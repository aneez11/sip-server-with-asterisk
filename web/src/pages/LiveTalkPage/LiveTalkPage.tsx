import { useEffect, useRef } from 'react';
import { Radio, Square, PhoneCall, ShieldAlert, Mic, MonitorSpeaker, WifiOff } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { suggestedHttpsOrigin } from '@/lib/mic';

const METER_BARS = 24;

export const LiveTalkPage = () => {
  const endpoints = useStore((s) => s.endpoints);
  const recording = useStore((s) => s.recording);
  const talkMode = useStore((s) => s.talkMode);
  const talkTargetIds = useStore((s) => s.talkTargetIds);
  const talkPaGroupIds = useStore((s) => s.talkPaGroupIds);
  const talkSource = useStore((s) => s.talkSource);
  const setTalkSource = useStore((s) => s.setTalkSource);
  const talkConnectionLost = useStore((s) => s.talkConnectionLost);
  const paGroups = useStore((s) => s.paGroups);
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

  // Live talk can target endpoints, PA groups, or both — a PA group counts as
  // every one of its receivers, so the summary reflects the resolved fan-out.
  const groupReceiverIds = paGroups
    .filter((g) => talkPaGroupIds.has(g.id))
    .flatMap((g) => g.receiverEndpointIds ?? []);
  const targetCount = new Set([...talkTargetIds, ...groupReceiverIds]).size;
  const groupCount = talkPaGroupIds.size;

  return (
    <div className="flex flex-col h-full gap-4">
      {talkConnectionLost && (
        <div className="flex-shrink-0 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <WifiOff className="h-4 w-4 mt-0.5 text-amber-500 flex-shrink-0" />
          <div className="text-xs leading-relaxed">
            <span className="font-medium">Connection lost.</span> The broadcast is
            being held on the server for two minutes and resumes when this page
            reconnects. Keep this tab open.
          </div>
        </div>
      )}
      {!window.isSecureContext && (
        <div className="flex-shrink-0 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <ShieldAlert className="h-4 w-4 mt-0.5 text-amber-500 flex-shrink-0" />
          <div className="text-xs leading-relaxed">
            <span className="font-medium">Microphone blocked — this page is not a secure context.</span>{' '}
            Browsers hide the microphone API on plain HTTP, so Live Talk cannot record here.
            Open{' '}
            <a className="underline font-medium" href={`${suggestedHttpsOrigin()}${window.location.pathname}`}>
              {suggestedHttpsOrigin()}
            </a>{' '}
            instead.
          </div>
        </div>
      )}

      <div className="flex-shrink-0">
        <span className="text-xs text-muted-foreground">          {recording
            ? twoway
              ? 'Two-way call in progress — talk and listen to the selected phone'
              : `Live broadcast — ${targetCount} target${targetCount === 1 ? '' : 's'} hearing your mic live${
                  groupCount > 0
                    ? ` via ${groupCount} PA group${groupCount === 1 ? '' : 's'}`
                    : ''
                }`
            : `Select endpoints or PA groups from the right panel (${onlineCount} registered), then Start talk. One phone endpoint = two-way call; multiple endpoints or a PA group = live one-way broadcast.`}
        </span>
      </div>

      <div className="flex-shrink-0 border rounded-xl bg-card shadow-lg p-4 flex flex-col items-center gap-3 mt-auto">
        {!recording && (
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
            <button
              type="button"
              onClick={() => setTalkSource('mic')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
                talkSource === 'mic'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Mic size={13} />
              Microphone
            </button>
            <button
              type="button"
              onClick={() => setTalkSource('device')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
                talkSource === 'device'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <MonitorSpeaker size={13} />
              Device audio
            </button>
          </div>
        )}

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
            {talkSource === 'device' ? (
              <MonitorSpeaker className="mr-2 h-4 w-4" />
            ) : twoway ? (
              <PhoneCall className="mr-2 h-4 w-4" />
            ) : (
              <Radio className="mr-2 h-4 w-4" />
            )}
            {talkSource === 'device' ? 'Share device audio' : 'Start talk'}
          </Button>
        )}

        <p className="text-muted-foreground text-[10px] text-center max-w-md leading-relaxed">
          {recording
            ? twoway
              ? 'Your voice is streamed live to the phone and the phone audio comes back here — a normal call.'
              : talkSource === 'device'
                ? 'Device audio is streamed live to the selected targets. Press Stop to end the broadcast.'
                : 'Your voice is streamed live to the selected endpoints in real time. Press Stop to end the broadcast.'
            : talkSource === 'device'
              ? 'Streams audio already playing on this computer (music, a video, another app) to the targets. Pick a tab or screen and enable "Share tab audio" / "Share system audio". This is one-way only.'
              : 'Your microphone is streamed live while talk is active (not recorded-then-played).'}
        </p>
      </div>
    </div>
  );
};
