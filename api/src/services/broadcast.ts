import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { config } from '../config.js';
import type { AmiClient } from '../ami/client.js';
import type { Server as SocketServer } from 'socket.io';
import { ApiError } from '../errors.js';
import { EVENTS } from '@infinity/shared';
import { originateMemberLegs } from '../lib/member-legs.js';
import { onlineEndpoints } from '../lib/online-endpoints.js';
import type { AnnouncementService } from './announcements.js';

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

  async broadcastZone(zoneId: number, announcementId?: number): Promise<{ id: number }> {
    const zone = await prisma.zone.findUnique({ where: { id: zoneId }, include: { members: true } });
    if (!zone) throw new ApiError(404, 'Zone not found');

    const active = await prisma.broadcastLog.findFirst({ where: { status: 'pending', zoneId } });
    if (active) throw new ApiError(409, `Zone "${zone.name}" is already paging`);

    const endpointIds = (await prisma.endpoint.findMany({ where: { id: { in: zone.members.map((m) => m.endpointId) }, isActive: true } })).map((e) => e.id);
    if (endpointIds.length === 0) throw new ApiError(422, 'Zone has no active endpoints');

    let autoAnswer: ZonePageOptions['autoAnswer'] = null;
    if (zone.autoAnswerProfileId) {
      const p = await prisma.autoAnswerProfile.findUnique({ where: { id: zone.autoAnswerProfileId } });
      if (p) {
        autoAnswer = { alertInfo: p.alertInfo, callInfo: p.callInfo, sipUri: p.sipUri, dTime: p.dTime };
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

  async broadcastAdhoc(endpointIds: number[], announcementId?: number, zone?: ZonePageOptions): Promise<{ id: number }> {
    const endpoints = await onlineEndpoints(this.ami, await prisma.endpoint.findMany({ where: { id: { in: endpointIds }, isActive: true } }));
    if (endpoints.length === 0) throw new ApiError(422, 'No online endpoints in selection');

    let playPath: string | null = null;
    let title = 'Broadcast';
    let durationSec: number | null = null;
    if (announcementId) {
      const a = await prisma.announcement.findUnique({ where: { id: announcementId } });
      if (a) {
        playPath = `${config.announcementsDir}/${a.filename}`.replace(/\.\w+$/, '');
        title = a.name;
        if (a.duration != null) durationSec = a.duration;
      }
    }
    if (!playPath) {
      // No announcement chosen: default to the most recently uploaded one so
      // zone quick-play / "Broadcast default" are never silent.
      const latest = await prisma.announcement.findFirst({
        where: { flash: false },
        orderBy: { id: 'desc' },
      });
      if (latest) {
        playPath = `${config.announcementsDir}/${latest.filename}`.replace(/\.\w+$/, '');
        title = latest.name;
        if (latest.duration != null) durationSec = latest.duration;
      }
    }
    if (!playPath) {
      // Check for the default announcement file
      const defaultPath = `${config.announcementsDir}/announcement`;
      try { await fs.access(defaultPath + '.wav'); playPath = defaultPath; title = 'Announcement'; } catch { /* no default */ }
    }

    // Per-zone attention tone: a custom announcement (if set) or the standard
    // "beep" prompt is prepended to the content in the announcer's Playback.
    // Asterisk's Playback plays `a&b` files in sequence.
    if (zone && playPath) {
      if (zone.attentionAnnouncementId) {
        const tone = await prisma.announcement.findUnique({ where: { id: zone.attentionAnnouncementId } });
        if (tone) playPath = `${config.announcementsDir}/${tone.filename}`.replace(/\.\w+$/, '') + '&' + playPath;
      } else if (zone.beep) {
        playPath = 'beep&' + playPath;
      }
    }

    const log = await prisma.broadcastLog.create({
      data: { status: 'pending', zoneId: zone?.zoneId ?? null, endpointIds: endpointIds, title, durationSec, startedAt: new Date() },
    });
    this.io.emit(EVENTS.broadcastUpdated, {
      id: log.id,
      status: 'pending',
      zoneId: log.zoneId,
      title: log.title,
      endpointIds,
      durationSec: log.durationSec,
      startedAt: log.startedAt,
      endedAt: null,
    });

    const pageConf = randomUUID();
    try {
      // Announcer: the WAV is played into the paging ConfBridge as the marked
      // speaker. The conference mixer drains the speaker at realtime, so audio
      // is streamed in chunks instead of being queued onto the Local channel
      // as one blob (fixes "Exceptionally long voice queue length" warnings).
      if (playPath) {
        await this.ami.action({
          Action: 'Originate',
          Channel: 'Local/announce@paging-bridge',
          Application: 'Playback',
          Data: playPath,
          Variable: `_PAGE_CONF=${pageConf}`,
          Async: 'true',
        });
      }

      // Members: one leg per endpoint (a single `&`-joined Dial only connects
      // ONE member — Dial's U() runs on the first answered channel). Each leg
      // dials its PJSIP target and the U() Gosub joins it, muted, into the
      // shared conference.
      await originateMemberLegs({
        ami: this.ami,
        endpointExtensions: endpoints.map((e) => e.extension),
        logId: log.id,
        pageConf,
        title,
        volume: zone?.volume ?? null,
        autoAnswer: zone?.autoAnswer ?? null,
      });
    } catch (e) {
      await prisma.broadcastLog.update({ where: { id: log.id }, data: { status: 'failed', endedAt: new Date() } });
      this.io.emit(EVENTS.broadcastUpdated, { id: log.id, status: 'failed', zoneId: log.zoneId, title: log.title, endpointIds, durationSec: log.durationSec, startedAt: log.startedAt, endedAt: new Date().toISOString() });
      throw new ApiError(500, `AMI originate failed: ${(e as Error).message}`);
    }

    return { id: log.id };
  }
}