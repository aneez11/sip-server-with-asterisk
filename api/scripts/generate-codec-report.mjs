#!/usr/bin/env node
/**
 * Generate CODEC_VERIFICATION.md from the endpoint_codec_log table.
 *
 * Summarizes per-endpoint negotiated codec (G.722 wideband vs G.711 fallback)
 * and how consistently each endpoint achieves wideband. This is an ongoing
 * health check, not a one-time audit.
 *
 *   docker compose exec api node scripts/generate-codec-report.mjs
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { promises as fs } from 'node:fs';

const prisma = new PrismaClient();

const fmtTs = (d) => (d ? new Date(d).toISOString() : '—');

async function main() {
  const rows = await prisma.endpointCodecLog.findMany({ orderBy: { createdAt: 'asc' } });

  const lines = [];
  lines.push('# CODEC_VERIFICATION.md');
  lines.push('');
  lines.push(`Generated: ${fmtTs(new Date())}`);
  lines.push('');
  lines.push(
    'Verifies G.722 (16 kHz wideband) negotiation per endpoint from live broadcast traffic — ' +
      'every answered page member is logged automatically. G.711 fallback (ulaw/alaw) is expected ' +
      'for narrowband-only devices and is not an error by itself; consistent wideband is the goal.',
  );
  lines.push('');

  if (rows.length === 0) {
    lines.push('> No codec observations yet. Run broadcasts for ~1-2 days of normal PA use, then regenerate.');
    lines.push('');
    await writeReport(lines.join('\n'));
    console.log('CODEC_VERIFICATION.md written (no data yet).');
    await prisma.$disconnect();
    return;
  }

  const byEndpoint = new Map();
  for (const r of rows) {
    const key = `${r.extension}${r.endpointModel ? ` (${r.endpointModel})` : ''}`;
    if (!byEndpoint.has(key)) byEndpoint.set(key, { id: r.endpointId, codecs: {}, count: 0, first: r.createdAt, last: r.createdAt });
    const e = byEndpoint.get(key);
    e.codecs[r.negotiatedCodec] = (e.codecs[r.negotiatedCodec] ?? 0) + 1;
    e.count += 1;
    if (r.createdAt < e.first) e.first = r.createdAt;
    if (r.createdAt > e.last) e.last = r.createdAt;
  }

  const wb = (n) => (n === 'g722' || n === 'g7221' || n === 'silk');
  lines.push('| Endpoint | Broadcasts logged | G.722 share | Codecs | First | Last |');
  lines.push('|---|---|---|---|---|---|---|');
  const summary = { widebandOnly: [], mixed: [], narrowbandOnly: [], unknown: [] };
  for (const [name, e] of [...byEndpoint.entries()].sort()) {
    const total = e.count;
    const g722 = Object.entries(e.codecs).filter(([c]) => wb(c)).reduce((s, [, n]) => s + n, 0);
    const share = Math.round((g722 / total) * 100);
    const codecs = Object.entries(e.codecs).map(([c, n]) => `${c} ${n}`).join(', ');
    lines.push(`| ${name} | ${total} | ${share}% | ${codecs} | ${fmtTs(e.first)} | ${fmtTs(e.last)} |`);
    if (share === 100) summary.widebandOnly.push(name);
    else if (share === 0) summary.narrowbandOnly.push(name);
    else summary.mixed.push(name);
  }

  lines.push('');
  lines.push('## Health summary');
  lines.push('');
  lines.push(`- **Consistent wideband (100% G.722):** ${summary.widebandOnly.length ? summary.widebandOnly.join(', ') : 'none yet'}`);
  lines.push(`- **Mixed (G.722 / G.711):** ${summary.mixed.length ? summary.mixed.join(', ') : 'none'}`);
  lines.push(`- **Narrowband only (0% G.722):** ${summary.narrowbandOnly.length ? summary.narrowbandOnly.join(', ') : 'none'}`);
  lines.push('');
  lines.push(
    '> Narrowband-only endpoints may simply not advertise G.722 (older IP speaker/softphone firmware). ' +
      'Investigate if a model that previously achieved wideband starts falling back — that indicates ' +
      'firmware updates or config drift.',
  );

  await writeReport(lines.join('\n'));
  console.log(`CODEC_VERIFICATION.md written — ${rows.length} observations, ${byEndpoint.size} endpoints.`);
  await prisma.$disconnect();
}

async function writeReport(md) {
  await fs.writeFile('CODEC_VERIFICATION.md', md, 'utf8');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
