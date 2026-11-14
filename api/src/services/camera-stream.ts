import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import type { CameraService } from "./camera.js";

/**
 * Bridges a camera's RTSP stream to the browser using the go2rtc gateway as an
 * RTSP -> WebRTC bridge.
 *
 * Two ways in:
 *   - **Talk-bound** (`ensure(talk, endpointId)`) — a two-way call to an
 *     endpoint that has a camera. The token carries the talk and camera ids.
 *   - **Preview** (`preview(cameraId)`) — the Cameras page, with no call active.
 *     The token carries only the camera id and is revoked on disable/delete.
 *
 * In both cases the browser receives only a token; it POSTs its SDP offer to
 * `/api/camera/whep/<token>`, the API registers the camera with go2rtc
 * (`PUT /api/streams`) as `cam-<cameraId>`, forwards the offer, and deletes the
 * stream when the session ends.
 *
 * Codecs: browsers cannot decode HEVC over WebRTC, and UNV cameras commonly
 * report H264 in ONVIF while actually streaming H265. The codec stored at config
 * time (ffprobe) decides whether go2rtc must transcode (`ffmpeg:…#video=h264`).
 * Direct passthrough is used whenever the camera really is H.264.
 */
export class CameraStreamService {
  private tokens = new Map<
    string,
    { cameraId: number; talkId?: string; endpointId?: number; exp: number }
  >();
  /** Streams the gateway currently knows about (avoids re-opening on every frame). */
  private readonly registered = new Set<string>();
  /** Streams serving an active WHEP peer; never idle-torn-down. */
  private readonly whepStreams = new Set<string>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly camera: CameraService) {}

  private static streamName(cameraId: number): string {
    return `cam-${cameraId}`;
  }

  /**
   * Gateway source for a camera. H.264 is passed through untouched; anything
   * else is transcoded when the deployment allows it, and refused otherwise.
   */
  private static sourceFor(cam: { uri: string; codec: string }): {
    src: string;
    transcode: boolean;
    codec: string;
  } {
    const codec = (cam.codec || "").toLowerCase();
    if (codec === "" || codec === "h264" || codec === "avc1")
      return { src: cam.uri, transcode: false, codec };
    if (config.camera.transcode !== "auto")
      throw new ApiError(
        422,
        `Camera streams ${codec.toUpperCase()} — switch it to H.264 to preview`,
      );
    return { src: `ffmpeg:${cam.uri}#video=h264`, transcode: true, codec };
  }

  /** Talk path: validate the talk targets this endpoint and mint a token. */
  async ensure(
    talk: { id: string; mode: string; endpointIds: number[] },
    endpointId: number,
  ): Promise<{ token: string; expiresAt: string }> {
    if (!config.camera.enabled)
      throw new ApiError(503, "Camera support is disabled on this server");
    if (talk.mode !== "twoway")
      throw new ApiError(422, "Camera preview is only available for two-way calls");
    if (!talk.endpointIds.includes(endpointId))
      throw new ApiError(422, "Endpoint is not the target of this talk");

    const cam = await this.camera.getForEndpoint(endpointId);
    if (!cam.id) throw new ApiError(404, "No camera linked to this endpoint");

    const token = this.mint({
      cameraId: cam.id,
      talkId: talk.id,
      endpointId,
    });
    console.log(`[camera] token talk=${talk.id} endpoint=${endpointId} camera=${cam.id}`);
    return token;
  }

  /** Preview path: any enabled, configured camera, with no talk involved. */
  async preview(cameraId: number): Promise<{ token: string; expiresAt: string }> {
    if (!config.camera.enabled)
      throw new ApiError(503, "Camera support is disabled on this server");
    const cam = await this.camera.get(cameraId);
    if (!cam.enabled) throw new ApiError(422, "Camera is disabled");
    if (!cam.configured) throw new ApiError(422, "Camera has no host configured");

    const token = this.mint({ cameraId });
    console.log(`[camera] preview token camera=${cameraId}`);
    return token;
  }

  private mint(payload: {
    cameraId: number;
    talkId?: string;
    endpointId?: number;
  }): { token: string; expiresAt: string } {
    const exp = Date.now() + config.camera.tokenTtlSec * 1000;
    const encoded = Buffer.from(
      JSON.stringify({
        c: payload.cameraId,
        t: payload.talkId,
        e: payload.endpointId,
        x: exp,
      }),
    ).toString("base64url");
    const token = `${encoded}.${this.sign(encoded)}`;
    this.tokens.set(token, {
      cameraId: payload.cameraId,
      talkId: payload.talkId,
      endpointId: payload.endpointId,
      exp,
    });
    return { token, expiresAt: new Date(exp).toISOString() };
  }

  /** Drop tokens and gateway streams belonging to a finished talk. */
  stop(talkId: string): void {
    const cameras = new Set<number>();
    for (const [token, v] of this.tokens) {
      if (v.talkId === talkId) {
        this.tokens.delete(token);
        cameras.add(v.cameraId);
      }
    }
    for (const id of cameras) void this.unregister(CameraStreamService.streamName(id));
    if (cameras.size > 0)
      console.log(`[camera] closed talk=${talkId} cameras=${[...cameras].join(",")}`);
  }

  /** Drop every token (and stream) for one camera — used on disable/delete. */
  async revoke(cameraId: number): Promise<void> {
    for (const [token, v] of this.tokens) {
      if (v.cameraId === cameraId) this.tokens.delete(token);
    }
    await this.unregister(CameraStreamService.streamName(cameraId));
  }

  stopAll(): void {
    const cameras = new Set([...this.tokens.values()].map((v) => v.cameraId));
    this.tokens.clear();
    for (const id of cameras) void this.unregister(CameraStreamService.streamName(id));
  }

  private sign(payload: string): string {
    return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  }

  private verify(token: string): { cameraId: number; talkId?: string } {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) throw new ApiError(401, "Invalid camera token");
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new ApiError(401, "Invalid camera token");

    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      c: number;
      t?: string;
      e?: number;
      x: number;
    };
    if (!parsed.c) throw new ApiError(401, "Invalid camera token");
    if (!parsed.x || parsed.x < Date.now()) throw new ApiError(401, "Camera token expired");
    if (!this.tokens.has(token)) throw new ApiError(401, "Camera session closed");
    return { cameraId: parsed.c, talkId: parsed.t };
  }

  /** Forward a WHEP offer for a tokenized camera to the gateway. */
  async whep(
    token: string,
    offer: string,
    contentType: string,
  ): Promise<{ body: string; contentType: string }> {
    const { cameraId } = this.verify(token);
    const cam = await this.camera.rtspUriFor(cameraId);
    if (!cam || !cam.enabled) throw new ApiError(404, "Camera is not enabled");

    const name = CameraStreamService.streamName(cameraId);
    const source = CameraStreamService.sourceFor(cam);
    await this.register(name, source.src);
    this.whepStreams.add(name);
    if (source.transcode)
      console.log(`[camera] transcoding ${source.codec} -> h264 camera=${cameraId}`);
    const url = `${config.camera.gatewayUrl}/api/webrtc?src=${encodeURIComponent(name)}`;
    console.log(`[camera] whep camera=${cameraId} stream=${name} offer=${offer.length}B`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType || "application/sdp" },
      body: offer,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    if (!res.ok) {
      console.warn(`[camera] gateway error camera=${cameraId} status=${res.status}`);
      throw new ApiError(502, `Camera gateway rejected the stream (HTTP ${res.status})`, {
        gateway: [body.slice(0, 300)],
      });
    }
    console.log(`[camera] whep ok camera=${cameraId} answer=${body.length}B`);
    return { body, contentType: res.headers.get("content-type") ?? "application/sdp" };
  }

  /**
   * One JPEG frame through the gateway. Some cameras do not implement ONVIF
   * `GetSnapshotUri`; this keeps the snapshot fallback working for them.
   *
   * The gateway stream is registered once and dropped after a minute without
   * frame requests. A WHEP preview cancels that teardown because the peer
   * connection keeps the producer busy.
   */
  async frame(cameraId: number): Promise<{ body: Buffer; contentType: string }> {
    const cam = await this.camera.rtspUriFor(cameraId);
    if (!cam || !cam.enabled) throw new ApiError(404, "Camera is not enabled");

    const name = CameraStreamService.streamName(cameraId);
    const source = CameraStreamService.sourceFor(cam);
    await this.ensureRegistered(name, source.src);

    // A freshly registered producer may need a moment before it has a frame.
    const grab = async (): Promise<Awaited<ReturnType<typeof fetch>>> =>
      fetch(`${config.camera.gatewayUrl}/api/frame.jpeg?src=${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(8000),
      });
    let res = await grab();
    if (!res.ok && res.status >= 500) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      res = await grab();
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[camera] frame failed camera=${cameraId} status=${res.status}`);
      throw new ApiError(502, `Camera snapshot failed (HTTP ${res.status})`, {
        gateway: [detail.slice(0, 200)],
      });
    }
    if (!this.whepStreams.has(name)) this.scheduleIdleTeardown(name);
    return {
      body: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "image/jpeg",
    };
  }

  private async ensureRegistered(name: string, src: string): Promise<void> {
    if (this.registered.has(name)) return;
    await this.register(name, src);
  }

  private scheduleIdleTeardown(name: string): void {
    const current = this.idleTimers.get(name);
    if (current) clearTimeout(current);
    const timer = setTimeout(() => {
      this.idleTimers.delete(name);
      void this.unregister(name);
    }, 60_000);
    timer.unref?.();
    this.idleTimers.set(name, timer);
  }

  /** Register (or replace) the gateway stream for a camera. */
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
    this.registered.add(name);
  }

  private async unregister(name: string): Promise<void> {
    const timer = this.idleTimers.get(name);
    if (timer) clearTimeout(timer);
    this.idleTimers.delete(name);
    this.registered.delete(name);
    this.whepStreams.delete(name);
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
