import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { OnvifClient, pickPreviewProfile, type OnvifProfile } from "../lib/onvif.js";
import { encryptSecret, decryptSecret, canDecrypt } from "../lib/secret-box.js";

export interface CameraConfigInput {
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
  lastCheckAt: string | null;
  lastCheckError: string | null;
  profiles: OnvifProfile[];
}

interface CameraRow {
  endpointId: number;
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
  lastCheckAt: Date | null;
  lastCheckOk: boolean | null;
  lastCheckError: string | null;
}

const EMPTY_VIEW: CameraView = {
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
  lastCheckAt: null,
  lastCheckError: null,
  profiles: [],
};

/**
 * Per-endpoint ONVIF camera configuration and probing.
 *
 * Credentials never leave the API: the operator writes a password, the API
 * stores it AES-GCM encrypted and only ever reports `hasPassword`. Every camera
 * failure is a soft failure — the voice path must not depend on this service.
 */
export class CameraService {
  private assertEnabled(): void {
    if (!config.camera.enabled)
      throw new ApiError(503, "Camera support is disabled on this server");
  }

  /** Camera summary for the endpoint list (no secrets). */
  async summaries(
    endpointIds?: number[],
  ): Promise<Map<number, { enabled: boolean; configured: boolean; reachable: boolean | null }>> {
    const rows = await prisma.endpointCamera.findMany({
      where: endpointIds ? { endpointId: { in: endpointIds } } : undefined,
    });
    return new Map(
      rows.map((r) => [
        r.endpointId,
        { enabled: r.enabled, configured: Boolean(r.host), reachable: r.lastCheckOk ?? null },
      ]),
    );
  }

  async get(endpointId: number): Promise<CameraView> {
    const row = await prisma.endpointCamera.findUnique({ where: { endpointId } });
    await this.assertEndpoint(endpointId);
    return toView(row);
  }

  private async assertEndpoint(endpointId: number): Promise<void> {
    const endpoint = await prisma.endpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) throw new ApiError(404, "Endpoint not found");
  }

  /** Save config; probes the camera inline so the UI can show the result. */
  async save(endpointId: number, input: CameraConfigInput): Promise<CameraView> {
    this.assertEnabled();
    await this.assertEndpoint(endpointId);
    const existing = await prisma.endpointCamera.findUnique({ where: { endpointId } });

    const providedPassword = input.password !== undefined && input.password !== "";
    const passwordCipher = providedPassword
      ? encryptSecret(input.password as string)
      : (existing?.passwordCipher ?? "");
    const password = providedPassword
      ? (input.password as string)
      : safeDecrypt(existing?.passwordCipher ?? "");

    let profiles: OnvifProfile[] = [];
    let error: string | undefined;
    let rtspUri = existing?.rtspUri ?? "";
    let snapshotUri = existing?.snapshotUri ?? "";
    let profileToken = input.profileToken || existing?.profileToken || "";
    let profileName = existing?.profileName ?? "";

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
      } catch (e) {
        error = (e as Error).message;
      }
    }

    const data = {
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
      lastCheckAt: new Date(),
      lastCheckOk: error ? false : input.host ? true : null,
      lastCheckError: error ?? null,
    };
    const row = existing
      ? await prisma.endpointCamera.update({ where: { endpointId }, data })
      : await prisma.endpointCamera.create({ data: { endpointId, ...data } });
    return { ...toView(row), profiles };
  }

  async remove(endpointId: number): Promise<void> {
    await prisma.endpointCamera.deleteMany({ where: { endpointId } });
  }

  /** "Test connection" — probe without saving the configuration. */
  async test(
    endpointId: number,
  ): Promise<{ ok: boolean; error?: string; profiles?: OnvifProfile[]; streamUri?: string }> {
    this.assertEnabled();
    const row = await prisma.endpointCamera.findUnique({ where: { endpointId } });
    if (!row?.host) throw new ApiError(422, "No camera configured for this endpoint");
    try {
      const probe = await new OnvifClient({
        host: row.host,
        port: row.port,
        username: row.username,
        password: safeDecrypt(row.passwordCipher),
      }).probe();
      await prisma.endpointCamera.update({
        where: { endpointId },
        data: {
          lastCheckAt: new Date(),
          lastCheckOk: true,
          lastCheckError: null,
          profileToken: row.profileToken || probe.suggestedToken || "",
          rtspUri: row.rtspUri || probe.streamUri || "",
          snapshotUri: row.snapshotUri || probe.snapshotUri || "",
        },
      });
      return { ok: true, profiles: probe.profiles, streamUri: probe.streamUri };
    } catch (e) {
      const message = (e as Error).message;
      await prisma.endpointCamera.update({
        where: { endpointId },
        data: { lastCheckAt: new Date(), lastCheckOk: false, lastCheckError: message },
      });
      return { ok: false, error: message };
    }
  }

  /**
   * RTSP URI with credentials, for the media gateway only. The stored URI never
   * contains the password; it is injected here at pull time.
   */
  async rtspUriFor(
    endpointId: number,
  ): Promise<{ uri: string; snapshotUri: string; enabled: boolean } | null> {
    const row = await prisma.endpointCamera.findUnique({ where: { endpointId } });
    if (!row || !row.rtspUri) return null;
    const u = new URL(row.rtspUri);
    if (row.username) {
      u.username = row.username;
      u.password = safeDecrypt(row.passwordCipher);
    }
    return { uri: u.toString(), snapshotUri: row.snapshotUri, enabled: row.enabled };
  }

  /** Proxied JPEG so the camera's credentials never reach the browser. */
  async snapshot(endpointId: number): Promise<{ body: Buffer; contentType: string }> {
    this.assertEnabled();
    const row = await prisma.endpointCamera.findUnique({ where: { endpointId } });
    if (!row?.snapshotUri) throw new ApiError(404, "No snapshot URI for this camera");
    const u = new URL(row.snapshotUri);
    if (row.username) {
      u.username = row.username;
      u.password = safeDecrypt(row.passwordCipher);
    }
    return fetchBinary(u.toString());
  }
}

export function toView(row: CameraRow | null): CameraView {
  if (!row) return EMPTY_VIEW;
  return {
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
    snapshotAvailable: Boolean(row.snapshotUri),
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
