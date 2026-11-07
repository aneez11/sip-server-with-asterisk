// Live talk — true live streaming of the operator's mic into Asterisk.
//
// WebRTC-to-Asterisk is unavailable in this distro build (the pjsip websocket
// transport never binds), so the API bridges the browser to Asterisk as a
// minimal SIP/RTP client (PCMU/8000). Two modes:
//
//   live   (>=1 endpoint, or a speaker): the operator UA joins the paging
//          ConfBridge as the marked speaker (paging_caller); endpoints join
//          muted (paging_user) via the standard member leg. One-way.
//   twoway (exactly 1 phone endpoint): the operator UA dials the endpoint
//          directly — a normal two-way call. Browser mic -> endpoint,
//          endpoint audio -> browser speaker.
//
// Browser audio flows over Socket.IO binary (`talk:audio`), the API resamples
// to 8k and µ-law-encodes it into the RTP leg.

import { randomUUID } from "node:crypto";
import dgram from "node:dgram";
import type { Server as SocketServer } from "socket.io";
import { prisma } from "../db.js";
import { config } from "../config.js";
import type { AmiClient } from "../ami/client.js";
import { ApiError } from "../errors.js";
import { EVENTS } from "@infinity/shared";
import { SipUa } from "../lib/sip-ua.js";
import { RtpSession } from "../lib/rtp-session.js";
import { pcm16ToF32, resampleF32, f32ToPcm16 } from "../lib/resample.js";
import { originateMemberLegs } from "../lib/member-legs.js";
import { onlineEndpoints } from "../lib/online-endpoints.js";
import { MonitorService } from "./monitor.js";
import { registerTalkLog, unregisterTalkLog } from "./talk-registry.js";

export type TalkMode = "live" | "twoway";
export type TalkSource = "mic" | "device";

export interface TalkSessionView {
  id: string;
  mode: TalkMode;
  endpointIds: number[];
  /** PA groups that contributed targets to this session. */
  paGroupIds: number[];
  source: TalkSource;
  startedAt: string;
}

interface TalkSession {
  id: string;
  mode: TalkMode;
  logId: number;
  endpointIds: number[];
  endpointExtensions: string[];
  paGroupIds: number[];
  source: TalkSource;
  sip: SipUa;
  rtp: RtpSession;
  connected: boolean;
  socketId: string | null;
  /** Pending teardown after the owning socket dropped (see detachSocket). */
  detachTimer?: NodeJS.Timeout | null;
  pageConf: string | null;
  startedAt: Date;
  /** Monitor call id (talk:<session id>). */
  callId: string;
}

const SOCKET_AUDIO_EVENT = "talk:audio";

/**
 * How long a talk survives after its socket drops. A backgrounded tab throttles
 * timers (Chrome: down to once per minute), which can miss a Socket.IO heartbeat
 * without the operator doing anything wrong.
 */
const DETACH_GRACE_MS = 120_000;

function getLocalIp(): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    sock.once("error", reject);
    sock.once("connect", () => {
      const ip = sock.address().address;
      sock.close();
      resolve(ip);
    });
    sock.connect(1, config.liveTalk.asteriskHost);
  });
}

const fmtClock = () => new Date().toLocaleTimeString();

export class LiveTalkService {
  private sessions = new Map<string, TalkSession>();

  constructor(
    private readonly ami: AmiClient,
    private readonly io: SocketServer,
    private readonly stopPages: (logId?: number) => Promise<number>,
    private readonly monitor: MonitorService,
  ) {}

