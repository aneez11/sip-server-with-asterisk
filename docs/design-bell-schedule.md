# Design — Scheduled bells (school chimes / shift bells)

A **Bells** page that rings an audio clip on a wall-clock schedule: school period
bells, break/lunch chimes, factory shift changes, office prayer or quiet-hours
tones. Operators define bells once (time + weekdays + term range + targets) and
the API fires them through the existing paging path — no dialplan changes and no
new media pipeline.

> **Status:** design only. Nothing below is implemented yet.

Labels: **must** = required for the feature to count as shipped, **should** =
expected, **may** = follow-up.

## Problem

Today every sound the system makes is operator-initiated: Broadcast, Live talk,
Music, and dial-triggered PA groups. A school needs ~10–20 sounds a day at fixed
times (start of period, end of period, lunch, assembly, end of day) repeated five
days a week for a term, and those must not depend on someone remembering to press
Play.

Nothing in the console can express "08:00 Mon–Fri" or "not during holidays", and
the existing broadcast path has three properties that make a scheduler delicate:
zones reject a second concurrent page (`409`), pages are short-lived ConfBridge
sessions rather than persistent streams, and a page that is fired twice to the
same zone produces a double chime that is immediately audible — much worse than
a duplicated announcement.

## Goals

- **must** Define a bell: name, wall-clock time, weekdays, optional date range,
  audio, target zones and/or endpoints, enable toggle.
- **must** Fire reliably at the scheduled minute: exactly once per occurrence,
  surviving API restarts and overlapping manual broadcasts (no double chime).
- **must** Skip dates: whole-calendar holidays (all bells) and single-occurrence
  skips (a bell that did not ring today).
- **must** "Pause all bells" switch for snow days / exam weeks, plus per-bell
  disable.
- **must** Ledger of occurrences (`scheduled → firing → fired | skipped | missed
  | failed`) so an operator can answer "did the 10:15 bell ring?".
- **must** Every firing appears in History and the Monitor like any broadcast,
  titled with the bell name.
- **should** "Test" a bell now without recording it as a scheduled occurrence.
- **should** Named schedule templates (Regular day / Half day / Exam) with one
  active, switchable from the page.
- **should** Week-grid view (Mon–Sun × time) beside the list.
- **may** One-off bells for a single date (sports day, inspection).
- **may** Coalesce two bells due in the same minute for the same zone.
- **may** Telegram/email notifications on bell failure.

**Non-goals:** background music between periods (that is the Music page), alarm
or emergency siren semantics (a bell must never pre-empt a live announcement),
per-endpoint volume profiles, and cloud/multi-site scheduling.

## Why the API owns the clock

The dialplan is static by design (`asterisk-config/extensions.conf`), and the only
process that talks to Asterisk is the API's AMI client. Asterisk's own
`GotoIfTime` would put schedule data in generated dialplan, require an AMI reload
per edit, and give no ledger, no pause switch and no holiday list. So:

- the **API** decides *when*, using a 15 s tick and a materialized ledger;
- the **API** decides *what*, by calling `BroadcastService` (same
  `Local/announce@paging-bridge` announcer + per-endpoint member legs already used
  by Broadcast and Music);
- Asterisk is unchanged.

A bell is therefore just a broadcast with a system origin (`BroadcastLog.source =
'bell'`), which is why History, the Monitor and the orphan sweep keep working
without modification.

## Data model

