// Linear resampling between arbitrary sample rates. For downsampling, a
// box-car anti-aliasing filter is applied before decimation to prevent
// aliasing (which sounds like muffled/speaker noise). For upsampling, linear
// interpolation is used (no aliasing concern).

/** Resample a mono Float32 track ([-1,1]) from srcRate to dstRate. */
export function resampleF32(src: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (srcRate === dstRate || src.length === 0) return src;

  if (dstRate < srcRate) {
    // Downsampling with box-car anti-aliasing filter.
    const ratio = srcRate / dstRate;
    const outLen = Math.max(1, Math.floor(src.length / ratio));
    const out = new Float32Array(outLen);
    const box = Math.round(ratio); // box filter width
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(start + box, src.length);
      let sum = 0;
      for (let j = start; j < end; j++) sum += src[j];
      out[i] = sum / (end - start);
    }
    return out;
  }

  // Upsampling: linear interpolation.
  const ratio = srcRate / dstRate;
  const outLen = Math.max(1, Math.floor(src.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = src[Math.min(idx, src.length - 1)];
    const b = src[Math.min(idx + 1, src.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** Convert Float32 [-1,1] to Int16. */
export function f32ToPcm16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const s = Math.max(-1, Math.min(1, src[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Convert Int16 PCM to Float32 [-1,1]. */
export function pcm16ToF32(src: Int16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 32768;
  return out;
}