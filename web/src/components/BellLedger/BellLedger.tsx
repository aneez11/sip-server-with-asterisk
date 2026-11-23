import { useEffect, useMemo, useState } from 'react';
import { History, SkipForward } from 'lucide-react';
import type { Bell, BellOccurrence } from '@infinity/shared';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Badge } from '@/components/Badge/Badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/Dialog/Dialog';

interface Props {
  open: boolean;
  /** null = the whole schedule */
  bell: Bell | null;
  bells: Bell[];
  onClose: () => void;
}

const toneFor = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' =>
  status === 'fired'
    ? 'default'
    : status === 'failed' || status === 'missed'
      ? 'destructive'
      : status === 'skipped'
        ? 'secondary'
        : 'outline';

export const BellLedger = ({ open, bell, bells, onClose }: Props) => {
  const loadOccurrences = useStore((s) => s.loadOccurrences);
  const skipOccurrence = useStore((s) => s.skipOccurrence);
  const [rows, setRows] = useState<BellOccurrence[]>([]);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState<number | 'all'>(bell?.id ?? 'all');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (open) setScope(bell?.id ?? 'all');
  }, [open, bell]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void loadOccurrences({
      ...(scope === 'all' ? {} : { bellId: scope }),
      ...(status ? { status } : {}),
      limit: 200,
    })
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, scope, status, loadOccurrences]);

  // Re-fetch after a skip so the row reflects the new status immediately.
  const handleSkip = async (id: number) => {
    await skipOccurrence(id, 'manual');
    const data = await loadOccurrences({
      ...(scope === 'all' ? {} : { bellId: scope }),
      ...(status ? { status } : {}),
      limit: 200,
    });
    setRows(data);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, BellOccurrence[]>();
    for (const row of rows) {
      const list = map.get(row.localDate) ?? [];
      list.push(row);
      map.set(row.localDate, list);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="bells-ledger">
        <DialogHeader>
          <DialogTitle className="inline" style={{ gap: 8 }}>
            <History size={16} /> Occurrence ledger
          </DialogTitle>
          <DialogDescription>
            What actually happened, newest scope first. A skipped row still appears
            — the ledger must be able to explain silence.
          </DialogDescription>
        </DialogHeader>

        <div className="bells-ledger-filter">
          <select
            className="input"
            value={scope}
            onChange={(e) =>
              setScope(e.target.value === 'all' ? 'all' : Number(e.target.value))
            }
            aria-label="Filter ledger by bell"
          >
            <option value="all">All bells</option>
            {bells.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.timeOfDay})
              </option>
            ))}
          </select>
          <select
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter ledger by status"
          >
            <option value="">Every status</option>
            <option value="scheduled">Scheduled</option>
            <option value="fired">Fired</option>
            <option value="skipped">Skipped</option>
            <option value="missed">Missed</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div className="bells-ledger-body">
          {loading ? (
            <div className="state">
              <span className="spinner" /> Loading occurrences…
            </div>
          ) : grouped.length === 0 ? (
            <div className="state state-empty">
              <div>
                <strong>No occurrences in this window</strong>
                <p>Materialization covers the configured horizon (default 14 days).</p>
              </div>
            </div>
          ) : (
            grouped.map(([date, items]) => (
              <section key={date} className="bells-ledger-day">
                <h4 className="mono">{date}</h4>
                {items.map((row) => (
                  <div key={row.id} className="bells-ledger-row">
                    <span className="mono bells-ledger-time">{row.localMinute}</span>
                    <span className="bells-ledger-name">{row.bellName}</span>
                    <Badge
                      variant={toneFor(row.status)}
                      title={row.reason || undefined}
                    >
                      {row.status}
                      {row.reason && row.reason !== row.status ? ` · ${row.reason}` : ''}
                    </Badge>
                    {row.resultStatus && row.status === 'fired' ? (
                      <span className="muted tiny">delivery: {row.resultStatus}</span>
                    ) : null}
                    {row.status === 'scheduled' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleSkip(row.id)}
                        title="Skip this occurrence"
                      >
                        <SkipForward size={12} /> Skip
                      </Button>
                    ) : null}
                  </div>
                ))}
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
