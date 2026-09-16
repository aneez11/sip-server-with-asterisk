// PaGroup service — initiator/receiver one-to-many PA announcement groups.
//
// A group has a trigger extension (dialed on the initiator device), a receiver
// set (endpoints that hear the announcement), and optional pa_start/pa_end
// audio. When the initiator dials the extension, the static dialplan runs an AGI
// hook that calls trigger() here; the API resolves receivers, originates their
// member legs into a fresh ConfBridge, and returns the conf + audio so the
// dialplan can bridge the initiator as the marked speaker and play start/end.

import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { config } from '../config.js';
import type { AmiClient } from '../ami/client.js';
import type { Server as SocketServer } from 'socket.io';
import { ApiError } from '../errors.js';
import { EVENTS } from '@infinity/shared';
import type { MonitorService } from '../live/monitor.js';
import type { PaGroup, PaGroupTrigger } from '@infinity/shared';
import { originateMemberLegs } from '../lib/member-legs.js';

export interface PaGroupInput {
  name: string;
  extension: string;
  initiatorEndpointId: number | null;
  paStartAnnouncementId: number | null;
  paEndAnnouncementId: number | null;
  receiverEndpointIds: number[];
}

export class PaGroupService {
  /** pageConf -> paEnd info for teardown replay. */
  private paEndByConf = new Map<string, { paEnd: string | null; logId: number }>();

  constructor(
    private readonly ami: AmiClient,
    private readonly io: SocketServer,
    private readonly stopMembers?: (logId?: number) => Promise<number>,
    private readonly monitor?: MonitorService,
  ) {}

  async list(): Promise<PaGroup[]> {
    const groups = await prisma.paGroup.findMany({
      orderBy: { name: 'asc' },
      include: {
        initiatorEndpoint: { select: { extension: true, label: true } },
        receivers: true,
      },
    });
    return groups.map((g) => this.serialize(g));
  }

  async get(id: number): Promise<PaGroup> {
    const g = await prisma.paGroup.findUnique({
      where: { id },
      include: { initiatorEndpoint: { select: { extension: true, label: true } }, receivers: true },
    });
    if (!g) throw new ApiError(404, 'PA group not found');
    return this.serialize(g);
  }

  async create(input: PaGroupInput): Promise<PaGroup> {
    const ext = this.normalizeExtension(input.extension);
    const g = await prisma.paGroup.create({
      data: {
        name: input.name.trim(),
        extension: ext,
        initiatorEndpointId: input.initiatorEndpointId ?? null,
        paStartAnnouncementId: input.paStartAnnouncementId ?? null,
        paEndAnnouncementId: input.paEndAnnouncementId ?? null,
        receivers: { create: (input.receiverEndpointIds ?? []).map((id) => ({ endpointId: id })) },
      },
      include: { initiatorEndpoint: { select: { extension: true, label: true } }, receivers: true },
    });
    return this.serialize(g);
  }

  async update(id: number, input: Partial<PaGroupInput>): Promise<PaGroup> {
    const existing = await prisma.paGroup.findUnique({ where: { id }, include: { receivers: true } });
    if (!existing) throw new ApiError(404, 'PA group not found');
    const g = await prisma.paGroup.update({
      where: { id },
      data: {
        name: input.name != null ? input.name.trim() : undefined,
        extension: input.extension != null ? this.normalizeExtension(input.extension) : undefined,
        initiatorEndpointId: input.initiatorEndpointId !== undefined ? input.initiatorEndpointId : undefined,
        paStartAnnouncementId: input.paStartAnnouncementId !== undefined ? input.paStartAnnouncementId : undefined,
        paEndAnnouncementId: input.paEndAnnouncementId !== undefined ? input.paEndAnnouncementId : undefined,
        ...(input.receiverEndpointIds
          ? {
              receivers: {
                deleteMany: {},
                create: input.receiverEndpointIds.map((rid) => ({ endpointId: rid })),
              },
            }
          : {}),
      },
      include: { initiatorEndpoint: { select: { extension: true, label: true } }, receivers: true },
    });
    return this.serialize(g);
  }

