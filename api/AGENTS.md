# AGENTS.md — @infinity/api

Node.js + TypeScript (strict, `NodeNext`), Express 4, Socket.IO, Prisma (MySQL), a raw
AMI client, and an in-process AMI listener. See `.ai/rules/api-src.md` (mandatory) and
the root `AGENTS.md`.

## Commands

- `npm run dev` — `tsx watch src/index.ts`
- `npm run build` — `tsc -p tsconfig.json && prisma generate`
- `npm run typecheck` — `tsc --noEmit`
- `npm run start` — `node dist/index.js`

## Env (.env)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | API + socket + static web |
| `DATABASE_URL` | — | `mysql://root:pw@mysql:3306/infinity_echo` |
| `AMI_HOST` / `AMI_PORT` | `asterisk` / `5038` | AMI endpoint (bridge network) |
| `AMI_USERNAME` / `AMI_SECRET` | — | AMI creds (must match manager.conf) |
| `ASTERISK_ENDPOINTS_CONF_PATH` | `/etc/asterisk/endpoints.conf` | config-regen target |
| `ANNOUNCEMENTS_DIR` | `/announcements` | shared WAV store (also mounted in Asterisk) |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_DISPLAY` | — | seeded console login |
| `SESSION_SECRET` | — | cookie signing |

## Boot

1. `prisma db push` creates/migrates the `infinity_echo` schema (simple single-DB model —
   no migrations-as-files workflow needed at this scale).
2. Seed the admin user if absent.
3. Start the AMI listener, then Express + Socket.IO.
4. Serve `web/dist` (built by the workspace `build` step) at `/` with SPA fallback.

## AMI

- `src/ami/client.ts` — raw TCP AMI protocol (login, actions with ActionID matching,
  list-event collection, reconnect with backoff). The only place that touches the socket.
- `src/ami/listener.ts` — maps AMI events to domain state: broadcast log lifecycle
  (VarSet BROADCAST_LOG_ID → Newchannel Local;2 → DialBegin/End → Hangup → finalize),
  plus a sweep that fails orphaned pending logs.

## Rules (short version)

- Strict TS, `.js` extensions on relative imports.
- Domain types only from `@infinity/shared`.
- zod validation in `src/validation/`, one schema per resource; 422 on failure.
- Errors via `ApiError(status, message, errors?)`.
- Never hand-edit `endpoints.conf` — always through the regen service + AMI reload.
