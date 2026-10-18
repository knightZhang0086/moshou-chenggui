import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createGameServer} from './server.mjs';
test('two clients: join, auth, realtime, idempotency, stale revision, restart reconnect, room close',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moshou-test-'));let app=createGameServer({dataDir:dir}),base;
 const start=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;};await start();
 const req=async(route,body,token)=>{const r=await fetch(base+route,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,...await r.json()};};
 try{
 const red=await req('/api/rooms',{});assert.equal(red.status,201);const route='/api/rooms/'+red.code;
 assert.equal((await req(route)).status,401);
 const joined=await Promise.all([req(route+'/join',{}),req(route+'/join',{})]);assert.deepEqual(joined.map(r=>r.status).sort(),[200,409]);const blue=joined.find(r=>r.status===200);
 const abort=new AbortController();const stream=await fetch(base+route+'/events',{headers:{Authorization:'Bearer '+blue.token},signal:abort.signal});const reader=stream.body.getReader();const decoder=new TextDecoder();let buf='';
 const snapshot=async(revision)=>{for(let i=0;i<15;i++){while(buf.includes('\n\n')){const end=buf.indexOf('\n\n'),part=buf.slice(0,end);buf=buf.slice(end+2);if(part.startsWith('data: ')){const s=JSON.parse(part.slice(6));if(s.state.revision===revision)return s;}}const item=await reader.read();if(item.done)break;buf+=decoder.decode(item.value);}throw Error('missing SSE snapshot');};
 assert.equal((await snapshot(0)).joined,true);
 const action={id:'test-action-1',revision:0,action:{type:'place',target:0}};
 assert.equal((await req(route+'/action',action,blue.token)).status,400);
 const moved=await req(route+'/action',action,red.token);assert.equal(moved.state.pool,35);assert.equal((await snapshot(1)).state.board[0],'red');
 assert.equal((await req(route+'/action',action,red.token)).state.pool,35);
 assert.equal((await req(route+'/action',{...action,id:'stale-action'},blue.token)).status,409);
 const second=await req(route+'/action',{id:'test-action-2',revision:1,action:{type:'place',target:1}},blue.token);assert.equal(second.state.revision,2);
 abort.abort();await app.close();app=createGameServer({dataDir:dir});await start();
 const restored=await req(route,null,red.token);assert.equal(restored.state.pool,34);assert.equal(restored.side,'red');assert.equal(restored.joined,true);
 const disk=fs.readFileSync(path.join(dir,red.code+'.json'),'utf8');assert.ok(!disk.includes(red.token));assert.ok(!disk.includes(blue.token));assert.ok(!JSON.stringify(restored).includes('players'));
 assert.equal((await req(route+'/close',{id:'close-room-1',revision:2},red.token)).closed,true);
 assert.equal((await req(route+'/action',{id:'late-action-1',revision:3,action:{type:'place',target:2}},red.token)).status,410);
 const blocked=await fetch(base+'/api/rooms',{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
 assert.equal((await fetch(base+'/')).status,200);
 }finally{await app.close();fs.rmSync(dir,{recursive:true,force:true});}
});
