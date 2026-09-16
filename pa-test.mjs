const base = 'http://localhost:3001';
async function jfetch(path, opts = {}) {
  const r = await fetch(base + path, { ...opts });
  const t = await r.text(); let b;
  try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}
async function main() {
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345' }) });
  const cookie = login.headers.get('set-cookie') ? login.headers.get('set-cookie').split(';')[0] : '';
  if (!cookie) { console.error('no cookie'); return; }

  const eps = await jfetch('/api/endpoints', { headers: { Cookie: cookie } });
  if (!Array.isArray(eps.body)) { console.error('endpoints not array', eps.status, JSON.stringify(eps.body).slice(0,120)); return; }
  const ph = eps.body.find((e) => e.type === 'phone') || eps.body[0];
  const spk = eps.body.filter((e) => e.type === 'speaker').map((e) => e.id);
  console.log('initiator:', ph.label, ph.extension, '| receivers:', spk.length);

  // Create group: initiator = first phone, receivers = speakers, ext 9100
  const group = await jfetch('/api/pa-groups', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name: 'Test PA', extension: '9100', initiatorEndpointId: ph.id, paStartAnnouncementId: null, paEndAnnouncementId: null, receiverEndpointIds: spk }) });
  console.log('create group', group.status, JSON.stringify(group.body).slice(0,300));

  // Trigger via internal token
  const tr = await jfetch('/api/pa-trigger/9100?caller=' + ph.extension, { headers: { Authorization: 'Bearer pa-internal-trigger-secret' } });
  console.log('trigger', tr.status, JSON.stringify(tr.body));
  console.log('done');
}
main().catch((e) => console.error('ERR', e.message));
