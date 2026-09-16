const base = 'http://localhost:3001';
async function main() {
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345' }) });
  const cookie = login.headers.get('set-cookie') ? login.headers.get('set-cookie').split(';')[0] : '';
  const overview = await fetch(base + '/api/status/overview', { headers: { Cookie: cookie } });
  const text = await overview.text();
  console.log('status', overview.status);
  console.log('body head', text.slice(0, 200));
}
main().catch((e) => console.error('ERR', e.message));
