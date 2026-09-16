// G.711 µ-law (PCMU) codec — matches Asterisk's codec_ulaw (linear2ulaw /
// ulaw2linear). The API's operator RTP leg negotiates PCMU/8000.

const BIAS = 0x84;
const CLIP = 32635;

/** exponent lookup: log2(v) for v in 0..255 (seg_uend equivalent). */
function expLut(v: number): number {
  if (v <= 0) return 0;
  return 31 - Math.clz32(v);
}

function linearToUlaw(pcm: number): number {
  const sign = (pcm >> 8) & 0x80;
  if (sign) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;
  pcm += BIAS;
  const exponent = expLut((pcm >> 7) & 0xff);
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa);
}

function ulawToLinear(u: number): number {
  const u2 = ~u;
  const sign = u2 & 0x80;
  const exponent = (u2 >> 4) & 0x07;
  const mantissa = u2 & 0x0f;
  let sample = (mantissa << 3) + BIAS;
  sample <<= exponent;
  sample -= BIAS;
  return sign ? -sample : sample;
}

const LINEAR_TO_ULAW = new Uint8Array(65536);
for (let i = 0; i < 65536; i++) LINEAR_TO_ULAW[i] = linearToUlaw(i - 32768);

export function pcmToUlaw(pcm: Int16Array): Uint8Array {
  const out = new Uint8Array(pcm.length);
  const table = LINEAR_TO_ULAW;
  for (let i = 0; i < pcm.length; i++) out[i] = table[pcm[i] + 32768];
  return out;
}

export function ulawToPcm(ulaw: Uint8Array): Int16Array {
  const out = new Int16Array(ulaw.length);
  for (let i = 0; i < ulaw.length; i++) out[i] = ulawToLinear(ulaw[i]);
  return out;
}