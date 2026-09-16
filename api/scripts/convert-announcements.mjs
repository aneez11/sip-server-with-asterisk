#!/usr/bin/env node
/**
 * One-off batch conversion for the existing announcement/music library.
 *
 * Every stored file (WAV or MP3) is re-encoded to 16 kHz mono PCM16 WAV and the
 * DB row is repointed at the normalized file. The ORIGINAL file is retained as
 * `originalFile` (rollback reference) — it is never deleted in this pass.
 *
 * Run inside the API container (has ffmpeg + DATABASE_URL):
 *   docker compose exec api node scripts/convert-announcements.mjs
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const dir = process.env.ANNOUNCEMENTS_DIR || '/announcements';
const prisma = new PrismaClient();

function ffmpeg(input, output) {
  return execFileP(
    'ffmpeg',
    ['-i', input, '-ar', '16000', '-ac', '1', '-acodec', 'pcm_s16le', '-y', output],
    { maxBuffer: 64 * 1024 * 1024 },
  );
}

async function main() {
  const rows = await prisma.announcement.findMany();
  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const a of rows) {
    if (a.flash) { skipped += 1; continue; } // live-talk flash files are ephemeral
    if (a.originalFile) { skipped += 1; continue; } // already normalized by the new pipeline

    const input = path.join(dir, a.filename);
    const ext = path.extname(a.filename).toLowerCase();
    if (ext !== '.wav' && ext !== '.mp3') { skipped += 1; continue; }

    let stat;
    try { stat = await fs.stat(input); } catch { failed += 1; console.log(`MISSING ${a.filename}`); continue; }
    if (!stat.isFile()) { skipped += 1; continue; }

    const outputName = `${a.filename.replace(/\.\w+$/, '')}_16k.wav`;
    const output = path.join(dir, outputName);

    try {
      await ffmpeg(input, output);
      await prisma.announcement.update({
        where: { id: a.id },
        data: { filename: outputName, originalFile: a.filename },
      });
      converted += 1;
      console.log(`OK ${a.filename} -> ${outputName}`);
    } catch (e) {
      failed += 1;
      const detail = String(e.stderr ?? e.message).split('\n').filter(Boolean).slice(-2).join(' ');
      console.log(`FAIL ${a.filename}: ${detail}`);
    }
  }

  console.log(`\nConverted ${converted}, skipped ${skipped}, failed ${failed}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
