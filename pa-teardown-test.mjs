// Verify PA teardown: trigger a real PA via API, add a marked initiator leg,
// hang it up, and confirm the API plays pa_end + tears down (check logs/conf).
import net from 'node:net';

const base = 'http://localhost:3001';
const sec = 'pa-internal-trigger-secret';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Ami {
  constructor(){ this.buf=''; this.id=0; this.sock=net.createConnection({host:'asterisk',port:5038}); this.sock.on('data',c=>this.onData(c)); this.sock.on('connect',()=>this.send('Action: Login\r\nUsername: broadcastapi\r\nSecret: abd0c26f1e947583\r\nEvents: on\r\n\r\n')); this.events=[]; this.waiters=[]; }
  onData(c){ this.buf+=c.toString(); let i; while((i=this.buf.indexOf('\r\n\r\n'))!==-1){ const m=this.buf.slice(0,i); this.buf=this.buf.slice(i+4); this.parse(m);} }
  parse(m){ const k={}; for(const l of m.split('\r\n')){ const j=l.indexOf(':'); if(j>0) k[l.slice(0,j).trim()]=l.slice(j+1).trim(); } this.events.push(k); for(const w of [...this.waiters]) if(w(k)){ this.waiters.splice(this.waiters.indexOf(w),1);} }
  send(s){ this.sock.write(s); }
  waitEvent(name, timeout=15000){ return new Promise((res,rej)=>{ const w=(k)=>{ if(k.Event===name){ res(k); return true; } return false; }; this.waiters.push(w); setTimeout(()=>rej(new Error('timeout '+name)),timeout); }); }
  originate(o){ let s='Action: Originate\r\nActionID: O'+(++this.id)+'\r\n'; for(const [k,v] of Object.entries(o)) s+=`${k}: ${v}\r\n`; s+='\r\n'; this.send(s); }
  hangup(ch){ this.send('Action: Hangup\r\nChannel: '+ch+'\r\n\r\n'); }
}

async function jfetch(path, opts = {}) {
  const r = await fetch(base + path, { ...opts });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}

async function main(){
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345' }) });
  const cookie = login.headers.get('set-cookie') ? login.headers.get('set-cookie').split(';')[0] : '';
  const eps = await jfetch('/api/endpoints', { headers: { Cookie: cookie } });
  const ph = (eps.body||[]).find(e=>e.type==='phone');
  const spk = (eps.body||[]).filter(e=>e.type==='speaker').map(e=>e.id);
  console.log('initiator', ph?.extension, 'receivers', spk.length);

  const tr = await jfetch('/api/pa-trigger/9101?caller='+(ph?.extension??''), { headers: { Authorization: 'Bearer '+sec } });
  console.log('trigger', tr.status, JSON.stringify(tr.body));
  const pageConf = tr.body?.pageConf;
  if (!pageConf) { console.log('no pageConf'); return; }

  const ami = new Ami();
  await sleep(1200);

  // Add the initiator as the marked speaker (paging_caller) into the same conf.
  ami.originate({ Channel:'Local/announce@pa-bridge', Application:'ConfBridge', Data:`${pageConf},paging_bridge,paging_caller`, Variable:`PAGE_CONF=${pageConf}`, Async:'true' });
  await sleep(2500);
  console.log('initiator marked leg originated; waiting for it to join...');

  // Find the marked caller channel and hang it up (simulate initiator hanging up).
  const marked = ami.events.find(e => (e.ApplicationData||'').includes(',paging_caller') && e.Channel);
  if (marked) { console.log('found marked channel', marked.Channel, 'hanging up...'); ami.hangup(marked.Channel); }
  else { console.log('no marked channel found'); }

  await sleep(3000);
  console.log('teardown triggered; check conf + api logs');
  process.exit(0);
}
main().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
