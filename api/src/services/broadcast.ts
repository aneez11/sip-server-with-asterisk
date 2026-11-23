import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { config } from "../config.js";
import type { AmiClient } from "../ami/client.js";
import type { Server as SocketServer } from "socket.io";
import { ApiError } from "../errors.js";
import { EVENTS, type BroadcastSource } from "@infinity/shared";
import { originateMemberLegs } from "../lib/member-legs.js";
import { onlineEndpoints } from "../lib/online-endpoints.js";
import type { AnnouncementService } from "./announcements.js";

export interface ZonePageOptions {
  zoneId: number;
  beep: boolean;
  volume: number | null;
  attentionAnnouncementId: number | null;
  autoAnswer: {
    alertInfo: string | null;
    callInfo: string | null;
    sipUri: string | null;
    dTime: number | null;
  } | null;
}

/** Resolved inputs for one paging conference. */
interface StartPageInput {
  /** Endpoints to dial (already filtered to active/online). */
  endpointIds: number[];
  /** Endpoint ids recorded on the log — the History snapshot. */
  snapshotIds: number[];
  /** null = silent page (no announcer Playback originated). */
  playPath: string | null;
  title: string;
  durationSec: number | null;
  zoneId: number | null;
  volume: number | null;
  autoAnswer: ZonePageOptions["autoAnswer"] | null;
  source: BroadcastSource;
}

export class BroadcastService {
  constructor(
    private readonly ami: AmiClient,
    private readonly io: SocketServer,
    private readonly announcements: AnnouncementService,
    private readonly stopPages: (logId?: number) => Promise<number>,
  ) {}

  /** Hard-stop an active broadcast (all pages, or one by log id). */
  async stop(logId?: number): Promise<{ stopped: number }> {
    return { stopped: await this.stopPages(logId) };
  }

  async broadcastZone(
    zoneId: number,
    announcementId?: number,
  ): Promise<{ id: number }> {
    const zone = await prisma.zone.findUnique({
      where: { id: zoneId },
      include: { members: true },
    });
    if (!zone) throw new ApiError(404, "Zone not found");

    const active = await prisma.broadcastLog.findFirst({
      where: { status: "pending", zoneId },
    });
    if (active)
      throw new ApiError(409, `Zone "${zone.name}" is already paging`);

    const endpointIds = (
      await prisma.endpoint.findMany({
        where: {
          id: { in: zone.members.map((m) => m.endpointId) },
          isActive: true,
        },
      })
    ).map((e) => e.id);
    if (endpointIds.length === 0)
      throw new ApiError(422, "Zone has no active endpoints");

    let autoAnswer: ZonePageOptions["autoAnswer"] = null;
    if (zone.autoAnswerProfileId) {
      const p = await prisma.autoAnswerProfile.findUnique({
        where: { id: zone.autoAnswerProfileId },
      });
      if (p) {
        autoAnswer = {
          alertInfo: p.alertInfo,
          callInfo: p.callInfo,
          sipUri: p.sipUri,
          dTime: p.dTime,
        };
      }
    }

    return this.broadcastAdhoc(endpointIds, announcementId, {
      zoneId,
      beep: zone.beep,
      volume: zone.volume,
      attentionAnnouncementId: zone.announcementId,
      autoAnswer,
    });
  }