```prisma
// One scheduled chime. `timeOfDay` is a WALL-CLOCK string ("07:45"), never a
// timestamp: the bell must ring at 07:45 local on every day it is enabled,
// independent of how UTC offsets or DST shift underneath it.
model Bell {
  id             Int       @id @default(autoincrement())
  name           String    @default("")
  timeOfDay      String    // "HH:MM" local, minute granularity
  // CSV of ISO weekdays, 1=Mon .. 7=Sun. "1,2,3,4,5" = school week.
  daysOfWeek     String    @default("1,2,3,4,5")
  // Term window (inclusive, local dates "YYYY-MM-DD" as strings for the same
  // reason as timeOfDay: no timezone attached to a calendar day).
  dateFrom       String    @default("")
  dateTo         String    @default("")
  enabled        Boolean   @default(true)
  announcementId Int?
  announcement   Announcement? @relation(fields: [announcementId], references: [id], onDelete: SetNull)
  // Optional attention beep before the clip; the clip itself is usually a chime.
  beep           Boolean   @default(false)
  volume         Int?      // 0-100, pushed as PVOL on member legs
  // Phase 3: named template (null = belongs to the always-on set).
  templateId     Int?
  template       BellTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  zones       BellZone[]
  endpoints   BellEndpoint[]
  occurrences BellOccurrence[]

  @@index([enabled])
  @@index([timeOfDay])
}

model BellZone {
  bellId Int
  zoneId Int
  bell   Bell @relation(fields: [bellId], references: [id], onDelete: Cascade)
  zone   Zone @relation(fields: [zoneId], references: [id], onDelete: Cascade)

  @@id([bellId, zoneId])
}

model BellEndpoint {
  bellId     Int
  endpointId Int
  bell       Bell     @relation(fields: [bellId], references: [id], onDelete: Cascade)
  endpoint   Endpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@id([bellId, endpointId])
}

// Materialized occurrence. The unique key makes a bell ring exactly once per
// local minute — including across a DST fall-back hour, where the same
// localDate + localMinute occurs twice.
model BellOccurrence {
  id          Int      @id @default(autoincrement())
  bellId      Int
  bell        Bell     @relation(fields: [bellId], references: [id], onDelete: Cascade)
  scheduledAt DateTime // UTC instant of the local wall clock
  localDate   String   // "2026-11-22" (bell timezone)
  localMinute String   // "07:45"
  // scheduled | firing | fired | skipped | missed | failed
  status      String   @default("scheduled")
  reason      String   @default("")   // "paused" | "holiday" | "busy" | error text
  /** Monitor the real delivery result, not just that we dispatched. */
  resultStatus String  @default("")   // success | partial | failed
  broadcastLogId Int?  @unique
  claimedAt   DateTime?
  firedAt     DateTime?
  createdAt   DateTime @default(now())

  @@unique([bellId, localDate, localMinute])
  @@index([status, scheduledAt])
  @@index([scheduledAt])
}

// Date-level exceptions. bellId null = every bell (holiday / vacation day).
model BellSkip {
  id      Int    @id @default(autoincrement())
  date    String // local "YYYY-MM-DD"
  bellId  Int?
  bell    Bell?  @relation(fields: [bellId], references: [id], onDelete: Cascade)
  reason  String @default("")

  @@unique([date, bellId])
  @@index([date])
}

// Phase 3. A named set of bells (Regular day / Half day / Exam day). Exactly one
// template is active; per-date overrides let the operator say "this Friday runs
// the Half-day template".
model BellTemplate {
  id        Int      @id @default(autoincrement())
  name      String   @unique
  active    Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  bells     Bell[]
  overrides BellTemplateOverride[]
}

model BellTemplateOverride {
  id         Int          @id @default(autoincrement())
  date       String       // local "YYYY-MM-DD"
  templateId Int
  template   BellTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([date])
}

// Singleton (id = 1): the pause switch survives restarts and is site state, not
// deployment config.
model BellSetting {
  id        Int      @id @default(1)
  paused    Boolean  @default(false)
  pausedBy  String   @default("")
  pausedAt  DateTime?
  updatedAt DateTime @updatedAt
}
```

Migration is additive (`prisma db push`): new tables plus two nullable columns.
`BroadcastLog` gains:

```prisma
source String @default("manual") // manual | bell | music | talk | pa
```

so History can badge bell-fired rows without joining the ledger.

## Scheduling model

### Wall clock, not instants

