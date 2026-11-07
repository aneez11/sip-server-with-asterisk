# Design - Endpoint camera preview during two-way talk

Show the room's camera while the operator is in a **one-to-one** live talk with
that endpoint, so a two-way call becomes a "see and speak" call.

> **Status:** Phase 1 and Phase 2 implemented and deployed. Phase 3 (PTZ) not
> started. See "Implementation notes" at the end for what shipped and where it
> differs from the original plan.

Labels used below: **must** = required for the feature to count as shipped,
**should** = expected, **may** = follow-up.

## Why this shape

ONVIF is a control/discovery protocol; the media is **RTSP**. Browsers cannot
play RTSP, and Asterisk is not an SFU, so the camera path is kept *beside* the
SIP call instead of inside it:

```
Camera (ONVIF + RTSP)  --RTSP-->  go2rtc  --WHEP (WebRTC)-->  Browser <video>
                                    ^
                                    | REST: create/destroy stream
                              API (Node, session auth)
```

Three independent paths correlated by endpoint id:

| Path | Carries | Terminates at |
|---|---|---|
| SIP/RTP (existing) | two-way voice | Asterisk <-> operator UA |
| ONVIF (control) | discovery, profiles, snapshot URI, PTZ | API -> camera |
| RTSP -> WebRTC (new) | camera video | go2rtc -> browser |

**Non-goals:** camera video into the SIP call, recording the camera, camera audio
in the operator's ear (double-audio), remote/cloud access to cameras.

## Data model (`api/prisma/schema.prisma`)

New 1:1 model rather than columns on `Endpoint`, so credentials and stream
selection stay in one place and `Endpoint` stays lean:

```
model EndpointCamera {
  id                Int      @id @default(autoincrement())
  endpointId        Int      @unique
  endpoint          Endpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  enabled           Boolean  @default(false)
  host              String            // 192.168.10.61
  port              Int      @default(80)
  username          String   @default("")
  passwordCipher    String            // AES-256-GCM, never returned by the API
  profileToken      String   @default("")   // ONVIF media profile to use
  rtspUri           String   @default("")   // resolved GetStreamUri (no creds)
  snapshotUri       String   @default("")
  preferredStream   String   @default("sub") // sub | main
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

`prisma db push --accept-data-loss` runs at API boot; adding a model is additive
and non-destructive. Take a `mysqldump` first anyway (the deploy runbook already
does this).

## API

New `CameraService` (`api/src/services/camera.ts`) + `OnvifClient`
(`api/src/lib/onvif.ts`) + `CameraStreamService`
(`api/src/services/camera-stream.ts`).

```
GET    /api/endpoints/:id/camera            -> { enabled, configured, reachable, profiles[], snapshotAvailable }
PUT    /api/endpoints/:id/camera            -> save config, resolve profiles + stream/snapshot URIs (password write-only)
DELETE /api/endpoints/:id/camera            -> remove config
POST   /api/endpoints/:id/camera/test       -> ONVIF GetCapabilities/GetProfiles probe (no side effects)
GET    /api/endpoints/:id/camera/snapshot   -> proxied JPEG (cookie auth, ~2 fps, Cache-Control: no-store)
POST   /api/talk/:talkId/camera             -> { whepUrl, token, expiresAt } (only for twoway talks)
DELETE /api/talk/:talkId/camera             -> tear the stream down
POST   /api/camera/whep/:token              -> authenticated WHEP proxy -> go2rtc (SDP offer/answer)
```

Rules

- **Camera credentials never reach the browser.** The API registers the stream
  with the gateway (`PUT /api/streams?name=<uuid>&src=rtsp://user:pass@host/...`)
  and returns only the stream name + short-lived token.
- Streams are only created for `mode = twoway`, only after the call is answered,
  and only for endpoints with `EndpointCamera.enabled`.
- Token is bound to `talkId + endpointId`, expires with the talk (+60 s), and is
  validated by the WHEP proxy. Stream names are random UUIDs, not endpoint ids.
- Every camera error is non-fatal: the voice call must keep working, the UI shows
  "camera unavailable".

`Endpoint` payloads gain `camera: { enabled, configured, reachable }` (no host
credentials) so the console can show a camera badge in the endpoint list.

## Gateway (`docker-compose.yml`)

New service, pinned to the existing `172.30.0.0/24` network:

```yaml
go2rtc:
  image: alexxit/go2rtc:latest
  restart: unless-stopped
  environment:
    GO2RTC_API_LISTEN: ":1984"
    GO2RTC_RTSP_LISTEN: ":8554"
    GO2RTC_WEBRTC_LISTEN: ":8555"
    GO2RTC_WEBRTC_CANDIDATES: "192.168.10.3:8555"
  ports: ["8555:8555/tcp", "8555:8555/udp"]
  mem_limit: ${CAMERA_MEM_LIMIT:-192m}
```