  async remove(id: number): Promise<void> {
    const existing = await prisma.paGroup.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'PA group not found');
    await prisma.paGroup.delete({ where: { id } });
  }

  /**
   * Trigger a PA announcement. Called by the AGI hook when a device dials the
   * group extension. Resolves receivers, originates their member legs into a new
   * ConfBridge, and returns the conf name + boundary audio for the dialplan.
   */
  async trigger(extension: string, callerExt?: string | null): Promise<PaGroupTrigger> {
    const group = await prisma.paGroup.findUnique({
      where: { extension: String(extension).trim() },
      include: { receivers: { include: { endpoint: { select: { extension: true, isActive: true } } } } },
    });
    if (!group) throw new ApiError(404, 'PA group not found');

    // Enforce initiator (if a specific device is configured).
    if (group.initiatorEndpointId != null) {
      const caller = await prisma.endpoint.findUnique({ where: { extension: callerExt ?? '' } });
      if (!caller || caller.id !== group.initiatorEndpointId) {
        throw new ApiError(403, 'This device is not the initiator for this group');
      }
    }

    const receiverExts = group.receivers
      .filter((r) => r.endpoint.isActive)
      .map((r) => r.endpoint.extension);
    if (receiverExts.length === 0) throw new ApiError(422, 'Group has no active receivers');

    const pageConf = randomUUID();
    const title = `PA: ${group.name}`;
    // Resolve pa_start / pa_end from uploaded Announcement media. If the group
    // has none selected, fall back to the system-seeded pa_start/pa_end media
    // (registered as Announcement rows so they normalize through the same
    // pipeline — never absolute on-disk paths).
    const defaultStartId = await this.defaultPaId('pa_start');
    const defaultEndId = await this.defaultPaId('pa_end');
    const paStart = await this.audioName(group.paStartAnnouncementId ?? defaultStartId);
    const paEnd = await this.audioName(group.paEndAnnouncementId ?? defaultEndId);
    const log = await prisma.broadcastLog.create({
      data: { status: 'pending', endpointIds: group.receivers.map((r) => r.endpointId), title, startedAt: new Date() },
    });
    this.io.emit(EVENTS.broadcastUpdated, {
      id: log.id, status: 'pending', zoneId: null, title, startedAt: log.startedAt, endedAt: null,
    });

    try {
      // Member legs: receivers join the conf muted (no end_marked) and hear the
      // announcement. They stay joined after the initiator leaves so pa_end can
      // play to them; the API tears them down afterwards.
      await originateMemberLegs({
        ami: this.ami,
        endpointExtensions: receiverExts,
        logId: log.id,
        pageConf,
        title,
        role: 'paging_pa_user',
      });
      // Hold announcer: a Local leg whose ;2 runs `announce` (ConfBridge,
      // paging_announcer — unmuted, not marked) and ;1 waits, keeping the conf
      // alive while the initiator speaks as the marked speaker.
      await this.ami.action({
        Action: 'Originate',
        Channel: 'Local/announce@pa-announce',
        Application: 'Wait',
        Data: '3600',
        Variable: ['_PAGE_CONF=' + pageConf, '_PA_START=' + (paStart ?? 'beep')].join(','),
        Async: 'true',
      });
      // PA start tone: played AFTER the receiver member legs have actually joined
      // the conference. We poll Asterisk until the expected number of receiver
      // members (paging_pa_user) are in the bridge, then play pa_start. The tone
      // announcer joins as paging_pa_tone (marked) so its audio reaches the muted
      // receivers, then leaves when the playback ends; the initiator becomes the
      // marked live speaker afterwards.
      if (paStart) {
        await this.waitForMembers(pageConf, receiverExts.length, 8000);
        await this.ami.action({
          Action: 'Originate',
          Channel: 'Local/announce@pa-announce',
          Application: 'Playback',
          Data: paStart,
          Variable: ['_PAGE_CONF=' + pageConf, '_PA_ROLE=paging_pa_tone'].join(','),
          Async: 'true',
        });
      }
      // Remember paEnd (and logId) so the listener can replay it on teardown.
      this.paEndByConf.set(pageConf, { paEnd, logId: log.id });
    } catch (e) {
      await prisma.broadcastLog.update({ where: { id: log.id }, data: { status: 'failed', endedAt: new Date() } });
      throw new ApiError(500, `PA trigger failed: ${(e as Error).message}`);
    }

    return { ok: true, pageConf, receivers: receiverExts, paStart, paEnd, title };
  }

  /**
   * Replay pa_end into a live PA conference, then hang up the receiver member
   * legs and finalize the log. Called by the AMI listener when the initiator
   * (marked speaker) leaves the conference.
   */
  async onInitiatorLeft(pageConf: string): Promise<void> {
    const info = this.paEndByConf.get(pageConf);
    if (!info) return;
    this.paEndByConf.delete(pageConf);

    // Play pa_end into the still-joined receivers first (as a marked tone leg so
    // its audio reaches the muted paging_pa_user receivers).
    if (info.paEnd) {
      await this.ami.action({
        Action: 'Originate',
        Channel: 'Local/announce@pa-announce',
        Application: 'Playback',
        Data: info.paEnd,
        Variable: ['_PAGE_CONF=' + pageConf, '_PA_ROLE=paging_pa_tone'].join(','),
        Async: 'true',
      });
      // Give the tone a moment before dropping the receivers.
      await new Promise((r) => setTimeout(r, 2000));
    }

    // Hang up the receiver member legs for this log (Local/9000@paging legs).
    if (this.stopMembers) await this.stopMembers(info.logId);

    // Safety net: the listener normally ends the monitor call when the last
    // member hangs up (page finalize). If that event was missed, force it now so
    // the Monitor never shows these receivers stuck on "receiving".
    this.monitor?.endCall(`log:${info.logId}`);

    const current = await prisma.broadcastLog.findUnique({ where: { id: info.logId }, select: { status: true, title: true, startedAt: true } });
    const updated = await prisma.broadcastLog.update({ where: { id: info.logId }, data: { status: 'success', endedAt: new Date() } });
    this.io.emit(EVENTS.broadcastUpdated, {
      id: updated.id, status: updated.status, zoneId: null, title: current?.title ?? '', startedAt: updated.startedAt, endedAt: updated.endedAt,
    });
  }

  /** Playback path (filename without extension) for an Announcement by id. */
  private async audioName(announcementId: number | null): Promise<string | null> {
    if (announcementId == null) return null;
    const a = await prisma.announcement.findUnique({ where: { id: announcementId } });
    if (!a) return null;
    // Playback wants the absolute filename WITHOUT extension (existing pattern).
    return `${config.announcementsDir}/${a.filename}`.replace(/\.\w+$/, '');
  }

  /** Find the seeded pa_start / pa_end Announcement (registered via seed()). */
  private async defaultPaId(basename: string): Promise<number | null> {
    const a = await prisma.announcement.findFirst({ where: { name: basename, music: false }, orderBy: { id: 'asc' } });
    return a?.id ?? null;
  }

  /** Poll Asterisk until `count` receiver members (paging_pa_user) are in the
   *  conference (or timeout). Returns true if the expected count was reached. */
  private async waitForMembers(pageConf: string, count: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const lines = await this.ami.coreShowChannels().catch(() => []) as string[];
      const members = lines.filter((l) => l.includes(pageConf) && l.includes('paging_pa_user')).length;
      if (members >= count) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  /**
   * A PA group extension must be in the range the static [internal] dialplan
   * routes to the PA AGI trigger: _9[1-9]XX (9000-9999). Take the last 3 digits
   * and prefix with `9`, replacing a leading `0` in the second position with `1`,
   * so dialing the extension lands on the PA trigger — not the generic
   * device-to-device Dial(PJSIP/<ext>) path ("peer not found").
   */
  private normalizeExtension(ext: string): string {
    const d = String(ext).trim().replace(/\D/g, '');
    if (d.length === 0) throw new ApiError(422, 'Group extension is required');
    let tail = d.slice(-3).padStart(3, '1');
    if (tail[0] === '0') tail = `1${tail.slice(1)}`;
    return `9${tail}`;
  }

  private serialize(g: any): PaGroup {
    return {
      id: g.id,
      name: g.name,
      extension: g.extension,
      initiatorEndpointId: g.initiatorEndpointId ?? null,
      initiatorExtension: g.initiatorEndpoint?.extension ?? null,
      initiatorLabel: g.initiatorEndpoint?.label ?? null,
      paStartAnnouncementId: g.paStartAnnouncementId ?? null,
      paEndAnnouncementId: g.paEndAnnouncementId ?? null,
      receiverEndpointIds: (g.receivers ?? []).map((r: any) => r.endpointId),
      receiverCount: (g.receivers ?? []).length,
    };
  }
}
