# AGENTS.md — @infinity/web

React 19 + Vite + Tailwind CSS v3 (token bridge) + SCSS design system. The visual
language, shell layout and components mirror the Cafe Management reference console
(`styles/` partials) — keep changes consistent with it.
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
  main.scss             # Tailwind directives + HSL token bridge
  styles/               # design-system SCSS (tokens, shell, chrome, forms, dialogs)
  App/App.tsx           # console shell (grid 80 / 1fr / 320; 56 / 1fr / auto / 44)
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
