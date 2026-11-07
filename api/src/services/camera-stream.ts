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
 *      token. The browser receives the token only.
 *   2. Browser POSTs its SDP offer to `/api/camera/whep/<token>`.
 *   3. The API resolves the endpoint's RTSP URI *with credentials* and forwards
 *      the offer to go2rtc (`/api/webrtc?src=<uri>`), returning the answer.
 *
 * The camera URI — and therefore the camera password — never reaches the
 * browser. go2rtc opens the RTSP session on demand and drops it when the
 * WebRTC peer goes away, so there is no stream to leak when a tab is closed.
 */
export class CameraStreamService {
  private tokens = new Map<string, { talkId: string; endpointId: number; exp: number }>();

  constructor(private readonly camera: CameraService) {}

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
    const payload = Buffer.from(
      JSON.stringify({ t: talk.id, e: endpointId, x: exp }),
    ).toString("base64url");
    const token = `${payload}.${this.sign(payload)}`;
    this.tokens.set(token, { talkId: talk.id, endpointId, exp });
    console.log(`[camera] token talk=${talk.id} endpoint=${endpointId}`);
    return { token, expiresAt: new Date(exp).toISOString() };
  }

  /** Drop tokens belonging to a finished talk. */
  stop(talkId: string): void {
    let n = 0;
    for (const [token, v] of this.tokens) {
      if (v.talkId === talkId) {
        this.tokens.delete(token);
        n += 1;
      }
    }
    if (n > 0) console.log(`[camera] tokens closed talk=${talkId} count=${n}`);
  }

  /** Drop every token (stop-all). */
  stopAll(): void {
    this.tokens.clear();
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
    // Also honour explicit teardown (talk stopped, but token not yet expired).
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

    const url = `${config.camera.gatewayUrl}/api/webrtc?src=${encodeURIComponent(cam.uri)}`;
    console.log(`[camera] whep endpoint=${endpointId} offer=${offer.length}B`);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType || "application/sdp" },
      body: offer,
      signal: AbortSignal.timeout(10_000),
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
