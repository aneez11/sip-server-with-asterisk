import net from 'node:net';
const base = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jfetch(path, opts = {}) {
  const r = await fetch(base + path, { ...opts });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}

class Ami {
  constructor(){ this.buf=''; this.id=0; this.sock=net.createConnection({host:'asterisk',port:5038}); this.sock.on('data',c=>this.onData(c)); this.sock.on('connect',()=>this.send('Action: Login\r\nUsername: broadcastapi\r\nSecret: abd0c26f1e947583\r\nEvents: on\r\n\r\n')); this.marked=''; }
  onData(c){ this.buf+=c.toString(); let i; while((i=this.buf.indexOf('\r\n\r\n'))!==-1){ const m=this.buf.slice(0,i); this.buf=this.buf.slice(i+4); this.parse(m);} }
  parse(m){ const k={}; for(const l of m.split('\r\n')){ const j=l.indexOf(':'); if(j>0) k[l.slice(0,j).trim()]=l.slice(j+1).trim(); } if(k.ApplicationData && k.ApplicationData.includes('paging_caller')) this.marked=k.Channel; }
  send(s){ this.sock.write(s); }
  originate(o){ let s='Action: Originate\r\nActionID: O'+(++this.id)+'\r\n'; for(const [k,v] of Object.entries(o)) s+=`${k}: ${v}\r\n`; s+='\r\n'; this.send(s); }
}

async function main(){
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345' }) });
  const cookie = login.headers.get('set-cookie') ? login.headers.get('set-cookie').split(';')[0] : '';

  const tr = await jfetch('/api/pa-trigger/9500?caller=2000', { headers: { Authorization: 'Bearer pa-internal-trigger-secret' } });
  const pageConf = tr.body?.pageConf;
  console.log('trigger', tr.status, 'conf', pageConf);
  if (!pageConf) return;

  const ami = new Ami();
  await sleep(8000);

  // Simulate initiator joining as marked paging_caller.
  ami.originate({ Channel:'PJSIP/operator-ua', Application:'ConfBridge', Data:`${pageConf},paging_bridge,paging_caller`, Variable:`PAGE_CONF=${pageConf}`, Async:'true' });
  await sleep(3000);
  console.log('marked channel:', ami.marked || '(none)');

  // Check monitor shows the call active.
  const m1 = await jfetch('/api/monitor', { headers: { Cookie: cookie } });
  console.log('monitor before hangup:', m1.body.active ? JSON.stringify(m1.body.active.map((a)=>({id:a.id, members:a.members}))) : 'EMPTY');

  // Hang up the initiator -> triggers onInitiatorLeft -> pa_end + teardown.
  if (ami.marked) { console.log('hanging up initiator:', ami.marked); ami.send('Action: Hangup\r\nChannel: '+ami.marked+'\r\n\r\n'); }
  await sleep(6000);

  const m2 = await jfetch('/api/monitor', { headers: { Cookie: cookie } });
  console.log('monitor after hangup:', m2.body.active ? JSON.stringify(m2.body.active.map((a)=>({id:a.id, members:a.members}))) : 'EMPTY');

  // Check channels dropped.
  const ch = await fetch(base + '/x').catch(()=>null);
  console.log('done');
  process.exit(0);
}
main().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
