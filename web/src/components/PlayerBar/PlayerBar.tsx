import { useEffect, useState } from "react";
import { Music, Radio, X } from "lucide-react";
import { useStore } from "@/store";
import { Progress } from "@/components/Progress/Progress";

const fmtDur = (s: number) => {
  const sec = Math.max(0, Math.round(s));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

/** Global now-playing strip above the status bar. Hidden when idle. */
export const PlayerBar = () => {
  const recentLogs = useStore((s) => s.recentLogs);
  const stopBroadcast = useStore((s) => s.stopBroadcast);
  const musicPlaying = useStore((s) => s.musicPlaying);
  const music = useStore((s) => s.music);
  const currentMusicId = useStore((s) => s.currentMusicId);
  const stopMusic = useStore((s) => s.stopMusic);
  const musicTargetIds = useStore((s) => s.musicTargetIds);
  const musicStartedAt = useStore((s) => s.musicStartedAt);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const activeBroadcast = recentLogs.find(
    (b) => b.status === "pending" && b.title,
  );
  const currentTrack = currentMusicId
    ? music.find((m) => m.id === currentMusicId)
    : null;

  const kind = activeBroadcast
    ? "broadcast"
    : musicPlaying && currentTrack
      ? "music"
      : null;

  if (!kind) return null;

  const startedAt = activeBroadcast?.startedAt
    ? new Date(activeBroadcast.startedAt).getTime()
    : musicStartedAt
      ? new Date(musicStartedAt).getTime()
      : now;
  const elapsed = Math.max(0, (now - startedAt) / 1000);
  const total = activeBroadcast
    ? activeBroadcast.durationSec && activeBroadcast.durationSec > 0
      ? activeBroadcast.durationSec
      : 30
    : currentTrack?.duration && currentTrack.duration > 0
      ? currentTrack.duration
      : 30;
  const pct = Math.min(100, (elapsed / total) * 100);
  const title = activeBroadcast?.title ?? currentTrack?.name ?? "Broadcast";
  const sub = activeBroadcast
    ? `${activeBroadcast.zoneName ?? "Ad-hoc"} · ${activeBroadcast.endpointIds?.length ?? 0} endpoint${(activeBroadcast.endpointIds?.length ?? 0) === 1 ? "" : "s"}`
    : `${musicTargetIds.length} endpoint${musicTargetIds.length === 1 ? "" : "s"}`;
  const onStop = activeBroadcast
    ? () => void stopBroadcast(activeBroadcast.id)
    : () => void stopMusic();

  return (
    <div className="player-strip">
      <span className={`player-icon${kind === "music" ? " music" : ""}`}>
        {kind === "broadcast" ? <Radio size={16} /> : <Music size={16} />}
      </span>
      <div className="player-main">
        <div className="player-title">
          <b>{title}</b>
          <small>{sub}</small>
        </div>
        <div className="player-progress">
          <span>{fmtDur(elapsed)}</span>
          <Progress value={pct} />
          <span>{fmtDur(total)}</span>
        </div>
      </div>
      <button
        type="button"
        className="player-stop"
        onClick={onStop}
        title={activeBroadcast ? "Stop broadcast" : "Stop music"}
      >
        <X size={13} />
        Stop
      </button>
    </div>
  );
};
