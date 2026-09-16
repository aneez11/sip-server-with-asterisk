import { Router } from 'express';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Multer } from 'multer';
import multer from 'multer';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { endpointCreateSchema, endpointUpdateSchema } from '../validation/schemas.js';
import { ApiError } from '../errors.js';
import type { EndpointService } from '../services/endpoints.js';
import type { AnnouncementService } from '../services/announcements.js';
import type { BroadcastService } from '../services/broadcast.js';
import type { LiveTalkService } from '../live/LiveTalkService.js';
import type { MonitorService } from '../live/monitor.js';
import type { AmiClient } from '../ami/client.js';
import type { AmiListener } from '../ami/listener.js';
import type { PaGroupService } from '../services/pa-groups.js';

const upload: Multer = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function createEndpointsRouter(endpoints: EndpointService): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try { res.json(await endpoints.list()); } catch (e) { next(e); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const body = endpointCreateSchema.parse(req.body);
      const created = await endpoints.create(body);
      res.status(201).json(created);
    } catch (e) { next(e); }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const body = endpointUpdateSchema.parse(req.body);
      res.json(await endpoints.update(Number(req.params.id), body));
    } catch (e) { next(e); }
  });

  router.delete('/:id', async (req, res, next) => {
    try { await endpoints.remove(Number(req.params.id)); res.status(204).end(); } catch (e) { next(e); }
  });

  router.post('/:id/activate', async (req, res, next) => {
    try { res.json(await endpoints.setActive(Number(req.params.id), true)); } catch (e) { next(e); }
  });

  router.post('/:id/deactivate', async (req, res, next) => {
    try { res.json(await endpoints.setActive(Number(req.params.id), false)); } catch (e) { next(e); }
  });

  router.post('/:id/requalify', async (req, res, next) => {
    try { res.json(await endpoints.requalify(Number(req.params.id))); } catch (e) { next(e); }
  });

  return router;
}

export function createZonesRouter(): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const zones = await prisma.zone.findMany({ orderBy: { name: 'asc' }, include: { members: true } });
      res.json(zones.map((z) => ({
        id: z.id,
        name: z.name,
        beep: z.beep,
        volume: z.volume,
        announcementId: z.announcementId,
        autoAnswerProfileId: z.autoAnswerProfileId,
        endpointCount: z.members.length,
        endpointIds: z.members.map((m) => m.endpointId),
      })));
    } catch (e) { next(e); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const { name, beep, volume, announcementId, autoAnswerProfileId } = req.body as { name?: string; beep?: boolean; volume?: number | null; announcementId?: number | null; autoAnswerProfileId?: number | null };
      if (!name?.trim()) throw new ApiError(422, 'Name is required');
      const zone = await prisma.zone.create({
        data: { name: name.trim(), beep: beep ?? true, volume: volume ?? null, announcementId: announcementId ?? null, autoAnswerProfileId: autoAnswerProfileId ?? null },
      });
      res.status(201).json({ id: zone.id, name: zone.name, beep: zone.beep, volume: zone.volume, announcementId: zone.announcementId, autoAnswerProfileId: zone.autoAnswerProfileId, endpointCount: 0, endpointIds: [] });
    } catch (e) { next(e); }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const { name, beep, volume, announcementId, autoAnswerProfileId } = req.body as { name?: string; beep?: boolean; volume?: number | null; announcementId?: number | null; autoAnswerProfileId?: number | null };
      if (!name?.trim()) throw new ApiError(422, 'Name is required');
      await prisma.zone.update({
        where: { id: Number(req.params.id) },
        data: { name: name.trim(), beep, volume: volume ?? null, announcementId: announcementId ?? null, autoAnswerProfileId: autoAnswerProfileId ?? null },
      });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  router.delete('/:id', async (req, res, next) => {
    try { await prisma.zone.delete({ where: { id: Number(req.params.id) } }); res.status(204).end(); } catch (e) { next(e); }
  });

  router.post('/:id/members', async (req, res, next) => {
    try {
      const { endpointId } = req.body as { endpointId?: number };
      if (!endpointId) throw new ApiError(422, 'endpointId is required');
      await prisma.zoneMember.create({ data: { zoneId: Number(req.params.id), endpointId } });
      res.status(201).json({ ok: true });
    } catch (e) { next(e); }
  });

  router.delete('/:id/members/:endpointId', async (req, res, next) => {
    try {
      await prisma.zoneMember.delete({ where: { zoneId_endpointId: { zoneId: Number(req.params.id), endpointId: Number(req.params.endpointId) } } });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  return router;
}

export function createAnnouncementsRouter(announcements: AnnouncementService): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try { res.json(await announcements.list()); } catch (e) { next(e); }
  });

  router.get('/:id/audio', async (req, res, next) => {
    try {
      const f = await announcements.filePath(Number(req.params.id));
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Content-Disposition', `inline; filename="${f.name}.wav"`);
      res.sendFile(f.absolute);
    } catch (e) { next(e); }
  });

  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) throw new ApiError(422, 'file is required');
      const name = (req.body?.name as string | undefined)?.trim() || undefined;
      res.status(201).json(await announcements.upload(req.file, name));
    } catch (e) { next(e); }
  });

  router.delete('/:id', async (req, res, next) => {
    try { await announcements.remove(Number(req.params.id)); res.status(204).end(); } catch (e) { next(e); }
  });

  router.post('/:id/play', async (req, res, next) => {
    try {
      const ids = (req.body?.endpointIds ?? req.body?.endpoint_ids) as number[] | undefined;
      if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(422, 'endpointIds is required');
      const log = await announcements.play(Number(req.params.id), ids);
      res.status(201).json({ broadcastLogId: log.id });
    } catch (e) { next(e); }
  });

  return router;
}

