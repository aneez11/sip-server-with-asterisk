import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    /** Cached at login so routes can attribute actions without a DB read. */
    displayName?: string;
  }
}
