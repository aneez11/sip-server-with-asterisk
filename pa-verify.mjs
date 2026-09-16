import net from 'node:net';
const base = 'http://localhost:3001';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jfetch(path, opts = {}) {
  const r = await fetch(base + path, { ...opts });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}

class Ami {
  constructor(){ this.buf=''; this.id=0; this.sock=net.createConnection({host:'asterisk',port:5038}); this.sock.on('data',c=>this.onData(c)); this.sock.on('connect',()=>this.send('Action: Login\r\nUsername: broadcastapi\r\nSecret: abd0c26f1e947583\r\nEvents: on\r\n\r\n')); }
  onData(c){ this.buf+=c.toString(); let i; while((i=this.buf.indexOf('\r\n\r\n'))!==-1){ const m=this.buf.slice(0,i); this.buf=this.buf.slice(i+4); this.events.push(m);} }
  send(s){ this.sock.write(s); }
  originate(o){ let s='Action: Originate\r\nActionID: O'+(++this.id)+'\r\n'; for(const [k,v] of Object.entries(o)) s+=`${k}: ${v}\r\n`; s+='\r\n'; this.send(s); }
  hangup(ch){ this.send('Action: Hangup\r\nChannel: '+ch+'\r\n\r\n'); }
}

async function main(){
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin12345' }) });
  const cookie = login.headers.get('set-cookie') ? login.headers.get('set-cookie').split(';')[0] : '';

  const tr = await jfetch('/api/pa-trigger/9500?caller=2000', { headers: { Authorization: 'Bearer pa-internal-trigger-secret' } });
  const pageConf = tr.body?.pageConf;
  console.log('trigger conf', pageConf);
  if (!pageConf) return;

  const ami = new Ami(); ami.events=[];
  await sleep(8000);

  const m1 = await jfetch('/api/monitor', { headers: { Cookie: cookie } });
  console.log('monitor before:', m1.body.active ? m1.body.active.map((a)=>`${a.id}[${a.members.map(x=>x.extension+':'+x.status).join(',')}]`).join(' | ') : 'EMPTY');

  // Simulate initiator leaving: originate a marked paging_caller then hang it up.
  ami.originate({ Channel:'PJSIP/2000', Application:'ConfBridge', Data:`${pageConf},paging_bridge,paging_caller`, Variable:`PAGE_CONF=${pageConf}`, Async:'true' });
  await sleep(2500);
  // find the marked channel from events
  const evs = ami.events.join('\n');
  const mk = /Channel: (PJSIP\/2000-\S+)[\s\S]*?paging_caller/.exec(evs);
  console.log('found marked?', !!mk, mk?mk[1]:'');
  if (mk) ami.hangup(mk[1]);

  await sleep(7000);
  const m2 = await jfetch('/api/monitor', { headers: { Cookie: cookie } });
  console.log('monitor after:', m2.body.active ? m2.body.active.map((a)=>`${a.id}[${a.members.map(x=>x.extension+':'+x.status).join(',')}]`).join(' | ') : 'EMPTY');
  process.exit(0);
}
main().catch(e=>{ console.error('ERR', e.message); process.exit(1); });
