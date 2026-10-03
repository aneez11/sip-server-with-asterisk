import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { validateAudioExtension, normalizeAudioTo8k, audioDurationSeconds } from '../lib/audio.js';
import type { AmiClient } from '../ami/client.js';
import type { Server as SocketServer } from 'socket.io';
import { ApiError } from '../errors.js';
import { originateMemberLegs } from '../lib/member-legs.js';
import { onlineEndpoints } from '../lib/online-endpoints.js';

import { EVENTS } from '@infinity/shared';


export interface MulterFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

export interface AnnouncementView {
  id: number;
  name: string;
  filename: string;
  originalName: string;
  originalFile: string;
  fileSize: number;
  duration: number | null;
  flash: boolean;
  music: boolean;
}

export class AnnouncementService {
  constructor(
    private readonly ami: AmiClient,
    private readonly io: SocketServer,
    private readonly stopMusicStreams?: () => Promise<number>,
  ) {}

  /**
   * Register the system PA boundary tones (pa_start.wav / pa_end.wav) as real
   * Announcement media so PA groups can reference them through the same upload
   * pipeline (normalized to 8 kHz mono) rather than absolute on-disk paths.
   * Idempotent — skips rows already seeded by name.
   */
  async seedPaMedia(): Promise<void> {
    for (const name of ['pa_start', 'pa_end']) {
      const already = await prisma.announcement.findFirst({ where: { name, music: false } });
      if (already) continue;
      const filePath = path.join(config.announcementsDir, `${name}.wav`);
      const buf = await fs.readFile(filePath).catch(() => null);
      if (!buf) continue; // file not present — skip (upload path normalizes later)
      const canonical = `${name}-${randomUUID()}.wav`;
      const canonicalPath = path.join(config.announcementsDir, canonical);
      await fs.writeFile(canonicalPath, buf);
      // Ensure 8 kHz mono so Asterisk ConfBridge/Playback can decode it.
      await normalizeAudioTo8k(canonicalPath, canonicalPath).catch(() => undefined);
      const fileSize = (await fs.stat(canonicalPath)).size;
      const duration = await audioDurationSeconds(canonicalPath);
      await prisma.announcement.create({
        data: { name, filename: canonical, originalName: `${name}.wav`, originalFile: '', fileSize, duration, music: false },
      });
    }
  }

  async list() {
    return prisma.announcement.findMany({ where: { flash: false, music: false }, orderBy: { name: 'asc' } });
  }

  /** All media (broadcast announcements + music tracks) for the Media Manager. */
  async listAll() {
    return prisma.announcement.findMany({ where: { flash: false }, orderBy: [{ music: 'asc' }, { name: 'asc' }] });
  }

  async listMusic() {
    return prisma.announcement.findMany({ where: { music: true }, orderBy: { name: 'asc' } });
  }

  async upload(file: MulterFile, name?: string, music = false): Promise<AnnouncementView> {
    const stored = await this.persistAudio(file, music ? 'music-' : '');
    const a = await prisma.announcement.create({
      data: {
        name: name ?? this.baseName(file.originalname),
        filename: stored.filename,
        originalName: file.originalname,
        originalFile: stored.originalFile,
        fileSize: stored.fileSize,
        duration: stored.duration,
        music,
      },
    });
    return this.serialize(a);
  }

  async uploadMusic(file: MulterFile, name?: string): Promise<AnnouncementView> {
    return this.upload(file, name, true);
  }

  async remove(id: number): Promise<void> {
    const a = await prisma.announcement.findUnique({ where: { id } });
    if (!a) throw new ApiError(404, 'Not found');
    await fs.unlink(path.join(config.announcementsDir, a.filename)).catch(() => undefined);
    if (a.originalFile) await fs.unlink(path.join(config.announcementsDir, a.originalFile)).catch(() => undefined);
    await prisma.announcement.delete({ where: { id } });
  }

  /** Absolute path to the canonical (normalized) audio file for local playback. */
  async filePath(id: number): Promise<{ absolute: string; name: string }> {
    const a = await prisma.announcement.findUnique({ where: { id } });
    if (!a) throw new ApiError(404, 'Announcement not found');
    return { absolute: path.join(config.announcementsDir, a.filename), name: a.name };
  }

