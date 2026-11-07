import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { request as httpRequest } from "node:http";

const execFileAsync = promisify(execFile);

/**
 * Minimal ONVIF SOAP client — only what the console needs to attach a room
 * camera to an endpoint: capabilities, media profiles, stream URI, snapshot URI.
 *
 * Written by hand (no dependency) because the available npm ONVIF packages are
 * unmaintained and this is a small, fixed set of calls.
 *
 * Device behaviours handled here (validated against a UNV camera):
 *  - The media service lives at its own XAddr advertised by `GetCapabilities`
 *    (UNV: `/onvif/media`). Posting media calls to `/onvif/device_service`
 *    returns an empty SOAP body, which is what produced "no media profiles".
 *  - The profile token is an attribute of the `<Profiles>` element itself; the
 *    nested `VideoSourceConfiguration` has its own unrelated token.
 *  - Media2 (`ver20`) is tried first, then Media1 (`ver10`) — UNV exposes Media1
 *    only.
 *  - WS-Security UsernameToken with a SHA-1 digest (UNV rejects plain text), and
 *    clock-skew compensation from `GetSystemDateAndTime`.
 *  - `GetSnapshotUri` may be "Optional Action Not Implemented" — that is not an
 *    error, the preview simply falls back to video only.
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
  suggestedToken?: string;
  streamUri?: string;
  snapshotUri?: string;
  /** Media service actually used (diagnostics). */
  mediaService?: string;
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

function tagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([^<]*)</(?:[\\w-]+:)?${tag}>`).exec(xml);
  return m ? m[1].trim() : undefined;
}

/** Inner content of the first matching element. */
function innerOf(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`).exec(xml);
  return m ? m[1] : undefined;
}

/** [attributes, innerXml] for every matching element — the token lives in the attrs. */
function elements(xml: string, tag: string): Array<[string, string]> {
  const re = new RegExp(`<(?:[\\w-]+:)?${tag}\\b([^>]*)>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`, "g");
  const out: Array<[string, string]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push([m[1], m[2]]);
  return out;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
}

function faultOf(xml: string): string | undefined {
  const reason = innerOf(xml, "Reason") ?? innerOf(xml, "Detail");
  const text = reason ? tagText(reason, "Text") : undefined;
  const fallback =
    tagText(xml, "Text") ?? tagText(xml, "faultstring") ?? tagText(xml, "Value");
  const msg = (text ?? fallback ?? "").replace(/\s+/g, " ").trim();
  if (msg) return msg;
  return /Fault/i.test(xml) ? "ONVIF fault" : undefined;
}

interface HttpResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

function httpPost(url: string, body: string, headers: Record<string, string>): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: { "Content-Type": "application/soap+xml; charset=utf-8", ...headers },
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

/** HTTP Digest (MD5) for cameras that protect the ONVIF endpoint itself. */
function digestHeader(challenge: string, method: string, uri: string, username: string, password: string): string {
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
  let header = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
  if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (opaque) header += `, opaque="${opaque}"`;
  return header;
}

export class OnvifClient {
  private mediaUrls: { media2?: string; media1?: string } | null = null;

  constructor(private readonly target: OnvifCameraTarget) {}

  private get deviceUrl(): string {
    return `http://${this.target.host}:${this.target.port}/onvif/device_service`;
  }

  private async post(url: string, envelopeXml: string): Promise<string> {
    let res = await httpPost(url, envelopeXml, {});
    if (res.status === 401) {
      const challenge = String(res.headers["www-authenticate"] ?? "");
      const u = new URL(url);
      const auth = challenge.toLowerCase().startsWith("digest")
        ? digestHeader(challenge, "POST", u.pathname, this.target.username, this.target.password)
        : `Basic ${Buffer.from(`${this.target.username}:${this.target.password}`).toString("base64")}`;
      res = await httpPost(url, envelopeXml, { Authorization: auth });
    }
    if (res.status >= 400) {
      throw new Error(faultOf(res.body) ?? `HTTP ${res.status} from camera`);
    }
    const fault = faultOf(res.body);
    if (fault) throw new Error(fault);
    return res.body;
  }

  private call(url: string, actionBody: string, createdShiftMs = 0): Promise<string> {
    return this.post(
      url,
      envelope(wsSecurity(this.target.username, this.target.password, createdShiftMs), actionBody),
    );
  }

  private async callDevice(actionBody: string, shift = 0): Promise<string> {
    return this.call(this.deviceUrl, actionBody, shift);
  }

