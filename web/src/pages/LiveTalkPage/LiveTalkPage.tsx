import { useEffect, useRef } from 'react';
import {
  Mic,
  MonitorSpeaker,
  PhoneCall,
  Radio,
  ShieldAlert,
  Square,
  Users,
  WifiOff,
} from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { CameraPreview } from '@/components/CameraPreview/CameraPreview';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
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
  const activeTalkId = useStore((s) => s.activeTalkId);
  const talkConnectionLost = useStore((s) => s.talkConnectionLost);
  const paGroups = useStore((s) => s.paGroups);
  const busy = useStore((s) => s.busy);
  const startLiveTalk = useStore((s) => s.startLiveTalk);
  const stopLiveTalk = useStore((s) => s.stopLiveTalk);
  const setContextOpen = useStore((s) => s.setContextOpen);

  const meterRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    if (!recording) {
      meterRefs.current.forEach((bar) => bar?.classList.remove('lit'));
      return;
    }
    let frame = 0;
    const loop = () => {
      const level = useStore.getState().talkLevel;
      const lit = Math.round(Math.min(1, level) * METER_BARS);
      meterRefs.current.forEach((bar, i) => {
        if (bar) bar.classList.toggle('lit', i < lit);
      });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [recording]);

  const onlineCount = endpoints.filter((e) => e.registered).length;
  const twoway = talkMode === 'twoway';

  const twowayEndpointId = twoway && talkTargetIds.size === 1 ? [...talkTargetIds][0] : null;
  const twowayEndpointLabel = endpoints.find((e) => e.id === twowayEndpointId)?.label ?? 'endpoint';

  const groupReceiverIds = paGroups
    .filter((g) => talkPaGroupIds.has(g.id))
    .flatMap((g) => g.receiverEndpointIds ?? []);
  const targetCount = new Set([...talkTargetIds, ...groupReceiverIds]).size;
  const groupCount = talkPaGroupIds.size;

  const modeLabel = recording
    ? twoway
      ? 'Two-way call'
      : 'Live broadcast'
    : 'Ready';
  const sourceLabel = talkSource === 'device' ? 'Device audio' : 'Microphone';

  const hint = recording
    ? twoway
      ? 'Your voice is streamed live to the phone and the phone audio comes back here — a normal call.'
      : talkSource === 'device'
        ? 'Device audio is streamed live to the selected targets. Press Stop to end the broadcast.'
        : 'Your voice is streamed live to the selected endpoints in real time. Press Stop to end the broadcast.'
    : talkSource === 'device'
      ? 'Streams audio already playing on this computer (music, a video, another app) to the targets. Pick a tab or screen and enable "Share tab audio" / "Share system audio". This is one-way only.'
      : 'Your microphone is streamed live while talk is active (not recorded-then-played).';

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Live talk"
        subtitle={
          recording
            ? twoway
              ? 'Two-way call in progress — talk and listen to the selected phone'
              : `Live broadcast — ${targetCount} target${targetCount === 1 ? '' : 's'} hearing your mic live${
                  groupCount > 0 ? ` via ${groupCount} PA group${groupCount === 1 ? '' : 's'}` : ''
                }`
            : `Pick endpoints or PA groups in the targets panel (${onlineCount} registered), then start. One phone = two-way call; multiple endpoints or a PA group = live one-way broadcast.`
        }
      />

      {talkConnectionLost && (
        <div className="note-box">
          <WifiOff size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b>Connection lost.</b> The broadcast is held on the server for two minutes and resumes when this
            page reconnects. Keep this tab open.
          </div>
        </div>
      )}

      {!window.isSecureContext && (
        <div className="note-box">
          <ShieldAlert size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <b>Microphone blocked — this page is not a secure context.</b> Browsers hide the microphone API
            on plain HTTP, so Live Talk cannot record here. Open{' '}
            <a className="underline font-medium" href={`${suggestedHttpsOrigin()}${window.location.pathname}`}>
              {suggestedHttpsOrigin()}
            </a>{' '}
            instead.
          </div>
        </div>
      )}

      <div className="talk-layout">
        <div className="talk-main">
          <section className={`talk-console${recording ? ' live' : ''}`}>
            <div className="talk-console-head">
              <span className={`chip ${recording ? 'bad' : 'quiet'}`}>
                {recording && <i className="dot" aria-hidden="true" />}
                {modeLabel}
              </span>
              <span className="talk-console-count">
                <Users size={12} />
                {targetCount} target{targetCount === 1 ? '' : 's'}
              </span>
            </div>

            <div className="talk-orb" aria-hidden="true">
              {recording ? (
                <Radio size={34} />
              ) : talkSource === 'device' ? (
                <MonitorSpeaker size={34} />
              ) : (
                <Mic size={34} />
              )}
            </div>

            <div className="level-meter" aria-hidden="true">
              {Array.from({ length: METER_BARS }).map((_, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    meterRefs.current[i] = el;
                  }}
                />
              ))}
            </div>

            {!recording && (
              <Button
                variant="outline"
                size="sm"
                className="talk-select-targets"
                onClick={() => setContextOpen(true)}
              >
                <Users size={13} />
                {targetCount === 0 ? 'Select targets' : `Change targets (${targetCount})`}
              </Button>
            )}

            {!recording && (
              <div className="source-toggle">
                <button
                  type="button"
                  className={talkSource === 'mic' ? 'on' : ''}
                  onClick={() => setTalkSource('mic')}
                >
                  <Mic size={13} /> Microphone
                </button>
                <button
                  type="button"
                  className={talkSource === 'device' ? 'on' : ''}
                  onClick={() => setTalkSource('device')}
                >
                  <MonitorSpeaker size={13} /> Device audio
                </button>
              </div>
            )}

            {recording ? (
              <Button
                variant="destructive"
                size="lg"
                className="talk-action"
                onClick={() => void stopLiveTalk()}
                disabled={busy}
              >
                <Square size={15} /> Stop talk
              </Button>
            ) : (
              <Button
                size="lg"
                className="talk-action"
                onClick={() => void startLiveTalk()}
                disabled={busy}
              >
                {talkSource === 'device' ? (
                  <MonitorSpeaker size={16} />
                ) : twoway ? (
                  <PhoneCall size={16} />
                ) : (
                  <Radio size={16} />
                )}
                {talkSource === 'device' ? 'Share device audio' : 'Start talk'}
              </Button>
            )}

            <p className="note talk-hint">{hint}</p>
          </section>

          {recording && twowayEndpointId !== null && activeTalkId && (
            <CameraPreview
              talkId={activeTalkId}
              endpointId={twowayEndpointId}
              endpointLabel={twowayEndpointLabel}
            />
          )}
        </div>

        <aside className="talk-side">
          <Card>
            <div className="card-title">Session</div>
            <div className="meta-row">
              <span>Mode</span>
              <strong>{modeLabel}</strong>
            </div>
            <div className="meta-row">
              <span>Targets</span>
              <strong>{targetCount}</strong>
            </div>
            <div className="meta-row">
              <span>Online</span>
              <strong className="ok-text">{onlineCount}</strong>
            </div>
            <div className="meta-row">
              <span>Source</span>
              <strong>{sourceLabel}</strong>
            </div>
            {groupCount > 0 && (
              <div className="meta-row">
                <span>PA groups</span>
                <strong>{groupCount}</strong>
              </div>
            )}
          </Card>

          <Card className="talk-help">
            <div className="card-title">How it works</div>
            <ol>
              <li>
                Pick <b>endpoints</b> or <b>PA groups</b> in the targets panel.
              </li>
              <li>
                One phone and nothing else starts a <b>two-way call</b>. Anything else is a live one-way
                broadcast.
              </li>
              <li>
                Press <b>Start</b>, speak, then <b>Stop</b>. Audio is live — there is no recording step.
              </li>
            </ol>
          </Card>
        </aside>
      </div>
    </div>
  );
};
