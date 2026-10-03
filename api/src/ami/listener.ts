import { type AmiClient, type AmiMessage } from "./client.js";
import { prisma } from "../db.js";
import { config } from "../config.js";
import type { Server as SocketServer } from "socket.io";
import { EVENTS } from "@infinity/shared";
import { MonitorService } from "../live/monitor.js";

interface PageMember {
  channel?: string;
  dialed: boolean;
  answered: boolean;
  hungup: boolean;
  /** DialEnd status (ANSWER/BUSY/NOANSWER/CONGESTION/CHANUNAVAIL/...). */
  dialStatus?: string;
  /** Cache of the resolved extension->callId so monitor updates are routed. */
  callId?: string;
}

interface Page {
  logId: number;
  startedAt: number;
  kind: "paging" | "music";
  originChannel?: string;
  members: Record<string, PageMember>;
  /** Monitor call id — set when the page is registered with the monitor. */
  callId?: string;
  /** ConfBridge conference name (uuid) — used for sweep liveness checks. */
  confName?: string;
}

/** A direct device-to-device call (endpoint dials another endpoint in [internal]). */
interface DirectCall {
  callerExt: string;
  calleeExt: string;
  callerAnswered: boolean;
  calleeAnswered: boolean;
  hungup: boolean;
  /** Monitor call id. */
  callId: string;
}

/**
 * Correlates AMI events to broadcast logs, mirroring the v1 handler:
 *  - VarSet BROADCAST_LOG_ID → Linkedid → logId
 *  - Newchannel Local/9000@paging-*;2 → start a page
 *  - DialBegin/DialEnd/Hangup on PJSIP/<ext>-* → member state
 *  - all hung up → finalize; sweep fails orphaned pending logs
 */
export class AmiListener {
  private pages = new Map<string, Page>();
  private logIds = new Map<string, number>();
  private logStats = new Map<
    number,
    { answered: number; dialed: number; total: number }
  >();
  private lastFlashCleanup = 0;
  private stoppedLogIds = new Set<number>();
  /** Direct device-to-device calls (e.g. 2000 -> 2002 via [internal]), keyed by linkedid. */
  private directCalls = new Map<string, DirectCall>();

  /** Wired after construction (circular dep): replay pa_end + tear down when the
   *  PA initiator (marked speaker) leaves a pa group's conference. */
  private onPaInitiatorLeft?: (pageConf: string) => void;

  constructor(
    private readonly ami: AmiClient,
    private readonly io: SocketServer,
    private readonly monitor: MonitorService,
  ) {
    this.ami.on("event", (msg: AmiMessage) => this.handle(msg));
  }

  setPaInitiatorLeftHandler(fn: (pageConf: string) => void): void {
    this.onPaInitiatorLeft = fn;
  }

