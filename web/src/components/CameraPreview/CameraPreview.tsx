import { useEffect, useRef, useState } from "react";
import { MonitorSpeaker, VideoOff } from "lucide-react";
import { api } from "@/lib/api/client";
import { attachCamera, startSnapshotPoll } from "@/lib/camera";
import type { CameraSession } from "@/lib/camera";
import { Badge } from "@/components/Badge/Badge";

/**
 * Live camera preview for a two-way call.
 *
 * Mounts only while a `twoway` talk is running and the target endpoint has a
 * camera. WebRTC (WHEP) is attempted first; if the gateway/camera cannot deliver
 * video it falls back to proxied snapshots, and if that fails too the panel shows
 * a placeholder — the voice call is never affected.
 */
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
  const [state, setState] = useState<"connecting" | "live" | "snapshot" | "off">(
    "connecting",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let session: CameraSession | null = null;
    let stopSnapshots: (() => void) | null = null;

    const run = async () => {
      // Nothing configured → hide the panel entirely.
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

      // Fallback: still frames through the API proxy.
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
      <div className="flex-shrink-0 flex items-center justify-center gap-2 rounded-xl border border-border bg-muted/30 px-3 py-5 text-muted-foreground">
        <VideoOff size={15} />
        <span className="text-[11px]">
          No camera preview for {endpointLabel}
          {error ? ` — ${error}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 rounded-xl border border-border bg-black/90 overflow-hidden relative">
      <video
        ref={videoRef}
        className={`w-full aspect-video object-contain ${state === "live" ? "" : "hidden"}`}
        autoPlay
        playsInline
        muted
      />
      <img
        ref={imgRef}
        alt="Camera preview"
        className={`w-full aspect-video object-contain ${state === "snapshot" ? "" : "hidden"}`}
      />
      {state === "connecting" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-muted-foreground">
          <MonitorSpeaker size={15} />
          <span className="text-[11px]">Connecting camera…</span>
        </div>
      )}
      <div className="absolute top-2 left-2">
        <Badge
          variant={state === "live" ? "destructive" : "secondary"}
          className="text-[10px] px-1.5 py-0"
        >
          {state === "live" ? "Live" : state === "snapshot" ? "Snapshot" : "…"}
        </Badge>
      </div>
    </div>
  );
};
