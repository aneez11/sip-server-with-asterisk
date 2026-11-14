import { Radio } from 'lucide-react';
import { useStore } from '@/store';
import { ScreenHeader } from '@/components/ScreenHeader/ScreenHeader';

const fmtClock = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};

const statusTone = (status: string) =>
  status === 'success'
    ? ''
    : status === 'failed'
      ? 'bad'
      : status === 'stopped'
        ? 'quiet'
        : 'outline';

export const HistoryPage = () => {
  const recentLogs = useStore((s) => s.recentLogs);
  const endpoints = useStore((s) => s.endpoints);
  const busy = useStore((s) => s.busy);
  const playAdhoc = useStore((s) => s.playAdhoc);

  return (
    <div className="page-scroll">
      <ScreenHeader
        title="Broadcast history"
        subtitle={`${recentLogs.length} recent broadcast${recentLogs.length === 1 ? '' : 's'} · target lists are snapshots of what was dialed`}
      />

      {recentLogs.length === 0 ? (
        <div className="state state-empty state-fill">
          <div>
            <strong>No broadcast history yet</strong>
            <p>Broadcasts you start appear here with their target snapshot.</p>
          </div>
        </div>
      ) : (
        <div className="history-grid">
          {recentLogs.map((b) => {
            const labels = (b.endpointIds ?? []).map(
              (id) => endpoints.find((e) => e.id === id)?.label ?? `#${id}`,
            );
            const count = b.endpointIds?.length ?? 0;
            return (
              <article key={b.id} className="history-card">
                <div className="history-card-head">
                  <span className="mono history-card-time">{fmtClock(b.startedAt)}</span>
                  <span className={`chip ${statusTone(b.status)}`}>{b.status}</span>
                </div>

                <b className="history-card-title" title={b.title || b.zoneName || 'Ad-hoc'}>
                  {b.title || b.zoneName || 'Ad-hoc'}
                </b>
                <small className="history-card-targets" title={labels.join(', ')}>
                  {b.zoneName ? `${b.zoneName} · ` : ''}
                  {labels.join(', ') || '—'}
                </small>

                <div className="history-card-foot">
                  <span className="tiny muted">
                    {count} endpoint{count === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    className="icon-link"
                    onClick={() => void playAdhoc(b.endpointIds)}
                    disabled={busy || count === 0}
                    title="Rebroadcast to the same endpoints"
                    aria-label={`Rebroadcast ${b.title || b.zoneName || 'ad-hoc broadcast'}`}
                  >
                    <Radio size={13} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
