# AGENTS.md — @infinity/web

React 19 + Vite + Tailwind CSS v3 (UNV theme) + SCSS desktop console. The theme and
shell layout are ported **verbatim** from the UNV IPSpeaker project — do not change
`tailwind.config.js` or `src/main.scss` without an explicit user request.
Follow `.ai/rules/web-src.md` (MANDATORY) and the root `AGENTS.md`.

## Commands

- `npm run dev` — Vite dev server (port 5173, proxies `/api` + `/socket.io` → `http://localhost:3001`)
- `npm run build` — `tsc --noEmit && vite build`
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — type-only (no ESLint)

## Directory structure (follow exactly)

```
src/
  main.tsx              # entry — mounts the console + splash
  main.scss             # UNV theme tokens (verbatim) — DO NOT CHANGE
  App/App.tsx           # console shell (grid 260 / 1fr / 300; 56 / 1fr / 32)
  components/<Name>/<Name>.tsx + <Name>.scss   # shared atomic UI
  pages/<Name>Page/<Name>Page.tsx + .scss      # Broadcast, LiveTalk, Endpoints, History
  lib/
    api/                # typed API client + socket client
    store/              # zustand store
    validation/schemas/ # zod form schemas mirroring the API
    utils.ts
  recorder/recorder.ts  # mic recorder (live talk, record-then-play)
```

## Rules (short version)

- **Folder-per-component (MANDATORY)** — every component/page in its own folder.
- `@/` absolute imports only (`@/components/Button/Button`, `@/lib/store`).
- PascalCase folders+files for components/pages; `useX` hooks; `xService` services.
- Forms: zod + react-hook-form + `@hookform/resolvers`; never inline validation.
- Icons via `lucide-react` only. Toasts via `react-hot-toast`.
- State via zustand; realtime via `socket.io-client` (`src/lib/api/socket.ts`).
- Definition of Done: `npm run typecheck` + `npm run build` clean.
