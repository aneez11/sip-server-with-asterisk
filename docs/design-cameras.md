# Design — IP camera management page

A dedicated **Cameras** page so cameras become first-class records instead of a
hidden section inside an endpoint's edit dialog.

> **Status:** planned, not implemented. This doc is the source of truth for the
> shape below; code lands phase by phase.

Labels: **must** = required for the feature to count as shipped, **should** =
expected, **may** = follow-up.

## Problem

Today a camera exists only as `EndpointCamera` with a **unique `endpointId`**
(`api/prisma/schema.prisma`). Consequences:

- You cannot register a camera that has no phone/speaker in front of it
  (corridor, gate, parking) — there is no endpoint to attach it to.
- Discovery is awkward: an operator must first open an endpoint, then scroll to
  the camera section, to find out whether a camera is reachable.
- There is no single list: fleet health, codec, and "who is this camera for" are
  scattered across per-endpoint dialogs.
- The preview path only works inside a two-way talk
  (`CameraStreamService.ensure` rejects anything but `mode === "twoway"`).

## Goals

- **must** A **Cameras** tab listing every camera with live status, thumbnail,
  codec, resolution, host, and the endpoint it serves (if any).
- **must** Create/edit/delete a camera **independently of endpoints**; optional
  link to one endpoint.
- **must** Preview a camera from the management page without starting a talk
  (WebRTC when the codec allows, JPEG snapshot fallback otherwise).
- **must** Probe ("Test"), detect ONVIF profiles, snapshot, enable/disable, and
  update credentials from the page.
- **must** Existing endpoint-bound cameras keep working in Live talk with no
  operator action after migration.
- **should** Fleet view: counts by status (online / unreachable / disabled),
  filter and sort, alphabetical by name.
- **should** Reuse the existing ONVIF probe, secret-box, and go2rtc plumbing —
  no second media path.
- **may** One camera serving several endpoints (see "Multi-binding" below).

**Non-goals:** camera recording, PTZ controls, audio from cameras, motion
alerts, cloud/remote access. PTZ stays a follow-up on this page.

## Why a new model rather than loosening `EndpointCamera`

`EndpointCamera.endpointId` is `@unique` and required — the schema itself encodes
"one camera per endpoint, camera is meaningless alone". Making that column
nullable would work, but every existing query keys off `endpointId`, so the
standalone case would fork the code (two ids, two lookups, two stream names).

A separate `Camera` table with an **optional** unique `endpointId` keeps one
identity for a camera everywhere: gateway stream name, token payload, snapshot
route, and the endpoint dialog all reference `camera.id`.

## Data model

```prisma
model Camera {
  id               Int      @id @default(autoincrement())
  name             String   @default("")            // operator label, unique-ish
  location         String   @default("")
  // Optional inverse binding: a camera may serve one endpoint (Live talk preview).
  endpointId       Int?     @unique
  endpoint         Endpoint? @relation(fields: [endpointId], references: [id], onDelete: SetNull)
  enabled          Boolean  @default(false)
  host             String
  port             Int      @default(80)
  username         String   @default("")
  passwordCipher   String   @default("")
  channel          Int      @default(1)
  profileToken     String   @default("")
  profileName      String   @default("")
  rtspUri          String   @default("")
  snapshotUri      String   @default("")
  preferredStream  String   @default("sub")
  streamCodec      String   @default("")
  streamWidth      Int?
  streamHeight     Int?
  lastCheckAt      DateTime?
  lastCheckOk      Boolean?
  lastCheckError   String?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([enabled])
  @@index([name])
}
```

Migration is additive and data-preserving:

1. create `Camera`;
2. `INSERT INTO Camera (...) SELECT ... FROM EndpointCamera` keeping `id` free
   but preserving `endpointId`;
3. leave `EndpointCamera` in place for one release, read-through in the service;
4. drop `EndpointCamera` in a follow-up once nothing reads it.

