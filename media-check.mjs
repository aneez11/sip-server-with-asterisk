const base = 'http://localhost:3001';
async function main() {
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345' }) });
  const cookie = login.headers.get('set-cookie') ? login.headers.get('set-cookie').split(';')[0] : '';
  const r = await fetch(base + '/api/media', { headers: { Cookie: cookie } });
  const j = await r.json();
  console.log('media status', r.status, 'count', Array.isArray(j) ? j.length : 'ERR');
  if (Array.isArray(j)) console.log(j.map((m) => `${m.name}${m.music ? '(music)' : ''}:${m.duration ?? '?'}s`).join(' | '));
}
main().catch((e) => console.error('ERR', e.message));
