import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import type { CameraService } from "./camera.js";

/**
 * Bridges a room camera's RTSP stream to the browser for the duration of a
 * two-way talk, using the go2rtc gateway as an RTSP -> WebRTC bridge.
 *
 * Flow
 *   1. `ensure(talkId, endpointId)` — only for a live `twoway` talk, only when
 *      the endpoint has an enabled camera. Mints a short-lived, talk-bound
 *      token; the browser receives the token only.
 *   2. Browser POSTs its SDP offer to `/api/camera/whep/<token>`.
 *   3. The API registers the camera with go2rtc (`PUT /api/streams`) under a
 *      name derived from the endpoint, forwards the offer to
 *      `/api/webrtc?src=<name>` and returns the answer.
 *   4. On talk stop the stream is deleted, which closes the camera session.
 *
 * Codecs: browsers cannot decode HEVC over WebRTC, and UNV cameras commonly
 * report H264 in ONVIF while actually streaming H265. The codec stored at config
 * time (ffprobe) decides whether go2rtc must transcode (`ffmpeg:…#video=h264`).
 * Direct passthrough is used whenever the camera really is H.264.
 */
export class CameraStreamService {
  private tokens = new Map<string, { talkId: string; endpointId: number; exp: number }>();

  constructor(private readonly camera: CameraService) {}

  private static streamName(endpointId: number): string {
    return `cam-${endpointId}`;
  }

  /** Validate that this talk is a two-way call to this endpoint. */
  ensure(talk: { id: string; mode: string; endpointIds: number[] }, endpointId: number): {
    token: string;
    expiresAt: string;
  } {
    if (!config.camera.enabled)
      throw new ApiError(503, "Camera support is disabled on this server");
    if (talk.mode !== "twoway")
      throw new ApiError(422, "Camera preview is only available for two-way calls");
    if (!talk.endpointIds.includes(endpointId))
      throw new ApiError(422, "Endpoint is not the target of this talk");

    const exp = Date.now() + config.camera.tokenTtlSec * 1000;
    const payload = Buffer.from(JSON.stringify({ t: talk.id, e: endpointId, x: exp })).toString(
      "base64url",
    );
    const token = `${payload}.${this.sign(payload)}`;
    this.tokens.set(token, { talkId: talk.id, endpointId, exp });
    console.log(`[camera] token talk=${talk.id} endpoint=${endpointId}`);
    return { token, expiresAt: new Date(exp).toISOString() };
  }

  /** Drop tokens (and gateway streams) belonging to a finished talk. */
  stop(talkId: string): void {
    const endpoints = new Set<number>();
    for (const [token, v] of this.tokens) {
      if (v.talkId === talkId) {
        this.tokens.delete(token);
        endpoints.add(v.endpointId);
      }
    }
    for (const id of endpoints) void this.unregister(CameraStreamService.streamName(id));
    if (endpoints.size > 0)
      console.log(`[camera] closed talk=${talkId} endpoints=${[...endpoints].join(",")}`);
  }

  stopAll(): void {
    const endpoints = new Set([...this.tokens.values()].map((v) => v.endpointId));
    this.tokens.clear();
    for (const id of endpoints) void this.unregister(CameraStreamService.streamName(id));
  }

  private sign(payload: string): string {
    return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  }

  private verify(token: string): { endpointId: number; talkId: string } {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) throw new ApiError(401, "Invalid camera token");
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new ApiError(401, "Invalid camera token");

    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      t: string;
      e: number;
      x: number;
    };
    if (!parsed.x || parsed.x < Date.now()) throw new ApiError(401, "Camera token expired");
    if (!this.tokens.has(token)) throw new ApiError(401, "Camera session closed");
    return { endpointId: parsed.e, talkId: parsed.t };
  }

  /** Forward a WHEP offer for a tokenized camera to the gateway. */
  async whep(
    token: string,
    offer: string,
    contentType: string,
  ): Promise<{ body: string; contentType: string }> {
    const { endpointId } = this.verify(token);
    const cam = await this.camera.rtspUriFor(endpointId);
    if (!cam || !cam.enabled) throw new ApiError(404, "Camera is not enabled for this endpoint");

    const codec = (cam.codec || "").toLowerCase();
    const needsTranscode =
      config.camera.transcode === "auto" && codec !== "" && codec !== "h264" && codec !== "avc1";
    if (needsTranscode && config.camera.transcode === "never") {
      throw new ApiError(422, `Camera streams ${codec.toUpperCase()} — switch it to H.264 to preview`);
    }

    const name = CameraStreamService.streamName(endpointId);
    const src = needsTranscode ? `ffmpeg:${cam.uri}#video=h264` : cam.uri;
    await this.register(name, src);
    if (needsTranscode)
      console.log(`[camera] transcoding ${codec} -> h264 endpoint=${endpointId}`);

    const url = `${config.camera.gatewayUrl}/api/webrtc?src=${encodeURIComponent(name)}`;
    console.log(`[camera] whep endpoint=${endpointId} stream=${name} offer=${offer.length}B`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType || "application/sdp" },
      body: offer,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (!res.ok) {
      console.warn(`[camera] gateway error endpoint=${endpointId} status=${res.status}`);
      throw new ApiError(502, `Camera gateway rejected the stream (HTTP ${res.status})`, {
        gateway: [body.slice(0, 300)],
      });
    }
    console.log(`[camera] whep ok endpoint=${endpointId} answer=${body.length}B`);
    return { body, contentType: res.headers.get("content-type") ?? "application/sdp" };
  }

  /** Register (or replace) the gateway stream for an endpoint. */
  private async register(name: string, src: string): Promise<void> {
    // Drop a stale producer first so an old camera session cannot linger.
    await this.unregister(name);
    const url = `${config.camera.gatewayUrl}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`;
    const res = await fetch(url, { method: "PUT", signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[camera] register failed name=${name} status=${res.status}`);
      throw new ApiError(502, `Camera gateway could not open the stream (HTTP ${res.status})`, {
        gateway: [detail.slice(0, 200)],
      });
    }
  }

  private async unregister(name: string): Promise<void> {
    try {
      await fetch(`${config.camera.gatewayUrl}/api/streams?src=${encodeURIComponent(name)}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // best effort — a stale stream is harmless, the producer idle-times out
    }
  }

  /** Gateway reachability, surfaced in the endpoint test result. */
  async gatewayStatus(): Promise<boolean> {
    try {
      const res = await fetch(`${config.camera.gatewayUrl}/api/streams`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