Every schedule field (`timeOfDay`, `dateFrom`, `dateTo`, `BellSkip.date`,
`localDate`, `localMinute`) is a **string** interpreted in `BELL_TIMEZONE`
(IANA id, default `Asia/Kathmandu`, documented in `.env.example`). Only
`BellOccurrence.scheduledAt` is a UTC instant, derived. Storing "07:45" as a
timestamp is how scheduled-audio systems end up chiming an hour early after a
DST change; the derived-instant column exists purely for ordering and
`<= now` dispatch queries.

### Materialized horizon

`BellService.materialize()` walks the next `BELL_HORIZON_DAYS` (default 14) of
local dates and, for each enabled bell whose weekday is selected and whose local
date is inside `dateFrom..dateTo`, upserts a `BellOccurrence` with
`status = "scheduled"`. The unique `(bellId, localDate, localMinute)` key makes
this idempotent, so it is safe to run on boot, hourly, and after every edit.

- Editing a bell's time or weekdays deletes its future `scheduled` rows and
  rematerializes, so a moved bell never keeps a stale ghost occurrence.
- A `BellSkip` covering the date materializes the row as `skipped` up front
  (rather than omitting it), so the ledger shows "skipped: holiday" instead of a
  suspicious gap.
- Occurrences older than `BELL_RETENTION_DAYS` (default 90) are pruned daily.

### Dispatch tick

`setInterval(15_000)`; each tick:

1. Read `BellSetting`; if `paused`, stamp due rows `skipped / "paused"` and stop.
2. `findMany({ status: "scheduled", scheduledAt: { lte: now } })`.
3. For each, **claim atomically**:
   `updateMany({ where: { id, status: "scheduled" }, data: { status: "firing", claimedAt: now } })`
   — only `count === 1` proceeds, so a duplicate tick, a manual materialize or a
   second API process can never double-fire.
4. Refresh the bell's targets (zones expanded to active endpoints, plus direct
   endpoints), then call `BroadcastService.broadcastForBell()`.
5. On success: `status = "fired"`, `broadcastLogId`, `firedAt`.
   On `409 busy`: leave `scheduled` and retry next tick until
   `scheduledAt + BELL_BUSY_GRACE_SEC` (default 60) has passed, then
   `failed / "busy"`. A bell never pre-empts a live announcement.
   On any other error: `failed` with the message in `reason`.

### Restarts, downtime and clock jumps

- Occurrences already due but older than `BELL_CATCHUP_SEC` (default **0 — no
  catch-up**) are stamped `missed` on boot. Blasting three bells at once because
  the container restarted at 09:12 is worse than silence, so catching up is
  opt-in.
- Because the ledger key is the local date+minute, a backwards clock jump or a
  repeated tick cannot re-ring a bell.
