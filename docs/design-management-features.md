# Design — Broadcast Management Features

Source-of-truth doc for five management features ported from comparable open-source
projects (FreePBX/paging, Wriar FreePBX-Paging-API, AccelerateNetworks PagingServer).

All five features keep the existing hard constraints: static dialplan (no per-zone
regen), AMI not ARI, endpoints never special-cased by `type`, `endpoint_ids` stays a
snapshot.

Implementation order (each phase independently shippable and testable):

1. Zone busy-state + live "in progress" indicator
2. Caller-ID announcement titles on target phones
3. Nonce-named announcement uploads + delayed cleanup
4. Per-zone attention tone, beep, volume
5. `user_agent` capture + per-vendor auto-answer profiles

---

## Phase 1 — Zone busy-state + live "in progress" indicator

### Problem

A user can trigger a second broadcast to the same zone while one is already running.
Phones get double-paged and the two streams fight over the same ConfBridge. The UI
has no way to know a broadcast is live.

### Behavior

- A zone is **busy** while a broadcast to it has `status = pending` (active page).
- Server rejects starting another broadcast to a busy zone: `409 Zone <name> is
  already paging`.
- Busy state is pushed to the UI in real time; triggers for a busy zone are disabled
  and the zone shows an "in progress" badge.
- A zone becomes free automatically when its page finalizes (success/partial/failed)
  or when the orphan sweep fails it.

### Changes

**API (`api/src/services/broadcast.ts`)**
- `broadcastZone` no longer delegates blindly: before creating the log, query
  `prisma.broadcastLog.findFirst({ where: { status: 'pending', zoneId } })` →
  throw `ApiError(409, ...)` if found.
- Thread `zoneId` through `broadcastAdhoc` (optional arg) so `BroadcastLog.zoneId` is
  finally populated (today it is never set — latent bug worth fixing here).
- After creating the pending log, emit `EVENTS.broadcastUpdated` with the pending
  state so the UI can mark the zone busy immediately (today the UI only learns of a
  broadcast when it finalizes).

**AMI listener (`api/src/ami/listener.ts`)**
- `finalize()`/orphan-sweep emits already carry `zoneId`; the pending emit happens
  synchronously in the broadcast service (no double-emit), so no `startPage()`
  change was needed for busy.
- No change needed to clear busy: `finalize()` already emits `broadcast.updated`.

**Shared (`shared/src/types.ts`)**
- `OverviewResponse.busyZoneIds: number[]` (chosen over per-zone `Zone.busy` for
  simplicity — the web derives busy from this + socket payloads).
- `BroadcastLog.zoneId` already existed; now genuinely populated.

**Routes (`api/src/routes/index.ts`)**
- `GET /api/status/overview`: compute `busyZoneIds` from pending logs
  (`status: 'pending'` → distinct non-null `zoneId`s).

**Web (`web/src/store/index.ts`, pages)**
- Store: `busyZoneIds: Set<number>` updated from `broadcast.updated` payloads
  (pending → add owning zone, terminal → remove) and seeded from overview.
- `BroadcastPage.tsx`: disable a zone quick-play button while that zone is busy and
  render an "In progress" label instead of the zone name.
- `ZonesPage.tsx`: amber "IN PROGRESS" badge column next to busy zone names.

### Acceptance criteria

- Second broadcast to a busy zone returns 409 and creates no log.
- Busy flag appears within ~1 event round-trip and clears on finalize/sweep.
- Overview payload reflects busy zones on fresh load.
- Feature test: mock AMI, assert 409 + single pending log per zone; assert
  `zoneId` is stored on the log.

---

## Phase 2 — Caller-ID announcement titles on target phones

### Problem

Target phones show an empty/"unknown" caller for pages. Operators want the
announcement title (e.g. "Fire drill") visible on the phone display, and it should
appear in the broadcast history too.

### Behavior

- The member leg of every page carries a Caller-ID set to the **content title**:
  announcement `name` for library broadcasts, "Live talk HH:MM:SS" for talk, track
  name for music, "Broadcast" fallback.
- Title is sanitized (control chars stripped, trimmed to 32 display chars) and
  stored on `BroadcastLog` for history.

### Changes