  async play(id: number, endpointIds: number[], opts: { music?: boolean } = {}): Promise<{ id: number }> {
    const a = await prisma.announcement.findUnique({ where: { id } });
    if (!a) throw new ApiError(404, 'Announcement not found');

    const endpoints = await onlineEndpoints(this.ami, await prisma.endpoint.findMany({ where: { id: { in: endpointIds }, isActive: true } }));
    if (endpoints.length === 0) throw new ApiError(422, 'No online endpoints');

    const log = await prisma.broadcastLog.create({
      data: { status: 'pending', endpointIds, startedAt: new Date(), title: a.name, durationSec: a.duration ?? null },
    });
    this.io.emit(EVENTS.broadcastUpdated, {
      id: log.id,
      status: 'pending',
      zoneId: null,
      title: log.title,
      endpointIds,
      durationSec: log.durationSec,
      startedAt: log.startedAt,
      endedAt: null,
    });

    const playPath = path.join(config.announcementsDir, a.filename).replace(/\.\w+$/, '');

    const pageConf = randomUUID();
    try {
      // Announcer: play the track into the paging ConfBridge as the marked
      // speaker so the conference mixer streams it at realtime (no Local-channel
      // queue buildup). The U() Gosub joins each member, muted, into the same
      // conference.
      await this.ami.action({
        Action: 'Originate',
        Channel: opts.music ? 'Local/announce@music-bridge' : 'Local/announce@paging-bridge',
        Application: 'Playback',
        Data: playPath,
        Variable: `_PAGE_CONF=${pageConf}`,
        Async: 'true',
      });

      await originateMemberLegs({
        ami: this.ami,
        endpointExtensions: endpoints.map((e) => e.extension),
        logId: log.id,
        pageConf,
        title: a.name,
        music: opts.music,
      });
    } catch (e) {
      const endedAt = new Date();
      await prisma.broadcastLog.update({ where: { id: log.id }, data: { status: 'failed', endedAt } });
      this.io.emit(EVENTS.broadcastUpdated, {
        id: log.id,
        status: 'failed',
        zoneId: null,
        title: log.title,
        endpointIds,
        durationSec: log.durationSec,
        startedAt: log.startedAt,
        endedAt,
      });
      throw new ApiError(500, `AMI originate failed: ${(e as Error).message}`);
    }

    return { id: log.id };
  }

  async flashPlay(endpointIds: number[], file: MulterFile): Promise<{ id: number }> {
    const stored = await this.persistAudio(file, 'flash-');
    const a = await prisma.announcement.create({
      data: {
        name: `Live talk ${new Date().toLocaleTimeString()}`,
        filename: stored.filename,
        originalName: 'talk.wav',
        originalFile: stored.originalFile,
        fileSize: stored.fileSize,
        flash: true,
      },
    });

    return this.play(a.id, endpointIds);
  }

  /** Hard-stop active music streams (hangs up the paging origin channels). */
  async stopMusic(): Promise<{ stopped: number }> {
    if (!this.stopMusicStreams) return { stopped: 0 };
    const stopped = await this.stopMusicStreams();
    return { stopped };
  }

  /**
   * Validate extension, retain the original upload, and produce the canonical
   * 16 kHz mono PCM16 WAV via ffmpeg. On conversion failure the original stays
   * on disk and the error is surfaced (never silently dropped).
   */
  private async persistAudio(file: MulterFile, prefix: string): Promise<{ filename: string; originalFile: string; fileSize: number; duration: number | null }> {
    let ext: string;
    try {
      ext = validateAudioExtension(file.originalname);
    } catch (e) {
      throw new ApiError(422, (e as Error).message);
    }

    await fs.mkdir(config.announcementsDir, { recursive: true });
    const id = randomUUID();
    const originalStored = `${prefix}${id}${ext}`;
    const canonical = `${prefix}${id}.wav`;
    const originalPath = path.join(config.announcementsDir, originalStored);
    const canonicalPath = path.join(config.announcementsDir, canonical);

    await fs.writeFile(originalPath, file.buffer);

    const tmpIn = path.join(config.announcementsDir, `.${id}.upload`);
    const tmpOut = path.join(config.announcementsDir, `.${id}-8k.wav`);
    await fs.writeFile(tmpIn, file.buffer);
    try {
      await normalizeAudioTo8k(tmpIn, tmpOut);
      await fs.copyFile(tmpOut, canonicalPath);
    } catch (e) {
      throw new ApiError(500, `Audio conversion failed — original retained: ${(e as Error).message}`);
    } finally {
      await fs.unlink(tmpIn).catch(() => undefined);
      await fs.unlink(tmpOut).catch(() => undefined);
    }

    const fileSize = (await fs.stat(canonicalPath)).size;
    const duration = await audioDurationSeconds(canonicalPath);
    return { filename: canonical, originalFile: originalStored, fileSize, duration };
  }

  private baseName(name: string) {
    return (path.parse(name).name || 'announcement').slice(0, 120);
  }

  private serialize(a: any) {
    return {
      id: a.id,
      name: a.name,
      filename: a.filename,
      originalName: a.originalName,
      originalFile: a.originalFile ?? '',
      fileSize: a.fileSize,
      duration: a.duration ?? null,
      flash: a.flash,
      music: a.music ?? false,
    };
  }
}