- The design assumes a single API replica (the deployment's shape). The atomic
  claim keeps it correct if that ever changes, but the in-memory sweep/horizon
  timers would need a leader election — noted, not built.

### DST policy (must be explicit)

- **Non-existent local time** (spring forward: 02:30 skips to 03:30): the
  occurrence is materialized as `skipped / "dst"` rather than shifted. A shifted
  bell rings at a time the timetable does not mention.
- **Ambiguous local time** (fall back: 01:30 happens twice): the first instant
  is used; the second attempt collides with the same `(bellId, localDate,
  localMinute)` and is rejected by the unique index.
- Nepal (UTC+05:45) has no DST, but the math is zone-generic so the feature is
  not Nepal-only.

## API

`createBellsRouter(bells)` mounted at `/api/bells`, session auth like the rest of
`/api`. Literal paths are registered before `/:id`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/bells` | List with targets, audio name, next occurrence, today's status |
| `POST` | `/api/bells` | Create (validates time, days, range, audio, targets) |
| `GET` | `/api/bells/:id` | Detail |
| `PUT` | `/api/bells/:id` | Update; resets future occurrences and rematerializes |
| `PATCH` | `/api/bells/:id` | `{ enabled }` only — the fast card/list toggle, no rematerialize burst |
| `DELETE` | `/api/bells/:id` | Delete (cascades occurrences; `BroadcastLog` rows stay) |
| `POST` | `/api/bells/:id/test` | Fire now to its current targets, `source="manual"`, no matching artifact |
| `GET` | `/api/bells/status` | `{ paused, timezone, serverTime, clockDriftSec, next: [...] }` |
| `POST` | `/api/bells/pause` | `{ paused }` — the "Pause all bells" kill switch |
| `GET` | `/api/bells/occurrences` | Ledger query: `?from&to&status` (local dates) |
| `POST` | `/api/bells/occurrences/:id/skip` | Skip one occurrence (`reason`) |
| `GET` | `/api/bells/skips` | Holiday / skip list |
| `POST` | `/api/bells/skips` | Add a skip (`date`, optional `bellId`, `reason`) |
| `DELETE` | `/api/bells/skips/:id` | Remove a skip |
| `POST` | `/api/bells/preview` | Upload/preview a candidate chime without saving a bell |

`GET /api/bells/status` also returns the server's own local time and offset so
the page can warn when the API host clock and `BELL_TIMEZONE` disagree — the
single most likely cause of "the bell rang at the wrong time".

Validation (`api/src/validation/schemas.ts`, mirrored in the web form schema):

- `timeOfDay` `/^([01]\d|2[0-3]):[0-5]\d$/`
- `daysOfWeek` non-empty subset of `1..7` (parsed from CSV)
- `dateFrom`/`dateTo` `"" | YYYY-MM-DD`, and `dateFrom <= dateTo` when both set
- `name` ≤ 120 trimmed; at least one target (`zoneIds` or `endpointIds`)
- `announcementId` must reference a broadcast-available `Announcement`; a clip
  longer than 120 s saves with a warning field rather than a hard rejection
- `volume` 0–100 or null

## Broadcast integration

Extract the originate block that `BroadcastService.broadcastAdhoc` already
contains into a private `startPage({ endpointIds, playPath, title, volume, beep,
autoAnswer, source, bellOccurrenceId })` and add:

```ts
async broadcastForBell(input: {
  occurrenceId: number;
  bellName: string;
  announcementId: number;
  zoneIds: number[];
  endpointIds: number[];
  beep: boolean;
  volume: number | null;
}): Promise<{ id: number }>
```

It resolves targets → active endpoints, applies the **per-zone busy check** for
every `zoneId` in the bell (a scheduled chime must not step on a live page),
creates the log with `source = "bell"` and `zoneId = null` (the bell's targets
are the snapshot, exactly like an ad-hoc broadcast), then calls `startPage`.

Bells intentionally ignore `Zone.beep` / `Zone.announcementId` / `Zone.volume`:
those describe operator broadcasts to that zone, and a bell's chime already *is*
the attention sound. A bell's own `beep` and `volume` apply instead. Documented
accepted limitation — merging several zones' option sets into one page has no
sensible answer.

Delivery result: `AmiListener.setLogFinalizedHandler((logId, status) => …)` is a
small new hook (called from `finalize()` and the orphan sweep) that lets
`BellService` copy `success | partial | failed` into
`BellOccurrence.resultStatus`. Without it the ledger can only report "we asked
Asterisk", not "the speakers answered".

## Web

New tab `bells` in `TAB_IDS`, icon rail entry between **PA groups** and
**History** (`BellRing` from `lucide-react`), label "Bells". No context rail
(`CONTEXT_TABS` unchanged) — the schedule is the content. `App.tsx` `PAGES` gains
`bells: BellsPage`.

`web/src/pages/BellsPage/BellsPage.tsx`:

- **Header:** `Bells` + subtitle
  `12 active · next 10:15 Period 3 · Mon–Fri · Asia/Kathmandu` and actions:
  a **Pause all** switch (danger-toned when paused), **Skips**, **Add bell**.
- **Paused banner:** full-width amber strip reading "All bells are paused — no
  chimes will ring", with an inline Resume button. This state must be impossible
  to miss; a silently paused school is the worst failure mode of the feature.
- **Toolbar:** search (name), day filter (Today / Mon / … / Sunday), status filter
  (All / Enabled / Disabled), sort by time ascending (default), matching the
  alphabetical-sort convention used by Media and Music.
- **List:** one row per bell — time badge (mono), name, day chips, target chips
  (zone names, "+n endpoints"), audio name, next-fire countdown, enable switch,
  Test / Edit / Delete actions. Rows due within the next hour are visually
  emphasized.
- **Week grid (should):** 7 columns (Mon–Sun) × time axis; each bell is a chip at
  its time. Read-only first; drag-and-drop rescheduling is a `may`.
- **Add/Edit dialog:** name, time (`type="time"`, minute step), weekday toggles
  (Mon–Fri quick-pick), optional term dates, audio picker over broadcast media
  with inline play, beep toggle, volume slider, target picker (zone checklist +
  endpoint sublist), enable switch, **Test** (fires now) and a live
  "next 3 occurrences" preview computed from the current form values.
- **Occurrences drawer:** the ledger for the selected bell or the whole schedule,
  grouped by day, with status chips and a per-row Skip action.
- **Skips dialog:** add a date (range quick actions: "next Monday", "winter
  break"), optional bell scope, reason.

Styling stays inside the existing design system (`Card`, `Badge`, `Switch`,
`Dialog`, `ScreenHeader`, `chip`/`state`/`grid-cards` classes in
`web/src/styles/`). No new palette, no new component language.

## Configuration

New env (`api/src/config.ts`, `.env.example`, NAS `.env`):

| Var | Default | Purpose |
|---|---|---|
| `BELL_ENABLED` | `true` | Hard kill switch: when false the router answers 503 and the tick does nothing |
| `BELL_TIMEZONE` | `Asia/Kathmandu` | IANA zone all wall-clock interpretation uses |
| `BELL_HORIZON_DAYS` | `14` | How far ahead occurrences are materialized |
| `BELL_TICK_MS` | `15000` | Dispatch tick period |
| `BELL_BUSY_GRACE_SEC` | `60` | How long a bell waits for a busy zone before failing |
| `BELL_CATCHUP_SEC` | `0` | Ring late after downtime; 0 = mark missed |
| `BELL_RETENTION_DAYS` | `90` | Ledger pruning |

No migration of existing data; a fresh install simply has zero bells.

## Phases

### Phase 1 — Engine + API (must)

1. Schema (`Bell`, `BellZone`, `BellEndpoint`, `BellOccurrence`, `BellSkip`,
   `BellSetting`, `BroadcastLog.source`) + `prisma db push` on boot.
2. `api/src/lib/bell-time.ts` — pure, dependency-free helpers:
   `localDateOf(instant, tz)`, `localMinuteOf`, `instantForWallClock(date, time,
   tz)` returning `null` for a non-existent local time, `parseDays`,
   `nextOccurrences(bell, tz, count)`. Fully unit-testable, no Prisma.
3. `api/src/services/bells.ts` — CRUD, `materialize`, `tick`, `test`, `pause`,
   `skips`, ledger queries, `onLogFinalized`.
4. `BroadcastService.startPage` extraction + `broadcastForBell` with the per-zone
   busy check; `AmiListener.setLogFinalizedHandler`.
5. `createBellsRouter` + zod schemas + shared types
   (`Bell`, `BellOccurrence`, `BellStatus`, `BellSkipView`,
   `EVENTS.bellFired`, `EVENTS.bellsChanged`).
6. Seeded chimes: `BellService.seedChimes()` writes three short 8 kHz mono clips
   with ffmpeg (`bell-chime`, `bell-double`, `bell-long`) through the same
   normalizer as announcements, so the feature works before anyone uploads audio
   — the same pattern as `seedPaMedia()`.
7. Tests: `bell-time` across a DST zone and Nepal; materialize idempotency;
   claim-once under a duplicated tick; busy → retry → `failed/busy`; paused →
   `skipped/paused`; catch-up off → `missed`.

**Acceptance:** `curl -X POST /api/bells` with `07:45` + Mon–Fri + one zone
produces occurrences for the next 14 school days; at 07:45 a broadcast log titled
with the bell name appears in History once (not twice) and the ledger shows
`fired` then `resultStatus: success`. Restarting the API at 07:46 does not
re-ring it.

### Phase 2 — Bells page (must)

1. Tab, rail entry, route registration.
2. List + pause banner + toolbar (search/day/status).
3. Add/Edit dialog with target picker, audio picker, occurrence preview and Test.
4. Occurrences drawer + skips dialog.
5. History badge for `source = "bell"` and a `bell.fired` toast.

**Acceptance:** an operator can create, test, disable, pause and skip bells
entirely from the page; a paused schedule shows the banner and produces `skipped`
rows, never audio.

### Phase 3 — Schedule templates (should)

1. `BellTemplate` CRUD, clone-from-active, exactly-one-active invariant.
2. Per-date overrides ("this Friday runs Half day").
3. Materialize reads template + override when picking the day's set.

**Acceptance:** switching from Regular to Half day re-materializes tomorrow as
the half-day set; a single date override changes only that date.

### Phase 4 — Polish (should/may)

- Week-grid view; drag a chip to change the time (`may`).
- Coalesce bells due in the same minute for an overlapping zone (`may`).
- `CallKind = "bell"` in the Monitor with its own icon/tone (`may`).
- Failure notification (toast + optional webhook) when a bell ends `failed` (`may`).
- One-off bells bound to a single date (`may`).

## Risks

| Risk | Mitigation |
|---|---|
| Double chime to the same zone (duplicate tick, restart, retry) | Unique `(bellId, localDate, localMinute)` + atomic `updateMany` claim; a bell never re-fires a claimed row |
| Wrong time zone after a deploy | Wall-clock strings + explicit `BELL_TIMEZONE`; `/status` exposes the zone and clock drift; the page prints the zone in the header |
| Moved/edited bell keeps a stale occurrence | Any schedule edit deletes that bell's future `scheduled` rows and rematerializes |
| Bell swallowed by a live announcement | Bounded retry inside `BELL_BUSY_GRACE_SEC`, then `failed/busy` — never pre-empts |
| Bells ring during a holiday | `BellSkip` rows materialize as `skipped` up front; visible in the ledger |
| Restart storms bells at once | `BELL_CATCHUP_SEC = 0` default → `missed`, not a burst |
| Silently paused schedule | Persistent amber banner + StatusBar indicator + `pausedBy/pausedAt` recorded |
| Ledger growth | Daily prune older than `BELL_RETENTION_DAYS`; `scheduledAt` indexed |
| Chime too long, overlaps the next | Save-time warning above 120 s; the busy check prevents overlap in the same zone |

## Effort

| Phase | Work | Est. |
|---|---|---|
| 1 | Schema, `bell-time`, service + tick, broadcast integration, routes, seeds, tests | ~1.5 days |
| 2 | Bells page, dialog, ledger drawer, skips, history badge | ~1 day |
| 3 | Templates + per-date overrides | ~½ day |
| 4 | Grid, coalescing, monitor kind, notifications | incremental |

Ship Phase 1 dark (zero bells = no behavior change) and add the page in Phase 2,
so the scheduler can be verified with a single test bell before operators see the
UI.

## Open decisions (defaults chosen above)

1. **Template granularity.** Flat bells + day masks are Phase 1; named templates
   (Regular / Half day / Exam) are Phase 3. Confirm that a school can live with
   one flat list for the first release.
2. **Bell vs. zone audio settings.** Bells use their own `beep`/`volume` and
   ignore the zone's, because a bell's clip is the attention sound. Confirm.
3. **Catch-up.** Defaults to off. Confirm that a missed bell after downtime should
   be logged, not rung late.
4. **Page placement.** Rail order `… Endpoints / Zones / PA groups / Bells /
   History`. Confirm, or state where it should sit.