  async broadcastAdhoc(
    endpointIds: number[],
    announcementId?: number,
    zone?: ZonePageOptions,
  ): Promise<{ id: number }> {
    const endpoints = await onlineEndpoints(
      this.ami,
      await prisma.endpoint.findMany({
        where: { id: { in: endpointIds }, isActive: true },
      }),
    );
    if (endpoints.length === 0)
      throw new ApiError(422, "No online endpoints in selection");

    let playPath: string | null = null;
    let title = "Broadcast";
    let durationSec: number | null = null;
    if (announcementId) {
      const a = await prisma.announcement.findUnique({
        where: { id: announcementId },
      });
      if (a) {
        playPath = this.playPathFor(a.filename);
        title = a.name;
        if (a.duration != null) durationSec = a.duration;
      }
    }
    if (!playPath) {
      // No announcement chosen: default to the most recently uploaded one so
      // zone quick-play / "Broadcast default" are never silent.
      const latest = await prisma.announcement.findFirst({
        where: { flash: false },
        orderBy: { id: "desc" },
      });
      if (latest) {
        playPath = this.playPathFor(latest.filename);
        title = latest.name;
        if (latest.duration != null) durationSec = latest.duration;
      }
    }
    if (!playPath) {
      // Check for the default announcement file
      const defaultPath = `${config.announcementsDir}/announcement`;
      try {
        await fs.access(defaultPath + ".wav");
        playPath = defaultPath;
        title = "Announcement";
      } catch {
        /* no default */
      }
    }
    if (!playPath) throw new ApiError(422, "No announcement audio available");

    // Per-zone attention tone: a custom announcement (if set) or the standard
    // "beep" prompt is prepended to the content in the announcer's Playback.
    // Asterisk's Playback plays `a&b` files in sequence.
    if (zone) {
      if (zone.attentionAnnouncementId) {
        const tone = await prisma.announcement.findUnique({
          where: { id: zone.attentionAnnouncementId },
        });
        if (tone) playPath = `${this.playPathFor(tone.filename)}&${playPath}`;
      } else if (zone.beep) {
        playPath = "beep&" + playPath;
      }
    }

    return this.startPage({
      endpointIds: endpoints.map((e) => e.id),
      snapshotIds: endpointIds,
      playPath,
      title,
      durationSec,
      zoneId: zone?.zoneId ?? null,
      volume: zone?.volume ?? null,
      autoAnswer: zone?.autoAnswer ?? null,
      source: "manual",
    });
  }

  /**
   * Scheduled bell page. Resolves the bell's zones to their currently active
   * endpoints plus any directly-targeted endpoints, refuses to pre-empt a live
   * page in any of those zones (a bell must never step on a live announcement),
   * and applies the bell's own beep/volume rather than the zone's.
   *
   * The created log has `source = "bell"` and `zoneId = null`: the bell's
   * resolved endpoint list is the snapshot, exactly like an ad-hoc broadcast, so
   * History and the Monitor keep working unchanged.
   */
  async broadcastForBell(input: {
    bellName: string;
    announcementId: number;
    zoneIds: number[];
    endpointIds: number[];
    beep: boolean;
    volume: number | null;
    /** "bell" for a scheduled fire; "manual" for an operator Test. */
    source?: BroadcastSource;
  }): Promise<{ id: number }> {
    const zoneMembers = input.zoneIds.length
      ? await prisma.zoneMember.findMany({
          where: { zoneId: { in: input.zoneIds } },
          select: { endpointId: true },
        })
      : [];
    const candidateIds = [
      ...new Set([
        ...zoneMembers.map((m) => m.endpointId),
        ...input.endpointIds,
      ]),
    ];
    if (candidateIds.length === 0)
      throw new ApiError(422, "Bell has no target endpoints");

    // Busy check must cover the bell's zones AND any zone that merely contains a
    // directly-targeted endpoint: paging zone X while a bell pings endpoint 2001
    // (also in X) would still double-chime the room.
    const containing = await prisma.zoneMember.findMany({
      where: { endpointId: { in: candidateIds } },
      select: { zoneId: true },
    });
    const guardedZoneIds = [
      ...new Set([...input.zoneIds, ...containing.map((m) => m.zoneId)]),
    ];
    const busy = await prisma.broadcastLog.findFirst({
      where: { status: "pending", zoneId: { in: guardedZoneIds } },
      select: { id: true },
    });
    if (busy)
      throw new ApiError(409, "A page is already active in one of the bell's zones");

    const endpoints = await onlineEndpoints(
      this.ami,
      await prisma.endpoint.findMany({
        where: { id: { in: candidateIds }, isActive: true },
      }),
    );
    if (endpoints.length === 0)
      throw new ApiError(422, "No online endpoints for this bell");

    const announcement = await prisma.announcement.findUnique({
      where: { id: input.announcementId },
    });
    if (!announcement)
      throw new ApiError(422, "Bell announcement is no longer available");

    let playPath = this.playPathFor(announcement.filename);
    if (input.beep) playPath = "beep&" + playPath;

    return this.startPage({
      endpointIds: endpoints.map((e) => e.id),
      snapshotIds: endpoints.map((e) => e.id),
      playPath,
      title: input.bellName || "Bell",
      durationSec: announcement.duration ?? null,
      zoneId: null,
      volume: input.volume,
      autoAnswer: null,
      source: input.source ?? "bell",
    });
  }

