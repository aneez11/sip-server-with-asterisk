// Minimal SIP user agent for the operator media leg. Enough to place a call
// into Asterisk (INVITE/ACK/BYE, 100/180/200) and negotiate PCMU RTP — no
// registration, no NAT/TLS (LAN-only). Media is carried by RtpSession.

import dgram from 'node:dgram';

export interface SipUaOptions {
  localIp: string;
  fromUser: string;
  asteriskHost: string;
  asteriskPort?: number;
}

export interface SipCallOptions {
  target: string;
  rtpPort: number;
  /** Channel variables applied to the inbound call via X-Asterisk-Variable. */
  variables?: Record<string, string>;
  timeoutMs?: number;
  onRinging?: () => void;
}

interface CallState {
  callId: string;
  localTag: string;
  toTag: string | null;
  cseq: number;
  remoteSdp: string | null;
  target: string;
  remoteContact: string | null;
}

function makeSdp(localIp: string, rtpPort: number): string {
  const ts = Math.floor(Date.now() / 1000);
  return [
    'v=0',
    `o=- ${ts} ${ts} IN IP4 ${localIp}`,
    's=-',
    `c=IN IP4 ${localIp}`,
    't=0 0',
    `m=audio ${rtpPort} RTP/AVP 0`,
    'a=rtpmap:0 PCMU/8000',
    'a=sendrecv',
    '',
  ].join('\r\n');
}

function parseSdpPort(sdp: string): number | null {
  const m = /m=audio\s+(\d+)/.exec(sdp);
  return m ? Number(m[1]) : null;
}

function parseResponse(buf: Buffer): { status: number; reason: string; headers: Record<string, string>; body: string } {
  const text = buf.toString('utf8');
  const lines = text.split('\r\n');
  const first = lines[0] ?? '';
  const [, statusStr] = /^SIP\/2\.0\s+(\d+)\s+(.*)$/.exec(first) ?? [];
  const headers: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') break;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (name === 'from' || name === 'to' || name === 'via') {
      headers[name] = (headers[name] ? headers[name] + ', ' : '') + value;
    } else if (!(name in headers)) {
      headers[name] = value;
    }
  }
  const body = lines.slice(i + 1).join('\r\n');
  return { status: Number(statusStr ?? 0), reason: (statusStr ? '' : first) ?? '', headers, body };
}

export class SipUa {
  private readonly localIp: string;
  private readonly fromUser: string;
  private readonly asteriskHost: string;
  private readonly asteriskPort: number;
  private socket: dgram.Socket | null = null;
  private state: CallState | null = null;
  private settled = false;

  constructor(opts: SipUaOptions) {
    this.localIp = opts.localIp;
    this.fromUser = opts.fromUser;
    this.asteriskHost = opts.asteriskHost;
    this.asteriskPort = opts.asteriskPort ?? 5060;
  }

  private get localPort(): number {
    return this.socket ? this.socket.address().port : 0;
  }

  /** Place a call; resolves with the negotiated remote RTP port on 200 OK. */
  call(opts: SipCallOptions): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const callId = `${Math.floor(Math.random() * 1e12)}@${this.localIp}`;
      const localTag = `${Math.floor(Math.random() * 1e8)}`;
      const state: CallState = { callId, localTag, toTag: null, cseq: Math.floor(Math.random() * 100) + 1, remoteSdp: null, target: opts.target, remoteContact: null };
      this.state = state;
      this.settled = false;

      const sock = dgram.createSocket('udp4');
      this.socket = sock;
      sock.bind(0);
      sock.on('message', (msg) => this.onMessage(msg, opts, resolve, reject));
      sock.on('error', (err) => { this.cleanup(); reject(err); });