- 1984/8554 are **not** published; the API proxies 1984 over the bridge network.
- 8555 is published because ICE/media runs browser <-> gateway directly (UDP).
- `runOnDemand` + idle timeout so an abandoned preview does not hold the camera.
- Passthrough only: request the camera's **H.264 sub-stream**. No transcoding —
  the DS225+ cannot transcode and keep up with paging.

Env (`api/src/config.ts`, `.env.example`, NAS `.env`):
`CAMERA_ENABLED` (default true), `CAMERA_SECRET` (32-byte base64, AES key),
`CAMERA_GATEWAY_URL` (`http://go2rtc:1984`), `CAMERA_MEM_LIMIT`.

## Web

- `web/src/lib/camera.ts` — capabilities fetch, stream start/stop, WHEP
  negotiation (`RTCPeerConnection` + `POST /api/camera/whep/:token`), snapshot
  fallback poller.
- `web/src/pages/LiveTalkPage/LiveTalkPage.tsx` — when `talkMode === 'twoway'`
  and the target endpoint has a camera, render a `CameraPreview` panel beside the
  VU meter: `<video autoplay playsinline muted>` (operator hears the phone, not
  the camera), PiP + fullscreen, "camera unavailable" placeholder.
- `web/src/pages/EndpointsPage/EndpointsPage.tsx` — "Camera" section in the
  endpoint dialog: host/port/user/password, **Detect** (ONVIF profiles),
  stream selector (sub/main), **Test**, snapshot thumbnail.
- Teardown on: talk stop, `beforeunload`, `visibilitychange` (hidden > 30 s),
  token expiry. The 60 s live-talk resilience work must stay untouched — a camera
  failure must never call `stopLiveTalk()`.

Validation mirrored in `api/src/validation/schemas.ts` (`cameraConfigSchema`) and
the web form schema, per the repo rule.

## Phases

### Phase 1 — Config + snapshot preview (no new container)

1. `EndpointCamera` model + `CAMERA_SECRET` encryption helper (`lib/secret-box.ts`).
2. `OnvifClient` with WS-Security UsernameToken digest, digest/basic HTTP auth:
   `GetCapabilities`, `GetProfiles`, `GetStreamUri`, `GetSnapshotUri`,
   `GetSystemDateAndTime` (some cameras reject skewed timestamps).
3. Camera CRUD + snapshot proxy routes; endpoint dialog section.
4. Snapshot preview (1–2 fps) in the twoway panel; "camera unavailable" state.

**Acceptance:** operator opens a two-way talk and sees a live-ish still from the
room; wrong/absent credentials degrade to a placeholder; voice unaffected.

### Phase 2 — WebRTC video (the actual feature)

1. `go2rtc` service + proxied WHEP + per-talk token.
2. `CameraStreamService`: create stream on answered call, destroy on stop/expiry.
3. `<video>` panel with WHEP, snapshot fallback, PiP/fullscreen.
4. Logging: `[camera] start/stop endpoint=… stream=… reason=…` (same style as
   `[talk]`, so a silent failure is diagnosable).

**Acceptance:** sub-500 ms video during a two-way call, survives backgrounding
the tab (ICE in the browser, independent of the socket), stream disappears from
`go2rtc` after the call, pass-through CPU stays near idle.

### Phase 3 — Control (may)

ONVIF PTZ (`ContinuousMove`/`Stop`), presets, camera snapshot in history rows,
camera health in Monitor, optional camera audio muted by default.

## Testing

- Unit: ONVIF XML parsing + WS-Security digest; AES round-trip; token expiry.
- Integration: fake RTSP source (`go2rtc` `src: ffmpeg:...` test pattern) so
  stream lifecycle is testable without a camera.
- E2E (Playwright, like the existing mic tests): start a twoway talk to a test
  endpoint, assert `<video>` gets a `readyState > 0` and that the stream is
  destroyed after Stop; assert the snapshot fallback appears when the gateway is
  stopped.
- Regression: live talk start/stop, PA group targeting, device audio, the
  socket-disconnect grace window.

## Risks / mitigations

| Risk | Mitigation |
|---|---|
| Mixed content (`https` console, `http` gateway) | WHEP through the HTTPS API proxy; media uses UDP ICE, not page origin |
| ICE/UDP 8555 blocked by switch/DSM firewall | Document the port; verify from a console before rollout; `candidates` pinned to `HOST_IP` |
| H.265-only camera burns CPU | Force H.264 sub-stream; if unavailable, Phase-1 snapshot mode |
| ONVIF quirks (auth, time skew, vendor SOAP variants) | Manual host + profile token fallback; `Test` button reports the exact failing step |
| Credential exposure | AES-GCM at rest, write-only API, never in responses/logs, random stream names |
| Camera down breaks calls | All camera paths are best-effort; voice never depends on them |
| Memory on a 1.7 GB host | `mem_limit` 192m, single stream, `runOnDemand`, idle teardown |

