import { config } from '/app/api/dist/config.js';
const base = 'http://localhost:3001';
console.log('resolved secret =', JSON.stringify(config.paTriggerSecret));
const ext = '9100';
const r = await fetch(base + '/api/pa-trigger/' + ext + '?caller=2000', { headers: { Authorization: `Bearer ${config.paTriggerSecret}` } });
const t = await r.text();
console.log('status', r.status, t.slice(0, 200));
