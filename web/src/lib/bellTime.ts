/**
 * Browser-side mirror of api/src/lib/bell-time.ts, used only for the dialog's
 * "next 3 occurrences" preview. The server is authoritative for real
 * scheduling; this exists so the operator can see what they are about to save.
 *
 * Same rules: values are wall clock in the site timezone, a non-existent local
 * time (DST gap) is reported as null rather than shifted, and an ambiguous
 * fall-back time resolves to the first instant.
 */

export interface PreviewOccurrence {
  localDate: string;
  localMinute: string;
  at: Date | null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

const partsFormatter = (tz: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

function zonedParts(date: Date, tz: string) {
  const parts = partsFormatter(tz).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function localDateOf(date: Date, tz: string): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (date.getTime() - (date.getTime() % 1000));
}

export function instantForWallClock(
  localDate: string,
  localMinute: string,
  tz: string,
): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(localMinute);
  if (!dm || !tm) return null;
  const [year, month, day] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [hour, minute] = [Number(tm[1]), Number(tm[2])];
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  let candidate = naive - offsetMs(new Date(naive), tz);
  candidate = naive - offsetMs(new Date(candidate), tz);

  const resolved = new Date(candidate);
  const p = zonedParts(resolved, tz);
  if (
    p.year !== year ||
    p.month !== month ||
    p.day !== day ||
    p.hour !== hour ||
    p.minute !== minute
  )
    return null;
  return resolved;
}

const addDays = (date: string, delta: number) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta),
  );
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
};

const weekdayOf = (date: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return 0;
  const js = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  ).getUTCDay();
  return ((js + 6) % 7) + 1;
};

export function previewOccurrences(
  schedule: {
    timeOfDay: string;
    daysOfWeek: number[];
    dateFrom: string;
    dateTo: string;
  },
  tz: string,
  count = 3,
  from: Date = new Date(),
): PreviewOccurrence[] {
  const out: PreviewOccurrence[] = [];
  if (!schedule.timeOfDay || schedule.daysOfWeek.length === 0) return out;
  const daySet = new Set(schedule.daysOfWeek);
  let cursor = localDateOf(from, tz);

  for (let i = 0; i < 400 && out.length < count; i += 1) {
    if (
      (!schedule.dateFrom || cursor >= schedule.dateFrom) &&
      (!schedule.dateTo || cursor <= schedule.dateTo) &&
      daySet.has(weekdayOf(cursor))
    ) {
      const at = instantForWallClock(cursor, schedule.timeOfDay, tz);
      if (at === null || at.getTime() > from.getTime()) {
        out.push({ localDate: cursor, localMinute: schedule.timeOfDay, at });
      }
    }
    if (schedule.dateTo && cursor >= schedule.dateTo) break;
    cursor = addDays(cursor, 1);
  }
  return out;
}

export const DAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7];

/** "07:45" -> minutes since local midnight, for sorting/countdowns. */
export function minutesOfDay(time: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