- **Schema**: add `title String @default("")` to `BroadcastLog`.
- **`broadcast.ts`**: resolve a `title` (announcement name, else latest-library name,
  else "Broadcast"); include `title` in the log row; pass it to the paging context as
  the `PAGE_TITLE` channel variable on the member Originate.
- **`announcements.ts`**: `play()` / `flashPlay()` pass the announcement name the same
  way (talk uses `Live talk <HH:MM:SS>`; music uses track name).
- **`lib/caller-id.ts`**: `sanitizeCallerId()` — strips control chars/CRLF, replaces
  AMI variable-list delimiters (`,` `&` `=` `;`), collapses whitespace, caps at 32
  chars, falls back to "Broadcast". Used for both the channel variable and display.
- **Static dialplan (`asterisk-config/extensions.conf`)**: one-time addition in
  `[paging]` 9000 and `[music]` 9001:
  `ExecIf($[${LEN(${PAGE_TITLE})} > 0]?Set(CALLERID(name)=${PAGE_TITLE}))` before
  `Dial()`. Required because the generated `endpoints.conf` sets `callerid` per
  endpoint, and an AMI `CallerID` on the Originate does NOT reach the dialing Local
  leg — the channel variable + dialplan Set is the only reliable path. The number
  stays the endpoint's configured callerid; only the display name is overridden.
- **`listener.ts`**: `broadcast.updated` payloads carry `title`.
- **Shared**: `BroadcastLog.title`; overview `recentLogs` include `title`.
- **Web history (`HistoryPage.tsx`)**: render the title (falls back to zone/Ad-hoc).

### Acceptance criteria

- AMI member Originate carries `PAGE_TITLE=<title>`; SIP INVITE `From:` shows the
  title as display name (verified live: `From: "crazy_7aHbNXc5"`).
- History rows show the title.
- Music/talk also carry titles.

---

## Phase 3 — Nonce-named announcement uploads + delayed cleanup

### Status

**Already implemented.** The `persistAudio()` method in `announcements.ts:152` has
always used `randomUUID()` for filenames. On-disk files are UUID-named (e.g.
`5cfac78e-4586-402e-80aa-8cc76adbe4a1.wav`), `originalName` is preserved for
display, and `cleanupFlash()` in the listener already sweeps flash files older than
5 minutes. No code changes required.

---

## Phase 4 — Per-zone attention tone, beep, volume

### Problem

Today a broadcast plays content with no attention cue, and all zones sound identical.
FreePBX gives each group a beep/none/custom announcement and a volume; operators want
the same.

### Behavior

- Each zone has:
  - `beep` (bool, default `true`) — play the standard `beep` prompt before content.
  - optional `announcementId` — custom attention tone played instead of `beep`.
  - `volume` (int 0–100, nullable) — receiver volume applied to member channels.
- Applied at broadcast time by the **announcer leg**, not by touching the dialplan:
  - beep on: `Playback` Data becomes `beep&<path>` (Asterisk plays files in sequence).
  - custom tone: `<tonePath>&<path>`.
  - beep off: `<path>` as today.
- Volume rides as a channel variable on the member Originate (`PVOL=<n>`); the
  static paging dialplan reads it once (one-time static edit — not per-zone regen).

### Changes

- **Schema**: `Zone.beep Boolean @default(true)`, `Zone.announcementId Int?` (FK to
  `Announcement`, nullable), `Zone.volume Int?`.
- **`broadcast.ts` `broadcastZone`**: load zone config, compute the announcer
  `Playback` data (attention `&` content) and add `PVOL` to the member leg variable
  list.
- **Routes**: `createZonesRouter` accepts the three new fields (PUT).
- **Static dialplan (`asterisk-config`)**: one-time addition in the paging context to
  apply `Set(VOLUME(TX)=${PVOL})` when `PVOL` is non-empty. This is a static edit,
  not generation.
- **Web `ZonesPage`**: add/edit dialog gains beep toggle, attention-tone picker
  (library announcements), volume slider.

### Acceptance criteria

- Zone with beep produces `Playback Data: beep&<content>` in the announcer Originate.
- Custom attention tone uses the selected announcement file.
- `volume` is present in member-leg variables.
- Zones without settings behave exactly as today.
- Feature test: assert Originate payload for each beep/custom/off combination.

