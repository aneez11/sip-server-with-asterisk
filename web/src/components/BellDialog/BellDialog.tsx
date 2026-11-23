import { useEffect, useMemo, useRef, useState } from 'react';
import { BellRing, Play, Volume2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Announcement, Bell, Endpoint, Zone } from '@infinity/shared';
import { useStore } from '@/store';
import { Button } from '@/components/Button/Button';
import { Input } from '@/components/Input/Input';
import { Switch } from '@/components/Switch/Switch';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/Dialog/Dialog';
import { DAY_LABELS, WEEKDAY_ORDER, previewOccurrences } from '@/lib/bellTime';
import { bellFormSchema, type BellFormValues } from '@/lib/validation/schemas/bell';
import { cn } from '@/lib/utils';

interface Props {
  /** null = add */
  bell: Bell | null;
  timezone: string;
  zones: Zone[];
  endpoints: Endpoint[];
  media: Announcement[];
  onClose: () => void;
}

const toFormValues = (bell: Bell | null, media: Announcement[]): BellFormValues => ({
  name: bell?.name ?? '',
  timeOfDay: bell?.timeOfDay ?? '07:45',
  daysOfWeek: bell?.daysOfWeek ?? [1, 2, 3, 4, 5],
  dateFrom: bell?.dateFrom ?? '',
  dateTo: bell?.dateTo ?? '',
  enabled: bell?.enabled ?? true,
  announcementId: bell?.announcementId ?? media[0]?.id ?? null,
  beep: bell?.beep ?? false,
  volume: bell?.volume ?? null,
  zoneIds: bell?.zoneIds ?? [],
  endpointIds: bell?.endpointIds ?? [],
});

