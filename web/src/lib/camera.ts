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

/** Shared WHEP negotiation for talk-bound and preview tokens. */
async function attachWithToken(
  token: string,
  video: HTMLVideoElement,
  onStop?: () => void,
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
    if (!res.ok) throw new Error(`Camera stream failed (HTTP ${res.status})`);
    const answer = await res.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });

    pc.ontrack = (ev) => {
      video.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
      void video.play().catch(() => undefined);
    };

    return { video, stop };
  } catch (e) {
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
