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

## Flow

1. Operator selects targets and presses **Start talk**.
2. `POST /api/talk/start { endpointIds }` → API determines mode, creates the
   member leg (live mode), and starts the operator UA SIP call.
3. Browser opens an AudioContext + AudioWorklet capture; each PCM block is
   streamed over Socket.IO (`talk:audio { talkId, rate, data }`).
4. API resamples to 8 k, µ-law-encodes, packetizes into 20 ms RTP frames, sends
   to Asterisk's negotiated RTP port.
5. Two-way: Asterisk's RTP to the operator leg is decoded, upsampled, and sent
   back to the browser (`talk:audio` event) for playback.
6. **Stop talk** (`POST /api/talk/stop` or socket disconnect) → UA BYE → live
   mode: marked speaker leaves → `end_marked` kicks members → log finalizes.

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
