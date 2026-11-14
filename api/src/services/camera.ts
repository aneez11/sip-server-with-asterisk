import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { OnvifClient, pickPreviewProfile, probeRtspCodec, type OnvifProfile } from "../lib/onvif.js";
import { encryptSecret, decryptSecret, canDecrypt } from "../lib/secret-box.js";

export interface CameraConfigInput {
  name?: string;
  location?: string;
  /** null clears the endpoint link; undefined leaves it untouched. */
  endpointId?: number | null;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  /** Omit to keep the stored password (write-only field). */
  password?: string;
  channel: number;
  preferredStream: "sub" | "main";
  profileToken?: string;
}

export interface CameraView {
  id: number;
  name: string;
  location: string;
  endpointId: number | null;
  /** Populated by list(); get() leaves it null. */
  endpointLabel: string | null;
  enabled: boolean;
  configured: boolean;
  reachable: boolean | null;
  host: string | null;
  port: number | null;
  username: string | null;
  hasPassword: boolean;
  channel: number;
  preferredStream: string;
  profileToken: string;
  profileName: string;
  streamUri: string | null;
  snapshotAvailable: boolean;
  /** Codec actually pulled over RTSP ("h264" / "hevc"), not what ONVIF claims. */
  streamCodec: string | null;
  streamWidth: number | null;
  streamHeight: number | null;
  lastCheckAt: string | null;
  lastCheckError: string | null;
  profiles: OnvifProfile[];
}

interface CameraRow {
  id: number;
  name: string;
  location: string;
  endpointId: number | null;
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  passwordCipher: string;
  channel: number;
  profileToken: string;
  profileName: string;
  rtspUri: string;
  snapshotUri: string;
  preferredStream: string;
  streamCodec: string;
  streamWidth: number | null;
  streamHeight: number | null;
  lastCheckAt: Date | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
}

export const EMPTY_VIEW: CameraView = {
  id: 0,
  name: "",
  location: "",
  endpointId: null,
  endpointLabel: null,
  enabled: false,
  configured: false,
  reachable: null,
  host: null,
  port: null,
  username: null,
  hasPassword: false,
  channel: 1,
  preferredStream: "sub",
  profileToken: "",
  profileName: "",
  streamUri: null,
  snapshotAvailable: false,
  streamCodec: null,
  streamWidth: null,
  streamHeight: null,
  lastCheckAt: null,
  lastCheckError: null,
  profiles: [],
};

/**
 * ONVIF camera configuration and probing.
 *
 * A camera is its own record; linking one to an endpoint is optional so
 * endpoint-less cameras (corridors, gates) can be managed from the Cameras page.
 * Credentials never leave the API: the operator writes a password, the API
 * stores it AES-GCM encrypted and only ever reports `hasPassword`. Every camera
 * failure is a soft failure — the voice path must not depend on this service.
 */
export class CameraService {
  private assertEnabled(): void {
    if (!config.camera.enabled)
      throw new ApiError(503, "Camera support is disabled on this server");
  }

  /** Every camera, alphabetically, with endpoint labels for the cards. */
  async list(): Promise<CameraView[]> {
    const [rows, endpoints] = await Promise.all([
      prisma.camera.findMany({ orderBy: { name: "asc" } }),
      prisma.endpoint.findMany({ select: { id: true, label: true, extension: true } }),
    ]);
    const labels = new Map(
      endpoints.map((e) => [e.id, `${e.label} (${e.extension})`]),
    );
    return rows.map((r) => ({
      ...toView(r as CameraRow),
      endpointLabel: r.endpointId != null ? (labels.get(r.endpointId) ?? null) : null,
    }));
  }

