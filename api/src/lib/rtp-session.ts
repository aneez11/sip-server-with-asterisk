// Minimal RTP session (PCMU/8000, payload type 0) for the operator UA's media
// leg with Asterisk. Sends packetized µ-law frames and receives/decode them.

import dgram from 'node:dgram';
import { pcmToUlaw, ulawToPcm } from './g711.js';

export const RTP_HEADER = 12;
export const FRAME_MS = 20;
export const SAMPLES_PER_FRAME = 160; // 8000 Hz * 20ms

export interface RtpSessionOptions {
  localPort: number;
  remoteHost: string;
  remotePort: number;
  onAudio?: (pcm: Int16Array, seq: number) => void;
}

export class RtpSession {
  readonly socket: dgram.Socket;
  private readonly remoteHost: string;
  private readonly requestedPort: number;
  private remotePort: number;
  private seq = 0;
  private ts = 0;
  private ssrc = Math.floor(Math.random() * 0xffffffff);
  private buf = Buffer.alloc(0);
  private onAudio?: (pcm: Int16Array, seq: number) => void;

  constructor(opts: RtpSessionOptions) {
    this.remoteHost = opts.remoteHost;
    this.requestedPort = opts.localPort;
    this.remotePort = opts.remotePort;
    this.onAudio = opts.onAudio;
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg) => this.onMessage(msg));
  }

  /** Resolves once the UDP socket is bound (bind() is asynchronous). */
  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject);
      this.socket.once('listening', resolve);
      this.socket.bind(this.requestedPort);
    });
  }

  get localPort(): number {
    return this.socket.address().port;
  }

  setRemotePort(port: number): void {
    this.remotePort = port;
  }

  /** Register a receive callback (two-way audio into the browser). */
  setOnAudio(cb: ((pcm: Int16Array, seq: number) => void) | undefined): void {
    this.onAudio = cb;
  }

  /** Send µ-law bytes as one or more 20ms RTP frames. */
  sendUlaw(ulaw: Uint8Array): void {
    for (let off = 0; off < ulaw.length; off += SAMPLES_PER_FRAME) {
      const n = Math.min(SAMPLES_PER_FRAME, ulaw.length - off);
      const hdr = Buffer.alloc(RTP_HEADER);
      hdr[0] = 0x80; // v=2, no padding/extension, csrc=0
      hdr[1] = 0;    // PCMU payload type 0
      hdr.writeUInt16BE(this.seq++, 2);
      hdr.writeUInt32BE(this.ts, 4);
      hdr.writeUInt32BE(this.ssrc, 8);
      const payload = Buffer.from(ulaw.buffer, ulaw.byteOffset + off, n);
      this.socket.send(Buffer.concat([hdr, payload]), this.remotePort, this.remoteHost);
      this.ts += n; // PCMU: timestamp = samples
    }
  }

  /** Convenience: encode Int16 PCM to µ-law and send. */
  sendPcm16(pcm: Int16Array): void {
    this.sendUlaw(pcmToUlaw(pcm));
  }

  close(): void {
    try { this.socket.close(); } catch { /* already closed */ }
  }

  private onMessage(msg: Buffer): void {
    if (msg.length < RTP_HEADER) return;
    const pt = msg[1] & 0x7f;
    const seq = msg.readUInt16BE(2);
    if (pt !== 0) return; // only PCMU handled
    const payload = msg.subarray(RTP_HEADER);
    this.buf = Buffer.concat([this.buf, payload]);
    // Emit complete frames as they accumulate (drop partial tail conservatively).
    while (this.buf.length >= SAMPLES_PER_FRAME) {
      const frame = this.buf.subarray(0, SAMPLES_PER_FRAME);
      this.buf = this.buf.subarray(SAMPLES_PER_FRAME);
      const pcm = ulawToPcm(new Uint8Array(frame));
      this.onAudio?.(pcm, seq);
    }
  }
}