## Sequencing / effort

| Phase | Work | Est. |
|---|---|---|
| 1 | Model, crypto, ONVIF client, CRUD, snapshot UI | ~1.5 days |
| 2 | go2rtc, stream lifecycle, WHEP, video panel, logging | ~1.5–2 days |
| 3 | PTZ + history/monitor integration | ~1 day |

Rollout: deploy Phase 1 with `CAMERA_ENABLED=false` per endpoint until one room
is verified, then enable camera-by-camera.

## Implementation notes (what actually shipped)

Files added:

| File | Role |
|---|---|
| `api/prisma/schema.prisma` (`EndpointCamera`) | per-endpoint ONVIF config, encrypted password, resolved URIs, last check result |
| `api/src/lib/secret-box.ts` | AES-256-GCM at-rest encryption (`CAMERA_SECRET`) |
| `api/src/lib/onvif.ts` | hand-rolled SOAP client: GetDeviceInformation, GetProfiles (Media2 → Media1), GetStreamUri, GetSnapshotUri, WS-Security digest, clock-skew compensation, HTTP digest/basic |
| `api/src/services/camera.ts` | config CRUD, probe ("Test"), snapshot proxy with digest auth |
| `api/src/services/camera-stream.ts` | talk-bound tokens, WHEP proxy to go2rtc |
| `web/src/lib/camera.ts` | WHEP negotiation + snapshot poller |
| `web/src/components/CameraPreview/` | video panel in the Live talk page |
| `web/src/components/CameraSettings/` | camera section in the endpoint dialog |
| `docker/go2rtc/` | templated go2rtc config + entrypoint (`HOST_IP` → ICE candidate) |

**Deviation from the plan (simplification):** no stream registration API. The
WHEP proxy passes the camera's RTSP URI to go2rtc as a `?src=` query parameter
(`POST /api/webrtc?src=…`), so go2rtc opens the RTSP session on demand and drops
it when the peer disappears. That removed the stream CRUD, the idle timeout and a
whole class of leak bugs, while keeping credentials server-side (the browser only
ever sees the token).

**Correction after testing a real UNV camera:** `?src=` only accepts *registered*
stream names in go2rtc 1.9, and passthrough is impossible for H.265. The service
therefore registers the camera with `PUT /api/streams?name=cam-<endpointId>&src=…`
and WHEPs by name, deleting it on stop.

**Codec reality (important):** the UNV camera reports `H264` in ONVIF while its
RTSP streams (all three profiles, including the sub) are actually **H.265/HEVC**.
Chrome cannot decode HEVC over WebRTC (“codecs not matched: video:H265 →
video:H264”), so:

- the real codec is detected with `ffprobe` at config/test time and stored
  (`streamCodec/streamWidth/streamHeight`);
- when it is not H.264 the gateway source becomes `ffmpeg:<rtsp>#video=h264`,
  i.e. the server transcodes (`CAMERA_TRANSCODE=auto`, default; `never` refuses
  and asks the operator to switch the camera stream);
- transcode cost is small on the 704×576 sub-stream, but switching the camera to
  H.264 is still the better option on this hardware.

Also fixed while testing: the media service lives at the `XAddr` advertised by
`GetCapabilities` (`/onvif/media` on UNV), not at `/onvif/device_service`, and the
profile token is an attribute of `<Profiles>`, not of the nested
`VideoSourceConfiguration` — both bugs made the first probe return "no media
profiles".


**Acceptance verified on the deployment:** table created, camera config
round-trips, unreachable camera saves with `lastCheckError` (no crash), password
stored as `v1:<iv>:<tag>:<data>` with zero plaintext occurrences, `GET` exposes
only `hasPassword`, WHEP rejects unknown/expired tokens (401), unknown talk 404,
gateway reachable (`/api/camera/status` → `{enabled:true,gateway:true}`), go2rtc
config rendered with `candidates: ["192.168.10.3:8555"]`, endpoint dialog renders
the camera section.

**Not yet exercised end-to-end:** a real ONVIF probe and a real WHEP stream — both
need a camera's IP/credentials and a live two-way call.

**Update (real camera, 192.168.10.31):** ONVIF probe, profile selection, stream
URI resolution, codec detection (HEVC), registration, transcode and WHEP answer
(`H264/90000`) all verified against live hardware. Remaining unverified step is
browser playback (ICE to `HOST_IP:8555`) inside a real two-way call.


