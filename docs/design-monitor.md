# Design — Live monitor (active calls / device receive status)

A dashboard that shows, in real time, every active call and whether each targeted
device is actually receiving it. Sits behind a new **Monitor** tab in the console.

## Purpose

Broadcast paging, music player, live talk and two-way calls are all "fire and
forget" from the operator's side — the UI historically only reported an
aggregate log status (`pending | success | partial | failed`) *after* the fact.
Operators had no way to know, mid-broadcast, whether a phone or speaker had
actually answered and was playing the page. The Monitor closes that gap.

## Data model

Per-device receive status for an active call:

```
CallKind        = 'broadcast' | 'music' | 'live' | 'twoway'
DeviceCallStatus = 'idle' | 'dialing' | 'receiving' | 'done' | 'missed'

ActiveCallMember { extension, status }
ActiveCall      { id, kind, title, zoneId, startedAt, members: ActiveCallMember[] }
CallsSnapshot   { active: ActiveCall[], serverTime }
```

Event (`calls.updated`) and snapshot shape are declared once in
`@infinity/shared` and imported by both api and web (cross-project rule).

## Architecture

A single `MonitorService` (`api/src/live/monitor.ts`) owns the live snapshot.
It keeps `Map<callId, MonitorCall>` where each call carries `members:
Map<extension, DeviceCallStatus>`. It is **fed by two sources**:

1. **`AmiListener`** (`api/src/ami/listener.ts`) — broadcast/music pages. The
   listener already correlates AMI events to per-member state
   (`dialed/answered/hungup`); it now translates that into a `DeviceCallStatus`
   and calls `monitor.setMember(...)`. On page start it registers the call
   (`beginCall`, id `log:<broadcastLogId>`) with the member extensions resolved
   from the log's `endpointIds`. On finalize it removes the call (`endCall`).

2. **Direct device-to-device calls** (e.g. 2000 → 2002 via the `[internal]`
   context) are also tracked in the `AmiListener`: there is no `Local/` origin,
   so `tryDirectCall()` detects these by the caller itself being a `PJSIP/<ext>`
   channel and tracks both ends as a two-way call (`beginCall`, id
   `direct:<linkedid>`), driving `dialing → receiving` and `endCall` on hangup.

3. **`LiveTalkService`** (`api/src/live/LiveTalkService.ts`) — live talk / two-way.
   Two-way (registered under `log:<broadcastLogId>`) has no AMI member legs (the
   operator UA dials the endpoint directly), so the service owns that call and
   drives its status (`dialing → receiving`). Live mode's endpoints are
   originated as real member legs, so the AMI listener owns their status under
   `log:<broadcastLogId>`; the live session itself is not registered as a second
   call (avoids dupes).

Every mutation calls `monitor.emit()`, which broadcasts the **entire snapshot**
on `calls.updated` — no client-side reconciliation needed.

## API

- `GET /api/monitor` → `CallsSnapshot` (current snapshot; auth required like all
  `/api/*`).
- Socket event `calls.updated` (`EVENTS.callsUpdated`) → `CallsSnapshot`, pushed
  on every member transition and call start/end.

## UI (`web/src/pages/MonitorPage`)

- **Status cards** (4): Active calls, Targeted endpoints, Receiving now,
  Unavailable (red when > 0).
- **Per-call card** per active call: kind badge (`Broadcast | Music | Live talk |
  Two-way`), title, started time, `received/targeted` count, and a device grid.
- **Device row** per targeted endpoint: presence dot + status chip, joined to
  endpoint metadata (`label`, `type`, `registered`) from the store.
  `Idle → Dialing (amber pulse) → Receiving (green) → Done (sky)` and
  `Unavailable (red)` for busy/no-answer/unregistered.

Empty state: "No active calls — all devices idle."

The `RightRail` shows a compact live summary when the Monitor tab is active.

## Verification

- Typecheck (`npm run typecheck`) and build clean across shared/api/web.
- Deploy the API container (`docker compose build api && docker compose up -d api`).
- Start a broadcast (or two-way call) and open the Monitor tab: devices should
  transition Idle → Dialing → Receiving as they answer, and Unavailable for any
  that don't; the dashboard clears when the call ends.
