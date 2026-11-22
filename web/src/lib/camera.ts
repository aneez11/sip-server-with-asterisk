// Camera preview client: WHEP (WebRTC) playback of a room camera, plus a
// snapshot fallback for cameras the gateway cannot publish.
//
// The camera itself is never contacted from the browser — the API proxies the
// WHEP offer with the camera's RTSP URI, so credentials stay server-side and the
// console stays on a single HTTPS origin (no mixed content).

import { api } from "@/lib/api/client";

export interface CameraSession {
  video: HTMLVideoElement;
  stop: () => void;
}

/**
 * Attach a camera stream to a <video> element.
 *
 * 1. ask the API for a talk-bound token,
 * 2. build a recvonly audio-less SDP offer (video only),
 * 3. POST it to the API's WHEP proxy,
 * 4. apply the answer and wait for media.
 */
export async function attachCamera(
  talkId: string,
  endpointId: number,
  video: HTMLVideoElement,
): Promise<CameraSession> {
  const { token } = await api.talk.camera.start(talkId, endpointId);
  return attachWithToken(token, video, () => {
    void api.talk.camera.stop(talkId).catch(() => undefined);
  });
}

/**
 * Preview a camera from the Cameras page with no call in progress.
 *
 * Same WHEP negotiation as a talk, but the token is minted by
 * `POST /api/cameras/:id/preview`; stopping only closes the local peer
 * connection (the server drops the token when the stream ends or the camera is
 * disabled).
 */
export async function attachCameraPreview(
  cameraId: number,
  video: HTMLVideoElement,
): Promise<CameraSession> {
  const { token } = await api.cameras.preview(cameraId);
  return attachWithToken(token, video);
}

/**
 * Shared WHEP negotiation for talk-bound and preview tokens.
 *
 * Resolves only after the element has actually painted a frame. A WHEP answer
 * with no media (ICE blocked, gateway not publishing yet, camera slow to start)
 * used to resolve immediately, leaving the caller on a permanently black
 * <video>; now that case rejects so the caller can fall back to snapshots.
 */
async function attachWithToken(
  token: string,
  video: HTMLVideoElement,
  onStop?: () => void,
  firstFrameTimeoutMs = 8000,
): Promise<CameraSession> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const stop = () => {
    try {
      pc.getSenders().forEach((s) => s.track?.stop());
      pc.close();
    } catch {
      // ignore
    }
    video.srcObject = null;
    onStop?.();
  };

  // Holder object rather than a `let`: assignments happen inside the promise
  // executor below, and TS does not widen a captured variable from closures.
  const firstFrameCtl: { cancel?: () => void } = {};
  try {
    // Video only: the operator hears the phone, not the camera.
    pc.addTransceiver("video", { direction: "recvonly" });
    video.srcObject = new MediaStream();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // go2rtc's WHEP endpoint wants a complete offer; non-trickle fits a proxy.
    await waitForIce(pc);

    const res = await fetch(api.camera.whepUrl(token), {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription?.sdp ?? offer.sdp ?? "",
      credentials: "same-origin",
    });
    // `ontrack` MUST be attached before the remote answer is applied. Tracks
    // from a recvonly transceiver arrive during setRemoteDescription, and a
    // handler installed afterwards is never invoked for them — the peer
    // connects, the SDP is accepted, and the <video> stays black forever.
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    };

    if (!res.ok) throw new Error(`Camera stream failed (HTTP ${res.status})`);
    const answer = await res.text();

    const firstFrame = new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        firstFrameCtl.cancel = undefined;
        clearTimeout(timer);
        pc.removeEventListener("iceconnectionstatechange", onIce);
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("playing", onReady);
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(
        () => finish(new Error("Camera sent no video within 8s")),
        firstFrameTimeoutMs,
      );
      // ICE failing is the common cause (8555/UDP unreachable from the browser)
      // and surfaces long before the frame timeout would.
      const onIce = () => {
        if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          finish(new Error(`Camera media connection ${pc.iceConnectionState}`));
        }
      };
      pc.addEventListener("iceconnectionstatechange", onIce);
      firstFrameCtl.cancel = () => finish(new Error("cancelled"));

      // `loadedmetadata` with a non-zero width means a decodable frame exists;
      // requestVideoFrameCallback is the precise signal where supported.
      const still = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      const onReady = () => {
        if (video.videoWidth > 0) finish();
      };
      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("playing", onReady);
      if (typeof still.requestVideoFrameCallback === "function") {
        still.requestVideoFrameCallback(() => finish());
      }
    });

    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    await firstFrame;
    return { video, stop };
  } catch (e) {
    firstFrameCtl.cancel?.();
    stop();
    throw e;
  }
}

/** Collect ICE candidates so the offer is complete (no trickle through the proxy). */
function waitForIce(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") done();
    };
    pc.addEventListener("icegatheringstatechange", check);
    setTimeout(done, timeoutMs);
  });
}

/** Snapshot fallback: poll the API-proxied JPEG a couple of times per second. */
export function startSnapshotPoll(
  endpointId: number,
  img: HTMLImageElement,
  intervalMs = 800,
): () => void {
  return pollImage(api.camera.snapshotUrl(endpointId), img, intervalMs);
}

/** Same poller for the Cameras page (camera-id snapshot route). */
export function startCameraSnapshotPoll(
  cameraId: number,
  img: HTMLImageElement,
  intervalMs = 2000,
): () => void {
  return pollImage(api.cameras.snapshotUrl(cameraId), img, intervalMs);
}

function pollImage(
  baseUrl: string,
  img: HTMLImageElement,
  intervalMs: number,
): () => void {
  let alive = true;
  const tick = () => {
    if (!alive) return;
    img.src = `${baseUrl}?t=${Date.now()}`;
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    alive = false;
    clearInterval(timer);
  };
}
