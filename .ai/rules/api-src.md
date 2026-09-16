---
paths:
  - 'api/src/**'
---

# API source

## Structure

- `src/index.ts` — bootstrap: Express app, Socket.IO, AMI listener start, static web serving.
- `src/config.ts` — env-driven config (single source of truth, `zod`-parsed).
- `src/ami/` — the raw AMI client (`client.ts`) and the event listener (`listener.ts`).
- `src/services/` — domain services (endpoints, zones, broadcast, announcements, talk).
- `src/routes/` — Express routers (auth, endpoints, zones, broadcast, announcements, talk, status).

## Conventions

- TypeScript strict; `NodeNext` modules with `.js` extensions on relative imports.
- All API response shapes and socket events come from `@infinity/shared` — never
  re-declare domain types locally.
- Validation: zod schemas in `src/validation/` (one per resource). Never hand-roll
  `if`-based validation in handlers.
- AMI protocol: the client in `src/ami/client.ts` is the ONLY place that talks to
  Asterisk. Services never touch the socket directly.
- Config regeneration writes `endpoints.conf` then triggers `module reload res_pjsip.so`
  via AMI — never hand-edit the generated file.
- Errors: `ApiError` with status; zod failures become 422 with `{ message, errors }`.

## Definition of Done

- `npm run typecheck` — zero errors.
- `npm run build` — compiles.
- New behavior is covered by a unit test in `src/**/*.test.ts` (vitest) where feasible.
