import { useEffect, useRef } from 'react';
import { Radio, Square, PhoneCall } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';

const METER_BARS = 24;

export const LiveTalkPage = () => {
  const endpoints = useStore((s) => s.endpoints);
  const recording = useStore((s) => s.recording);
  const talkMode = useStore((s) => s.talkMode);
  const talkTargetIds = useStore((s) => s.talkTargetIds);
  const busy = useStore((s) => s.busy);
  const startLiveTalk = useStore((s) => s.startLiveTalk);
  const stopLiveTalk = useStore((s) => s.stopLiveTalk);

  const meterRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    if (!recording) return;
    let frame = 0;
    const loop = () => {
      const level = useStore.getState().talkLevel;
      const lit = Math.round(Math.min(1, level) * METER_BARS);
      meterRefs.current.forEach((bar, i) => {
        if (bar) {
          bar.classList.toggle('bg-emerald-500', i < lit);
          bar.classList.toggle('bg-border', i >= lit);
        }
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [recording]);

  const onlineCount = endpoints.filter((e) => e.registered).length;
  const twoway = talkMode === 'twoway';

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          {recording
            ? twoway
              ? 'Two-way call in progress — talk and listen to the selected phone'
              : `Live broadcast — ${talkTargetIds.size} target${talkTargetIds.size === 1 ? '' : 's'} hearing your mic live`
            : `Select endpoints from the right panel (${onlineCount} registered), then Start talk. One phone endpoint = two-way call; multiple endpoints = live one-way broadcast.`}
        </span>
      </div>

      <div className="flex-shrink-0 border rounded-xl bg-card shadow-lg p-4 flex flex-col items-center gap-3 mt-auto">
        <div className="flex items-end justify-center gap-[2px] h-10">
          {Array.from({ length: METER_BARS }).map((_, i) => (
            <span
              key={i}
              ref={(el) => { meterRefs.current[i] = el; }}
              className="w-1.5 rounded-sm bg-border transition-colors duration-75"
              style={{ height: `${Math.max(3, ((i + 1) / METER_BARS) * 38)}px` }}
            />
          ))}
        </div>

        {recording ? (
          <Button variant="destructive" size="lg" className="min-w-[190px]" onClick={() => void stopLiveTalk()} disabled={busy}>
            <Square className="mr-2 h-4 w-4" />
            Stop talk
          </Button>
        ) : (
          <Button variant="default" size="lg" className="min-w-[190px]" onClick={() => void startLiveTalk()} disabled={busy}>
            {twoway ? <PhoneCall className="mr-2 h-4 w-4" /> : <Radio className="mr-2 h-4 w-4" />}
            Start talk
          </Button>
        )}

        <p className="text-muted-foreground text-[10px] text-center max-w-md leading-relaxed">
          {recording
            ? twoway
              ? 'Your voice is streamed live to the phone and the phone audio comes back here — a normal call.'
              : 'Your voice is streamed live to the selected endpoints in real time. Press Stop to end the broadcast.'
            : 'Your microphone is streamed live while talk is active (not recorded-then-played).'}
        </p>
      </div>
    </div>
  );
};
