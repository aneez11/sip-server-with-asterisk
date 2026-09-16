/**
 * Sanitize a broadcast title into a safe caller-ID display string that is also
 * safe to carry as an AMI channel variable (no commas/`&`/`=` which delimit the
 * AMI Variable list). Strips control chars / CRLF (prevents header injection),
 * collapses whitespace and caps length for phone display. Empty result falls
 * back to "Broadcast".
 */
export function sanitizeCallerId(title: string): string {
  const clean = title
    .replace(/[\r\n\x00-\x1f]/g, ' ')
    .replace(/[,&=;]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  return clean || 'Broadcast';
}
