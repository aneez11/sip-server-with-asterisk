// Backfill durations for announcements with NULL duration, using ffprobe on the
// canonical WAV in /announcements.
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const dir = '/announcements';

function ffprobeDuration(p) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', p], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const s = parseFloat(String(stdout).trim());
      resolve(Number.isFinite(s) ? s : null);
    });
  });
}

async function main() {
  const { execSync } = await import('node:child_process');
  const bcrypt = null;
  // Use the API's db module directly.
  const { prisma } = await import('/app/api/dist/db.js');
  const rows = await prisma.announcement.findMany({ select: { id: true, filename: true, duration: true } });
  for (const a of rows) {
    if (a.duration != null) continue;
    const abs = path.join(dir, a.filename);
    const d = await ffprobeDuration(abs);
    if (d != null) {
      await prisma.announcement.update({ where: { id: a.id }, data: { duration: d } });
      console.log('updated', a.id, a.filename, '->', d.toFixed(1) + 's');
    } else {
      console.log('MISSING/ERR', a.id, a.filename);
    }
  }
  console.log('done');
  process.exit(0);
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
