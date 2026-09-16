const base = 'http://localhost:3001';
const r = await fetch(base + '/api/pa-trigger/9500?caller=2000', { headers: { Authorization: 'Bearer pa-internal-trigger-secret' } });
console.log('trigger', r.status, (await r.text()).slice(0, 120));
