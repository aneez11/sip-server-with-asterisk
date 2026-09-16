/**
 * WAV handling for announcements.
 *
 * Two problems solved here:
 *  1. ffmpeg-produced WAVs carry a LIST/INFO metadata chunk before the data
 *     chunk (plus a stale RIFF size), which Asterisk's format_wav cannot open.
 *  2. Asterisk's format_wav in this build cannot open 44.1/48 kHz or stereo
 *     PCM WAVs at all — only telephony-grade 8 kHz mono works reliably.
 *
 * So every upload is transcoded to 8 kHz mono 16-bit PCM. This is the format
 * every Asterisk handles, keeps files small, and is ideal for voice paging.
 * Files that are not PCM 16-bit are returned unchanged (they will fail
 * Playback with a clear log line rather than hang).
 */
export function normalizeWav(input: Buffer): Buffer {
  const parsed = parseWav(input);
  if (!parsed) return input;

  const { fmt, data } = parsed;
  if (fmt.length < 16 || fmt.readUInt16LE(0) !== 1 || fmt.readUInt16LE(14) !== 16) {
    return input; // not PCM 16-bit — leave untouched
  }

  const channels = fmt.readUInt16LE(2);
  const rate = fmt.readUInt32LE(4);
  const sampleCount = Math.floor(data.length / 2 / channels);

  // Downmix to mono.
  const mono = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      sum += data.readInt16LE((i * channels + c) * 2);
    }
    mono[i] = sum / channels;
  }

  // Resample to 8000 Hz (linear interpolation).
  const TARGET = 8000;
  const out = new Int16Array(Math.floor((mono.length * TARGET) / rate));
  for (let i = 0; i < out.length; i++) {
    const pos = (i * rate) / TARGET;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, mono.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(mono[i0] * (1 - frac) + mono[i1] * frac);
  }

  const body = Buffer.alloc(out.length * 2);
  for (let i = 0; i < out.length; i++) body.writeInt16LE(out[i], i * 2);

  return buildWav(body);
}

function parseWav(input: Buffer): { fmt: Buffer; data: Buffer } | null {
  if (input.length < 44 || input.toString('latin1', 0, 4) !== 'RIFF' || input.toString('latin1', 8, 12) !== 'WAVE') {
    return null;
  }
  let offset = 12;
  let fmt: Buffer | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= input.length) {
    const id = input.toString('latin1', offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const body = input.subarray(offset + 8, Math.min(offset + 8 + size, input.length));
    if (id === 'fmt ') fmt = Buffer.from(body);
    else if (id === 'data') { data = Buffer.from(body); break; }
    offset += 8 + size + (size % 2);
  }
  return fmt && data ? { fmt, data } : null;
}

function buildWav(data: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(8000, 4); // rate
  fmt.writeUInt32LE(16000, 8); // byte rate
  fmt.writeUInt16LE(2, 12); // block align
  fmt.writeUInt16LE(16, 14); // bits

  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8, 'latin1');
  header.write('fmt ', 12, 'latin1');
  header.writeUInt32LE(16, 16);
  fmt.copy(header, 20);
  header.write('data', 36, 'latin1');
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
}
