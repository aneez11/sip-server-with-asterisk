import { Radio } from 'lucide-react';
import { useStore } from '@/store';
import { Card } from '@/components/Card/Card';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';

const fmtClock = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
};

export const HistoryPage = () => {
  const recentLogs = useStore((s) => s.recentLogs);
  const endpoints = useStore((s) => s.endpoints);
  const busy = useStore((s) => s.busy);
  const playAdhoc = useStore((s) => s.playAdhoc);

  const statusTone = (status: string) =>
    status === 'success' ? '' : status === 'failed' ? 'bad' : status === 'stopped' ? 'quiet' : 'outline';

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Broadcast history"
        subtitle={`${recentLogs.length} recent broadcast${recentLogs.length === 1 ? '' : 's'} · target lists are snapshots of what was dialed`}
      />

      <div className="grid-cards">
        {recentLogs.map((b) => {
          const labels = (b.endpointIds ?? []).map(
            (id) => endpoints.find((e) => e.id === id)?.label ?? `#${id}`,
          );
          return (
            <Card key={b.id}>
              <div className="inline" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <b style={{ fontSize: 13 }}>{b.title || b.zoneName || 'Ad-hoc'}</b>
                  <div className="announce-meta">{fmtClock(b.startedAt)}</div>
                </div>
                <span className={`chip ${statusTone(b.status)}`}>{b.status}</span>
              </div>

              <div className="history-labels" style={{ marginTop: 8 }} title={labels.join(', ')}>
                {labels.join(', ') || '—'}
              </div>

              <button
                type="button"
                className="btn small"
                style={{ width: '100%', marginTop: 10 }}
                onClick={() => void playAdhoc(b.endpointIds)}
                disabled={busy || b.endpointIds.length === 0}
                title="Rebroadcast to the same endpoint configuration"
              >
                <Radio size={12} /> Rebroadcast same targets
              </button>

              {b.endedAt && (
                <div className="announce-meta" style={{ marginTop: 8 }}>
                  Ended {fmtClock(b.endedAt)}
                </div>
              )}
            </Card>
          );
        })}
        {recentLogs.length === 0 && (
          <div className="state state-empty" style={{ gridColumn: '1 / -1' }}>
            No broadcast history yet.
          </div>
        )}
      </div>
    </div>
  );
};
