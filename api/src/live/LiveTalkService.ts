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

export type TalkMode = "live" | "twoway";

export interface TalkSessionView {
  id: string;
  mode: TalkMode;
  endpointIds: number[];
  startedAt: string;
}

interface TalkSession {
  id: string;
  mode: TalkMode;
  logId: number;
  endpointIds: number[];
  endpointExtensions: string[];
  sip: SipUa;
  rtp: RtpSession;
  connected: boolean;
  socketId: string | null;
  pageConf: string | null;
  startedAt: Date;
  /** Monitor call id (talk:<session id>). */
  callId: string;
}

const SOCKET_AUDIO_EVENT = "talk:audio";

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
      startedAt: s.startedAt.toISOString(),
    }));
  }

  /** Associate a socket with an active talk (replaces any previous owner). */
  join(socketId: string, talkId: string): void {
    const s = this.sessions.get(talkId);
    if (s) s.socketId = socketId;
  }

  /** Start a live talk to the given endpoints. */
  async start(endpointIds: number[]): Promise<TalkSessionView> {
    const endpoints = await onlineEndpoints(
      this.ami,
      await prisma.endpoint.findMany({
        where: { id: { in: endpointIds }, isActive: true },
      }),
    );
    if (endpoints.length === 0)
      throw new ApiError(422, "No online endpoints in selection");

    const mode: TalkMode = endpoints.length === 1 ? "twoway" : "live";
    const title =
      mode === "twoway"
        ? `Two-way call ${fmtClock()}`
        : `Live talk ${fmtClock()}`;

    const log = await prisma.broadcastLog.create({
      data: { status: "pending", endpointIds, title, startedAt: new Date() },
    });
    this.io.emit(EVENTS.broadcastUpdated, {
      id: log.id,
      status: "pending",
      zoneId: null,
      title: log.title,
      endpointIds,
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
      endpointIds,
      endpointExtensions: endpoints.map((e) => e.extension),
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
      return {
        id,
        mode,
        endpointIds,
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
  async stop(talkId?: string): Promise<{ stopped: number }> {
    let stopped = 0;
    for (const [id, s] of [...this.sessions]) {
      if (talkId && id !== talkId) continue;
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
    return this.stop(ids[0]);
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