  private handle(msg: AmiMessage): void {
    const k = msg.keys;
    const channel = k.channel ?? k.destchannel ?? "";
    const linkedid = k.linkedid ?? k.destlinkedid ?? "";

    if (
      msg.name === "VarSet" &&
      k.variable === "BROADCAST_LOG_ID" &&
      this.isPageOrigin(channel)
    ) {
      if (linkedid) this.logIds.set(linkedid, Number(k.value));
      return;
    }

    if (msg.name === "Newchannel") {
      const m = /^(Local\/9000@paging|Local\/9001@music)-[0-9a-fA-F]+;2$/.exec(
        channel,
      );
      if (m && linkedid) {
        void this.startPage(
          linkedid,
          m[1] === "Local/9001@music" ? "music" : "paging",
          channel,
        );
        return;
      }
    }

    // A paged member answering and joining the ConfBridge is the definitive
    // "receiving" signal. DialEnd for the PJSIP leg is not emitted by this
    // build (the member is bridged into the conf via the U() gosub), so mark the
    // member receiving on ConfbridgeJoin / BridgeEnter. We also learn the
    // conference name here (ConfbridgeJoin carries `Conference`).
    if (
      (msg.name === "ConfbridgeJoin" || msg.name === "BridgeEnter") &&
      this.pages.has(linkedid)
    ) {
      const member = /^PJSIP\/(\d+)-/.exec(channel);
      if (member) {
        const page = this.pages.get(linkedid)!;
        if (k.conference) page.confName = k.conference;
        page.members[member[1]] = page.members[member[1]] ?? {
          dialed: true,
          answered: false,
          hungup: false,
        };
        page.members[member[1]].answered = true;
        this.monitor.setMember(
          page.callId ?? `log:${page.logId}`,
          member[1],
          "receiving",
        );
        return;
      }
    }

    // Direct device-to-device calls: an endpoint dialing another endpoint in the
    // [internal] context. The caller is itself a PJSIP/<ext> channel (not a
    // Local/ origin), so track both ends as a two-way call in the monitor.
    if (this.tryDirectCall(msg, linkedid)) return;

    // PA initiator left: the initiator device (a PJSIP/<ext> entered via the
    // _9[1-9]XX PA trigger) is the marked paging_caller in the conference. When
    // it leaves, play pa_end to the still-joined receivers, then tear down.
    if (msg.name === "ConfbridgeLeave" && this.onPaInitiatorLeft) {
      const initiator = /^PJSIP\/(\d+)-/.exec(channel);
      if (initiator && k.conference && !this.pages.has(linkedid)) {
        this.onPaInitiatorLeft(k.conference);
        return;
      }
    }

    if (!linkedid || !this.pages.has(linkedid)) return;

    // DialBegin/DialEnd name the PJSIP member as the DESTINATION channel; the
    // originating leg is the Local paging channel. All other member events name
    // the member channel directly.
    const memberChannel =
      msg.name === "DialBegin" || msg.name === "DialEnd"
        ? (k.destchannel ?? channel)
        : channel;
    if (/^(CBAnn|Local)\//.test(memberChannel)) return;

    const m = /^PJSIP\/(\d+)-/.exec(memberChannel);
    if (!m) return;
    const ext = m[1];
    const page = this.pages.get(linkedid)!;
    if (!page.members[ext])
      page.members[ext] = { dialed: false, answered: false, hungup: false };

    const member = page.members[ext];
    const callId = page.callId ?? `log:${page.logId}`;
    if (msg.name === "DialBegin") {
      member.channel = memberChannel;
      member.dialed = true;
      this.monitor.setMember(callId, ext, "dialing");
    } else if (msg.name === "DialEnd") {
      member.channel = memberChannel;
      member.dialed = true;
      member.dialStatus = k.dialstatus;
      if (k.dialstatus === "ANSWER") {
        member.answered = true;
        this.monitor.setMember(callId, ext, "receiving");
        void this.captureCodec(page, ext, memberChannel);
      } else {
        this.monitor.setMember(callId, ext, "missed");
      }
    } else if (msg.name === "Hangup") {
      member.hungup = true;
      this.monitor.setMember(
        callId,
        ext,
        member.answered ? "done" : member.dialed ? "missed" : "idle",
      );
      if (this.allHungUp(page)) void this.finalize(linkedid);
    }
  }

  private allHungUp(page: Page): boolean {
    const values = Object.values(page.members);
    return values.length > 0 && values.every((m) => m.hungup);
  }

  private isPageOrigin(channel: string): boolean {
    return (
      channel.startsWith("Local/9000@paging") ||
      channel.startsWith("Local/9001@music")
    );
  }

  /**
   * Detect and track direct device-to-device calls (e.g. 2000 -> 2002 via the
   * [internal] context). Unlike a broadcast page, there is no Local/ origin:
   * the caller is itself a PJSIP/<ext> channel. Returns true when the event
   * belongs to a direct call so the broadcast page path can skip it.
   */
  private tryDirectCall(msg: AmiMessage, linkedid: string): boolean {
    const k = msg.keys;
    if (!linkedid) return false;

    if (msg.name === "DialBegin") {
      const caller = /^PJSIP\/(\d+)-/.exec(k.channel ?? "");
      const callee = /^PJSIP\/(\d+)-/.exec(k.destchannel ?? "");
      if (!caller || !callee) return false;

      const callId = `direct:${linkedid}`;
      const existing = this.directCalls.get(linkedid);
      if (!existing) {
        this.directCalls.set(linkedid, {
          callerExt: caller[1],
          calleeExt: callee[1],
          callerAnswered: false,
          calleeAnswered: false,
          hungup: false,
          callId,
        });
        this.monitor.beginCall({
          id: callId,
          kind: "twoway",
          title: `Call ${caller[1]} → ${callee[1]}`,
          zoneId: null,
          startedAt: new Date().toISOString(),
          extensions: [caller[1], callee[1]],
        });
      }
      this.monitor.setMember(callId, caller[1], "dialing");
      this.monitor.setMember(callId, callee[1], "dialing");
      return true;
    }

    if (msg.name === "DialEnd") {
      const call = this.directCalls.get(linkedid);
      if (!call) return false;
      const callee = /^PJSIP\/(\d+)-/.exec(k.destchannel ?? "");
      if (!callee || callee[1] !== call.calleeExt) return false;
      const answered = k.dialstatus === "ANSWER";
      call.calleeAnswered = answered;
      if (answered) {
        this.monitor.setMember(call.callId, call.callerExt, "receiving");
        this.monitor.setMember(call.callId, call.calleeExt, "receiving");
      } else {
        this.monitor.setMember(call.callId, call.calleeExt, "missed");
        this.monitor.endCall(call.callId);
        this.directCalls.delete(linkedid);
      }
      return true;
    }

    if (msg.name === "Hangup") {
      const call = this.directCalls.get(linkedid);
      if (!call) return false;
      const hang = /^PJSIP\/(\d+)-/.exec(k.channel ?? "");
      if (!hang || (hang[1] !== call.callerExt && hang[1] !== call.calleeExt))
        return false;
      if (hang[1] === call.callerExt) call.callerAnswered = true;
      if (hang[1] === call.calleeExt) call.calleeAnswered = true;
      call.hungup = true;
      this.monitor.endCall(call.callId);
      this.directCalls.delete(linkedid);
      return true;
    }

    return false;
  }

  private async startPage(
    linkedid: string,
    kind: "paging" | "music",
    originChannel: string,
  ): Promise<void> {
    if (this.pages.has(linkedid)) return;

    const mappedId = this.logIds.get(linkedid);
    let log = mappedId
      ? await prisma.broadcastLog.findFirst({
          where: { id: mappedId, status: "pending" },
        })
      : null;
    if (!log) {
      log = await prisma.broadcastLog.findFirst({
        where: { status: "pending" },
        orderBy: { createdAt: "asc" },
      });
    }
    if (!log) return;

    const endpointIds = (log.endpointIds as number[]) ?? [];
    const endpointRows =
      endpointIds.length > 0
        ? await prisma.endpoint.findMany({
            where: { id: { in: endpointIds } },
            select: { extension: true },
          })
        : [];
    const callId = `log:${log.id}`;
    const page: Page = {
      logId: log.id,
      startedAt: Date.now(),
      kind,
      originChannel,
      members: {},
      callId,
    };
    this.pages.set(linkedid, page);
    this.monitor.beginCall({
      id: callId,
      kind: kind === "music" ? "music" : "broadcast",
      title: log.title ?? "Broadcast",
      zoneId: log.zoneId,
      startedAt: log.startedAt?.toISOString() ?? null,
      extensions: endpointRows.map((e) => e.extension),
    });
  }

  /** Query the negotiated codec for an answered member and persist it. */
  private async captureCodec(
    page: Page,
    extension: string,
    channel: string,
  ): Promise<void> {
    try {
      const codec = await this.ami.channelCodec(channel);
      if (!codec) return;
      const negotiated = codec.write || codec.read || "unknown";
      if (!negotiated) return;

      const endpoint = await prisma.endpoint
        .findUnique({ where: { extension } })
        .catch(() => null);
      await prisma.endpointCodecLog.create({
        data: {
          endpointId: endpoint?.id ?? null,
          extension,
          endpointModel: endpoint?.type ?? "",
          negotiatedCodec: negotiated.toLowerCase(),
          broadcastId: page.logId,
        },
      });

      this.io.emit(EVENTS.codecNegotiated, {
        endpointId: endpoint?.id ?? null,
        extension,
        endpointModel: endpoint?.type ?? "",
        negotiatedCodec: negotiated.toLowerCase(),
        broadcastId: page.logId,
        ts: Date.now(),
      });
    } catch (err) {
      console.warn("Codec capture failed:", (err as Error).message);
    }
  }

  /** Hard-stop active music streams by hanging up their paging origin channels. */
  async hangupMusic(): Promise<number> {
    let stopped = 0;
    const targets = new Set<string>();
    const logIds = new Set<number>();
    for (const [linkedid, page] of this.pages) {
      if (page.kind !== "music") continue;
      logIds.add(page.logId);
      if (page.originChannel) targets.add(page.originChannel);
    }
    // Also hang up the music announcer leg so the track stops playing.
    try {
      const channels = await this.ami.coreShowChannels();
      for (const ch of channels) {
        if (/^Local\/announce@music-bridge-\S+;\d$/.test(ch)) targets.add(ch);
      }
    } catch {
      // Channel listing unavailable — member legs still stop.
    }
    for (const ch of targets) {
      const ok = await this.ami.hangup(ch);
      if (ok) stopped += 1;
    }
    await this.markStopped(logIds);
    return stopped;
  }

  /**
   * Stop active broadcast(s): hang up the member origin Local legs and every
   * announcer leg (Local/announce@*-bridge). Killing the marked announcer ends
   * the conference via end_marked, which kicks the members and finalizes the
   * log. With a logId only that page's origin is targeted; announcer legs are
   * stopped for all active pages (single shared announcer channel at a time in
   * practice).
   */
  async stopBroadcast(logId?: number): Promise<number> {
    let stopped = 0;
    const targets = new Set<string>();
    const memberChannels = new Set<string>();
    const logIds = new Set<number>();

    if (logId != null) logIds.add(logId);
    else {
      const pending = await prisma.broadcastLog.findMany({
        where: { status: "pending" },
        select: { id: true },
      });
      pending.forEach((log) => logIds.add(log.id));
    }

    for (const [, page] of this.pages) {
      if (logId != null && page.logId !== logId) continue;
      logIds.add(page.logId);
      if (page.originChannel) targets.add(page.originChannel);
      // Hang up the actual PJSIP member channels too: the U(paging-join) gosub
      // has already moved them into the ConfBridge and returned, so killing the
      // Local origin leg does NOT drop them. This is what ends a PA group.
      for (const member of Object.values(page.members)) {
        if (member.channel) memberChannels.add(member.channel);
      }
    }

    try {
      const channels = await this.ami.coreShowChannels();
      for (const ch of channels) {
        const name = ch.split("|")[0];
        if (
          /^Local\/announce@(?:paging-bridge|music-bridge|pa-announce)-\S+;\d$/.test(
            name,
          )
        )
          targets.add(name);
      }
    } catch {
      // Channel listing unavailable — origin legs still stop the page.
    }

    for (const ch of targets) {
      const ok = await this.ami.hangup(ch);
      if (ok) stopped += 1;
      // Also hang up the sibling ;1 leg (Wait) for Local/9000 origins — the ;2
      // (Dial) leg is hung up first, but the ;1 Wait leg keeps the Local channel
      // alive and may prevent the PJSIP member from being dropped cleanly.
      const m = /^(.+-\d+);\d$/.exec(ch);
      if (m) {
        const sibling = `${m[1]};${ch.endsWith(";1") ? "2" : "1"}`;
        if (!targets.has(sibling)) {
          await this.ami.hangup(sibling).catch(() => undefined);
        }
      }
    }
    // Hang up the member PJSIP channels (their gosub already bridged them into
    // the ConfBridge; ending them kicks them out of the conference).
    for (const ch of memberChannels) {
      if (!targets.has(ch)) {
        const ok = await this.ami.hangup(ch);
        if (ok) stopped += 1;
      }
    }
    await this.markStopped(logIds);
    return stopped;
  }

  private async markStopped(logIds: Iterable<number>): Promise<void> {
    for (const logId of new Set(logIds)) {
      this.stoppedLogIds.add(logId);
      const result = await prisma.broadcastLog.updateMany({
        where: { id: logId, status: "pending" },
        data: { status: "stopped", endedAt: new Date() },
      });
      if (result.count === 0) {
        this.stoppedLogIds.delete(logId);
        continue;
      }
      const updated = await prisma.broadcastLog.findUnique({
        where: { id: logId },
      });
      if (updated) {
        this.io.emit(EVENTS.broadcastUpdated, {
          id: updated.id,
          status: "stopped",
          zoneId: updated.zoneId,
          title: updated.title,
          endpointIds: updated.endpointIds,
          durationSec: updated.durationSec,
          startedAt: updated.startedAt,
          endedAt: updated.endedAt,
        });
      }
    }
  }

  private async finalize(linkedid: string): Promise<void> {
    const page = this.pages.get(linkedid);
    if (!page) return;
    this.pages.delete(linkedid);
    this.logIds.delete(linkedid);

    this.monitor.endCall(page.callId ?? `log:${page.logId}`);

    // Accumulate this leg's member stats for the log.
    const stats = this.logStats.get(page.logId) ?? {
      answered: 0,
      dialed: 0,
      total: 0,
    };
    for (const m of Object.values(page.members)) {
      stats.total += 1;
      if (m.dialed) stats.dialed += 1;
      if (m.answered) stats.answered += 1;
    }
    this.logStats.set(page.logId, stats);

    // Only finalize the log when ALL legs for it are done.
    if ([...this.pages.values()].some((p) => p.logId === page.logId)) return;

    this.logStats.delete(page.logId);
    const { answered, total } = stats;
    const status = this.stoppedLogIds.has(page.logId)
      ? "stopped"
      : total > 0 && answered === total
        ? "success"
        : answered > 0
          ? "partial"
          : "failed";

    const updated = await prisma.broadcastLog.update({
      where: { id: page.logId },
      data: { status, endedAt: new Date() },
    });

    this.io.emit(EVENTS.broadcastUpdated, {
      id: updated.id,
      status,
      zoneId: updated.zoneId,
      title: updated.title,
      endpointIds: updated.endpointIds,
      durationSec: updated.durationSec,
      startedAt: updated.startedAt,
      endedAt: updated.endedAt,
    });
    this.stoppedLogIds.delete(page.logId);
  }

  /** Run frequently: finalize stuck pages + fail orphaned pending logs. */
  async sweep(): Promise<void> {
    const cutoff = Date.now() - (config.pageDuration + 30) * 1000;

    // Only finalize a tracked page if its conference/channels are actually gone.
    // A long announcement (e.g. 79s) legitimately stays past the cutoff while it
    // still has live conference channels — killing it on the clock would cut the
    // broadcast short. We check liveness via the page's learned conf name.
    const confChannels = await this.ami.coreShowChannels().catch(() => []);
    const channelLines = confChannels.join("\n");
    const livePageIds = new Set<number>();
    for (const [, page] of this.pages) {
      if (page.confName && channelLines.includes(page.confName))
        livePageIds.add(page.logId);
    }

    for (const [linkedid, page] of this.pages) {
      if (page.startedAt < cutoff && !livePageIds.has(page.logId))
        void this.finalize(linkedid);
    }

    const trackedIds = [...this.pages.values()].map((p) => p.logId);
    const orphans = await prisma.broadcastLog.findMany({
      where: {
        status: "pending",
        startedAt: { lt: new Date(cutoff) },
        id: { notIn: trackedIds },
      },
    });
    for (const log of orphans) {
      await prisma.broadcastLog.update({
        where: { id: log.id },
        data: { status: "failed", endedAt: new Date() },
      });
      this.io.emit(EVENTS.broadcastUpdated, {
        id: log.id,
        status: "failed",
        zoneId: log.zoneId,
        title: log.title,
        endpointIds: log.endpointIds,
        durationSec: log.durationSec,
        startedAt: log.startedAt,
        endedAt: new Date(),
      });
    }

    if (Date.now() - this.lastFlashCleanup > 60_000) {
      this.lastFlashCleanup = Date.now();
      await this.cleanupFlash();
    }
  }

  private async cleanupFlash(): Promise<void> {
    const old = await prisma.announcement.findMany({
      where: {
        flash: true,
        createdAt: { lt: new Date(Date.now() - 5 * 60_000) },
      },
    });
    const { promises: fs } = await import("node:fs");
    for (const a of old) {
      await fs
        .unlink(`${config.announcementsDir}/${a.filename}`)
        .catch(() => undefined);
      if (a.originalFile)
        await fs
          .unlink(`${config.announcementsDir}/${a.originalFile}`)
          .catch(() => undefined);
      await prisma.announcement.delete({ where: { id: a.id } });
    }
  }
}