  /** Camera summary keyed by endpoint id, for the endpoint list. */
  async summaries(
    endpointIds?: number[],
  ): Promise<Map<number, { enabled: boolean; configured: boolean; reachable: boolean | null }>> {
    const rows = await prisma.camera.findMany({
      where: {
        endpointId: endpointIds ? { in: endpointIds } : { not: null },
      },
      select: { endpointId: true, enabled: true, host: true, lastCheckOk: true },
    });
    const out = new Map<
      number,
      { enabled: boolean; configured: boolean; reachable: boolean | null }
    >();
    for (const r of rows) {
      if (r.endpointId == null) continue;
      out.set(r.endpointId, {
        enabled: r.enabled,
        configured: Boolean(r.host),
        reachable: r.lastCheckOk ?? null,
      });
    }
    return out;
  }

  async get(id: number): Promise<CameraView> {
    const row = await prisma.camera.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Camera not found");
    return toView(row as CameraRow);
  }

  /** Endpoint adapter: the camera linked to an endpoint, if any. */
  async getForEndpoint(endpointId: number): Promise<CameraView> {
    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) throw new ApiError(404, "Endpoint not found");
    const row = await prisma.camera.findUnique({ where: { endpointId } });
    return row ? toView(row as CameraRow) : { ...EMPTY_VIEW };
  }

  async create(input: CameraConfigInput): Promise<CameraView> {
    this.assertEnabled();
    const name = (input.name ?? "").trim();
    if (!name) throw new ApiError(422, "Camera name is required");
    await this.assertEndpointFree(input.endpointId ?? null, null);

    const row = await prisma.camera.create({
      data: {
        name,
        location: (input.location ?? "").trim(),
        endpointId: input.endpointId ?? null,
        enabled: false,
        host: "",
        port: 80,
        username: "",
        channel: 1,
        preferredStream: "sub",
      },
    });
    return toView(row as CameraRow);
  }

  private async assertEndpointFree(
    endpointId: number | null,
    selfId: number | null,
  ): Promise<void> {
    if (endpointId == null) return;
    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) throw new ApiError(422, "Endpoint not found");
    const taken = await prisma.camera.findUnique({ where: { endpointId } });
    if (taken && taken.id !== selfId) {
      throw new ApiError(422, "That endpoint already has a camera", {
        endpointId: ["already assigned to another camera"],
      });
    }
  }

  /** Save config; probes the camera inline so the UI can show the result. */
  async save(id: number, input: CameraConfigInput): Promise<CameraView> {
    this.assertEnabled();
    const existing = await prisma.camera.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Camera not found");
    await this.assertEndpointFree(
      input.endpointId === undefined ? existing.endpointId : input.endpointId,
      id,
    );

    const providedPassword = input.password !== undefined && input.password !== "";
    const passwordCipher = providedPassword
      ? encryptSecret(input.password as string)
      : existing.passwordCipher;
    const password = providedPassword
      ? (input.password as string)
      : safeDecrypt(existing.passwordCipher);

    let profiles: OnvifProfile[] = [];
    let error: string | undefined;
    let rtspUri = existing.rtspUri;
    let snapshotUri = existing.snapshotUri;
    let profileToken = input.profileToken || existing.profileToken;
    let profileName = existing.profileName;
    let streamCodec = existing.streamCodec;
    let streamWidth: number | null = existing.streamWidth;
    let streamHeight: number | null = existing.streamHeight;

    if (input.host) {
      try {
        const probe = await new OnvifClient({
          host: input.host,
          port: input.port,
          username: input.username,
          password,
        }).probe();
        profiles = probe.profiles;
        const chosen =
          probe.profiles.find((p) => p.token === profileToken) ??
          pickPreviewProfile(probe.profiles);
        profileToken = chosen?.token ?? "";
        profileName = chosen?.name ?? "";
        rtspUri = probe.streamUri ?? "";
        snapshotUri = probe.snapshotUri ?? "";

        // ONVIF's encoder report is not always truthful (UNV reports H264 while
        // streaming H265), so verify what RTSP really carries.
        if (rtspUri) {
          const withCreds = withCredentials(rtspUri, input.username, password);
          const codec = await probeRtspCodec(withCreds);
          if (codec.ok) {
            streamCodec = codec.codec ?? "";
            streamWidth = codec.width ?? null;
            streamHeight = codec.height ?? null;
          } else {
            streamCodec = "";
            streamWidth = null;
            streamHeight = null;
            error = `ONVIF ok, but the RTSP stream could not be read: ${codec.error}`;
          }
        }
      } catch (e) {
        error = (e as Error).message;
      }
    }

    const name = input.name?.trim() || existing.name || input.host;
    const row = await prisma.camera.update({
      where: { id },
      data: {
        name,
        location: (input.location ?? existing.location).trim(),
        endpointId:
          input.endpointId === undefined ? existing.endpointId : input.endpointId,
        enabled: input.enabled,
        host: input.host,
        port: input.port,
        username: input.username,
        passwordCipher,
        channel: input.channel,
        preferredStream: input.preferredStream,
        profileToken,
        profileName,
        rtspUri,
        snapshotUri,
        streamCodec,
        streamWidth,
        streamHeight,
        lastCheckAt: new Date(),
        lastCheckOk: error ? false : input.host ? true : null,
        lastCheckError: error ?? null,
      },
    });
    return { ...toView(row as CameraRow), profiles };
  }

  /**
   * Metadata/enable changes that do not need an ONVIF probe.
   *
   * Save() re-probes the camera (seconds of latency), which is wrong for a card
   * toggle or linking an endpoint — those must feel instant.
   */
  async patchMeta(
    id: number,
    patch: {
      name?: string;
      location?: string;
      endpointId?: number | null;
      enabled?: boolean;
    },
  ): Promise<CameraView> {
    const existing = await prisma.camera.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Camera not found");

    const name = patch.name?.trim();
    if (patch.name !== undefined && !name) throw new ApiError(422, "Name cannot be empty");
    if (patch.endpointId !== undefined) {
      await this.assertEndpointFree(patch.endpointId, id);
    }

    const row = await prisma.camera.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(patch.location !== undefined ? { location: patch.location.trim() } : {}),
        ...(patch.endpointId !== undefined ? { endpointId: patch.endpointId } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      },
    });
    return toView(row as CameraRow);
  }

  async remove(id: number): Promise<void> {
    const row = await prisma.camera.findUnique({ where: { id } });
    if (!row) throw new ApiError(404, "Camera not found");
    await prisma.camera.delete({ where: { id } });
  }

  /** Endpoint adapter: unlink (or delete) the endpoint's camera. */
  async removeForEndpoint(endpointId: number): Promise<void> {
    const row = await prisma.camera.findUnique({ where: { endpointId } });
    if (row) await prisma.camera.delete({ where: { id: row.id } });
  }

  /** Endpoint adapter: save by endpoint id, creating the link if needed. */
  async saveForEndpoint(endpointId: number, input: CameraConfigInput): Promise<CameraView> {
    const existing = await prisma.camera.findUnique({ where: { endpointId } });
    if (existing) {
      return this.save(existing.id, { ...input, endpointId });
    }
    const created = await this.create({
      ...input,
      name: input.name?.trim() || `Camera for endpoint ${endpointId}`,
      endpointId,
    });
    return this.save(created.id, { ...input, endpointId });
  }

  /** "Test connection" — probe stored config, or unsaved values from the form. */
  async test(
    cameraId: number | undefined,
    overrides?: { host?: string; port?: number; username?: string; password?: string },
  ): Promise<{ ok: boolean; error?: string; profiles?: OnvifProfile[]; streamUri?: string; codec?: string }> {
    this.assertEnabled();
    const row = cameraId
      ? await prisma.camera.findUnique({ where: { id: cameraId } })
      : null;
    const host = overrides?.host?.trim() || row?.host || "";
    if (!host) throw new ApiError(422, "Enter the camera's host or IP address first");

    const password =
      overrides?.password && overrides.password !== ""
        ? overrides.password
        : safeDecrypt(row?.passwordCipher ?? "");

    try {
      const probe = await new OnvifClient({
        host,
        port: overrides?.port ?? row?.port ?? 80,
        username: overrides?.username ?? row?.username ?? "",
        password,
      }).probe();
      const codec = probe.streamUri
        ? await probeRtspCodec(
            withCredentials(probe.streamUri, overrides?.username ?? row?.username ?? "", password),
          )
        : { ok: false, error: "no stream URI" };

      if (row) {
        await prisma.camera.update({
          where: { id: row.id },
          data: {
            lastCheckAt: new Date(),
            lastCheckOk: true,
            lastCheckError: null,
            profileToken: row.profileToken || probe.suggestedToken || "",
            rtspUri: row.rtspUri || probe.streamUri || "",
            snapshotUri: row.snapshotUri || probe.snapshotUri || "",
            streamCodec: codec.ok ? (codec.codec ?? "") : row.streamCodec,
            streamWidth: codec.ok ? (codec.width ?? null) : row.streamWidth,
            streamHeight: codec.ok ? (codec.height ?? null) : row.streamHeight,
          },
        });
      }
      return {
        ok: true,
        profiles: probe.profiles,
        streamUri: probe.streamUri,
        codec: codec.ok ? codec.codec : undefined,
      };
    } catch (e) {
      const message = (e as Error).message;
      if (row) {
        await prisma.camera.update({
          where: { id: row.id },
          data: { lastCheckAt: new Date(), lastCheckOk: false, lastCheckError: message },
        });
      }
      return { ok: false, error: message };
    }
  }

  /** Endpoint adapter for test(): resolve the linked camera first. */
  async testForEndpoint(
    endpointId: number,
    overrides?: { host?: string; port?: number; username?: string; password?: string },
  ) {
    const row = await prisma.camera.findUnique({ where: { endpointId } });
    return this.test(row?.id, overrides);
  }

  /**
   * RTSP URI with credentials, for the media gateway only. The stored URI never
   * contains the password; it is injected here at pull time.
   */
  async rtspUriFor(
    cameraId: number,
  ): Promise<{ uri: string; snapshotUri: string; enabled: boolean; codec: string } | null> {
    const row = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!row || !row.rtspUri) return null;
    const u = new URL(row.rtspUri);
    if (row.username) {
      u.username = row.username;
      u.password = safeDecrypt(row.passwordCipher);
    }
    return {
      uri: u.toString(),
      snapshotUri: row.snapshotUri,
      enabled: row.enabled,
      codec: row.streamCodec,
    };
  }

  /** Endpoint adapter: resolve the endpoint's camera, then its RTSP URI. */
  async rtspUriForEndpoint(endpointId: number) {
    const row = await prisma.camera.findUnique({ where: { endpointId } });
    return row ? this.rtspUriFor(row.id) : null;
  }

  /** Proxied JPEG so the camera's credentials never reach the browser. */
  async snapshot(cameraId: number): Promise<{ body: Buffer; contentType: string }> {
    this.assertEnabled();
    const row = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!row?.snapshotUri) throw new ApiError(404, "No snapshot URI for this camera");
    const u = new URL(row.snapshotUri);
    if (row.username) {
      u.username = row.username;
      u.password = safeDecrypt(row.passwordCipher);
    }
    return fetchBinary(u.toString());
  }

  /** Endpoint adapter for snapshot(). */
  async snapshotForEndpoint(endpointId: number) {
    const row = await prisma.camera.findUnique({ where: { endpointId } });
    if (!row) throw new ApiError(404, "No camera linked to this endpoint");
    return this.snapshot(row.id);
  }

  /**
   * Turn a discovered ONVIF device into a camera record. Credentials are
   * optional: a discovered camera that rejects anonymous probes is created
   * disabled with its host filled in so the operator only has to add the user.
   */
  async addDiscovered(device: {
    host: string;
    port?: number;
    name?: string;
    location?: string;
  }): Promise<CameraView> {
    const existing = await prisma.camera.findFirst({ where: { host: device.host } });
    if (existing) throw new ApiError(422, "That camera is already added");
    return this.create({
      enabled: false,
      host: device.host,
      port: device.port ?? 80,
      username: "",
      channel: 1,
      preferredStream: "sub",
      name: device.name || device.host,
      location: device.location ?? "",
    });
  }
}

