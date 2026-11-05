# Design — Live talk (true live streaming)

Live talk streams the operator's microphone to endpoints **in real time** (not
record-then-play). It also supports **two-way talk** to a single endpoint.

## Why not WebRTC

This Asterisk build (Ubuntu 24.04 distro package, Asterisk 20.6) loads
`res_pjsip_transport_websocket.so` after `res_pjsip` has already parsed its
transport config, so `[transport-ws]` (pjsip.conf) never binds — verified live:
`pjsip show transports` lists only `transport-udp`/`transport-tcp-test`, and
`module reload res_pjsip.so` does not recreate the listener. Direct
browser-WebRTC → Asterisk is therefore unavailable.

## Architecture — API as a SIP/RTP operator bridge

The API bridges the browser to Asterisk as a **minimal SIP/RTP UA**:

```
Browser mic ──Socket.IO PCM──▶ API ──µ-law/RTP (PCMU/8000)──▶ Asterisk
Browser speaker ◀──Socket.IO PCM── API ◀──RTP── Asterisk (two-way only)
```

- **Signaling**: `api/src/lib/sip-ua.ts` — minimal INVITE/ACK/BYE UA (no
  registration, LAN-only). Identified by IP (`[operator-ua]` pjsip endpoint,
  `identify` match = API container IP).
- **Media**: `api/src/lib/rtp-session.ts` — UDP RTP socket, 20 ms PCMU frames.
- **Codec**: `api/src/lib/g711.ts` (µ-law) + `api/src/lib/resample.ts`
  (48 k → 8 k browser→RTP, 8 k → 48 k RTP→browser).
- **Orchestration**: `api/src/live/LiveTalkService.ts`.

## Modes

- **live** (≥ 2 endpoints, or any single speaker): the operator UA calls
  `live-<PAGE_CONF>` (the conference name is carried in the Request-URI because
  this Asterisk build does not apply `X-Asterisk-Variable` headers). The
  `[operator]` dialplan joins it to the paging ConfBridge as the **marked
  speaker** (`paging_caller`); the standard member leg (`Local/9000@paging`)
  dials the endpoints and joins them muted (`paging_user`). One-way broadcast.
- **twoway** (exactly 1 endpoint): the operator UA dials the endpoint directly
  (`Dial(PJSIP/<ext>,60,tT)` in `[operator]`). Normal two-way call — operator
  mic → endpoint, endpoint audio → operator's browser.

### Targeting PA groups

Live talk can target **PA groups** in addition to individual endpoints:

- `POST /api/talk/start { endpointIds?: number[], paGroupIds?: number[] }` — at
  least one of the two is required.
- Each PA group expands to its **receiver endpoints** (`PaGroupReceiver` rows);
  groups and explicit endpoints are merged and de-duplicated, then filtered to
  active + registered endpoints (same `onlineEndpoints` sweep as before).
- Any group in the selection forces **live** mode. A PA group is always a
  one-way broadcast, even when it has exactly one receiver — it never silently
  becomes a two-way call because of a small group.
- The `BroadcastLog.title` records the group name (`Live talk → Reception
  HH:MM:SS`) and `endpointIds` stores the resolved fan-out, so history/monitor
  show the real recipients rather than the group id.
- The response carries both `endpointIds` (resolved) and `paGroupIds`, so the UI
  can show "N targets via M PA groups".
- UI: the Live talk right rail lists **PA groups** above the endpoint list.
  Selecting a group marks it *Selected*, and its member endpoints show
  *In group*; both are additive with manual endpoint selection.
- Boundary tones (`pa_start`/`pa_end`) are **not** played by live talk — they
  belong to the dial-triggered PA path, where the initiator dials the group
  extension. Live talk goes straight to the operator's mic.

### Audio capture sources

Live talk can stream either the operator's **microphone** (default) or **audio
already playing on the operator's device** (music from a tab, a media player,
another app):

- `source: "mic" | "device"` on `POST /api/talk/start` (default `mic`).
- `device` uses `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`
  — the only browser API that exposes *rendered* audio (there is no way to tap the
  OS mixer directly). The video track is stopped immediately; only its audio is
  used, so nothing visual is captured or transmitted.
