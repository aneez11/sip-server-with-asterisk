import { useEffect, useRef, useState } from "react";
import { MonitorSpeaker, VideoOff } from "lucide-react";
import { api } from "@/lib/api/client";
import { attachCamera, startSnapshotPoll } from "@/lib/camera";
import type { CameraSession } from "@/lib/camera";

export const CameraPreview = ({
  talkId,
  endpointId,
  endpointLabel,
}: {
  talkId: string;
  endpointId: number;
  endpointLabel: string;
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [state, setState] = useState<"connecting" | "live" | "snapshot" | "off">("connecting");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let session: CameraSession | null = null;
    let stopSnapshots: (() => void) | null = null;

    const run = async () => {
      const cam = await api.camera.get(endpointId).catch(() => null);
      if (cancelled) return;
      if (!cam?.enabled || !cam.configured) {
        setState("off");
        return;
      }

      if (videoRef.current) {
        try {
          session = await attachCamera(talkId, endpointId, videoRef.current);
          if (cancelled) {
            session.stop();
            return;
          }
          setState("live");
          return;
        } catch (e) {
          if (cancelled) return;
          setError((e as Error).message);
        }
      }

      if (cam.snapshotAvailable && imgRef.current) {
        stopSnapshots = startSnapshotPoll(endpointId, imgRef.current);
        setState("snapshot");
        return;
      }
      setState("off");
    };

    void run();
    return () => {
      cancelled = true;
      session?.stop();
      stopSnapshots?.();
    };
  }, [talkId, endpointId]);

  if (state === "off") {
    return (
      <div className="state state-empty" style={{ minHeight: 56, padding: "12px 14px" }}>
        <VideoOff size={15} />
        <span className="tiny">
          No camera preview for {endpointLabel}
          {error ? ` — ${error}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="camera-panel">
      <video
        ref={videoRef}
        style={{ display: state === "live" ? "block" : "none" }}
        autoPlay
        playsInline
        muted
      />
      <img
        ref={imgRef}
        alt="Camera preview"
        style={{ display: state === "snapshot" ? "block" : "none" }}
      />
      {state === "connecting" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: 32, color: "var(--mut)" }}>
          <MonitorSpeaker size={15} />
          <span className="tiny">Connecting camera…</span>
        </div>
      )}
      <div className="camera-badge">
        <span className={`chip ${state === "live" ? "bad" : "quiet"}`}>
          {state === "live" ? "Live" : state === "snapshot" ? "Snapshot" : "…"}
        </span>
      </div>
    </div>
  );
};