export function createBroadcastRouter(broadcast: BroadcastService): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const { mode, zoneId, endpointIds, announcementId } = req.body as {
        mode?: string; zoneId?: number; endpointIds?: number[]; announcementId?: number;
      };
      if (mode === 'zone') {
        if (!zoneId) throw new ApiError(422, 'zoneId is required');
        res.status(201).json({ broadcastLogId: (await broadcast.broadcastZone(zoneId, announcementId)).id });
      } else {
        if (!endpointIds || endpointIds.length === 0) throw new ApiError(422, 'endpointIds is required');
        res.status(201).json({ broadcastLogId: (await broadcast.broadcastAdhoc(endpointIds, announcementId)).id });
      }
    } catch (e) { next(e); }
  });

  router.post('/stop', async (req, res, next) => {
    try {
      const logId = (req.body as { logId?: number | null } | undefined)?.logId ?? undefined;
      res.json(await broadcast.stop(logId));
    } catch (e) { next(e); }
  });

  return router;
}

export function createTalkRouter(liveTalk: LiveTalkService): Router {
  const router = Router();

  // Start a live talk: >=1 endpoints broadcasts one-way (operator joins the
  // paging conf as the live marked speaker); exactly 1 phone endpoint becomes
  // a two-way call.
  router.post('/start', async (req, res, next) => {
    try {
      const idsRaw = (req.body as { endpointIds?: unknown } | undefined)?.endpointIds;
      const ids = (Array.isArray(idsRaw) ? idsRaw : [idsRaw]).map(Number).filter((n: number) => Number.isFinite(n));
      if (ids.length === 0) throw new ApiError(422, 'endpointIds is required');
      const session = await liveTalk.start(ids);
      res.status(201).json({ ...session, broadcastLogId: undefined });
    } catch (e) { next(e); }
  });

  router.post('/stop', async (req, res, next) => {
    try {
      const talkId = (req.body as { talkId?: string | null } | undefined)?.talkId ?? undefined;
      res.json(await liveTalk.stop(talkId));
    } catch (e) { next(e); }
  });

  router.get('/status', async (_req, res, next) => {
    try { res.json({ active: liveTalk.listActive() }); } catch (e) { next(e); }
  });

  return router;
}

export function createMusicRouter(announcements: AnnouncementService): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try { res.json(await announcements.listMusic()); } catch (e) { next(e); }
  });

  router.post('/', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) throw new ApiError(422, 'file is required');
      const name = (req.body?.name as string | undefined)?.trim() || undefined;
      res.status(201).json(await announcements.uploadMusic(req.file, name));
    } catch (e) { next(e); }
  });

  router.delete('/:id', async (req, res, next) => {
    try { await announcements.remove(Number(req.params.id)); res.status(204).end(); } catch (e) { next(e); }
  });

  router.post('/:id/play', async (req, res, next) => {
    try {
      const ids = (req.body?.endpointIds ?? req.body?.endpoint_ids) as number[] | undefined;
      if (!Array.isArray(ids) || ids.length === 0) throw new ApiError(422, 'endpointIds is required');
      const log = await announcements.play(Number(req.params.id), ids, { music: true });
      res.status(201).json({ broadcastLogId: log.id });
    } catch (e) { next(e); }
  });

  router.post('/stop', async (_req, res, next) => {
    try {
      res.json(await announcements.stopMusic());
    } catch (e) { next(e); }
  });

  return router;
}

