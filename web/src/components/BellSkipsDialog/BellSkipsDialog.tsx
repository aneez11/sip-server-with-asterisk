import { useState } from 'react';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import type { Bell, BellSkipView } from '@infinity/shared';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Input } from '@/components/Input/Input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/Dialog/Dialog';
import { bellSkipFormSchema } from '@/lib/validation/schemas/bell';

interface Props {
  open: boolean;
  bells: Bell[];
  skips: BellSkipView[];
  onClose: () => void;
}

/** "Next Monday" from a given local date, plus a couple of common quick-picks. */
const nextWeekday = (weekday: number): string => {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  for (let i = 1; i <= 14; i += 1) {
    const candidate = new Date(d.getTime() + i * 86_400_000);
    if (((candidate.getUTCDay() + 6) % 7) + 1 === weekday) {
      return candidate.toISOString().slice(0, 10);
    }
  }
  return d.toISOString().slice(0, 10);
};

export const BellSkipsDialog = ({ open, bells, skips, onClose }: Props) => {
  const addBellSkip = useStore((s) => s.addBellSkip);
  const removeBellSkip = useStore((s) => s.removeBellSkip);

  const [date, setDate] = useState('');
  const [bellId, setBellId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const parsed = bellSkipFormSchema.safeParse({ date, bellId, reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the date');
      return;
    }
    setError(null);
    await addBellSkip(parsed.data);
    setDate('');
    setReason('');
    setBellId(null);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="inline" style={{ gap: 8 }}>
            <CalendarOff size={16} /> Skip dates
          </DialogTitle>
          <DialogDescription>
            A date skip covers every bell (holidays, vacations) unless a specific
            bell is chosen. Skipped occurrences stay in the ledger with their reason.
          </DialogDescription>
        </DialogHeader>

        <div className="stack" style={{ gap: 12 }}>
          <div className="form-grid">
            <div className="form-row">
              <label>Date</label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="form-row">
              <label>Applies to</label>
              <select
                className="input"
                value={bellId ?? ''}
                onChange={(e) =>
                  setBellId(e.target.value === '' ? null : Number(e.target.value))
                }
              >
                <option value="">Every bell (holiday)</option>
                {bells.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.timeOfDay})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <label>Reason (optional)</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. winter break, exam week"
            />
          </div>

          <div className="inline" style={{ gap: 6 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDate(nextWeekday(1))}
            >
              Next Monday
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setReason('holiday')}
            >
              Mark as holiday
            </Button>
          </div>

          {error ? <div className="form-error">{error}</div> : null}

          {skips.length > 0 ? (
            <div className="stack-sm">
              <small className="bells-targets-head">
                Existing skips ({skips.length})
              </small>
              {skips.map((skip) => (
                <div key={skip.id} className="bells-skip-row">
                  <span className="mono">{skip.date}</span>
                  <span>{skip.bellName ?? 'All bells'}</span>
                  <span className="muted tiny">{skip.reason}</span>
                  <button
                    type="button"
                    className="icon-link danger"
                    title="Remove skip"
                    onClick={() => void removeBellSkip(skip.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => void submit()}>
            <Plus size={13} /> Add skip
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
