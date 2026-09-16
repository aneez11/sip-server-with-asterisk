const base = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jfetch(path, opts = {}) {
  const r = await fetch(base + path, { ...opts });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}
async function main() {
  // ensure clean
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345' }) });
  const cookie = login.headers.get('set-cookie') ? login.headers.get('set-cookie').split(';')[0] : '';
  const eps = await jfetch('/api/endpoints', { headers: { Cookie: cookie } });
  const active = Array.isArray(eps.body) ? eps.body.filter((e) => e.isActive && e.registered).map((e) => e.id) : [];
  const anns = await jfetch('/api/announcements', { headers: { Cookie: cookie } });
  const larabara = (anns.body || []).find((a) => a.name === 'larabara');
  console.log('audio duration:', larabara.duration, 's');
  await jfetch('/api/announcements/' + larabara.id + '/play', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ endpointIds: active }) });
  console.log('broadcast started at', new Date().toISOString());
  // Run for 260s or until monitor empty
  const t0 = Date.now();
  let lastSeen = 0;
  while (Date.now() - t0 < 260000) {
    await sleep(10000);
    const m = await jfetch('/api/monitor', { headers: { Cookie: cookie } });
    const act = m.body.active;
    if (act.length) { lastSeen = (Date.now() - t0) / 1000; console.log('still active at', Math.round(lastSeen) + 's'); }
    else { console.log('broadcast ended; last seen at', Math.round(lastSeen) + 's, waited', Math.round((Date.now()-t0)/1000) + 's'); break; }
  }
  console.log('done');
}
main().catch((e) => console.error('ERR', e.message));
