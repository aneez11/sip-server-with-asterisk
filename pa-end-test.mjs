const base = 'http://localhost:3001';
const sec = 'pa-internal-trigger-secret';
async function jfetch(path, opts = {}) {
  const r = await fetch(base + path, { ...opts });
  const t = await r.text(); let b;
  try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // login to fetch endpoints
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const eps = await jfetch('/api/endpoints', { headers: { Cookie: cookie } });
  const ph = (eps.body || []).find((e) => e.type === 'phone');
  const spk = (eps.body || []).filter((e) => e.type === 'speaker').map((e) => e.id);
  console.log('initiator', ph?.label, ph?.extension, 'receivers', spk.length);

  // ensure a group exists
  const groups = await jfetch('/api/pa-groups', { headers: { Cookie: cookie } });
  let g = (groups.body || []).find((x) => x.name === 'Test PA2');
  if (!g) {
    const c = await jfetch('/api/pa-groups', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ name: 'Test PA2', extension: '9101', initiatorEndpointId: ph?.id ?? null, receiverEndpointIds: spk }) });
    g = c.body;
  }
  console.log('group', g.id, 'ext', g.extension);

  // trigger
  const tr = await jfetch('/api/pa-trigger/' + g.extension + '?caller=' + (ph?.extension ?? ''), { headers: { Authorization: 'Bearer ' + sec } });
  console.log('trigger', tr.status, JSON.stringify(tr.body));
  const pageConf = tr.body?.pageConf;
  if (!pageConf) { console.log('no pageConf, abort'); return; }

  // let member legs + announcer set up
  await sleep(4000);
  const confLine = await (await fetch(base + '/x') , true);
  console.log('pageConf', pageConf);

  // Simulate initiator leaving by invoking the listener's pa-initiator-left path.
  // Since we can't drive the phone, call the service directly via a config check.
  // Instead, verify the conf exists via asterisk CLI (outside node).
  console.log('done (check conf via asterisk CLI)');
}
main().catch((e) => console.error('ERR', e.message));
