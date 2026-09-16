import { execFile } from 'node:child_process';
import path from 'node:path';

/**
 * Audio asset pipeline — normalizes every announcement/music/live-talk upload
 * (WAV or MP3) to 8 kHz mono PCM16 WAV, the format this Asterisk build's WAV
 * decoder accepts (16 kHz WAV is rejected: "Unexpected frequency mismatch
 * 16000 (expecting 8000)" → Playback fails to open the file).
 *
 * ffmpeg auto-detects the input container/codec, so a single command handles
 * both WAV and MP3 sources. Only the file extension is validated here.
 */

export const ALLOWED_AUDIO_EXTENSIONS = ['.wav', '.mp3'];

/** Normalized output: 8 kHz mono PCM16 — 16000 bytes/sec. */
export const NORMALIZED_BYTES_PER_SECOND = 8000 * 2;

export function validateAudioExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_AUDIO_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported upload format: ${ext}. Only .wav and .mp3 accepted.`);
  }
  return ext;
}

export function normalizeAudioTo8k(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-i', inputPath, '-ar', '8000', '-ac', '1', '-acodec', 'pcm_s16le', '-y', outputPath],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const detail = String(stderr ?? err.message).split('\n').filter(Boolean).slice(-3).join(' | ');
          reject(new Error(`ffmpeg conversion failed: ${detail}`));
          return;
        }
        resolve();
      },
    );
  });
}

/** Duration (seconds) of an audio file via ffprobe. Resolves null on failure. */
export function audioDurationSeconds(filePath: string): Promise<number | null> {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) { resolve(null); return; }
        const s = parseFloat(String(stdout).trim());
        resolve(Number.isFinite(s) ? s : null);
      },
    );
  });
}