export function createProfilesRouter(): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const profiles = await prisma.autoAnswerProfile.findMany({ orderBy: { name: 'asc' } });
      res.json(profiles);
    } catch (e) { next(e); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const { name, userAgentMatch, alertInfo, callInfo, sipUri, dTime, dialOptions } = req.body as {
        name?: string; userAgentMatch?: string | null; alertInfo?: string | null; callInfo?: string | null;
        sipUri?: string | null; dTime?: number | null; dialOptions?: string | null;
      };
      if (!name?.trim()) throw new ApiError(422, 'Name is required');
      const profile = await prisma.autoAnswerProfile.create({
        data: { name: name.trim(), userAgentMatch: userAgentMatch || null, alertInfo: alertInfo || null, callInfo: callInfo || null, sipUri: sipUri || null, dTime: dTime ?? null, dialOptions: dialOptions || null },
      });
      res.status(201).json(profile);
    } catch (e) { next(e); }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const { name, userAgentMatch, alertInfo, callInfo, sipUri, dTime, dialOptions } = req.body as {
        name?: string; userAgentMatch?: string | null; alertInfo?: string | null; callInfo?: string | null;
        sipUri?: string | null; dTime?: number | null; dialOptions?: string | null;
      };
      if (!name?.trim()) throw new ApiError(422, 'Name is required');
      const profile = await prisma.autoAnswerProfile.update({
        where: { id: Number(req.params.id) },
        data: { name: name.trim(), userAgentMatch: userAgentMatch || null, alertInfo: alertInfo || null, callInfo: callInfo || null, sipUri: sipUri || null, dTime: dTime ?? null, dialOptions: dialOptions || null },
      });
      res.json(profile);
    } catch (e) { next(e); }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      await prisma.autoAnswerProfile.delete({ where: { id: Number(req.params.id) } });
      res.status(204).end();
    } catch (e) { next(e); }
  });

  return router;
}

export function createStatusRouter(endpoints: EndpointService, ami?: AmiClient): Router {
  const router = Router();  router.get('/overview', async (_req, res, next) => {
    try {
      const [endpointList, zones, logs, announcements, musicList, pendingLogs, profiles] = await Promise.all([
        endpoints.list(),
        prisma.zone.findMany({ orderBy: { name: 'asc' }, include: { members: true } }),
        prisma.broadcastLog.findMany({ orderBy: { id: 'desc' }, take: 10 }),
        prisma.announcement.findMany({ where: { flash: false, music: false }, orderBy: { name: 'asc' } }),
        prisma.announcement.findMany({ where: { music: true }, orderBy: { name: 'asc' } }),
        prisma.broadcastLog.findMany({ where: { status: 'pending' }, select: { zoneId: true } }),
        prisma.autoAnswerProfile.findMany({ orderBy: { name: 'asc' } }),
      ]);

      const busyZoneIds = [...new Set(pendingLogs.map((l) => l.zoneId).filter((z): z is number => z !== null))];
      const zoneNameById = new Map(zones.map((z) => [z.id, z.name]));

      res.json({
        endpoints: endpointList,
        zones: zones.map((z) => ({
          id: z.id,
          name: z.name,
          beep: z.beep,
          volume: z.volume,
          announcementId: z.announcementId,
          autoAnswerProfileId: z.autoAnswerProfileId,
          endpointCount: z.members.length,
          endpointIds: z.members.map((m) => m.endpointId),
        })),
        recentLogs: logs.map((l) => ({
          id: l.id,
          status: l.status,
          zoneId: l.zoneId,
          zoneName: l.zoneId != null ? (zoneNameById.get(l.zoneId) ?? null) : null,
          title: l.title ?? '',
          endpointIds: (l.endpointIds as number[]) ?? [],
          durationSec: l.durationSec ?? null,
          startedAt: l.startedAt?.toISOString() ?? null,
          endedAt: l.endedAt?.toISOString() ?? null,
        })),
        announcements: announcements.map((a) => ({
          id: a.id,
          name: a.name,
          filename: a.filename,
          originalName: a.originalName,
          fileSize: a.fileSize,
          duration: a.duration ?? null,
          flash: a.flash,
          music: a.music,
        })),
        music: musicList.map((a) => ({
          id: a.id,
          name: a.name,
          filename: a.filename,
          originalName: a.originalName,
          fileSize: a.fileSize,
          duration: a.duration ?? null,
          flash: a.flash,
          music: true,
        })),
        profiles: profiles.map((p) => ({
          id: p.id,
          name: p.name,
          userAgentMatch: p.userAgentMatch,
          alertInfo: p.alertInfo,
          callInfo: p.callInfo,
          sipUri: p.sipUri,
          dTime: p.dTime,
          dialOptions: p.dialOptions,
        })),
        busyZoneIds,
        amiConnected: ami?.isConnected() ?? false,
        serverHost: config.hostIp,
        serverTime: new Date().toISOString(),
      });
    } catch (e) { next(e); }
  });

  return router;
}

