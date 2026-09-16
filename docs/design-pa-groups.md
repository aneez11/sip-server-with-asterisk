# Design — Initiator/Receiver PA groups

One-to-many PA announcements triggered by **dialing an extension on a device**.
A profile (PA group) bundles an **initiator** device, a set of **receiver**
devices (speakers/phones that hear the announcement), a **group extension**, and
optional `pa_start` / `pa_end` tones.

## Data model (`PaGroup`)

```
PaGroup {
  id, name (unique), extension (unique — the number the initiator dials)
  initiatorEndpointId?  — device that may trigger it (null = any endpoint)
  paStartAnnouncementId? / paEndAnnouncementId?
  receivers[]           — PaGroupReceiver join (Endpoints that hear it)
}
```

## How it works (static dialplan + AGI hook)

The dialplan stays static; the receiver list (which lives in the DB) is resolved
at trigger time by an AGI hook that calls the API.

1. The initiator device dials the group extension (e.g. `9100`). The static
   `[internal]` context matches `_9[1-9]XX` and runs
   `AGI(/etc/asterisk/agi/pa-launch.sh,${EXTEN})`.
2. `pa-launch.sh` (shell + curl) parses `agi_extension` + `agi_callerid`, and calls
   the API `GET /api/pa-trigger/<ext>?caller=<initiator>` with a shared-secret
   bearer token (exempted from session auth).
3. The API `PaGroupService.trigger()`:
   - resolves the group and its active receivers,
   - enforces the initiator (if one is configured),
   - creates a `BroadcastLog`,
   - originates each receiver as a **member leg** (`Local/9000@paging` → joins the
     shared ConfBridge muted, `paging_user`),
   - originates a **hold announcer** (`Local/announce@pa-announce`, `paging_announcer`,
     unmuted/non-marked) that keeps the conference alive,
   - originates a **pa_start** tone announcer (`Local/announce@pa-bridge`, `paging_caller`)
     into the same conference,
   - returns `{ pageConf, receivers, paStart, paEnd, title }`.
4. The AGI sets the `PA_CONF` channel variable; the initiator's dialplan continues:
   `Answer()` → `ConfBridge(${PA_CONF}, paging_bridge, paging_caller)` — the
   initiator becomes the **marked speaker** (its mic is live to receivers).
5. When the initiator hangs up, `end_marked` kicks the receivers + announcer and
   the conference tears down.

## ConfBridge roles

- `paging_caller` = the initiator — marked speaker (mic live).
- `paging_pa_user` = PA receivers — muted (`startmuted=yes`), and **no
  `end_marked`**: they stay joined after the initiator leaves so pa_end can play
  to them, then the API tears them down.
- `paging_pa_tone` = the boundary tone leg — **marked + unmuted**, so its
  pa_start/pa_end playback reaches the muted receivers (same mixing path as the
  broadcast announcer). It joins, plays the tone, then leaves; the initiator
  becomes the marked live speaker after it departs.
- `paging_announcer` = the hold leg — unmuted, non-marked (keeps the conf alive).
- (Normal broadcasts still use `paging_user`, which has `end_marked=yes`.)

The `[paging-join]` Gosub reads a `PAGE_ROLE` variable (default `paging_user`)
and `[pa-announce]` reads `PA_ROLE` (default `paging_announcer`), so the same
dialplan serves normal broadcasts and PA groups.

## Group extension

A PA group extension is normalized to the `9XXX` range
(`PaGroupService.normalizeExtension`): the static `[internal]` dialplan only
routes `_9[1-9]XX` to the PA AGI trigger. Any other extension falls through to
the generic `_X.` → `Dial(PJSIP/<ext>)` device-to-device path, which fails with
"peer not found" for a non-endpoint extension.

## Boundary audio (start / end)

- `pa_start.wav` / `pa_end.wav` are seeded on boot as **real Announcement media**
  (`AnnouncementService.seedPaMedia()`), normalized to 8 kHz mono through the same
  ffmpeg pipeline as uploads. A PA group references them by `paStartAnnouncementId`
  / `paEndAnnouncementId`; when none is chosen the trigger falls back to the
  seeded `pa_start` / `pa_end` rows by name. No absolute on-disk paths.
- Tones must be 8 kHz mono WAV (Asterisk ConfBridge/Playback cannot decode
  44.1k stereo); the seed normalizes them with `-ar 8000 -ac 1 -acodec pcm_s16le`.
- On trigger the API plays pa_start via a tone announcer
  (`Local/announce@pa-announce`, `paging_announcer` role) after a short grace
  delay so the receiver member legs have joined. A hold announcer keeps the
  conference alive while the initiator (marked speaker) talks live.

## pa_end teardown

Receivers do not `end_marked`, so they stay joined after the initiator leaves. The
AMI listener watches for the initiator's `ConfbridgeLeave` (a PJSIP channel that
joined the PA conference as the marked `paging_caller`, not a member leg). On that
event it calls `PaGroupService.onInitiatorLeft(pageConf)`, which:
1. originates a fresh `paging_caller` announcer leg that plays pa_end to the
   still-joined receivers,
2. waits briefly, then hangs up the receiver member legs (`listener.stopBroadcast`),
3. finalizes the BroadcastLog as `success`.

## API

- `GET/POST /api/pa-groups`, `GET/PUT/DELETE /api/pa-groups/:id` — CRUD (session auth).
- `GET /api/pa-trigger/:extension?caller=<ext>` — internal trigger (shared-secret
  bearer token; exempted from session auth).

## UI — "PA groups" tab

Create/edit a group: name, group extension, initiator device (or "Any"),
pa_start/pa_end audio (default beep / none), and a receiver checklist. Shows
each group's extension badge, initiator, and receiver chips.

## Caveats / follow-ups

- **Receiver member legs only succeed for endpoints that are registered.** Idle
  devices get NOANSWER (visible in the monitor).
- The AGI reaches the API via `PA_API_BASE` (default `http://api:3001`) and the
  secret `PA_API_SECRET` (from `PA_TRIGGER_SECRET` in `.env`).
- pa_end teardown is triggered by the initiator's `ConfbridgeLeave`; it was
  verified by code inspection + the trigger path, but a real handset dialing the
  group extension should be tested live for full confidence.

