# Design — Music player (playlist jukebox over the broadcast path)

## Why not a true live stream

The packaged Asterisk cannot bind a pjsip WebSocket transport and the console
has no WebRTC↔SIP gateway (see `design-live-talk.md`). A continuous low-latency
audio stream to endpoints is therefore out of reach without a custom Asterisk
build. Instead the music player reuses the proven broadcast machinery and gives
a playlist-player UX with auto-advance — the practical equivalent for PA music.

## Flow

1. Upload a WAV track → stored like an announcement, but flagged `music = true`
   (same `Announcement` table; excluded from the announcement library and the
   status overview splits it into a separate `music` array).
2. Operator selects zones to stream to (inline chips, defaulting to the sidebar's
   selected zones).
3. **Play** → `POST /api/music/:id/play` → originates `Local/9001@music` with
   `Application: Playback` (the track) and `PAGE_MEMBERS`/`BROADCAST_LOG_ID`.
   The `[music]` context runs `Page(${PAGE_MEMBERS},q,i)` — `q` = quiet, so no
   beep, giving clean track playback.
4. When the broadcast log finalizes (all endpoints hung up / track finished), the
   socket `broadcast.updated` event fires; the store matches it to the current
   music log and auto-plays the next track (wrapping). One-track playlists loop.
5. **Stop** stops the auto-advance after the current track; **next/prev** restart
   at the chosen track. Elapsed/progress is computed from the broadcast start time
   and the normalized file size (8 kHz mono 16-bit → 16000 B/s).

## Why the beep is gone

Announcements keep `Page(${PAGE_MEMBERS},i,b(...))` (beep + auto-answer header);
music uses the separate `[music]` context with `q` so tracks don't start with a
chime. Both go through the same AMI Originate shape and the same listener
(which now matches both `Local/9000@paging` and `Local/9001@music` origins).

## Constraints / trade-offs

- Tracks are normalized to 8 kHz mono PCM (Asterisk's only reliable WAV format),
  same as announcements — hi-fi fidelity is not a goal for PA.
- No seek: Asterisk cannot seek into a Playback mid-file; the progress bar is
  informational.
- Stop is not a hard hangup of in-flight audio — the current track finishes and
  auto-advance stops. A hard-stop via AMI channel hangup is a possible follow-up.
