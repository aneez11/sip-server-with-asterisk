import { createHash, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";

/**
 * Minimal ONVIF SOAP client — only what the console needs to attach a room
 * camera to an endpoint: capabilities, media profiles, stream URI, snapshot URI.
 *
 * Written by hand (no dependency) because the available npm ONVIF packages are
 * unmaintained and this is a small, fixed set of calls.
 *
 * UNV-specific behaviour handled here:
 *  - WS-Security UsernameToken with a SHA-1 *digest* (UNV rejects plain-text
 *    tokens on current firmware).
 *  - Media2 is tried first (`ver20`), then Media1 (`ver10`), because older UNV
 *    firmware only implements Media1.
 *  - `GetSystemDateAndTime` is called first: a camera whose clock is far off
 *    rejects the digest because the `Created` timestamp looks stale. Without
 *    `GetSystemDateAndTimeSupport` the camera's own clock is used.
 *  - HTTP digest auth for the SOAP endpoint, falling back to basic.
 */

export interface OnvifCameraTarget {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface OnvifProfile {
  token: string;
  name: string;
  width?: number;
  height?: number;
  encoding?: string;
  bitrateKbps?: number;
  framerate?: number;
}

export interface OnvifProbeResult {
  ok: boolean;
  manufacturer?: string;
  model?: string;
  firmware?: string;
  profiles: OnvifProfile[];
  /** Profile chosen for the preview (lowest resolution H.264 stream). */
  suggestedToken?: string;
  streamUri?: string;
  snapshotUri?: string;
  error?: string;
}

const NS_ENVELOPE = "http://www.w3.org/2003/05/soap-envelope";
const NS_DEVICE = "http://www.onvif.org/ver10/device/wsdl";
const NS_MEDIA1 = "http://www.onvif.org/ver10/media/wsdl";
const NS_MEDIA2 = "http://www.onvif.org/ver20/media/wsdl";
const NS_SCHEMA = "http://www.onvif.org/ver10/schema";

function escapeXml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wsSecurity(username: string, password: string, createdShiftMs: number): string {
  const nonce = randomBytes(16);
  const created = new Date(Date.now() + createdShiftMs).toISOString();
  const digest = createHash("sha1")
    .update(Buffer.concat([nonce, Buffer.from(created, "utf8"), Buffer.from(password, "utf8")]))
    .digest("base64");
  return (
    `<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">` +
    `<UsernameToken><Username>${escapeXml(username)}</Username>` +
    `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>` +
    `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString("base64")}</Nonce>` +
    `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>` +
    `</UsernameToken></Security></s:Header>`
  );
}

function envelope(header: string, body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="${NS_ENVELOPE}">${header}<s:Body>${body}</s:Body></s:Envelope>`
  );
}

/** Pull the text of the first `<tag>` (namespace-insensitive). */
function tagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(xml);
  return m ? m[1].trim() : undefined;
}

/** Pull every `<tag>` block (namespace-insensitive). */
function tagBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function attr(block: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]*)"`).exec(block);
  return m ? m[1] : undefined;
}

/** Extract a SOAP fault message for operator-facing errors. */
function faultOf(xml: string): string | undefined {
  const reason = tagText(xml, "Text") ?? tagText(xml, "Reason") ?? tagText(xml, "faultstring");
  if (reason) return reason.replace(/\s+/g, " ").trim();
  if (/Fault/i.test(xml)) return "ONVIF fault";
  return undefined;
}

interface HttpResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function httpPost(
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: { "Content-Type": `application/soap+xml; charset=utf-8`, ...headers },
        timeout: 8000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.from(c)));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("camera timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

/** Minimal HTTP Digest (MD5) — UNV's web/ONVIF endpoint uses it. */
function digestHeader(
  challenge: string,
  method: string,
  uri: string,
  username: string,
  password: string,
): string {
  const get = (k: string) => new RegExp(`${k}="?([^",]+)"?`).exec(challenge)?.[1] ?? "";
  const realm = get("realm");
  const nonce = get("nonce");
  const qop = get("qop");
  const opaque = get("opaque");
  const md5 = (v: string) => createHash("md5").update(v).digest("hex");
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  let header =
    `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", ` +
    `response="${response}"`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (opaque) header += `, opaque="${opaque}"`;
  return header;
}

/**
 * ONVIF client for one camera. `probe()` is the single entry point used by the
 * console ("Test connection" and saving the config).
 */
export class OnvifClient {
  constructor(private readonly target: OnvifCameraTarget) {}

  private get baseUrl(): string {
    return `http://${this.target.host}:${this.target.port}/onvif/device_service`;
  }

  private async post(envelopeXml: string, createdShiftMs = 0): Promise<string> {
    let res = await httpPost(this.baseUrl, envelopeXml, {});
    if (res.status === 401) {
      const challenge = String(res.headers["www-authenticate"] ?? "");
      const auth = challenge.toLowerCase().startsWith("digest")
        ? digestHeader(challenge, "POST", "/onvif/device_service", this.target.username, this.target.password)
        : `Basic ${Buffer.from(`${this.target.username}:${this.target.password}`).toString("base64")}`;
      res = await httpPost(this.baseUrl, envelopeXml, { Authorization: auth });
    }
    if (res.status >= 400) {
      const fault = faultOf(res.body);
      throw new Error(fault ?? `HTTP ${res.status} from camera`);
    }
    const fault = faultOf(res.body);
    if (fault) throw new Error(fault);
    return res.body;
  }

  private call(actionBody: string, createdShiftMs = 0): Promise<string> {
    const header = wsSecurity(
      this.target.username,
      this.target.password,
      createdShiftMs,
    );
    return this.post(envelope(header, actionBody), createdShiftMs);
  }

  /** Camera clock offset in ms (camera time - our time), clamped to ±2 days. */
  private async clockShiftMs(): Promise<number> {
    try {
      const xml = await this.call(
        `<GetSystemDateAndTime xmlns="${NS_DEVICE}"/>`,
        // No auth clock correction yet; some cameras allow this unauthenticated.
        0,
      );
      const utc = tagText(xml, "UTCDateTime");
      if (!utc) return 0;
      const date = tagText(utc, "Date");
      const time = tagText(utc, "Time");
      if (!date || !time) return 0;
      const y = Number(tagText(date, "Year"));
      const mo = Number(tagText(date, "Month"));
      const d = Number(tagText(date, "Day"));
      const h = Number(tagText(time, "Hour"));
      const mi = Number(tagText(time, "Minute"));
      const s = Number(tagText(time, "Second"));
      if (![y, mo, d, h, mi, s].every(Number.isFinite)) return 0;
      const camera = Date.UTC(y, mo - 1, d, h, mi, s);
      const shift = camera - Date.now();
      return Math.abs(shift) > 120_000 && Math.abs(shift) < 2 * 86_400_000 ? shift : 0;
    } catch {
      return 0;
    }
  }

  async probe(): Promise<OnvifProbeResult> {
    const shift = await this.clockShiftMs();
    const info = await this.call(`<GetDeviceInformation xmlns="${NS_DEVICE}"/>`, shift);
    const manufacturer = tagText(info, "Manufacturer");
    const model = tagText(info, "Model");
    const firmware = tagText(info, "FirmwareVersion");

    // Media2 first, Media1 fallback (older UNV firmware).
    let xml = "";
    let profiles: OnvifProfile[] = [];
    try {
      xml = await this.call(`<GetProfiles xmlns="${NS_MEDIA2}"/>`, shift);
      profiles = this.parseMedia2Profiles(xml);
    } catch {
      xml = await this.call(`<GetProfiles xmlns="${NS_MEDIA1}"/>`, shift);
      profiles = this.parseMedia1Profiles(xml);
    }
    if (profiles.length === 0) {
      throw new Error("Camera returned no ONVIF media profiles");
    }

    const chosen = pickPreviewProfile(profiles);
    const streamUri = await this.resolveStream(chosen.token, shift);
    const snapshotUri = await this.resolveSnapshot(chosen.token, shift).catch(() => undefined);

    return {
      ok: true,
      manufacturer,
      model,
      firmware,
      profiles,
      suggestedToken: chosen.token,
      streamUri,
      snapshotUri,
    };
  }

  private parseMedia2Profiles(xml: string): OnvifProfile[] {
    // Media2: <Profiles token="..."><Name>..</Name><Configurations>...
    const blocks = tagBlocks(xml, "Profiles");
    return blocks.map((b) => ({
      token: attr(b, "token") ?? "",
      name: tagText(b, "Name") ?? attr(b, "token") ?? "profile",
      width: Number(tagText(tagText(b, "VideoEncoderConfiguration") ?? "", "Width")) || undefined,
      height: Number(tagText(tagText(b, "VideoEncoderConfiguration") ?? "", "Height")) || undefined,
      encoding: tagText(tagText(b, "VideoEncoderConfiguration") ?? "", "Encoding") ?? undefined,
      bitrateKbps:
        Number(tagText(tagText(b, "VideoEncoderConfiguration") ?? "", "Bitrate")) || undefined,
      framerate:
        Number(tagText(tagText(b, "VideoEncoderConfiguration") ?? "", "FrameRateLimit")) || undefined,
    })).filter((p) => p.token);
  }

  private parseMedia1Profiles(xml: string): OnvifProfile[] {
    const blocks = tagBlocks(xml, "Profiles");
    return blocks.map((b) => {
      const video = tagText(b, "VideoEncoderConfiguration") ?? "";
      return {
        token: attr(b, "token") ?? "",
        name: tagText(b, "Name") ?? attr(b, "token") ?? "profile",
        width: Number(tagText(video, "Width")) || undefined,
        height: Number(tagText(video, "Height")) || undefined,
        encoding: tagText(video, "Encoding") ?? undefined,
        bitrateKbps: Number(tagText(video, "Bitrate")) || undefined,
        framerate: Number(tagText(video, "FrameRateLimit")) || undefined,
      };
    }).filter((p) => p.token);
  }

  private async resolveStream(profileToken: string, shift: number): Promise<string | undefined> {
    const token = escapeXml(profileToken);
    try {
      const xml = await this.call(
        `<GetStreamUri xmlns="${NS_MEDIA2}"><StreamSetup><Stream xmlns="${NS_SCHEMA}">RTP-Unicast</Stream>` +
          `<Transport xmlns="${NS_SCHEMA}"><Protocol>RTSP</Protocol></Transport></StreamSetup>` +
          `<ProfileToken>${token}</ProfileToken></GetStreamUri>`,
        shift,
      );
      return tagText(xml, "Uri");
    } catch {
      const xml = await this.call(
        `<GetStreamUri xmlns="${NS_MEDIA1}"><StreamSetup><Stream xmlns="${NS_SCHEMA}">RTP-Unicast</Stream>` +
          `<Transport xmlns="${NS_SCHEMA}"><Protocol>RTSP</Protocol></Transport></StreamSetup>` +
          `<ProfileToken>${token}</ProfileToken></GetStreamUri>`,
        shift,
      );
      return tagText(xml, "Uri");
    }
  }

  private async resolveSnapshot(profileToken: string, shift: number): Promise<string | undefined> {
    const token = escapeXml(profileToken);
    try {
      const xml = await this.call(
        `<GetSnapshotUri xmlns="${NS_MEDIA2}"><ProfileToken>${token}</ProfileToken></GetSnapshotUri>`,
        shift,
      );
      const uri = tagText(xml, "Uri");
      if (uri) return uri;
    } catch {
      // fall through to Media1
    }
    const xml = await this.call(
      `<GetSnapshotUri xmlns="${NS_MEDIA1}"><ProfileToken>${token}</ProfileToken></GetSnapshotUri>`,
      shift,
    );
    return tagText(xml, "Uri");
  }
}

/**
 * Prefer the lowest-resolution H.264 profile: that is the sub-stream on a UNV
 * camera, and H.264 is what WebRTC can pass through without transcoding.
 */
export function pickPreviewProfile(profiles: OnvifProfile[]): OnvifProfile {
  const h264 = profiles.filter((p) => !p.encoding || p.encoding.toUpperCase() === "H264");
  const pool = h264.length > 0 ? h264 : profiles;
  const area = (p: OnvifProfile) => (p.width ?? 1e6) * (p.height ?? 1e6);
  return [...pool].sort((a, b) => area(a) - area(b))[0];
}
