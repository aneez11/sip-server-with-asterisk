import { useEffect } from 'react';
import { PhoneOff } from 'lucide-react';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Badge } from '@/components/Badge/Badge';
import { Card, CardContent } from '@/components/Card/Card';
import { cn } from '@/lib/utils';
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

const KIND_VARIANT: Record<CallKind, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  broadcast: 'default',
  music: 'secondary',
  live: 'secondary',
  twoway: 'outline',
};

/** Live device status -> chip colour + label. */
const STATUS_META: Record<DeviceCallStatus, { label: string; dot: string; chip: string }> = {
  idle: { label: 'Idle', dot: 'bg-muted-foreground/40', chip: 'text-muted-foreground' },
  dialing: { label: 'Dialing', dot: 'bg-amber-400 animate-pulse', chip: 'text-amber-400' },
  receiving: { label: 'Receiving', dot: 'bg-emerald-400', chip: 'text-emerald-400' },
  done: { label: 'Done', dot: 'bg-sky-400', chip: 'text-sky-400' },
  missed: { label: 'Unavailable', dot: 'bg-red-500', chip: 'text-red-500' },
};

function DeviceRow({ member }: { member: ActiveCallMember }) {
  const endpoint = useStore((s) => s.endpoints).find((e) => e.extension === member.extension);
  const meta = STATUS_META[member.status];
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/70 bg-muted/20 text-[12px]">
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', meta.dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{endpoint?.label ?? member.extension}</span>
          <span className="font-mono text-[10px] text-muted-foreground/70">{member.extension}</span>
        </div>
        <div className="text-[10px] text-muted-foreground">
          {endpoint ? (endpoint.type === 'speaker' ? 'Speaker' : 'Phone') : 'Unknown device'}
          {endpoint && !endpoint.registered && <span className="ml-1.5 text-amber-400">· unregistered</span>}
        </div>
      </div>
      <span className={cn('font-mono text-[10px] font-semibold flex-shrink-0', meta.chip)}>{meta.label}</span>
    </div>
  );
}

export const MonitorPage = () => {
  const calls = useStore((s) => s.calls);
  const refreshCalls = useStore((s) => s.refreshCalls);
  const endCallMonitor = useStore((s) => s.endCallMonitor);

  useEffect(() => { void refreshCalls(); }, [refreshCalls]);

  const active = calls?.active ?? [];
  const totalTargeted = active.reduce((n, c) => n + c.members.length, 0);
  const receiving = active.reduce((n, c) => n + c.members.filter((m) => m.status === 'receiving').length, 0);
  const missed = active.reduce((n, c) => n + c.members.filter((m) => m.status === 'missed').length, 0);

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          {active.length > 0
            ? `${active.length} active call${active.length === 1 ? '' : 's'} · live per-device receive status`
            : 'No active calls — all devices idle.'}
        </span>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 flex-shrink-0">
        {[
          { label: 'Active calls', value: active.length, accent: 'text-foreground' },
          { label: 'Targeted endpoints', value: totalTargeted, accent: 'text-foreground' },
          { label: 'Receiving now', value: receiving, accent: 'text-emerald-400' },
          { label: 'Unavailable', value: missed, accent: missed > 0 ? 'text-red-500' : 'text-muted-foreground' },
        ].map((s) => (
          <Card key={s.label} className="bg-card">
            <CardContent className="p-4">
              <div className="font-mono text-2xl font-semibold tabular-nums leading-none">{s.value}</div>
              <div className={cn('text-[11px] mt-1 text-muted-foreground')}>{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Active call cards */}
      {active.length === 0 ? (
        <div className="flex-1 border rounded-xl bg-muted/30 p-16 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
          <div className="text-4xl">📡</div>
          <div>All endpoints are idle. Broadcasts, live talks and two-way calls appear here live.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {active.map((call) => (
            <Card key={call.id} className="bg-card">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={KIND_VARIANT[call.kind]} className="text-[10px] px-1.5 py-0 flex-shrink-0">{KIND_LABEL[call.kind]}</Badge>
                      <span className="text-sm font-medium truncate">{call.title}</span>
                    </div>
                    <div className="text-muted-foreground text-[10px] font-mono mt-1">
                      Started {fmtClock(call.startedAt)} · {call.members.length} target{call.members.length === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {call.members.filter((m) => m.status === 'receiving').length}/{call.members.length} receiving
                    </span>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => void endCallMonitor(call.id)}
                      title="End this call"
                    >
                      <PhoneOff className="h-3 w-3 mr-1" />
                      End
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {call.members.map((m) => (
                    <DeviceRow key={m.extension} member={m} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