export function createMonitorRouter(monitor: MonitorService, listener: AmiListener, ami: AmiClient): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try { res.json(monitor.snapshot()); } catch (e) { next(e); }
  });

  router.post('/end-call', async (req, res, next) => {
    try {
      const { callId } = req.body as { callId?: string };
      if (!callId) throw new ApiError(422, 'callId is required');

      if (callId.startsWith('log:')) {
        const logId = Number(callId.slice(4));
        if (!Number.isFinite(logId)) throw new ApiError(422, 'Invalid callId');
        const stopped = await listener.stopBroadcast(logId);
        res.json({ stopped });
      } else if (callId.startsWith('direct:')) {
        const linkedid = callId.slice(7);
        const channels = await ami.coreShowChannels();
        let stopped = 0;
        for (const ch of channels) {
          const name = ch.split('|')[0];
          if (name.includes(linkedid) && /^PJSIP\//.test(name)) {
            if (await ami.hangup(name)) stopped += 1;
          }
        }
        res.json({ stopped });
      } else {
        throw new ApiError(422, 'Unknown callId format');
      }
    } catch (e) { next(e); }
  });

  return router;
}

export function createPaGroupsRouter(pa: PaGroupService): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try { res.json(await pa.list()); } catch (e) { next(e); }
  });

  router.get('/:id', async (req, res, next) => {
    try { res.json(await pa.get(Number(req.params.id))); } catch (e) { next(e); }
  });

  router.post('/', async (req, res, next) => {
    try {
      const b = req.body ?? {};
      res.status(201).json(await pa.create({
        name: b.name ?? '',
        extension: String(b.extension ?? ''),
        initiatorEndpointId: b.initiatorEndpointId ?? null,
        paStartAnnouncementId: b.paStartAnnouncementId ?? null,
        paEndAnnouncementId: b.paEndAnnouncementId ?? null,
        receiverEndpointIds: Array.isArray(b.receiverEndpointIds) ? b.receiverEndpointIds : [],
      }));
    } catch (e) { next(e); }
  });

  router.put('/:id', async (req, res, next) => {
    try {
      const b = req.body ?? {};
      res.json(await pa.update(Number(req.params.id), {
        name: b.name,
        extension: b.extension != null ? String(b.extension) : undefined,
        initiatorEndpointId: b.initiatorEndpointId,
        paStartAnnouncementId: b.paStartAnnouncementId,
        paEndAnnouncementId: b.paEndAnnouncementId,
        receiverEndpointIds: Array.isArray(b.receiverEndpointIds) ? b.receiverEndpointIds : undefined,
      }));
    } catch (e) { next(e); }
  });

  router.delete('/:id', async (req, res, next) => {
    try { await pa.remove(Number(req.params.id)); res.status(204).end(); } catch (e) { next(e); }
  });

  return router;
}

/** Internal trigger route used by the dialplan AGI hook (shared-secret auth). */
export function createPaTriggerRouter(pa: PaGroupService, secret: string): Router {
  const router = Router();

  router.get('/:extension', async (req, res, next) => {
    try {
      const auth = req.headers['authorization'] ?? '';
      if (auth !== `Bearer ${secret}`) { res.status(401).json({ message: 'Unauthorized' }); return; }
      const callerExt = (req.query.caller as string | undefined) ?? null;
      res.json(await pa.trigger(req.params.extension, callerExt));
    } catch (e) { next(e); }
  });

  return router;
}

/** Unified media index (announcements + music tracks) for the Media Manager. */
export function createMediaRouter(announcements: AnnouncementService): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try { res.json(await announcements.listAll()); } catch (e) { next(e); }
  });

  return router;
}