  /** Camera clock offset in ms, used to keep the WS-Security timestamp valid. */
  private async clockShiftMs(): Promise<number> {
    try {
      const xml = await this.callDevice(`<GetSystemDateAndTime xmlns="${NS_DEVICE}"/>`);
      const utc = innerOf(xml, "UTCDateTime");
      if (!utc) return 0;
      const date = innerOf(utc, "Date");
      const time = innerOf(utc, "Time");
      if (!date || !time) return 0;
      const y = Number(tagText(date, "Year"));
      const mo = Number(tagText(date, "Month"));
      const d = Number(tagText(date, "Day"));
      const h = Number(tagText(time, "Hour"));
      const mi = Number(tagText(time, "Minute"));
      const s = Number(tagText(time, "Second"));
      if (![y, mo, d, h, mi, s].every(Number.isFinite)) return 0;
      const shift = Date.UTC(y, mo - 1, d, h, mi, s) - Date.now();
      return Math.abs(shift) > 120_000 && Math.abs(shift) < 2 * 86_400_000 ? shift : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Resolve the media service URLs from GetCapabilities. Falls back to the
   * conventional `/onvif/media` path when the camera omits the block.
   */
  private async resolveMediaUrls(shift: number): Promise<{ media2?: string; media1?: string }> {
    if (this.mediaUrls) return this.mediaUrls;
    let media1: string | undefined;
    let media2: string | undefined;
    try {
      const xml = await this.callDevice(
        `<GetCapabilities xmlns="${NS_DEVICE}"><Category>All</Category></GetCapabilities>`,
        shift,
      );
      const caps = innerOf(xml, "Capabilities") ?? xml;
      const m1 = innerOf(caps, "Media");
      const m2 = innerOf(caps, "Media2");
      media1 = m1 ? tagText(m1, "XAddr") : undefined;
      media2 = m2 ? tagText(m2, "XAddr") : undefined;
    } catch {
      // ignore — conventional paths below
    }
    this.mediaUrls = {
      media1: media1 || `http://${this.target.host}:${this.target.port}/onvif/media`,
      media2,
    };
    return this.mediaUrls;
  }

  async probe(): Promise<OnvifProbeResult> {
    const shift = await this.clockShiftMs();
    const info = await this.callDevice(`<GetDeviceInformation xmlns="${NS_DEVICE}"/>`, shift);
    const manufacturer = tagText(info, "Manufacturer");
    const model = tagText(info, "Model");
    const firmware = tagText(info, "FirmwareVersion");

    const urls = await this.resolveMediaUrls(shift);
    let profiles: OnvifProfile[] = [];
    let mediaService = urls.media1;

    if (urls.media2) {
      try {
        const xml = await this.call(urls.media2, `<GetProfiles xmlns="${NS_MEDIA2}"/>`, shift);
        profiles = parseProfiles(xml);
        if (profiles.length > 0) mediaService = urls.media2;
      } catch {
        // fall through to Media1
      }
    }
    if (profiles.length === 0 && urls.media1) {
      const xml = await this.call(urls.media1, `<GetProfiles xmlns="${NS_MEDIA1}"/>`, shift);
      profiles = parseProfiles(xml);
      mediaService = urls.media1;
    }
    if (profiles.length === 0) throw new Error("Camera returned no ONVIF media profiles");

    const chosen = pickPreviewProfile(profiles);
    const streamUri = await this.resolveStream(chosen.token, urls, shift);
    const snapshotUri = await this.resolveSnapshot(chosen.token, urls, shift).catch(() => undefined);

    return {
      ok: true,
      manufacturer,
      model,
      firmware,
      profiles,
      suggestedToken: chosen.token,
      streamUri,
      snapshotUri,
      mediaService,
    };
  }

  private async resolveStream(
    profileToken: string,
    urls: { media2?: string; media1?: string },
    shift: number,
  ): Promise<string | undefined> {
    const token = escapeXml(profileToken);
    if (urls.media2) {
      try {
        const xml = await this.call(
          urls.media2,
          `<GetStreamUri xmlns="${NS_MEDIA2}"><StreamSetup><Stream xmlns="${NS_SCHEMA}">RTP-Unicast</Stream>` +
            `<Transport xmlns="${NS_SCHEMA}"><Protocol>RTSP</Protocol></Transport></StreamSetup>` +
            `<ProfileToken>${token}</ProfileToken></GetStreamUri>`,
          shift,
        );
        const uri = tagText(xml, "Uri");
        if (uri) return uri;
      } catch {
        // fall through
      }
    }
    if (!urls.media1) return undefined;
    const xml = await this.call(
      urls.media1,
      `<GetStreamUri xmlns="${NS_MEDIA1}"><StreamSetup><Stream xmlns="${NS_SCHEMA}">RTP-Unicast</Stream>` +
        `<Transport xmlns="${NS_SCHEMA}"><Protocol>RTSP</Protocol></Transport></StreamSetup>` +
        `<ProfileToken>${token}</ProfileToken></GetStreamUri>`,
      shift,
    );
    return tagText(xml, "Uri");
  }

  private async resolveSnapshot(
    profileToken: string,
    urls: { media2?: string; media1?: string },
    shift: number,
  ): Promise<string | undefined> {
    const token = escapeXml(profileToken);
    if (urls.media2) {
      try {
        const xml = await this.call(
          urls.media2,
          `<GetSnapshotUri xmlns="${NS_MEDIA2}"><ProfileToken>${token}</ProfileToken></GetSnapshotUri>`,
          shift,
        );
        const uri = tagText(xml, "Uri");
        if (uri) return uri;
      } catch {
        // fall through
      }
    }
    if (!urls.media1) return undefined;
    const xml = await this.call(
      urls.media1,
      `<GetSnapshotUri xmlns="${NS_MEDIA1}"><ProfileToken>${token}</ProfileToken></GetSnapshotUri>`,
      shift,
    );
    return tagText(xml, "Uri");
  }
}

/** Parse `<Profiles token="...">` elements (Media1 and Media2 share the shape). */
export function parseProfiles(xml: string): OnvifProfile[] {
  const out: OnvifProfile[] = [];
  for (const [attrs, body] of elements(xml, "Profiles")) {
    const token = attr(attrs, "token");
    if (!token) continue;
    const video = innerOf(body, "VideoEncoderConfiguration") ?? "";
    out.push({
      token,
      name: tagText(body, "Name") ?? token,
      width: Number(tagText(video, "Width")) || undefined,
      height: Number(tagText(video, "Height")) || undefined,
      encoding: tagText(video, "Encoding") ?? undefined,
      bitrateKbps: Number(tagText(video, "Bitrate")) || undefined,
      framerate: Number(tagText(video, "FrameRateLimit")) || undefined,
    });
  }
  return out;
}

/**
 * Prefer a low-bandwidth H.264 profile: the largest one that is still at most
 * 720p (the sub-stream on a UNV camera), else the smallest available.
 *
 * Note: some cameras *report* H264 here while actually streaming H.265, so the
 * real codec is verified separately with ffprobe (see services/camera.ts).
 */
export function pickPreviewProfile(profiles: OnvifProfile[]): OnvifProfile {
  const h264 = profiles.filter((p) => !p.encoding || p.encoding.toUpperCase() === "H264");
  const pool = h264.length > 0 ? h264 : profiles;
  const area = (p: OnvifProfile) => (p.width ?? 1e6) * (p.height ?? 1e6);
  const preview = pool.filter(
    (p) => (p.width ?? 0) > 0 && (p.width ?? 0) <= 1280 && (p.height ?? 0) <= 720,
  );
  const candidates = preview.length > 0 ? preview : pool;
  return [...candidates].sort((a, b) => area(b) - area(a))[0];
}

export interface CodecInfo {
  codec?: string;
  width?: number;
  height?: number;
  ok: boolean;
  error?: string;
}

/**
 * Ask ffprobe what the RTSP stream really carries. ONVIF's encoder report can
 * disagree with reality (UNV cameras report H264 while streaming H.265).
 */
export async function probeRtspCodec(uri: string, timeoutSec = 12): Promise<CodecInfo> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-rtsp_transport",
        "tcp",
        "-timeout",
        String(timeoutSec * 1_000_000),
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height",
        "-of",
        "default=nw=1",
        uri,
      ],
      { timeout: (timeoutSec + 4) * 1000 },
    );
    const get = (k: string) => new RegExp(`^${k}=(.+)$`, "m").exec(stdout)?.[1]?.trim();
    const codec = get("codec_name");
    if (!codec) return { ok: false, error: "ffprobe returned no video stream" };
    return {
      ok: true,
      codec,
      width: Number(get("width")) || undefined,
      height: Number(get("height")) || undefined,
    };
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0];
    return { ok: false, error: msg };
  }
}
