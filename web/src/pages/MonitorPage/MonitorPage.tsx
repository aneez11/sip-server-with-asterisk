import { useEffect } from 'react';
import { PhoneOff } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Card } from '@/components/Card/Card';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';
import type { ActiveCallMember, CallKind, DeviceCallStatus } from '@infinity/shared';

const fmtClock = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};

const KIND_LABEL: Record<CallKind, string> = {
  broadcast: 'Broadcast',
  music: 'Music',
  live: 'Live talk',
  twoway: 'Two-way',
};

const STATUS_META: Record<DeviceCallStatus, { label: string; dot: string; tone: string }> = {
  idle: { label: 'Idle', dot: 'off', tone: 'muted' },
  dialing: { label: 'Dialing', dot: 'live', tone: 'warn-text' },
  receiving: { label: 'Receiving', dot: 'on', tone: 'ok-text' },
  done: { label: 'Done', dot: 'on', tone: 'muted' },
  missed: { label: 'Unavailable', dot: 'off', tone: 'bad-text' },
};

function DeviceRow({ member }: { member: ActiveCallMember }) {
  const endpoint = useStore((s) => s.endpoints).find((e) => e.extension === member.extension);
  const meta = STATUS_META[member.status];
  return (
    <div className="member-row">
      <span className={`online-dot ${meta.dot}`} />
      <div className="member-main">
        <b>{endpoint?.label ?? member.extension}</b>
        <span className="ext">{member.extension}</span>
        <small>
          {endpoint ? (endpoint.type === 'speaker' ? 'Speaker' : 'Phone') : 'Unknown device'}
          {endpoint && !endpoint.registered ? ' · unregistered' : ''}
        </small>
      </div>
      <span className={`member-status ${meta.tone}`}>{meta.label}</span>
    </div>
  );
}

export const MonitorPage = () => {
  const calls = useStore((s) => s.calls);
  const refreshCalls = useStore((s) => s.refreshCalls);
  const endCallMonitor = useStore((s) => s.endCallMonitor);

  useEffect(() => {
    void refreshCalls();
  }, [refreshCalls]);

  const active = calls?.active ?? [];
  const totalTargeted = active.reduce((n, c) => n + c.members.length, 0);
  const receiving = active.reduce((n, c) => n + c.members.filter((m) => m.status === 'receiving').length, 0);
  const missed = active.reduce((n, c) => n + c.members.filter((m) => m.status === 'missed').length, 0);

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Live monitor"
        subtitle={
          active.length > 0
            ? `${active.length} active call${active.length === 1 ? '' : 's'} · live per-device receive status`
            : 'No active calls — all devices idle.'
        }
      />

      <div className="grid-kpi">
        {[
          { label: 'Active calls', value: active.length, tone: '' },
          { label: 'Targeted endpoints', value: totalTargeted, tone: '' },
          { label: 'Receiving now', value: receiving, tone: 'ok-text' },
          { label: 'Unavailable', value: missed, tone: missed > 0 ? 'bad-text' : 'muted' },
        ].map((s) => (
          <Card key={s.label} className="kpi">
            <div className={`num ${s.tone}`}>{s.value}</div>
            <small>{s.label}</small>
          </Card>
        ))}
      </div>

      {active.length === 0 ? (
        <div className="state state-empty state-fill">
          <div>
            <strong>Everything is quiet</strong>
            <p>Broadcasts, live talks and two-way calls appear here live.</p>
          </div>
        </div>
      ) : (
        <div className="split-2">
          {active.map((call) => (
            <Card key={call.id} className="call-card">
              <div className="call-head">
                <div style={{ minWidth: 0 }}>
                  <div className="call-title">
                    <span className="chip quiet">{KIND_LABEL[call.kind]}</span>
                    <b>{call.title}</b>
                  </div>
                  <div className="call-meta">
                    Started {fmtClock(call.startedAt)} · {call.members.length} target
                    {call.members.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="inline" style={{ gap: 8, flexShrink: 0 }}>
                  <span className="call-meta">
                    {call.members.filter((m) => m.status === 'receiving').length}/{call.members.length} receiving
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void endCallMonitor(call.id)}
                    title="End this call"
                  >
                    <PhoneOff size={12} /> End
                  </Button>
                </div>
              </div>
              <div className="stack-sm" style={{ marginTop: 12 }}>
                {call.members.map((m) => (
                  <DeviceRow key={m.extension} member={m} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
