/** Format seconds as m:ss. Rounds once so 59.6s is 1:00, never 0:60. */
export function formatDuration(seconds: number): string {
  const sec = Math.max(0, Math.round(seconds));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** Metadata durations show nothing when absent or zero. */
export function formatDurationOrBlank(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '';
  return formatDuration(seconds);
}
