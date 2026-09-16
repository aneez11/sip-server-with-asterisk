/**
 * Talk capture AudioWorklet processor.
 *
 * MediaRecorder outputs WebM/Opus, which Asterisk cannot play — so live talk
 * needs raw PCM. This processor runs on the audio thread and posts raw
 * Float32 sample blocks (~128 samples) back to the main thread, where the
 * recorder encodes them into a real 16-bit PCM WAV (downconverted to 8 kHz
 * mono by the API's normalizeWav before Playback).
 *
 * No imports: worklet modules run in a restricted global scope.
 * Messages FROM main: { type: 'set-block-size', size } before start.
 */
class TalkCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blockSize = 128;
    this.pending = [];
    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg && msg.type === 'set-block-size' && typeof msg.size === 'number' && msg.size > 0) {
        this.blockSize = Math.floor(msg.size);
      }
    };
  }

  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;

    for (let i = 0; i < input.length; i++) {
      let v = input[i];
      if (v > 1) v = 1;
      else if (v < -1) v = -1;
      this.pending.push(v);
    }

    while (this.pending.length >= this.blockSize) {
      const chunk = new Float32Array(this.blockSize);
      for (let i = 0; i < this.blockSize; i++) chunk[i] = this.pending[i];
      this.pending.splice(0, this.blockSize);
      this.port.postMessage(chunk, [chunk.buffer]);
    }
    return true;
  }
}

registerProcessor('talk-capture', TalkCaptureProcessor);
