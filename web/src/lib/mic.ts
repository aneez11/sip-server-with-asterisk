// Browser microphone access requires a *secure context*. Over plain HTTP on a
// LAN IP (e.g. http://192.168.10.3:3001) `navigator.mediaDevices` is undefined,
// so calling `navigator.mediaDevices.getUserMedia()` throws the opaque
// "Cannot read properties of undefined (reading 'getUserMedia')".
//
// Every mic entry point goes through requireMicDevices() so the user instead
// gets an actionable message naming the HTTPS origin they should open.

/** Default HTTPS port of the API when TLS is enabled (see docker-compose.yml). */
const DEFAULT_HTTPS_PORT = '3443';

export class MicAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MicAccessError';
  }
}

/** The HTTPS origin the operator should use instead of the current HTTP one. */
export function suggestedHttpsOrigin(): string {
  const { hostname, port } = window.location;
  const httpsPort =
    (import.meta.env.VITE_HTTPS_PORT as string | undefined) ?? DEFAULT_HTTPS_PORT;
  // A reverse proxy may already terminate TLS on 443, in which case the port is
  // omitted from the suggestion.
  return httpsPort === '443' || httpsPort === ''
    ? `https://${hostname}`
    : `https://${hostname}:${httpsPort}`;
}

/**
 * Returns `navigator.mediaDevices`, or throws a MicAccessError explaining why the
 * microphone is unavailable (insecure origin / unsupported browser).
 */
export function requireMicDevices(): MediaDevices {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new MicAccessError(
      `Microphone needs HTTPS — open ${suggestedHttpsOrigin()} instead of ${window.location.origin}`,
    );
  }
  return navigator.mediaDevices;
}
