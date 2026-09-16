// Live talk audio path test — connects to the API's socket.io, starts a live
// talk, and streams a PCM tone to verify the browser->API->RTP->Asterisk path.
// Run: node scripts/test-talk-audio.mjs <endpointId>
import { io } from 'socket.io-client';

const BASE = 'http://127.0.0.1:3001';
const endpointId = Number(process.argv[2] ?? 1);

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'admin12345' }),
});
if (!login.ok) throw new Error(`login failed ${login.status}`);
const cookie = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie')])
  .map((c) => c.split(';')[0])
  .join('; ');

const start = await fetch(`${BASE}/api/talk/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ endpointIds: [endpointId] }),
});
if (!start.ok) throw new Error(`talk start failed ${start.status}: ${await start.text()}`);
const session = await start.json();
console.log('talk started:', session.id, session.mode);

const sock = io(BASE, { transports: ['websocket'] });
sock.on('connect', () => {
  sock.emit('talk:join', session.id);
  console.log('joined socket', session.id);

  // Generate a continuous 440 Hz sine at 48k, stream as Int16 chunks.
  const rate = 48000;
  const chunk = 2048;
  const seconds = Number(process.argv[3] ?? 1.2);
  let sent = 0;
  const total = Math.floor(rate * seconds);
  const tone = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    tone[i] = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000);
  }
  const timer = setInterval(() => {
    const n = Math.min(chunk, total - sent);
    if (n <= 0) {
      clearInterval(timer);
      console.log('finished streaming tone, bytes:', sent);
      // Don't call sock.close() here — Node on Windows crashes with a UV
      // assertion when the socket is closed during an active send.
      setTimeout(() => process.exit(0), 1000);
      return;
    }
    const buf = tone.buffer.slice(sent * 2, (sent + n) * 2);
    sock.emit('talk:audio', { talkId: session.id, rate, data: buf });
    sent += n;
  }, 30);
});

sock.on('talk:audio', (p) => {
  console.log('received talk audio from API (two-way):', p.data?.byteLength ?? 0, 'bytes');
});

sock.on('connect_error', (e) => { console.error('socket error', e.message); process.exit(1); });
setTimeout(() => { console.log('timeout'); process.exit(2); }, 20000);
