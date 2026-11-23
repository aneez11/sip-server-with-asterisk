/**
 * Wall-clock helpers for the bell scheduler. Pure and dependency-free: no
 * Prisma, no network, no ambient timezone assumptions.
 *
 * Every schedule value in this feature is a *local wall clock* string
 * ("07:45", "2026-11-22") interpreted in one IANA zone (`BELL_TIMEZONE`). Only
 * the derived `scheduledAt` is a UTC instant. Storing the wall clock as a
 * timestamp is how scheduled-audio systems chime an hour early after a DST
 * change; this module exists so the conversion happens in exactly one place.
 */

export interface WallClockOccurrence {
  /** Local calendar day, "YYYY-MM-DD". */
  localDate: string;
  /** Local time of day, "HH:MM". */
  localMinute: string;
  /** UTC instant, or null when the local time does not exist (DST spring-forward). */
  scheduledAt: Date | null;
}

export interface BellSchedule {
  timeOfDay: string;
  daysOfWeek: string;
  dateFrom: string;
  dateTo: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidLocalDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

export function isValidLocalMinute(value: string): boolean {
  return TIME_RE.test(value);
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Split a UTC instant into the wall-clock fields of `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local calendar day ("YYYY-MM-DD") of an instant in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** Local time of day ("HH:MM") of an instant in `timeZone`. */
export function localMinuteOf(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
    0,
  );
  // Intl truncates to seconds; keep the millisecond residue out of the offset.
  return asUtc - (instant.getTime() - (instant.getTime() % 1000));
}

/**
 * UTC instant for a local wall clock in `timeZone`.
 *
 * Returns `null` for a local time that does not exist (DST spring-forward gap,
 * e.g. 02:30 in a zone where 02:00 jumps to 03:00). A gap bell is materialized
 * as skipped/"dst" rather than shifted — a shifted chime rings at a time the
 * timetable never mentions.
 *
 * Ambiguous times (fall-back, when 01:30 happens twice) resolve to the *first*
 * instant. The occurrence ledger's `(bellId, localDate, localMinute)` key then
 * stops the second pass from ringing again.
 */
export function instantForWallClock(
  localDate: string,
  localMinute: string,
  timeZone: string,
): Date | null {
  const dm = DATE_RE.exec(localDate);
  const tm = TIME_RE.exec(localMinute);
  if (!dm || !tm) return null;

  const [year, month, day] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [hour, minute] = [Number(tm[1]), Number(tm[2])];
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  // Two passes converge for every real-world zone: the first offset is taken at
  // the naive instant, the second at the corrected candidate (handles the hour
  // either side of a transition).
  let candidate = naive - offsetMs(new Date(naive), timeZone);
  candidate = naive - offsetMs(new Date(candidate), timeZone);

  const resolved = new Date(candidate);
  const p = zonedParts(resolved, timeZone);
  if (
    p.year !== year ||
    p.month !== month ||
    p.day !== day ||
    p.hour !== hour ||
    p.minute !== minute
  ) {
    return null;
  }
  return resolved;
}

/** Parse a CSV weekday mask ("1,2,3,4,5") into sorted ISO weekdays. */
export function parseDays(csv: string): number[] {
  const days = new Set<number>();
  for (const token of String(csv ?? "").split(",")) {
    const n = Number(token.trim());
    if (Number.isInteger(n) && n >= 1 && n <= 7) days.add(n);
  }
  return [...days].sort((a, b) => a - b);
}

export function formatDays(days: number[]): string {
  return [...new Set(days)]
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
    .sort((a, b) => a - b)
    .join(",");
}

/** ISO weekday (1=Mon .. 7=Sun) of a local calendar day — no timezone involved. */
export function weekdayOf(date: string): number {
  const m = DATE_RE.exec(date);
  if (!m) return 0;
  const jsDay = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  ).getUTCDay();
  return ((jsDay + 6) % 7) + 1;
}

/** Shift a local calendar day by whole days ("YYYY-MM-DD"). */
export function addLocalDays(date: string, delta: number): string {
  const m = DATE_RE.exec(date);
  if (!m) return date;
  const d = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta),
  );
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Whether `date` falls inside the bell's inclusive term window. */
export function withinTerm(
  date: string,
  dateFrom: string,
  dateTo: string,
): boolean {
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

/**
 * The next `count` occurrences of a bell strictly after `from`, walking local
 * calendar days. Returns gap days as `scheduledAt: null` so the caller can
 * record them as skipped/"dst" instead of silently dropping them.
 */
export function nextOccurrences(
  bell: BellSchedule,
  timeZone: string,
  count: number,
  from: Date = new Date(),
  maxLookaheadDays = 400,
): WallClockOccurrence[] {
  const out: WallClockOccurrence[] = [];
  if (count <= 0) return out;

  const days = parseDays(bell.daysOfWeek);
  if (days.length === 0) return out;

  const daySet = new Set(days);
  const fromMs = from.getTime();
  let cursor = localDateOf(from, timeZone);

  for (let i = 0; i < maxLookaheadDays && out.length < count; i += 1) {
    if (withinTerm(cursor, bell.dateFrom, bell.dateTo)) {
      if (daySet.has(weekdayOf(cursor))) {
        const scheduledAt = instantForWallClock(
          cursor,
          bell.timeOfDay,
          timeZone,
        );
        if (scheduledAt === null || scheduledAt.getTime() > fromMs) {
          out.push({
            localDate: cursor,
            localMinute: bell.timeOfDay,
            scheduledAt,
          });
        }
      }
    }
    if (!bell.dateTo || cursor < bell.dateTo) cursor = addLocalDays(cursor, 1);
    else break;
  }
  return out;
}