export function toView(row: CameraRow | null): CameraView {
  if (!row) return EMPTY_VIEW;
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    endpointId: row.endpointId,
    endpointLabel: null,
    enabled: row.enabled,
    configured: Boolean(row.host),
    reachable: row.lastCheckOk ?? null,
    host: row.host || null,
    port: row.port || null,
    username: row.username || null,
    hasPassword: Boolean(row.passwordCipher) && canDecrypt(row.passwordCipher),
    channel: row.channel,
    preferredStream: row.preferredStream,
    profileToken: row.profileToken,
    profileName: row.profileName,
    streamUri: row.rtspUri || null,
    // A snapshot URI is preferred, but the gateway can also serve a JPEG frame
    // from the RTSP stream when the camera has no ONVIF snapshot service.
    snapshotAvailable: Boolean(row.snapshotUri || row.rtspUri),
    streamCodec: row.streamCodec || null,
    streamWidth: row.streamWidth ?? null,
    streamHeight: row.streamHeight ?? null,
    lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
    lastCheckError: row.lastCheckError ?? null,
    profiles: [],
  };
}

function safeDecrypt(ciphertext: string): string {
  try {
    return decryptSecret(ciphertext);
  } catch {
    return "";
  }
}

/** Add credentials to an ONVIF-provided RTSP URI (used for local probing only). */
export function withCredentials(uri: string, username: string, password: string): string {
  if (!username) return uri;
  try {
    const u = new URL(uri);
    u.username = username;
    u.password = password;
    return u.toString();
  } catch {
    return uri;
  }
}