---

## Phase 5 — `user_agent` capture + per-vendor auto-answer profiles

### Problem

Mixed phone/speaker fleets answer pages inconsistently: some vendors honor
`Alert-Info`/`Call-Info` auto-answer headers, some need a different incantation.
Today auto-answer is one global dialplan macro; there is no way to tune per vendor or
even see which device models are registered.

### Behavior

- Every endpoint stores its **last-seen SIP `User-Agent`**, captured from AMI
  (`PJSIPShowContacts` `ContactList` events already consumed by
  `pjsipShowContacts()`), refreshed on each `fetchContacts()`.
- A small **auto-answer profile** table (`AutoAnswerProfile`) holds per-vendor
  overrides: matched by User-Agent substring, with optional `alertInfo`, `callInfo`,
  `sipUri`, `dTime`, `dialOptions`.
- A zone may reference one profile. Its header variables are passed on the member
  Originate and applied by the (already static) auto-answer macro when present.
- UI: Endpoints page shows the User-Agent column; Zones edit dialog has a profile
  picker; profiles are manageable via a small admin dialog.

> Design note: because a page is a single `Page()`/Originate to many endpoints, the
> profile applies **zone-wide**, not per-endpoint within one page. Per-endpoint
> tailoring would require per-target Dial (FreePBX style) and is out of scope — the
> zone-wide profile plus captured user agents covers the practical "this fleet is
> Grandstream" case. Flagged as an accepted limitation.

### Changes

- **Schema**:
  - `Endpoint.userAgent String?`.
  - `AutoAnswerProfile { id, name unique, userAgentMatch String?, alertInfo String?,
    callInfo String?, sipUri String?, dTime Int?, dialOptions String? }`.
  - `Zone.autoAnswerProfileId Int?` (FK).
- **AMI client (`client.ts`)**: `pjsipShowContacts()` also reads the `useragent`
  field from `ContactList`; return `Map<ext, { uri, userAgent }>`.
- **`endpoints.ts`**: `fetchContacts()` upserts each endpoint's `userAgent` (and
  `registered`); serialize into `Endpoint` for the UI.
- **`broadcast.ts`**: when the zone has a profile, append its non-null fields as
  member-leg variables (`_ALERTINFO`, `_CALLINFO`, `_SIP_URI_OPTIONS`, `_DTIME`) and
  keep `PVOL` volume.
- **Static dialplan**: the existing `paging-autoanswer` macro is updated once to
  prefer per-call variables (`${_ALERTINFO}` etc.) when set, falling back to the
  current default.
- **Routes**: `AutoAnswerProfile` CRUD + `GET /api/endpoints` now returns
  `userAgent`.
- **Web**: Endpoints table column; zones dialog profile select; profiles admin
  dialog.

### Acceptance criteria

- Registered endpoints show their User-Agent after a contacts refresh.
- A profile with `alertInfo` set produces `_ALERTINFO` on the member Originate for
  zones that reference it.
- Zones without a profile produce identical Originates to today.
- Feature test: fake `ContactList` events populate `userAgent`; profile fields appear
  in Originate variables.

---

## Cross-cutting

### Migration

Single `prisma db push` for all new columns/models (project has no migration-file
workflow). New fields are all nullable/defaulted → backwards compatible.

### Socket contract

- `broadcast.updated` payload gains `title` and (for pending) `zoneId`; keep the
  existing shape so older clients ignore extra fields.
- No new socket events required.

### Testing (per AGENTS.md)

- All broadcast tests mock `AmiClient`; assert Originate payloads (Caller-ID, `Data`
  attention sequence, `PVOL`, `_ALERTINFO`).
- Config/API tests: schema shapes, zone CRUD with new fields, 409 busy path.
- `npm run typecheck` across shared/api/web after each phase.

### Open questions

- Volume: receiver-side `VOLUME(TX)` on the member leg, or announcer-side
  `VOLUME(RX)` on the conf bridge? Default plan: member `VOLUME(TX)`, verify in
  manual test.
- Should busy be zone-level only, or also block overlapping ad-hoc sets? Plan: zone
  only (scope), revisit if ad-hoc double-page becomes a complaint.