  listActive(): TalkSessionView[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      mode: s.mode,
      endpointIds: s.endpointIds,
      paGroupIds: s.paGroupIds,
      source: s.source,
      startedAt: s.startedAt.toISOString(),
    }));
  }

  /** Associate a socket with an active talk (replaces any previous owner). */
  join(socketId: string, talkId: string): void {
    const s = this.sessions.get(talkId);
    if (!s) return;
    s.socketId = socketId;
    // A re-attach (e.g. the tab came back / the socket reconnected) cancels the
    // pending teardown so the broadcast continues where it left off.
    if (s.detachTimer) {
      clearTimeout(s.detachTimer);
      s.detachTimer = null;
    }
  }

  /**
   * Start a live talk to the given endpoints, optionally via PA groups.
   *
   * A PA group expands to its receiver endpoints: selecting groups is a shortcut
   * for "talk to everyone in this group", and its targets are merged (deduped)
   * with any individually selected endpoints. Any group involvement forces the
   * one-way `live` mode — a PA group is a broadcast even when it has a single
   * receiver, so it never turns into a two-way call by accident.
   */
  async start(
    endpointIds: number[],
    paGroupIds: number[] = [],
    source: TalkSource = "mic",
  ): Promise<TalkSessionView> {
    const groups =
      paGroupIds.length > 0
        ? await prisma.paGroup.findMany({
            where: { id: { in: paGroupIds } },
            include: { receivers: true },
          })
        : [];
    if (paGroupIds.length > 0 && groups.length === 0)
      throw new ApiError(422, "PA group not found");

    const groupEndpointIds = groups
      .flatMap((g) => g.receivers.map((r) => r.endpointId))
      .filter((id) => Number.isFinite(id));

    const selected = [...new Set([...endpointIds, ...groupEndpointIds])];
    if (selected.length === 0)
      throw new ApiError(422, "Select at least one endpoint or PA group");

    const endpoints = await onlineEndpoints(
      this.ami,
      await prisma.endpoint.findMany({
        where: { id: { in: selected }, isActive: true },
      }),
    );
    if (endpoints.length === 0)
      throw new ApiError(422, "No online endpoints in selection");

    // Groups always broadcast one-way; only a plain single-endpoint selection is
    // a two-way call. Device audio can never be two-way either: the audio comes
    // from the operator's own speakers, so playing the endpoint's return audio
    // back would create a feedback loop.
    const mode: TalkMode =
      source === "device"
        ? "live"
        : groups.length === 0 && endpoints.length === 1
          ? "twoway"
          : "live";
    const groupLabel =
      groups.length === 1 ? groups[0].name : `${groups.length} PA groups`;
    const sourceLabel = source === "device" ? "Device audio" : "Live talk";
    const title =
      mode === "twoway"
        ? `Two-way call ${fmtClock()}`
        : groups.length > 0
          ? `${sourceLabel} → ${groupLabel} ${fmtClock()}`
          : `${sourceLabel} ${fmtClock()}`;

    const resolvedIds = endpoints.map((e) => e.id);
    const log = await prisma.broadcastLog.create({
      data: {
        status: "pending",
        endpointIds: resolvedIds,
        title,
        startedAt: new Date(),
      },
    });
    // Exempt from the AMI listener's orphan sweep while the talk is on air.
    registerTalkLog(log.id);
    this.io.emit(EVENTS.broadcastUpdated, {
      id: log.id,
      status: "pending",
      zoneId: null,
      title: log.title,
      endpointIds: resolvedIds,
      durationSec: log.durationSec,
      startedAt: log.startedAt,
      endedAt: null,
    });

    const localIp = await getLocalIp();
    const id = randomUUID();
    const rtp = new RtpSession({
      localPort: 0,
      remoteHost: config.liveTalk.asteriskHost,
      remotePort: 0,
    });
    await rtp.ready();
    const sip = new SipUa({
      localIp,
      fromUser: config.liveTalk.fromUser,
      asteriskHost: config.liveTalk.asteriskHost,
      asteriskPort: config.liveTalk.asteriskPort,
    });

    const session: TalkSession = {
      id,
      mode,
      logId: log.id,
      endpointIds: resolvedIds,
      endpointExtensions: endpoints.map((e) => e.extension),
      paGroupIds,
      source,
      sip,
      rtp,
      connected: false,
      socketId: null,
      pageConf: null,
      startedAt: new Date(),
      callId: `log:${log.id}`,
    };

    // Register the call on the monitor (idempotent by id). Keying by the shared
    // broadcastLog id keeps the namespace consistent with the AMI listener's
    // broadcast/music calls: whoever registers first wins the kind label.
    //
    //   - live  : registered here as 'live' BEFORE member legs are originated,
    //             so the listener's beginCall (which would default it to
    //             'broadcast') is a no-op and the label stays 'Live talk'.
    //             The listener still drives member receive status via log:<id>.
    //   - twoway: no member legs — this service owns the call and drives the
    //             single member's status directly.
    this.monitor.beginCall({
      id: session.callId,
      kind: mode,
      title,
      zoneId: null,
      startedAt: session.startedAt.toISOString(),
      extensions: session.endpointExtensions,
    });
    this.attachRecv(session);

    try {
      if (mode === "live") {
        // 1. Originate one member leg per endpoint so each answered endpoint
        //    joins the shared conference muted (a single `&`-joined Dial only
        //    connects one member).
        const pageConf = randomUUID();
        session.pageConf = pageConf;
        await originateMemberLegs({
          ami: this.ami,
          endpointExtensions: endpoints.map((e) => e.extension),
          logId: log.id,
          pageConf,
          title,
        });

        // 2. The operator UA joins the same conf as the marked speaker.
        // PAGE_CONF travels in the Request-URI (live-<conf>) — X-Asterisk-Variable
        // headers are not applied by this Asterisk build.
        const rtpPort = await sip.call({
          target: `live-${pageConf}`,
          rtpPort: rtp.localPort,
          onRinging: () => {
            /* members may answer before the UA connects */
          },
        });
        rtp.setRemotePort(rtpPort);
      } else {
        // Two-way: the operator UA dials the single phone endpoint directly.
        const target = endpoints[0].extension;
        this.monitor.setMember(session.callId, target, "dialing");
        const rtpPort = await sip.call({ target, rtpPort: rtp.localPort });
        rtp.setRemotePort(rtpPort);
        this.monitor.setMember(session.callId, target, "receiving");
      }
      session.connected = true;
      this.sessions.set(id, session);
      console.log(
        `[talk] start id=${id} mode=${mode} source=${source} endpoints=${resolvedIds.length} groups=${paGroupIds.length} log=${log.id}`,
      );
      return {
        id,
        mode,
        endpointIds: resolvedIds,
        paGroupIds,
        source,
        startedAt: session.startedAt.toISOString(),
      };
    } catch (e) {
      rtp.close();
      sip.hangup();
      this.monitor.endCall(session.callId);
      await this.finalize(log.id, "failed");
      throw new ApiError(
        500,
        `Live talk setup failed: ${(e as Error).message}`,
      );
    }
  }

  /** Stop a talk: hang up the operator leg AND the member legs (live mode). */
  async stop(
    talkId?: string,
    reason = "user",
  ): Promise<{ stopped: number }> {
    let stopped = 0;
    for (const [id, s] of [...this.sessions]) {
      if (talkId && id !== talkId) continue;
      console.log(
        `[talk] stop id=${id} reason=${reason} mode=${s.mode} source=${s.source} endpoints=${s.endpointIds.length} groups=${s.paGroupIds.length}`,
      );
      if (s.detachTimer) {
        clearTimeout(s.detachTimer);
        s.detachTimer = null;
      }
      s.sip.hangup();
      s.rtp.close();
      this.sessions.delete(id);
      this.monitor.endCall(s.callId);
      // Hang up the operator UA channel directly — it is the marked speaker;
      // ending it ends the conference via end_marked and kicks the members.
      stopped += await this.hangupOperator();
      // Live mode: also hang up the member legs.
      if (s.mode === "live") {
        stopped += await this.stopPages(s.logId);
      }
      await this.finalize(s.logId, s.connected ? "success" : "failed");
      stopped += 1;
    }
    return { stopped };
  }

  /** Hang up any operator UA channels (the marked live-talk speaker). */
  private async hangupOperator(): Promise<number> {
    let n = 0;
    try {
      const channels = await this.ami.coreShowChannels();
      for (const ch of channels) {
        if (/^PJSIP\/operator-ua-\d+$/.test(ch)) {
          const ok = await this.ami.hangup(ch);
          if (ok) n += 1;
        }
      }
    } catch {
      // AMI unavailable — best effort.
    }
    return n;
  }

  stopForSocket(socketId: string): Promise<{ stopped: number }> {
    const ids = [...this.sessions.values()]
      .filter((s) => s.socketId === socketId)
      .map((s) => s.id);
    if (ids.length === 0) return Promise.resolve({ stopped: 0 });
    return this.stop(ids[0], "socket-forced");
  }

  /**
   * Called when the owning socket drops. A backgrounded browser tab has its
   * timers throttled, which can make Socket.IO's heartbeat miss and tear the
   * connection down mid-broadcast. Killing the call on the spot silently cuts
   * the operator off while the page still shows "capturing", so the session is
   * kept alive for a grace period: if any socket re-joins the talk in time the
   * broadcast simply continues, otherwise it is stopped and history is finalised.
   */
  detachSocket(socketId: string): void {
    for (const s of this.sessions.values()) {
      if (s.socketId !== socketId) continue;
      s.socketId = null;
      if (s.detachTimer) clearTimeout(s.detachTimer);
      s.detachTimer = setTimeout(() => {
        // Still detached after the grace period: really stop it.
        const current = this.sessions.get(s.id);
        if (current && !current.socketId)
          void this.stop(current.id, "socket-detached");
      }, DETACH_GRACE_MS);
      // Do not keep the process alive just for this timer.
      s.detachTimer.unref?.();
    }
  }

  /** Hang up operator UA channels orphaned by a previous API process restart. */
  async cleanupOrphans(): Promise<number> {
    let stopped = 0;
    try {
      const channels = await this.ami.coreShowChannels();
      for (const ch of channels) {
        if (/^PJSIP\/operator-ua-\d+$/.test(ch)) {
          const ok = await this.ami.hangup(ch);
          if (ok) stopped += 1;
        }
      }
    } catch {
      // AMI unavailable at boot — sweep runs again on next ready.
    }
    return stopped;
  }

  /** Feed browser mic PCM (Int16 at the browser sample rate) into the RTP leg. */
  async sendAudio(
    talkId: string,
    pcm: Int16Array,
    rate: number,
  ): Promise<void> {
    const s = this.sessions.get(talkId);
    if (!s || !s.connected) return;
    let f32 = pcm16ToF32(pcm);
    // Normalize peak to 0.5 to prevent µ-law clipping from a hot mic; the
    // µ-law encoder clips at 32635 (~0.996), and a hot mic hitting 0 dBFS
    // would clip the waveform harshly.
    let peak = 0;
    for (let i = 0; i < f32.length; i++) {
      const a = Math.abs(f32[i]);
      if (a > peak) peak = a;
    }
    if (peak > 0.01) {
      const gain = 0.5 / peak;
      if (gain < 1) for (let i = 0; i < f32.length; i++) f32[i] *= gain;
    }
    const down = resampleF32(f32, rate, 8000);
    s.rtp.sendPcm16(f32ToPcm16(down));
  }

  private async finalize(logId: number, status: string): Promise<void> {
    // The talk owns this log for as long as it runs; once finalised the sweep
    // may treat it as history again.
    unregisterTalkLog(logId);
    const current = await prisma.broadcastLog.findUnique({
      where: { id: logId },
      select: { status: true, startedAt: true },
    });
    if (!current || current.status !== "pending") return;
    const updated = await prisma.broadcastLog.update({
      where: { id: logId },
      data: { status, endedAt: new Date() },
    });
    this.io.emit(EVENTS.broadcastUpdated, {
      id: updated.id,
      status,
      zoneId: null,
      title: updated.title,
      endpointIds: updated.endpointIds,
      durationSec: updated.durationSec,
      startedAt: updated.startedAt,
      endedAt: updated.endedAt,
    });
  }

  /** RTP receive -> browser playback (two-way only). Wired in index.ts. */
  private attachRecv(s: TalkSession): void {
    s.rtp.setOnAudio((pcm8k) => {
      if (!s.socketId || s.mode !== "twoway") return;
      const f32 = pcm16ToF32(pcm8k);
      const up = resampleF32(f32, 8000, 48000);
      const out = f32ToPcm16(up);
      const buf = out.buffer.slice(
        out.byteOffset,
        out.byteOffset + out.byteLength,
      ) as ArrayBuffer;
      this.io
        .to(s.socketId)
        .emit(SOCKET_AUDIO_EVENT, { talkId: s.id, rate: 48000, data: buf });
    });
  }
}

export { SOCKET_AUDIO_EVENT };