/** GET a binary resource with basic auth, retrying once with digest. */
export function fetchBinary(
  url: string,
  authorization?: string,
  timeoutMs = 6000,
): Promise<{ body: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers: Record<string, string> = {};
    if (authorization) headers.Authorization = authorization;
    else if (u.username) {
      headers.Authorization = `Basic ${Buffer.from(
        `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`,
      ).toString("base64")}`;
    }
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const challenge = res.headers["www-authenticate"];
        if (res.statusCode === 401 && challenge && !authorization?.startsWith("Digest")) {
          res.resume();
          fetchBinary(url, digestAuth(String(challenge), u, timeoutMs), timeoutMs).then(
            resolve,
            reject,
          );
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status >= 400) {
            reject(
              new ApiError(
                status === 401 ? 403 : 502,
                `Camera snapshot failed (HTTP ${status})`,
              ),
            );
            return;
          }
          resolve({
            body: Buffer.concat(chunks),
            contentType: String(res.headers["content-type"] ?? "image/jpeg"),
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("camera snapshot timeout")));
    req.on("error", reject);
    req.end();
  });
}

function digestAuth(challenge: string, u: URL, _timeoutMs: number): string {
  const get = (k: string) => new RegExp(`${k}="?([^",]+)"?`).exec(challenge)?.[1] ?? "";
  const realm = get("realm");
  const nonce = get("nonce");
  const qop = get("qop");
  const user = decodeURIComponent(u.username);
  const pass = decodeURIComponent(u.password);
  const uri = `${u.pathname}${u.search}`;
  const md5 = (v: string) => createHash("md5").update(v).digest("hex");
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`GET:${uri}`);
  const nc = "00000001";
  const cnonce = Math.random().toString(16).slice(2);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  let header = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  return header;
}