- Chrome/Edge: the picker must be given a surface with audio — *Chrome tab* →
  "Share tab audio", or *Entire screen* → "Share system audio" (Windows).
  Firefox shares tab audio via "Share audio" on the tab. The operator must be on
  the HTTPS origin, since `getDisplayMedia` is also secure-context only.
- If the shared surface has no audio track, the client raises
  `DeviceAudioError` ("…enable Share tab audio / Share system audio") instead of
  starting a silent broadcast.
- Device audio **always forces one-way `live` mode**, even for a single endpoint:
  the audio originates from the operator's own speakers, so playing the
  endpoint's return audio back would create a feedback loop.
- History labels these sessions `Device audio [→ <group>] HH:MM:SS`.

## Flow

1. Operator selects targets (endpoints and/or PA groups) and presses **Start
   talk**.
2. `POST /api/talk/start { endpointIds, paGroupIds }` → API expands groups to
   receivers, determines mode, creates the member legs (live mode), and starts
   the operator UA SIP call.
3. Browser opens an AudioContext + AudioWorklet capture; each PCM block is
   streamed over Socket.IO (`talk:audio { talkId, rate, data }`).
4. API resamples to 8 k, µ-law-encodes, packetizes into 20 ms RTP frames, sends
   to Asterisk's negotiated RTP port.
5. Two-way: Asterisk's RTP to the operator leg is decoded, upsampled, and sent
   back to the browser (`talk:audio` event) for playback.
6. **Stop talk** (`POST /api/talk/stop` or socket disconnect) → UA BYE → live
   mode: marked speaker leaves → `end_marked` kicks members → log finalizes.

## Secure context (HTTPS) — required for the microphone

Live talk captures the operator's mic in the browser, so the page **must** be a
secure context. Browsers only expose `navigator.mediaDevices` on `https://` or
`localhost`; over `http://<LAN-IP>:3001` it is `undefined` and any mic call fails
with the opaque `Cannot read properties of undefined (reading 'getUserMedia')`.

- The API therefore also listens on **HTTPS port 3443** (`HTTPS_PORT`, set `0`
  to disable). Both listeners share the same Express app and Socket.IO server.
- `docker/api/entrypoint.sh` creates a **local root CA** once (kept in the
  `infinity-certs` volume) and issues a leaf cert for `HOST_IP` / `localhost`
  signed by it (825 days — the Apple limit for user-installed roots). The CA is
  served at **`/ca.pem`**; installing it once per device removes the browser
  warning entirely.
- HTTP page loads are **redirected to HTTPS** (`HTTPS_REDIRECT`, default on).
  Only `text/html` navigations are redirected — `/api`, `/socket.io` and
  `/health` keep working over HTTP, so existing clients and the container
  healthcheck are unaffected.
- Operators open `https://<HOST_IP>:3443`. Session cookies are `secure: false`,
  so they work on either scheme.
- The web client guards every mic entry point via `web/src/lib/mic.ts`
  (`requireMicDevices()`), which throws a `MicAccessError` naming the HTTPS
  origin; Live Talk also shows a persistent banner on an insecure origin.

## Verification

- Two-way to a speaker-with-mic (2002): operator UA in `Dial(PJSIP/2002)`, tone
  streamed over the socket, Asterisk `rtp set debug` logged **775 received /
  775 sent** RTP packets — the µ-law RTP path is confirmed end-to-end.
- Live mode: operator UA joins the conf as marked `paging_caller`; members join
  muted; conf shows 2 users / 1 marked.

## Notes

- `PAGE_CONF` travels via the Request-URI (`live-<uuid>`) — do not rely on
  `X-Asterisk-Variable` in this build.
- `[operator-ua]` pjsip endpoint is identified by the API's compose-network IP
  (currently `172.30.0.4/32`); update `pjsip.conf` if the API IP changes.
- Orphaned operator channels from a previous API process are cleaned on AMI
  ready (`LiveTalkService.cleanupOrphans()`).
