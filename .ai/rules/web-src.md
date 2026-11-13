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

The console uses the SCSS design system under `web/src/styles/` (tokens, shell,
page chrome, forms, dialogs). Keep new UI on those tokens/classes (`btn`, `card`,
`field`, `chip`, `screen-head`) and the shell grid (80px rail / 1fr workspace /
320px context rail; 56px / 1fr / auto player / 44px rows).

## Form validation

Forms use zod + react-hook-form + `@hookform/resolvers` — never inline if/toast
validation. Schemas live in `web/src/lib/validation/schemas/` and mirror the API
(zod) validation rules for the same entity.

## Definition of Done

- `npm run typecheck` — zero errors.
- `npm run build` — production build succeeds.
- New files follow folder-per-component and the naming conventions above.
