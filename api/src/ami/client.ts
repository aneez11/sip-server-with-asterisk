import net from 'node:net';
import { EventEmitter } from 'node:events';

export interface AmiMessage {
  name: string;
  keys: Record<string, string>;
  actionId?: string;
  isEvent: boolean;
}

export interface AmiActionParams {
  [key: string]: string | number;
}

const EVENT_LIST_COMPLETE = ['ContactListComplete', 'CoreShowChannelsComplete', 'DBGetResponse'];

/**
 * Minimal raw AMI client: TCP connect, login, actions with ActionID matching,
 * list-event collection, reconnect with backoff. This is the ONLY module that
 * talks to Asterisk.
 */
export class AmiClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private seq = 0;
  private pending = new Map<string, { resolve: (m: AmiMessage) => void; reject: (e: Error) => void; list?: boolean }>();
  private connected = false;
  private backoff = 1000;
  private stopping = false;

  constructor(private readonly opts: { host: string; port: number; username: string; secret: string }) {
    super();
  }

  start(): void {
    void this.connect();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.opts.host, port: this.opts.port }, () => {
        this.connected = true;
        this.backoff = 1000;
        void this.login().then(() => {
          this.emit('ready');
          resolve();
        }).catch(reject);
      });
      sock.setKeepAlive(true);
      sock.on('data', (chunk) => this.onData(chunk));
      sock.on('close', () => {
        this.connected = false;
        this.socket = null;
        this.failPending(new Error('AMI connection closed'));
        this.emit('close');
        if (!this.stopping) {
          setTimeout(() => void this.connect(), this.backoff);
          this.backoff = Math.min(this.backoff * 2, 15000);
        }
      });
      sock.on('error', (err) => {
        this.emit('error', err);
        sock.destroy();
      });
      this.socket = sock;
    });
  }

  private login(): Promise<void> {
    return this.sendAction(
      { Action: 'Login', Username: this.opts.username, Secret: this.opts.secret, Events: 'on' },
      5000,
    ).then(() => undefined);
  }

  private nextId(): string {
    this.seq += 1;
    return `ie-${this.seq}-${Date.now()}`;
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = this.buffer.indexOf('\r\n\r\n')) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 4);
      this.parseMessage(raw);
    }
    if (this.buffer.length > 1024 * 1024) this.buffer = '';
  }

  private parseMessage(raw: string): void {
    const keys: Record<string, string> = {};
    for (const line of raw.split('\r\n')) {
      const sep = line.indexOf(':');
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      if (key === 'Event') keys.event = value;
      else if (key === 'ActionID') keys.actionid = value;
      else keys[key.toLowerCase()] = value;
    }

    const actionId = keys.actionid;
    const isEvent = keys.event !== undefined;

    if (isEvent) {
      const msg: AmiMessage = { name: keys.event, keys, actionId, isEvent: true };

      if (actionId && this.pending.has(actionId) && this.pending.get(actionId)!.list) {
        const p = this.pending.get(actionId)!;
        if (EVENT_LIST_COMPLETE.includes(msg.name)) {
          this.pending.delete(actionId);
          p.resolve({ name: msg.name, keys, actionId, isEvent: true });
        }
        this.emit('listEvent', msg);
      }
      this.emit('event', msg);
      return;
    }

    const msg: AmiMessage = { name: keys.response ?? 'Unknown', keys, actionId, isEvent: false };

    if (actionId && this.pending.has(actionId)) {
      const p = this.pending.get(actionId)!;
      if (p.list) {
        this.pending.get(actionId)!.resolve(msg);
      } else {
        this.pending.delete(actionId);
        p.resolve(msg);
      }
    } else {
      this.emit('response', msg);
    }
  }

  private failPending(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private sendAction(params: AmiActionParams, timeoutMs = 8000, list = false, explicitId?: string): Promise<AmiMessage> {
    const actionId = explicitId ?? this.nextId();
    const lines = [`ActionID: ${actionId}`];
    for (const [k, v] of Object.entries(params)) lines.push(`${k}: ${v}`);
    const payload = lines.join('\r\n') + '\r\n\r\n';

    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('AMI not connected'));
      this.pending.set(actionId, { resolve, reject, list });
      this.socket.write(payload, (err) => {
        if (err) {
          this.pending.delete(actionId);
          reject(err);
        }
      });
      setTimeout(() => {
        if (this.pending.has(actionId)) {
          this.pending.delete(actionId);
          reject(new Error(`AMI action ${params.Action} timed out`));
        }
      }, timeoutMs);
    });
  }

  /** Fire-and-forget action (originate etc). */
  action(params: AmiActionParams): Promise<AmiMessage> {
    return this.sendAction(params);
  }

  /** Hang up a specific channel (used to hard-stop music paging). */
  async hangup(channel: string): Promise<boolean> {
    try {
      const resp = await this.action({ Action: 'Hangup', Channel: channel });
      return (resp.keys.response ?? '').toLowerCase() === 'success';
    } catch {
      return false;
    }
  }

  /** List active channel names via CoreShowChannels. */
  async coreShowChannels(): Promise<string[]> {
    const channels: string[] = [];
    const id = this.nextId();

    return new Promise<string[]>((resolve, reject) => {
      const cleanup = () => {
        this.off('listEvent', collect);
        this.pending.delete(id);
      };
      const collect = (msg: AmiMessage) => {
        if (msg.actionId !== id) return;
        if (msg.name === 'CoreShowChannel') {
          if (msg.keys.channel) {
            // Include the application + data so channel lines carrying a
            // ConfBridge conference name (needed for sweep liveness checks)
            // are visible in the returned strings.
            const app = msg.keys.application ?? msg.keys.appl ?? '';
            const data = msg.keys.applicationdata ?? msg.keys.data ?? '';
            channels.push(`${msg.keys.channel}|${app}|${data}`);
          }
        } else if (msg.name === 'CoreShowChannelsComplete') {
          cleanup();
          resolve(channels);
        }
      };
      this.on('listEvent', collect);
      this.sendAction({ Action: 'CoreShowChannels' }, 10000, true, id)
        .then((resp) => {
          if (resp.keys.response?.toLowerCase() === 'error') {
            cleanup();
            resolve(channels);
          }
        })
        .catch((err) => {
          cleanup();
          reject(err);
        });
    });
  }

  /** Negotiated codec for an answered channel via AMI Status. */
  async channelCodec(channel: string): Promise<{ read: string; write: string } | null> {
    const id = this.nextId();
    return new Promise<{ read: string; write: string } | null>((resolve) => {
      let done = false;
      const finish = (v: { read: string; write: string } | null) => {
        if (done) return;
        done = true;
        this.off('listEvent', collect);
        this.pending.delete(id);
        resolve(v);
      };
      const collect = (msg: AmiMessage) => {
        if (msg.actionId !== id) return;
        if (msg.name === 'Status') {
          finish({
            read: msg.keys.readcodec ?? msg.keys.readformat ?? '',
            write: msg.keys.writecodec ?? msg.keys.writeformat ?? '',
          });
        } else if (msg.name === 'StatusComplete') {
          finish(null);
        }
      };
      this.on('listEvent', collect);
      this.sendAction({ Action: 'Status', Channel: channel }, 10000, true, id)
        .then((resp) => {
          if ((resp.keys.response ?? '').toLowerCase() === 'error') finish(null);
        })
        .catch(() => finish(null));
    });
  }

  /** List action: resolves on the *Complete event, events via 'listEvent'. */
  listAction(params: AmiActionParams, completeEvent: string): Promise<AmiMessage> {
    return this.sendAction(params, 10000, true).then((m) =>
      m.name === completeEvent ? m : m,
    );
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Collects registered PJSIP contacts: extension -> contact URI + user agent. */
  async pjsipShowContacts(): Promise<Map<string, { uri: string; userAgent: string }>> {
    const contacts = new Map<string, { uri: string; userAgent: string }>();
    const id = this.nextId();

    return new Promise<Map<string, { uri: string; userAgent: string }>>((resolve, reject) => {
      const cleanup = () => {
        this.off('listEvent', collect);
        this.pending.delete(id);
      };
      const collect = (msg: AmiMessage) => {
        if (msg.actionId !== id) return;
        if (msg.name === 'ContactList') {
          const uri = msg.keys.uri ?? msg.keys.contacturi ?? '';
          const m = /^sip:(\d+)@/.exec(uri);
          if (m) contacts.set(m[1], { uri, userAgent: msg.keys.useragent ?? '' });
        } else if (msg.name === 'ContactListComplete') {
          cleanup();
          resolve(contacts);
        }
      };
      this.on('listEvent', collect);
      this.sendAction({ Action: 'PJSIPShowContacts' }, 10000, true, id)
        .then((resp) => {
          // Asterisk replies "Response: Error - No Contacts found" (with NO
          // ContactListComplete) when the contact list is empty.
          if (resp.keys.response?.toLowerCase() === 'error') {
            cleanup();
            resolve(contacts);
          }
        })
        .catch((err) => {
          cleanup();
          reject(err);
        });
    });
  }

  stop(): void {
    this.stopping = true;
    if (this.socket) this.socket.destroy();
  }
}
