import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHash} from 'node:crypto';
import {newMatch,applyAction,removeWinnerCard,VERSION} from './engine.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code=()=>Array.from(randomBytes(6),x=>alphabet[x%alphabet.length]).join('');
export function createGameServer(options={}) {
  const dataDir=options.dataDir||process.env.DATA_DIR||path.join(ROOT,'data');
  const allowedOrigins=new Set((options.origins||process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean));
  const maxRooms=options.maxRooms||1000, rooms=new Map(), streams=new Map(), rates=new Map();
  fs.mkdirSync(dataDir,{recursive:true});
  for(const file of fs.readdirSync(dataDir)) if(/^[A-Z2-9]{6}\.json$/.test(file)) {
    try {const r=JSON.parse(fs.readFileSync(path.join(dataDir,file),'utf8'));if(r.state?.version===VERSION)rooms.set(r.code,r);}catch{console.warn('Skipped invalid room file:',file);}
  }
  const persist=r=>{const dest=path.join(dataDir,r.code+'.json');fs.writeFileSync(dest+'.tmp',JSON.stringify(r),{mode:0o600});fs.renameSync(dest+'.tmp',dest);rooms.set(r.code,r);};
  const online=(id,p)=>[...(streams.get(id)||[])].some(x=>x.side===p);
  const view=r=>({code:r.code,state:r.state,joined:!!r.players.blue,closed:r.closed||false,online:{red:online(r.code,'red'),blue:online(r.code,'blue')},expiresAt:r.updatedAt+(r.closed?6:48)*3600000});
  const broadcast=r=>{const msg=`data: ${JSON.stringify(view(r))}\n\n`;for(const c of streams.get(r.code)||[])c.res.write(msg);};
  const fail=(status,message)=>Object.assign(Error(message),{status});
  const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  async function read(req) {let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192)throw fail(413,'请求过大');}try{return JSON.parse(text||'{}');}catch{throw fail(400,'无效 JSON');}}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    const url=new URL(req.url,'http://local');
    const origin=req.headers.origin;
    const self=origin&&[ `http://${req.headers.host}`,`https://${req.headers.host}`].includes(origin);
    if(origin&&!self&&!allowedOrigins.has(origin)){json(res,403,{error:'该网站尚未加入服务器 ALLOWED_ORIGINS'});return;}
    if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    try {
      if(url.pathname==='/api/health'){json(res,200,{ok:true,version:VERSION});return;}
      if(url.pathname.startsWith('/api/')) {
        const ip=req.socket.remoteAddress, now=Date.now();let rate=rates.get(ip);
        if(!rate||now-rate.start>60000){rate={start:now,count:0};rates.set(ip,rate);}if(++rate.count>300)throw fail(429,'请求太频繁，请稍后再试');
        if(url.pathname==='/api/rooms'&&req.method==='POST') {
          const settings=await read(req);const wins=settings.wins??3;if(![2,3,4,5].includes(wins))throw fail(400,'赛制只能是三局两胜、五局三胜、七局四胜或九局五胜');if(rooms.size>=maxRooms)throw fail(503,'房间已满，请稍后再试');
          let id;do{id=code();}while(rooms.has(id));const secret=token();
          const r={code:id,createdAt:now,updatedAt:now,players:{red:hash(secret),blue:null},state:newMatch(randomBytes(4).readUInt32LE(),{wins}),receipts:[]};persist(r);
          json(res,201,{...view(r),side:'red',token:secret});return;
        }
        const match=url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|events|action|close))?$/);
        if(!match)throw fail(404,'接口不存在');
        const r=rooms.get(match[1]);if(!r)throw fail(404,'房间不存在或已过期');
        const op=match[2];
        if(op==='join'&&req.method==='POST') {
          await read(req);const current=rooms.get(r.code);if(current.closed)throw fail(410,'房间已关闭');if(current.players.blue)throw fail(409,'房间已满；原玩家请使用原浏览器恢复对局');
          const secret=token(), next=structuredClone(current);next.players.blue=hash(secret);next.updatedAt=now;persist(next);broadcast(next);json(res,200,{...view(next),side:'blue',token:secret});return;
        }
        const auth=req.headers.authorization?.replace(/^Bearer /,'')||'';
        const digest=hash(auth),side=['red','blue'].find(p=>r.players[p]===digest);
        if(!side)throw fail(401,'座位凭证失效；请使用加入房间时的浏览器');
        if(!op&&req.method==='GET'){json(res,200,{...view(r),side});return;}
        if(op==='events'&&req.method==='GET') {
          const set=streams.get(r.code)||new Set();if(set.size>=8)throw fail(429,'房间连接过多，请关闭多余标签页');
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
          res.write(': connected\n\n');const client={res,side};set.add(client);streams.set(r.code,set);broadcast(r);
          req.on('close',()=>{set.delete(client);if(!set.size)streams.delete(r.code);const latest=rooms.get(r.code);if(latest)broadcast(latest);});return;
        }
        if(req.method!=='POST')throw fail(405,'不支持此请求方式');
        const body=await read(req);
        // Re-fetch after body read: another request may have committed in the meantime.
        const current=rooms.get(r.code);if(current.closed)throw fail(410,'房间已关闭');
        if(typeof body.id!=='string'||body.id.length>100||body.id.length<8)throw fail(400,'缺少行动编号');
        if(current.receipts.includes(side+':'+body.id)){json(res,200,view(current));return;}
        if(body.revision!==current.state.revision)throw fail(409,'局面已更新，请等待同步后重试');
        const next=structuredClone(current);
        if(op==='close'){next.closed=true;next.state.revision++;}
        else if(op==='action') {
          if(!next.players.blue)throw fail(409,'等待另一位玩家加入');
          try{next.state=body.action?.type==='removeCard'?removeWinnerCard(next.state,body.action.card,side):applyAction(next.state,body.action,side);}catch(e){throw fail(400,e.message);}
        } else throw fail(404,'接口不存在');
        next.updatedAt=Date.now();next.receipts.push(side+':'+body.id);next.receipts=next.receipts.slice(-64);persist(next);broadcast(next);json(res,200,view(next));return;
      }
      if(!['GET','HEAD'].includes(req.method))throw fail(405,'不支持此请求方式');
      let name=decodeURIComponent(url.pathname);if(name==='/')name='/index.html';
      const publicRoot=ROOT,filename=path.resolve(publicRoot,'.'+name);
      if(!new Set(["app.mjs","book.mjs","engine.mjs","favicon.svg","index.html","rulebook.html","RULEBOOK.md","RULEBOOK.pdf","rules.mjs","style.css"]).has(name.slice(1)))throw fail(404,'文件不存在');
      if(!filename.startsWith(publicRoot+path.sep))throw fail(403,'禁止访问');
      const stat=fs.statSync(filename,{throwIfNoEntry:false});if(!stat?.isFile())throw fail(404,'文件不存在');
      const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/plain; charset=utf-8','.svg':'image/svg+xml','.pdf':'application/pdf'};
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      res.writeHead(200,{'Content-Type':mime[path.extname(filename)]||'application/octet-stream','Cache-Control':'no-cache'});
      if(req.method==='HEAD')res.end();else fs.createReadStream(filename).pipe(res);
    }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'服务器错误，请稍后重试'});else res.end();if(!e.status)console.error(e);}
  });
  const timer=setInterval(()=>{
    const now=Date.now();for(const [id,r] of rooms){const ttl=(r.closed?6:r.players.blue?48:2)*3600000;if(!streams.has(id)&&now-r.updatedAt>ttl){rooms.delete(id);fs.rmSync(path.join(dataDir,id+'.json'),{force:true});}}
    for(const set of streams.values())for(const c of set)c.res.write(': heartbeat\n\n');
    for(const [ip,r] of rates)if(now-r.start>60000)rates.delete(ip);
  },15000);timer.unref();
  const close=()=>new Promise(resolve=>{clearInterval(timer);for(const set of streams.values())for(const c of set)c.res.end();server.close(resolve);server.closeAllConnections();});
  return {server,close,rooms};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const app=createGameServer();const port=Number(process.env.PORT)||4173;
  app.server.listen(port,'0.0.0.0',()=>console.log(`墨守成规 http://localhost:${port}`));
  for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{await app.close();process.exit(0);});
}