export const BellDialog = ({
  bell,
  timezone,
  zones,
  endpoints,
  media,
  onClose,
}: Props) => {
  const createBell = useStore((s) => s.createBell);
  const updateBell = useStore((s) => s.updateBell);
  const testBell = useStore((s) => s.testBell);
  const testBellDraft = useStore((s) => s.testBellDraft);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<BellFormValues>({
    resolver: zodResolver(bellFormSchema),
    defaultValues: toFormValues(bell, media),
  });

  const values = watch();
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const preview = useMemo(
    () =>
      previewOccurrences(
        {
          timeOfDay: values.timeOfDay,
          daysOfWeek: values.daysOfWeek,
          dateFrom: values.dateFrom,
          dateTo: values.dateTo,
        },
        timezone,
        3,
      ),
    [values.timeOfDay, values.daysOfWeek, values.dateFrom, values.dateTo, timezone],
  );

  const broadcastMedia = useMemo(
    () => media.filter((m) => (m.broadcast ?? !m.music) && !m.flash),
    [media],
  );

  useEffect(() => () => audioRef.current?.pause(), []);

  const toggleInList = (field: 'daysOfWeek' | 'zoneIds' | 'endpointIds', id: number) => {
    const current = new Set(values[field]);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    const next = [...current].sort((a, b) => a - b);
    setValue(field, next, { shouldValidate: true, shouldDirty: true });
  };

  const playPreview = () => {
    const audio = audioRef.current;
    if (!audio || values.announcementId == null) return;
    audio.src = `/api/announcements/${values.announcementId}/audio`;
    audio.currentTime = 0;
    setPlaying(true);
    void audio.play().catch(() => setPlaying(false));
  };

  const save = handleSubmit(async (data) => {
    const ok = bell ? await updateBell(bell.id, data) : await createBell(data);
    if (ok) onClose();
  });

  const runTest = handleSubmit(async (data) => {
    if (bell) {
      await testBell(bell.id);
      return;
    }
    await testBellDraft({
      announcementId: data.announcementId as number,
      zoneIds: data.zoneIds,
      endpointIds: data.endpointIds,
      beep: data.beep,
      volume: data.volume,
    });
  });

  const fieldError = (message?: string) =>
    message ? <span className="form-error">{message}</span> : null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bells-dialog">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle className="inline" style={{ gap: 8 }}>
              <BellRing size={16} /> {bell ? 'Edit bell' : 'New bell'}
            </DialogTitle>
            <DialogDescription>
              The chime rings at this wall-clock time in {timezone}. Times are
              never stored as timestamps, so a DST change cannot shift the
              schedule.
            </DialogDescription>
          </DialogHeader>

          <div className="stack" style={{ gap: 14 }}>
            <div className="form-grid">
              <div className="form-row">
                <label htmlFor="bell-name">Name</label>
                <Input
                  id="bell-name"
                  placeholder="e.g. Period 3 start"
                  aria-invalid={Boolean(errors.name)}
                  {...register('name')}
                />
                {fieldError(errors.name?.message)}
              </div>
              <div className="form-row">
                <label htmlFor="bell-time">Time (24-hour)</label>
                <Input
                  id="bell-time"
                  type="time"
                  step={60}
                  aria-invalid={Boolean(errors.timeOfDay)}
                  {...register('timeOfDay')}
                />
                {fieldError(errors.timeOfDay?.message)}
              </div>
            </div>

            <div className="form-row">
              <label>Days</label>
              <div className="bells-days">
                {WEEKDAY_ORDER.map((day) => (
                  <button
                    key={day}
                    type="button"
                    className={cn('bells-day', values.daysOfWeek.includes(day) && 'on')}
                    onClick={() => toggleInList('daysOfWeek', day)}
                    aria-pressed={values.daysOfWeek.includes(day)}
                  >
                    {DAY_LABELS[day]}
                  </button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setValue('daysOfWeek', [1, 2, 3, 4, 5], { shouldValidate: true })
                  }
                >
                  Mon–Fri
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setValue('daysOfWeek', [1, 2, 3, 4, 5, 6, 7], {
                      shouldValidate: true,
                    })
                  }
                >
                  Every day
                </Button>
              </div>
              {fieldError(errors.daysOfWeek?.message)}
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label htmlFor="bell-from">Term starts (optional)</label>
                <Input id="bell-from" type="date" {...register('dateFrom')} />
              </div>
              <div className="form-row">
                <label htmlFor="bell-to">Term ends (optional)</label>
                <Input
                  id="bell-to"
                  type="date"
                  aria-invalid={Boolean(errors.dateTo)}
                  {...register('dateTo')}
                />
                {fieldError(errors.dateTo?.message)}
              </div>
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label htmlFor="bell-audio">Chime</label>
                <select
                  id="bell-audio"
                  className="input"
                  value={values.announcementId ?? ''}
                  onChange={(e) =>
                    setValue(
                      'announcementId',
                      e.target.value === '' ? null : Number(e.target.value),
                      { shouldValidate: true },
                    )
                  }
                >
                  <option value="">Choose audio…</option>
                  {broadcastMedia.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {fieldError(errors.announcementId?.message)}
              </div>
              <div className="form-row">
                <label>Preview</label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={playPreview}
                  disabled={values.announcementId == null}
                >
                  <Play size={13} /> {playing ? 'Playing…' : 'Play chime'}
                </Button>
                <audio
                  ref={audioRef}
                  onEnded={() => setPlaying(false)}
                  onPause={() => setPlaying(false)}
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            <div className="form-grid">
              <div className="form-row">
                <label className="inline" style={{ gap: 8 }}>
                  <Switch
                    checked={values.beep}
                    onCheckedChange={(checked) => setValue('beep', checked)}
                  />
                  Attention beep before the chime
                </label>
              </div>
              <div className="form-row">
                <label className="inline" style={{ gap: 8 }}>
                  <Switch
                    checked={values.enabled}
                    onCheckedChange={(checked) => setValue('enabled', checked)}
                  />
                  Enabled
                </label>
              </div>
            </div>

            <div className="form-row">
              <label className="inline" style={{ gap: 8 }}>
                <Volume2 size={13} /> Volume
                <span className="muted tiny">
                  {values.volume == null ? 'device default' : `${values.volume}%`}
                </span>
              </label>
              <div className="inline" style={{ gap: 10 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={values.volume ?? 80}
                  onChange={(e) =>
                    setValue('volume', Number(e.target.value), { shouldDirty: true })
                  }
                  style={{ flex: 1, accentColor: 'var(--acc)' }}
                  aria-label="Bell volume"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setValue('volume', null)}
                >
                  Default
                </Button>
              </div>
            </div>

            <div className="form-row">
              <label>Targets</label>
              <div className="bells-targets">
                <div>
                  <small className="bells-targets-head">Zones</small>
                  {zones.length === 0 ? (
                    <span className="muted tiny">No zones configured.</span>
                  ) : (
                    zones.map((zone) => (
                      <label key={zone.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={values.zoneIds.includes(zone.id)}
                          onChange={() => toggleInList('zoneIds', zone.id)}
                          style={{ accentColor: 'var(--acc)' }}
                        />
                        <span style={{ flex: 1 }}>{zone.name}</span>
                        <span className="mono muted" style={{ fontSize: 10 }}>
                          {zone.endpointCount}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <div>
                  <small className="bells-targets-head">Individual endpoints</small>
                  <div style={{ maxHeight: 132, overflowY: 'auto' }}>
                    {endpoints.map((endpoint) => (
                      <label key={endpoint.id} className="check-row">
                        <input
                          type="checkbox"
                          checked={values.endpointIds.includes(endpoint.id)}
                          onChange={() => toggleInList('endpointIds', endpoint.id)}
                          style={{ accentColor: 'var(--acc)' }}
                        />
                        <span style={{ flex: 1 }}>{endpoint.label}</span>
                        <span className="mono muted" style={{ fontSize: 10 }}>
                          {endpoint.extension}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              {fieldError(errors.zoneIds?.message)}
            </div>

            <div className="bells-preview">
              <small className="bells-targets-head">Next 3 occurrences</small>
              {preview.length === 0 ? (
                <span className="muted tiny">
                  Nothing coming up — check the days and the term window.
                </span>
              ) : (
                <ul>
                  {preview.map((occ) => (
                    <li key={`${occ.localDate}-${occ.localMinute}`}>
                      <span className="mono">{occ.localDate}</span>
                      <span className="mono">{occ.localMinute}</span>
                      <span className="muted tiny">
                        {occ.at === null
                          ? 'skipped (DST gap)'
                          : occ.at.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={runTest}>
              <Play size={13} /> Test now
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : bell ? 'Save changes' : 'Add bell'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
