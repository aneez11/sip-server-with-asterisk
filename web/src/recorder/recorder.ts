// Live talk media helpers: continuous mic capture (AudioWorklet -> raw PCM
// chunks streamed to the API) and received-audio playback for two-way calls.
//
// MediaRecorder cannot be used — it emits WebM/Opus, which the RTP leg cannot
// carry. The worklet posts raw Float32 blocks; we convert to Int16 and hand each
// chunk to the caller, which streams it to the API over Socket.IO.

let audioCtx: AudioContext | null = null;
let captureNode: AudioWorkletNode | null = null;
let source: MediaStreamAudioSourceNode | null = null;
let stream: MediaStream | null = null;
let player: AudioContext | null = null;
let playerNext = 0;

const WORKLET_URL = new URL('./talk-capture.worklet.js', import.meta.url);

export interface LiveTalkHandlers {
  onLevel?: (level: number) => void;
  /** Called with each mic block (Int16 mono at the AudioContext sample rate). */
  onChunk: (pcm: Int16Array, rate: number) => void;
}

function f32ToPcm16(src: Float32Array): Int16Array {
  const out = new Int16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const s = Math.max(-1, Math.min(1, src[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export const liveTalk = {
  start: async (handlers: LiveTalkHandlers): Promise<void> => {
    if (audioCtx) return;
    const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    try {
      await ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (e) {
      ctx.close().catch(() => undefined);
      micStream.getTracks().forEach((t) => t.stop());
      throw new Error('AudioWorklet unavailable — please use a current browser');
    }
    await ctx.resume();

    const node = new AudioWorkletNode(ctx, 'talk-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.postMessage({ type: 'set-block-size', size: 2048 });
    node.port.onmessage = (e) => {
      const data = e.data as Float32Array;
      if (handlers.onLevel) {
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          const a = Math.abs(data[i]);
          if (a > peak) peak = a;
        }
        handlers.onLevel(peak);
      }
      handlers.onChunk(f32ToPcm16(data), ctx.sampleRate);
    };

    source = ctx.createMediaStreamSource(micStream);
    source.connect(node);

    stream = micStream;
    audioCtx = ctx;
    captureNode = node;
  },

  stop: (): void => {
    if (captureNode) captureNode.port.onmessage = null;
    if (source) source.disconnect();
    if (audioCtx) void audioCtx.close().catch(() => undefined);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    captureNode = null;
    source = null;
    audioCtx = null;
    stream = null;
  },

  /** Play received PCM (two-way) — chunks are queued and scheduled seamlessly. */
  play: (pcm: Int16Array, rate: number): void => {
    if (pcm.length === 0) return;
    if (!player) {
      player = new AudioContext();
      playerNext = player.currentTime + 0.12;
    }
    if (player.state === 'suspended') void player.resume();
    const f32 = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
    const buf = player.createBuffer(1, pcm.length, rate);
    buf.copyToChannel(f32, 0);
    const src = player.createBufferSource();
    src.buffer = buf;
    src.connect(player.destination);
    if (player.currentTime > playerNext) playerNext = player.currentTime + 0.04;
    src.start(playerNext);
    playerNext += buf.duration;
  },

  close: (): void => {
    liveTalk.stop();
    if (player) { void player.close().catch(() => undefined); player = null; playerNext = 0; }
  },
};
