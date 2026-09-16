# Design — SIP paging console (Infinity Echo)

## Problem

Institute staff must broadcast one-way PA announcements to SIP phones and IP speakers
on a LAN-only Asterisk PBX, and occasionally make live (PTT) announcements. The v1
system (Laravel + Blade) proved the dialplan/AMI mechanics; this project rewrites the
entire console in Node.js + TypeScript with a React SPA.

## Scope

- **Broadcast (recorded):** upload WAV announcements; play one to a zone or ad-hoc
  endpoint set via `Page()` + `Playback`.
- **Live talk:** browser mic recorded while PTT is held; on release the WAV is played
  to the selected endpoints (record-then-play — no WebRTC needed).
- **Music player:** upload WAV tracks to a library; play one to the endpoints in the
  selected zones, with playlist auto-advance (next track fires when the current
  broadcast completes).
- **Two-way calls:** endpoints can dial each other directly (phone-to-phone intercom).
- **Endpoints:** CRUD for SIP extensions (phone/speaker), active toggle, auto-generated
  password (≤ 16 chars), config regen (`endpoints.conf`) + AMI reload.
- **Zones:** named groups of endpoints.
- **History:** broadcast logs with statuses (pending/success/partial/failed).
- **Live status:** registration state via AMI `PJSIPShowContacts`, pushed over Socket.IO.

## Non-goals

- UNV camera/ONVIF management (device-specific; out of scope).
- True real-time WebRTC mic streaming (blocked: the Ubuntu-packaged Asterisk cannot
  bind its pjsip WebSocket transport; would need a custom build or a WebRTC↔SIP gateway).
- Public/internet exposure — LAN-only, single admin console.

## Architecture

```
Browser (web SPA) ──HTTP/session──▶ api (Express) ──TCP AMI──▶ Asterisk
        │                                 │                      │
        └──────────Socket.IO◀────────────┘  (broadcast/talk     PJSIP endpoints
                                             status events)       (phones/speakers)
api ──Prisma──▶ MySQL (infinity_echo)
api ──fs──────▶ /etc/asterisk/endpoints.conf (shared mount) + /announcements (WAV store)
```

- **AMI client** (`api/src/ami/client.ts`): raw TCP implementation — login, actions
  with ActionID matching, list-event collection, reconnect backoff. The only code that
  talks to Asterisk.
- **Listener** (`api/src/ami/listener.ts`): correlates AMI events to broadcast logs
  (VarSet `BROADCAST_LOG_ID` → Linkedid; `Newchannel Local/9000@paging-*;2` starts a
  page; DialBegin/DialEnd/Hangup track members; all-hung-up finalizes; sweep fails
  orphans after pageDuration + 30s).
- **Broadcast flow:** `POST /api/broadcast` → create log (pending) → AMI Originate
  `Local/9000@paging` with `Application: Playback` (announcement) or `Wait`, variables
  `PAGE_MEMBERS` + `BROADCAST_LOG_ID` → events finalize the log → Socket.IO push.
  The `b(paging-autoanswer^s^1)` option on Page() injects `Alert-Info: Auto Answer`
  on each dialed leg so hardware phones honouring that header auto-answer the page.
- **Music flow:** same mechanism as broadcast but via `Local/9001@music` (quiet page,
  no beep) and `Page(${PAGE_MEMBERS},q,i)`. The web UI auto-advances to the next
  track when the current broadcast log finalizes.
- **Two-way calls:** each endpoint has `context = internal` in `pjsip.conf`, so
  inbound calls from a handset enter the `[internal]` dialplan context which dials
  `PJSIP/${EXTEN}` for any extension matching `_X.`. The paging extension `9000`
  is explicitly guarded with `Hangup()`.
- **Talk flow:** PTT held → browser records (MediaRecorder) → PTT released →
  `POST /api/talk/start` (WAV + endpoint ids) → flash announcement played → cleanup
  after 5 min.
- **Config regen:** endpoint save → write `endpoints.conf` → AMI
  `Command: module reload res_pjsip.so`.

## Data model (Prisma, DB `infinity_echo`)

`User`, `Endpoint` (extension unique, type phone|speaker, isActive, sipPassword),
`Zone`, `ZoneMember` (composite PK), `BroadcastLog` (status, zoneId?, endpointIds JSON,
startedAt?, endedAt?), `Announcement` (filename, flash flag).

## Auth

Single admin console: `POST /api/auth/login` (bcrypt check) → express-session cookie.
All `/api/*` routes except login require the session. No registration.

## Theme

Web UI uses the UNV IPSpeaker theme verbatim (`tailwind.config.js`, `main.scss`),
shell grid 260/1fr/300 × 56/1fr/32, tabs: Broadcast / Live talk / Endpoints / History.