      sock.once('listening', () => {
        this.sendInvite(opts);
        const timeoutMs = opts.timeoutMs ?? 15000;
        setTimeout(() => {
          if (!this.settled) {
            this.sendCancel();
            this.cleanup();
            reject(new Error('SIP call timed out'));
          }
        }, timeoutMs);
      });
    });
  }

  /** Send BYE / CANCEL and close the signaling socket. */
  hangup(): void {
    if (!this.socket || !this.state) return;
    const s = this.state;
    if (this.settled) {
      const bye = this.buildRequest('BYE', s);
      this.socket.send(bye, this.asteriskPort, this.asteriskHost);
    } else {
      this.sendCancel();
    }
    // Delay cleanup so the BYE/CANCEL datagram flushes before the socket closes.
    setTimeout(() => this.cleanup(), 300);
  }

  private buildRequest(method: string, s: CallState, extraHeaders = ''): Buffer {
    const toTag = s.toTag ? `;tag=${s.toTag}` : '';
    // BYE/CANCEL go to the remote Contact captured from the 200 OK; fall back
    // to the original callee URI.
    const target = s.remoteContact ?? `sip:${s.target}@${this.asteriskHost}`;
    const lines = [
      `${method} ${target} SIP/2.0`,
      `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};branch=z9hG4bK-${Math.floor(Math.random() * 1e10)};rport`,
      `From: <sip:${this.fromUser}@${this.localIp}>;tag=${s.localTag}`,
      `To: <sip:${s.target}@${this.asteriskHost}>${toTag}`,
      `Call-ID: ${s.callId}`,
      `CSeq: ${s.cseq} ${method}`,
      'Max-Forwards: 70',
      `Contact: <sip:${this.fromUser}@${this.localIp}:${this.localPort}>`,
      extraHeaders,
      '',
      '',
    ];
    return Buffer.from(lines.join('\r\n'));
  }

  private sendInvite(opts: SipCallOptions): void {
    if (!this.socket || !this.state) return;
    const s = this.state;
    const sdp = makeSdp(this.localIp, opts.rtpPort);
    const varHeaders = opts.variables
      ? Object.entries(opts.variables).map(([k, v]) => `X-Asterisk-Variable: ${k}=${v}`).join('\r\n')
      : '';
    const head = [
      `INVITE sip:${opts.target}@${this.asteriskHost} SIP/2.0`,
      `Via: SIP/2.0/UDP ${this.localIp}:${this.localPort};branch=z9hG4bK-${Math.floor(Math.random() * 1e10)};rport`,
      `From: <sip:${this.fromUser}@${this.localIp}>;tag=${s.localTag}`,
      `To: <sip:${opts.target}@${this.asteriskHost}>`,
      `Call-ID: ${s.callId}`,
      `CSeq: ${s.cseq} INVITE`,
      'Max-Forwards: 70',
      `Contact: <sip:${this.fromUser}@${this.localIp}:${this.localPort}>`,
      'Content-Type: application/sdp',
      `Content-Length: ${Buffer.byteLength(sdp)}`,
      varHeaders ? varHeaders : undefined,
      '',
      sdp,
    ].filter((l): l is string => l !== undefined);
    this.socket.send(Buffer.from(head.join('\r\n')), this.asteriskPort, this.asteriskHost);
  }

  private sendCancel(): void {
    if (!this.socket || !this.state) return;
    this.socket.send(this.buildRequest('CANCEL', this.state), this.asteriskPort, this.asteriskHost);
  }

  private onMessage(
    msg: Buffer,
    opts: SipCallOptions,
    resolve: (port: number) => void,
    reject: (err: Error) => void,
  ): void {
    if (!this.state) return;
    const s = this.state;
    const resp = parseResponse(msg);
    const method = resp.headers['cseq']?.split(' ')[1];
    const callId = resp.headers['call-id'];
    if (callId !== s.callId) return;

    if (method === 'BYE' && resp.status === 0) {
      // Incoming BYE — answer 200 and treat as ended.
      this.socket?.send(this.buildRequest('BYE', s), this.asteriskPort, this.asteriskHost);
      this.settled = true;
      this.cleanup();
      return;
    }

    if (resp.status === 180 || resp.status === 183) {
      opts.onRinging?.();
      return;
    }

    if (resp.status === 200) {
      s.cseq += 1;
      const toTag = /;tag=([^;\s]+)/.exec(resp.headers['to'] ?? '');
      if (toTag) s.toTag = toTag[1];
      s.remoteSdp = resp.body;
      s.remoteContact = resp.headers['contact'] ?? null;
      const port = parseSdpPort(resp.body);
      this.socket?.send(this.buildRequest('ACK', s), this.asteriskPort, this.asteriskHost);
      this.settled = true;
      if (port != null) resolve(port);
      else reject(new Error('200 OK without audio port'));
      return;
    }

    if (resp.status >= 300) {
      this.settled = true;
      this.cleanup();
      reject(new Error(`SIP ${resp.status} ${resp.reason}`));
    }
  }

  private cleanup(): void {
    if (this.socket) {
      try { this.socket.close(); } catch { /* noop */ }
      this.socket = null;
    }
    this.state = null;
  }
}
