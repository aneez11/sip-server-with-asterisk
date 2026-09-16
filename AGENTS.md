# Infinity Echo — Workspace Guide

Monorepo for the Institute SIP broadcast paging console — a full Node.js + TypeScript
rewrite of the v1 Laravel/Asterisk system. The UI theme is ported **verbatim** from the
UNV IPSpeaker project.

```
Infinity Echo/
  shared/     @infinity/shared  — domain types + socket event contracts
  api/        @infinity/api     — Node/TS backend (Express + raw AMI + Socket.IO + Prisma)
  web/        @infinity/web     — React 19 + Vite + TS SPA (UNV theme, folder-per-component)
  docs/       design-*.md       — source of truth for intended behavior (docs-first)
```

Each sub-project has its own `AGENTS.md` with its local commands and conventions.
**When working inside a sub-project, read its `AGENTS.md` first and follow it.**
This root file covers cross-cutting structure and rules.

---

## Commands

- `npm install` — installs all workspaces.
- `npm run build` — builds shared → api → web.
- `npm run typecheck` — tsc --noEmit across all workspaces.
- `npm run dev:api` — API dev server (tsx watch).
- `npm run dev:web` — Vite dev server (proxies /api + /socket.io to the API).
- Docker: `docker compose up --build` — self-contained stack: its own Asterisk, MySQL
  and API on a pinned `172.30.0.0/24` network (the asterisk-config templates reference
  that subnet for AMI permit + RTP).

## Runtime layout (single process)

- `api` runs Express (REST + sessions), Socket.IO (live events), and the AMI listener
  loop in one process. `ami:listen` in v1 is the in-process listener here.
- The API serves the built `web/` static bundle in production (`/` → SPA).

## Live talk

Live talk is **true live streaming**: the API acts as a minimal SIP/RTP UA
(`api/src/lib/sip-ua.ts` + `api/src/lib/rtp-session.ts`) bridging the browser's
mic into Asterisk over PCMU RTP (WebRTC direct-to-Asterisk is unavailable — the
pjsip websocket transport never binds in this distro build). Exactly one selected
endpoint = two-way call; multiple endpoints = live one-way broadcast via the
paging ConfBridge. See `docs/design-live-talk.md`.

## Cross-project rules

- **Design docs before code:** behavior decisions live in `docs/`. Read the relevant
  `design-*.md` before implementing.
- **Shared types only from `@infinity/shared`:** API responses, request bodies, and
  socket events are declared once and imported by both api and web.
- **No secrets:** never commit `.env`, keys, or tokens.
- **Docs are not code:** update `docs/` when the user asks, or as part of the
  docs-first workflow when a feature ships.
- **Theme is frozen:** `web/tailwind.config.js` + `web/src/main.scss` are ported
  verbatim from UNV IPSpeaker — do not change without explicit user request.
- **Validation is mirrored, not duplicated:** the API's zod schemas and the web's
  form schemas stay in sync for the same entities.