  /** Filesystem path Playback uses — Asterisk wants the basename, no extension. */
  private playPathFor(filename: string): string {
    return path
      .join(config.announcementsDir, filename)
      .replace(/\.\w+$/, "");
  }

  /**
   * The single originate path shared by manual, ad-hoc and bell pages: create
   * the log, announce playPath into a fresh ConfBridge, then dial one member leg
   * per endpoint into the same conference.
   */
  private async startPage(input: StartPageInput): Promise<{ id: number }> {
    const log = await prisma.broadcastLog.create({
      data: {
        status: "pending",
        zoneId: input.zoneId,
        endpointIds: input.snapshotIds,
        title: input.title,
        durationSec: input.durationSec,
        source: input.source,
        startedAt: new Date(),
      },
    });
    this.io.emit(EVENTS.broadcastUpdated, {
      id: log.id,
      status: "pending",
      zoneId: log.zoneId,
      title: log.title,
      endpointIds: input.snapshotIds,
      durationSec: log.durationSec,
      source: input.source,
      startedAt: log.startedAt,
      endedAt: null,
    });

    const pageConf = randomUUID();
    try {
      // Announcer: the WAV is played into the paging ConfBridge as the marked
      // speaker. The conference mixer drains the speaker at realtime, so audio
      // is streamed in chunks instead of being queued onto the Local channel
      // as one blob (fixes "Exceptionally long voice queue length" warnings).
      if (input.playPath) {
        await this.ami.action({
          Action: "Originate",
          Channel: "Local/announce@paging-bridge",
          Application: "Playback",
          Data: input.playPath,
          Variable: `_PAGE_CONF=${pageConf}`,
          Async: "true",
        });
      }

      // Members: one leg per endpoint (a single `&`-joined Dial only connects
      // ONE member — Dial's U() runs on the first answered channel). Each leg
      // dials its PJSIP target and the U() Gosub joins it, muted, into the
      // shared conference.
      const endpointRows = await prisma.endpoint.findMany({
        where: { id: { in: input.endpointIds } },
        select: { extension: true },
      });
      await originateMemberLegs({
        ami: this.ami,
        endpointExtensions: endpointRows.map((e) => e.extension),
        logId: log.id,
        pageConf,
        title: input.title,
        volume: input.volume,
        autoAnswer: input.autoAnswer,
      });
    } catch (e) {
      const endedAt = new Date();
      await prisma.broadcastLog.update({
        where: { id: log.id },
        data: { status: "failed", endedAt },
      });
      this.io.emit(EVENTS.broadcastUpdated, {
        id: log.id,
        status: "failed",
        zoneId: log.zoneId,
        title: log.title,
        endpointIds: input.snapshotIds,
        durationSec: log.durationSec,
        source: input.source,
        startedAt: log.startedAt,
        endedAt: endedAt.toISOString(),
      });
      throw new ApiError(500, `AMI originate failed: ${(e as Error).message}`);
    }

    return { id: log.id };
  }
}