Do **not** rename `EndpointCamera` in place: a rename plus backfill in one
migration is the risky step, and the service can read either table during the
transition.

### Multi-binding (may)

If one camera should appear for two endpoints, replace the unique `endpointId`
with a `CameraEndpoint` join table. Explicitly out of the first cut: it changes
the Live-talk lookup from `endpointId` to a join and needs a "which camera wins"
rule.

## API

New router `createCamerasRouter(cameraService)` mounted at `/api/cameras`, same
session auth as the rest of `/api`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cameras` | List: id, name, location, enabled, configured, reachable, host, port, codec, width/height, lastCheckAt/Error, endpointId + endpoint label. Never returns the password. |
| `POST` | `/api/cameras` | Create. Optional `endpointId`; 422 if that endpoint already has a camera. |
| `GET` | `/api/cameras/:id` | Full `CameraView` (same shape as today's endpoint camera view, plus `name`, `location`, `endpointId`). |
| `PUT` | `/api/cameras/:id` | Update. `password` omitted/empty keeps the stored one (write-only, unchanged semantics). Probes inline like `CameraService.save`. |
| `DELETE` | `/api/cameras/:id` | Delete; stops any gateway stream for it. |
| `POST` | `/api/cameras/:id/test` | Probe unsaved host/port/user/password. |
| `GET` | `/api/cameras/:id/snapshot` | Proxied JPEG (existing credential handling). |
| `POST` | `/api/cameras/:id/preview` | Mint a short-lived preview token **not bound to a talk**. |
| `POST` | `/api/camera/whep/:token` | Existing WHEP proxy, extended to accept camera preview tokens. |

Existing routes stay for compatibility until the web app stops using them:

- `GET/PUT/DELETE /api/endpoints/:id/camera` → thin adapters that resolve the
  endpoint's `Camera` (404-style `configured:false` when unbound).
- `POST /api/talk/:talkId/camera` → resolves `talk.endpointIds[0]` → `Camera`
  as today; token payload gains `cameraId`.

Validation (`api/src/validation/schemas.ts`): extend `cameraConfigSchema` with
`name` (≤120, trimmed, required on create), `location` (≤190), `endpointId`
(nullable positive int). Keep the multiple-of-1 range checks on `port`,
`channel`, and the `sub|main` enum.

### Token and stream naming

- Token payload: `{ c: cameraId, t?: talkId, e?: endpointId, x: exp }`.
  Talk-bound tokens keep `t`/`e`; preview tokens carry only `c`. The service
  accepts both and authorizes the WHEP call by token, never by query string.
- Gateway stream name becomes `cam-<cameraId>`. Migration must therefore
  invalidate old `cam-<endpointId>` streams — `stopAll()` on boot plus the
  existing delete-on-stop covers it.
- Preview tokens are minted only for enabled cameras, and are revoked when the
  camera is disabled or deleted.

## Web

New tab `cameras` (icon rail, between **Monitor** and **Live talk** — camera
monitoring reads as a monitoring surface). `TAB_IDS` takes `"cameras"`; no
context rail (`hasContextRail` unchanged).

`web/src/pages/CamerasPage/CamerasPage.tsx`:

- **Header:** `Cameras` + counts (`n online · n unreachable · n disabled`) and an
  **Add camera** action. Subtitle: "ONVIF cameras for room previews and
  monitoring."
- **Toolbar:** search (name, location, host) and a status filter
  (All / Online / Unreachable / Disabled). Default sort alphabetical, matching
  the media library and music playlist.
- **Grid:** one card per camera — 16:9 snapshot (proxied JPEG, refreshed on a
  slow timer while the page is visible), status chip, name, location, host:port,
  codec + resolution, endpoint badge or "Unassigned", and actions: Preview,
  Test, Edit, Toggle, Delete.
- **Preview dialog (must):** `<video autoplay playsinline muted>` via WHEP when
  the codec is H.264 (or transcoding is on); otherwise the snapshot poller with a
  note. Close/Escape stops the peer connection and deletes the gateway stream.
  This must not require an active talk.
- **Add/Edit dialog:** extract the current `CameraSettings` form into a shared
  `CameraForm` (name, location, host, port, ONVIF user/password, Detect
  profiles, stream profile selector, preferred sub/main, optional endpoint
  link, enable toggle, Test, snapshot). `CameraSettings` becomes a thin wrapper
  that loads/saves through the endpoint adapter, so the endpoint dialog keeps its
  camera section and the Cameras page gets the same form.

`monitor`-style density: reuse `Card`, `Badge`, `Dialog`, `ScreenHeader`, and
the existing `media-card`/`kpi` styles rather than adding a new design language.
Mobile inherits the PWA shell (cards already stack; the preview dialog is
full-screen below 760px).

## Live talk integration (unchanged behavior)

When a two-way talk starts, `CameraPreview` resolves the endpoint → camera → WHEP
exactly as today. Only the stream name and token payload change internally. A
camera failure must still never call `stopLiveTalk()`.

## Phases

### Phase 1 — Model + API (must)

1. `Camera` model + migration backfilling every `EndpointCamera` row.
2. `CameraService` generalized to `cameraId`; `summaries()` keyed by camera id;
   endpoint lookups resolved through `Camera.endpointId`.
3. `/api/cameras` CRUD + test + snapshot.
4. Endpoint camera routes become adapters (behavior unchanged).
5. Tests: create standalone camera, probe failure stores `lastCheckError`, no
   plaintext password in any response, endpoint adapter round-trips.

**Acceptance:** `curl /api/cameras` lists migrated cameras; a standalone camera
can be created with no endpoint; Live talk still shows the room camera.

### Phase 2 — Preview without a talk (must)

1. `POST /api/cameras/:id/preview` mints a preview token; WHEP accepts it.
2. Token revoked on disable/delete; gateway stream removed when the peer leaves.
3. Tests: preview token rejected for a disabled camera, expired token 401,
   unknown camera 404.

**Acceptance:** operator opens Preview on the Cameras page with no call active
and sees video (H.264) or snapshots (H.265 with transcode off).

### Phase 3 — Cameras page UI (must)

1. Tab, rail entry, route registration.
2. Card grid + search/status filter + alphabetical sort.
3. Add/Edit dialog via the extracted `CameraForm`; endpoint link optional.
4. Preview dialog with teardown on close/hidden/page unload.

**Acceptance:** every camera action from the design works from this page, and
the endpoint dialog's camera section still behaves identically.

### Phase 4 — Fleet polish (should/may)

- Bulk re-test ("Test all") with a progress row.
- "Assign to endpoint" quick action from the card.
- Auto-refresh statuses every 60 s while the page is visible.
- PTZ controls (may, separate doc).

## Risks

| Risk | Mitigation |
|---|---|
| Migration leaves orphaned `EndpointCamera` reads | Read through `Camera`; keep adapters for one release; verify row counts match before dropping the old table. |
| Stream name change breaks a live preview mid-upgrade | `stopAll()` on boot; previews are short-lived and re-established on demand. |
| Preview tokens become an unauthenticated camera feed | Tokens are session-minted, short TTL, single camera, revoked on disable/delete, and WHEP verifies the HMAC; never expose the camera URI or password. |
| Fleet polling overloads cameras | Snapshot refresh only while visible, ≥1 s interval, and only for cards on screen. |
| Two cameras claimed for one endpoint | Unique `Camera.endpointId`; 422 with a clear message on conflict. |

## Effort

Phase 1 ~½ day (model, migration, service generalization, tests), Phase 2 ~¼
day, Phase 3 ~1 day (page + form extraction), Phase 4 incremental. Phase 1 and 2
ship dark behind the existing `CAMERA_ENABLED` switch.
