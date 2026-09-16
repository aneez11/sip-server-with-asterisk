---
paths:
  - 'web/src/**'
---

# Web source

## Folder-per-component (MANDATORY)

Every React component and every page gets its **own folder** named after it, containing the
same-named `.tsx` file plus its SCSS and an optional `index.ts`:

```
web/src/components/Button/Button.tsx
web/src/components/Button/Button.scss
web/src/pages/BroadcastPage/BroadcastPage.tsx
web/src/pages/BroadcastPage/BroadcastPage.scss
```

NEVER place a `.tsx` directly in a category folder. Keep SCSS next to its component.

## Imports: `@/` absolute only

Use `@/` absolute imports everywhere (`@/components/Button/Button`, `@/lib/store`,
`@/pages/BroadcastPage/BroadcastPage`). Do NOT use deep relative `../` imports.

## Naming conventions

- Components/pages: PascalCase folder + file (`TenantsPage/TenantsPage.tsx`).
- Hooks: `use` + PascalCase (`useEndpoints`), file in camelCase (`useEndpoints.ts`).
- Services: camelCase file with `Service` suffix (`endpointService.ts`), export `endpointService`.
- SCSS matches the component name; kebab-case for `@/` aliases and folders.

## Hooks & services separation

Pages consume **hooks**; hooks wrap **services**; services are the data boundary.

## Theme

The visual theme is ported VERBATIM from the UNV IPSpeaker project: `tailwind.config.js`
and `web/src/main.scss` must not be changed unless the user explicitly asks for a
theme change. Follow the existing token variables (`--background`, `--primary`,
`--muted-foreground`, `--amber`, `--teal`, `--red`, …) and the shell grid
(260px / 1fr / 300px columns; 56px / 1fr / 32px rows).

## Form validation

Forms use zod + react-hook-form + `@hookform/resolvers` — never inline if/toast
validation. Schemas live in `web/src/lib/validation/schemas/` and mirror the API
(zod) validation rules for the same entity.

## Definition of Done

- `npm run typecheck` — zero errors.
- `npm run build` — production build succeeds.
- New files follow folder-per-component and the naming conventions above.
