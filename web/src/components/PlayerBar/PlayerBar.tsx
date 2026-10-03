import { useEffect, useState } from "react";
import { Radio, Music, X, Volume2 } from "lucide-react";
import { useStore } from "@/store";
import { Progress } from "@/components/Progress/Progress";
import { cn } from "@/lib/utils";

const fmtDur = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/** Always-visible bottom player bar — shows the active broadcast or music track
 *  with a live progress bar and a stop control, on every page. */
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

  if (!kind) {
    return (
      <div className="col-span-1 flex min-w-0 items-center justify-center border-t border-border bg-muted/20 px-3 py-2 text-center text-[11px] text-muted-foreground select-none lg:col-span-2 xl:col-span-3">
        Nothing playing — broadcast or play a track from the console.
      </div>
    );
  }

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
    <div className="col-span-1 flex min-w-0 items-center gap-2 border-t border-border bg-card px-3 py-2 select-none sm:gap-3 sm:px-4 lg:col-span-2 xl:col-span-3">
      <div
        className={cn(
          "w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0",
          kind === "broadcast"
            ? "bg-amber-500/15 text-amber-500"
            : "bg-emerald-500/15 text-emerald-500",
        )}
      >
        {kind === "broadcast" ? (
          <Radio className="w-4 h-4 animate-pulse" />
        ) : (
          <Music className="w-4 h-4 animate-pulse" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-xs font-medium">{title}</span>
          <span className="hidden min-w-0 truncate text-[10px] text-muted-foreground sm:block">
            {sub}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="font-mono text-[10px] text-muted-foreground flex-shrink-0">
            {fmtDur(elapsed)}
          </span>
          <Progress value={pct} className="h-1 flex-1 [&>div]:bg-amber-500" />
          <span className="font-mono text-[10px] text-muted-foreground flex-shrink-0">
            {fmtDur(total)}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onStop}
        title={activeBroadcast ? "Stop broadcast" : "Stop music"}
        className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono text-red-500 hover:bg-red-500/10 transition-colors"
      >
        <X size={11} /> Stop
      </button>
    </div>
  );
};
