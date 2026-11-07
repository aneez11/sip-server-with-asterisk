/**
 * Live-talk registry.
 *
 * Live talk owns its BroadcastLog lifecycle (created at start, finalised on
 * stop). The AMI listener's sweep, however, fails *any* pending log older than
 * `PAGE_DURATION + 30` seconds so that crashed broadcasts do not linger. Without
 * this registry a talk that runs longer than ~40 s is marked "failed" in history
 * while it is still on air.
 *
 * Kept in a tiny module (no imports) so both the service and the listener can
 * depend on it without a circular import.
 */
const activeTalkLogIds = new Set<number>();

export function registerTalkLog(logId: number): void {
  activeTalkLogIds.add(logId);
}

export function unregisterTalkLog(logId: number): void {
  activeTalkLogIds.delete(logId);
}

export function isActiveTalkLog(logId: number): boolean {
  return activeTalkLogIds.has(logId);
}

export function activeTalkLogs(): number[] {
  return [...activeTalkLogIds];
}
