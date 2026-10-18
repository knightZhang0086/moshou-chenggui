import {VERSION,CARDS,NAMES,other,newMatch,geometry,cardById,applyAction,removeWinnerCard,legalActions,actionError,chooseAI,protectedAt,blockedAt} from './engine.mjs';
import {rulesHTML,libraryHTML,escapeHtml as esc} from './rules.mjs';
const $=id=>document.getElementById(id);
const formatName=w=>({2:'三局两胜',3:'五局三胜',4:'七局四胜',5:'九局五胜'}[w]);
const read=k=>{try{return JSON.parse(localStorage.getItem(k));}catch{return null;}};
const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{toast('浏览器无法保存存档；刷新可能丢失本地进度');}};
let state=null, mode='hotseat', human='red', selected='place', source=null, room=null, session=null, connected=false, busy=false, streamAbort=null, aiTimer=null;
let apiBase=read('moshou-server')||'';
const old=read('moshou-local');$('resume').hidden=!old||old.state?.version!==VERSION;
const savedRoom=read('moshou-room');$('resume-room').hidden=!savedRoom;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,5000);}
function modal(title,html){$('modal-title').textContent=title;$('modal-body').innerHTML=html;if(!$('modal').open)$('modal').showModal();}
$('modal-close').onclick=()=>$('modal').close();
$('rules').onclick=()=>modal('对弈之法',`<div class="rules-content">${rulesHTML()}</div>`);
$('library').onclick=()=>modal('九攻／九拒 · 完整牌库',libraryHTML());
function confirmAction(title,text,fn){modal(title,`<p>${text}</p><button id="confirm-yes">确认</button>`);$('confirm-yes').onclick=()=>{$('modal').close();fn();};}
function disconnect(){streamAbort?.abort();streamAbort=null;connected=false;clearTimeout(aiTimer);}
function startLocal(m){const run=()=>{disconnect();mode=m;human=$('human-side').value;state=newMatch(crypto.getRandomValues(new Uint32Array(1))[0],{wins:Number($('match-wins').value)});room=null;session=null;selected='place';source=null;showGame();persist();render();};if(read('moshou-local'))confirmAction('开始新的本地对局','将覆盖当前浏览器保存的本地对局。在线房间不受影响。',run);else run();}
$('hotseat').onclick=()=>startLocal('hotseat');$('ai').onclick=()=>startLocal('ai');
$('resume').onclick=()=>{const d=read('moshou-local');if(d?.state?.version!==VERSION)return toast('存档版本不兼容');disconnect();({state,mode,human}=d);room=null;session=null;showGame();render();};
$('home-button').onclick=()=>{disconnect();$('home').hidden=false;$('game').hidden=true;$('resume').hidden=!read('moshou-local');$('resume-room').hidden=!read('moshou-room');};
function showGame(){$('home').hidden=true;$('game').hidden=false;}
function persist(){if(mode!=='online')save('moshou-local',{state,mode,human});}
const canAct=()=>state?.phase==='playing'&&!busy&&(mode==='hotseat'||mode==='ai'&&state.turn===human||mode==='online'&&connected&&room?.joined&&!room?.closed&&state.turn===session?.side);
function cardMarkup(id,p){const c=cardById(id), removed=state.removed[p].includes(id), used=state.used[p].includes(id);return `<button class="card ${removed?'removed':used?'used':''} ${selected===id?'selected':''}" data-card="${id}" ${(!canAct()||p!==state.turn||removed||used)?'disabled':''}><span class="card-name">${c.name}<small>${removed?'已移除':used?'本局已用':'可用'}</small></span><p>${c.text}</p></button>`;}
function render(){
 if(!state)return;
 $('mode-label').textContent=mode==='online'?`千里邀局 · 你执${NAMES[session.side]}`:mode==='ai'?`问道机巧 · 你执${NAMES[human]}`:'同席对弈 · 本地热座';
 $('round-title').textContent=`第 ${state.round} 局 · ${formatName(state.config.wins)}`;
 $('turn-label').textContent=state.phase==='playing'?`${NAMES[state.turn]}行棋 · ${state.turn==='red'?'红方 南北':'蓝方 东西'}`:'本局已定';
 $('pool').textContent=state.pool;$('pool-progress').value=state.pool;$('pool-progress').max=state.config.pool;
 $('room-bar').hidden=mode!=='online';$('close-room').hidden=mode!=='online'||room?.closed;
 if(mode==='online'){$('room-bar').innerHTML=`邀请码 <strong>${esc(session.code)}</strong><button id="copy-invite">复制邀请</button> · ${room.closed?'房间已结束':!room.joined?'等待朋友加入':connected?'已同步':'断线，正在重连…'} · 对手${room.online?.[other(session.side)]?'在线':'离线'} <small>刷新可恢复座位</small>`;$('copy-invite').onclick=async()=>{const u=new URL(location.href);u.searchParams.set('room',session.code);if(apiBase)u.searchParams.set('server',apiBase);try{await navigator.clipboard.writeText(u.href);toast('邀请链接已复制');}catch{toast(`邀请码：${session.code}`);}};}
 for(const p of ['red','blue']){$(p+'-panel').innerHTML=`<div class="player-title"><h3>${NAMES[p]}</h3><small>${p==='red'?'九攻 · 南北贯通':'九拒 · 东西或木尽'}</small></div><div class="score">${Array.from({length:state.config.wins},(_,i)=>`<i class="${i<state.removed[p].length?'done':''}"></i>`).join('')}</div><div class="small muted">胜场 ${state.removed[p].length} / ${state.config.wins} · 已移除同数技能</div>${state.hands[p].map(id=>cardMarkup(id,p)).join('')}`;}
 document.querySelectorAll('[data-card]').forEach(b=>b.onclick=()=>{selected=b.dataset.card;source=null;render();});
 $('place').classList.toggle('selected',selected==='place');$('rotate').classList.toggle('selected',selected==='rotate');
 $('place').disabled=!canAct();$('rotate').disabled=!canAct();
 const available=canAct()?legalActions(state):[];
 $('pass').hidden=!available.some(a=>a.type==='pass');
 renderBoard(available);
 const c=cardById(selected);
 $('instruction').textContent=room?.closed?'房间已结束。可返回主菜单开始新对局。':state.phase!=='playing'?'小局结束。请查看下方结算。':mode==='online'&&!room.joined?'将邀请码分享给朋友；对方加入后开始对弈。':!canAct()?(mode==='ai'?'机巧正在推演…':'等待对方行动，或等待连接恢复。'):c?`${c.name}：${c.text}${c.kind==='move'?(source==null?' 先点己方源木。':` 已选 #${source+1}，再点目标空位。`):' 点击高亮目标。'}`:selected==='rotate'?'易械：点击合法敌木。须同时满足有援、可夺、禁连、禁劫；无高亮表示当前无合法目标。':'置木：点击圆形高亮桥位。木片自动连接两个己方节点，成功后耗1木。';
 $('log-count').textContent=`· ${state.log.length} 手`;$('log').innerHTML=state.log.slice().reverse().map(l=>`<li value="${l.ply}">${esc(l.text)}</li>`).join('');
 $('history').innerHTML=state.history.map(h=>`<p>第${h.round}局：${NAMES[h.winner]}胜 · ${h.reason}${h.removed?' · 移除'+cardById(h.removed).name:''}</p>`).join('');
 renderResult();scheduleAI();
}
function renderBoard(available){
 const slots=geometry(state.config.size), n=state.config.size, scale=36,pad=18,pt=v=>v*scale+pad,extent=2*n*scale+2*pad;
 const c=cardById(selected), kind=c?.kind||selected;
 const relevant=available.filter(a=>c?a.card===c.id:!a.card&&a.type===kind);
 const legal=new Set(relevant.filter(a=>kind!=='move'||source==null||a.source===source).map(a=>kind==='move'&&source==null?a.source:a.target));
 let svg=`<svg viewBox="0 0 ${extent} ${extent}" role="group" aria-label="交错连线棋盘，宋城在上，楚营在下">`;
 for(let i=0;i<=2*n;i++)svg+=`<path class="grid-line" d="M${pt(i)} ${pt(0)} V${pt(2*n)} M${pt(0)} ${pt(i)} H${pt(2*n)}"/>`;
 for(const s of slots){const owner=state.board[s.id];if(owner){const [a,b]=s[owner];svg+=`<line class="bridge-halo" x1="${pt(a[0])}" y1="${pt(a[1])}" x2="${pt(b[0])}" y2="${pt(b[1])}"/><line class="bridge ${owner} ${state.path.includes(s.id)?'win':''}" x1="${pt(a[0])}" y1="${pt(a[1])}" x2="${pt(b[0])}" y2="${pt(b[1])}"/>`;if(protectedAt(state,s.id))svg+=`<rect x="${pt(s.x)-11}" y="${pt(s.y)-11}" width="22" height="22" rx="4" fill="none" stroke="#a38135" stroke-width="2" stroke-dasharray="3 2"/>`;}
 if(blockedAt(state,s.id))svg+=`<path d="M${pt(s.x)-7} ${pt(s.y)-7} l14 14 m0 -14 l-14 14" stroke="#8a8170" stroke-width="2"/>`;
 }
 for(let y=0;y<=2*n;y++)for(let x=0;x<=2*n;x++){if(x%2===1&&y%2===0)svg+=`<circle class="node-red" cx="${pt(x)}" cy="${pt(y)}" r="4"/>`;if(x%2===0&&y%2===1)svg+=`<rect class="node-blue" x="${pt(x)-3.5}" y="${pt(y)-3.5}" width="7" height="7"/>`;}
 for(const s of slots){const owner=state.board[s.id];svg+=`<circle class="slot-hit ${legal.has(s.id)?'legal':''} ${source===s.id?'chosen':''}" cx="${pt(s.x)}" cy="${pt(s.y)}" r="17" role="button" tabindex="0" data-slot="${s.id}" aria-label="桥位 ${s.id+1}，${owner?NAMES[owner]+'木片':'空位'}${legal.has(s.id)?'，合法目标':''}"><title>#${s.id+1} ${owner?NAMES[owner]:'空位'}</title></circle><text class="slot-label" x="${pt(s.x)+12}" y="${pt(s.y)-12}">${s.id+1}</text>`;}
 $('board').innerHTML=svg+'</svg>';
 document.querySelectorAll('[data-slot]').forEach(el=>{el.onclick=()=>clickSlot(+el.dataset.slot);el.onkeydown=e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();clickSlot(+el.dataset.slot);}};});
}
function clickSlot(target){if(!canAct())return toast('当前不能行动');const c=cardById(selected),type=c?.kind||selected;if(type==='move'&&source==null){if(state.board[target]!==state.turn)return toast('先选择己方木片');source=target;render();return;}const a={type,target,...(c?{card:c.id}:{}),...(source!=null?{source}:{})};const err=actionError(state,a);if(err)return toast(err);submit(a);}
async function submit(action){
 if(busy)return;busy=true;
 try{if(mode==='online'){const v=await request(`/api/rooms/${session.code}/action`,{id:crypto.randomUUID(),revision:state.revision,action},session.token);receive(v);}else{state=action.type==='removeCard'?removeWinnerCard(state,action.card,other(state.roundWinner)):applyAction(state,action);persist();}selected='place';source=null;}
 catch(e){toast(e.message);if(mode==='online')try{receive(await request(`/api/rooms/${session.code}`,null,session.token));}catch{}}
 finally{busy=false;render();}
}
for(const id of ['place','rotate'])$(id).onclick=()=>{selected=id;source=null;render();};$('cancel').onclick=()=>{selected='place';source=null;render();};$('pass').onclick=()=>submit({type:'pass'});
function renderResult(){const result=$('result');result.hidden=state.phase==='playing';if(result.hidden)return;const winner=state.matchWinner||state.roundWinner;
 if(state.phase==='matchOver'){result.innerHTML=`<h3>${NAMES[winner]} · 整场胜出</h3><p>${state.config.wins}术已去，${state.config.wins}胜已成。本场共 ${state.round} 局。返回主菜单可再开新局。</p>`;return;}
 const loser=other(winner), canChoose=!busy&&(mode==='hotseat'||mode==='ai'&&loser===human||mode==='online'&&session.side===loser&&connected&&!room.closed);
 result.innerHTML=`<h3>${NAMES[winner]} · 此局胜</h3><p>${state.reason}。请败者${NAMES[loser]}选择移除胜者的一张技能。胜者进度将变为 ${state.removed[winner].length+1}/${state.config.wins}。</p>${state.hands[winner].filter(id=>!state.removed[winner].includes(id)).map(id=>`<button data-remove="${id}" ${canChoose?'':'disabled'} title="${cardById(id).text}">移除 ${cardById(id).name}</button>`).join('')}${!canChoose?'<p>等待败方选择…</p>':''}`;
 document.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>submit({type:'removeCard',card:b.dataset.remove}));
}
function scheduleAI(){clearTimeout(aiTimer);if(mode!=='ai'||busy||$('game').hidden)return;const ai=other(human);if(state.phase==='roundOver'&&other(state.roundWinner)===ai)aiTimer=setTimeout(()=>{const cards=state.hands[state.roundWinner].filter(x=>!state.removed[state.roundWinner].includes(x));const priority=['r8','r4','r5','r1','b9','b3','b4','b1'];cards.sort((a,b)=>(priority.includes(a)?priority.indexOf(a):99)-(priority.includes(b)?priority.indexOf(b):99));submit({type:'removeCard',card:cards[0]});},650);
 else if(state.phase==='playing'&&state.turn===ai)aiTimer=setTimeout(()=>submit(chooseAI(state)),450);
}
async function request(route,body=null,secret=null){const response=await fetch(apiBase+route,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(secret?{Authorization:'Bearer '+secret}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});let data;try{data=await response.json();}catch{throw Error('当前地址未运行在线服务。请配置对战服务器地址；热座和人机仍可使用。');}if(!response.ok)throw Error(data.error||'连接失败');return data;}
function onlineDialog(){modal('千里邀局',`<p>房主执红，朋友执蓝。使用同一服务器，凭六位邀请码加入；不需要注册。</p><p>创建赛制：<strong>${formatName(Number($('match-wins').value))}</strong> · 每人${$('match-wins').value}张技能（可回主菜单修改）</p><div class="form-row"><button id="create-room">创建房间</button><input id="room-code" aria-label="六位邀请码" maxlength="6" placeholder="六位邀请码"><button id="join-room">加入</button></div><details ${apiBase?'open':''}><summary>在线服务器设置</summary><p>完整部署留空即可。GitHub Pages 需填写已部署的对战服务 HTTPS 地址。</p><input class="server-field" id="server-url" aria-label="在线服务器地址" placeholder="https://你的对战服务器" value="${esc(apiBase)}"><button id="save-server">保存并检测</button><p class="small">仅连接你或朋友信任的对战服务器；座位凭证会发送至此服务。</p></details><p id="online-status" role="status"></p>`);
 $('save-server').onclick=async()=>{try{const value=$('server-url').value.trim().replace(/\/$/,'');if(value){const u=new URL(value);if(u.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(u.hostname))throw Error('公网服务器请使用 HTTPS');if(u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('请只填写服务器来源地址，不包含路径或凭证');}apiBase=value;save('moshou-server',value);await request('/api/health');$('online-status').textContent='在线服务已连接';}catch(e){$('online-status').textContent=e.message;}};
 const connect=async(join)=>{try{$('online-status').textContent='正在连接…';const v=await request(join?`/api/rooms/${$('room-code').value.trim().toUpperCase()}/join`:'/api/rooms',join?{}:{wins:Number($('match-wins').value)});session={code:v.code,side:v.side,token:v.token,base:apiBase};save('moshou-room',session);$('modal').close();enterRoom(v);}catch(e){$('online-status').textContent=e.message;}};
 $('create-room').onclick=()=>connect(false);$('join-room').onclick=()=>connect(true);
}
$('online').onclick=onlineDialog;
function receive(v){if(!state||v.state.revision>=state.revision){state=v.state;room=v;render();}}
function enterRoom(v){disconnect();mode='online';state=null;selected='place';source=null;showGame();receive(v);listen();}
$('resume-room').onclick=async()=>{const s=read('moshou-room');if(!s)return;apiBase=s.base||'';session=s;try{const v=await request(`/api/rooms/${s.code}`,null,s.token);enterRoom(v);}catch(e){toast(e.message);}};
async function listen(){const controller=new AbortController();streamAbort=controller;let retry=500;
 while(!controller.signal.aborted){try{const response=await fetch(`${apiBase}/api/rooms/${session.code}/events`,{headers:{Authorization:'Bearer '+session.token},signal:controller.signal});if(!response.ok)throw Error('连接失败');connected=true;render();retry=500;const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';while(!controller.signal.aborted){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n\n'))>=0){const part=buffer.slice(0,index);buffer=buffer.slice(index+2);if(part.startsWith('data: '))receive(JSON.parse(part.slice(6)));}}}catch{}if(controller.signal.aborted)break;connected=false;render();await new Promise(resolve=>{const t=setTimeout(resolve,retry);controller.signal.addEventListener('abort',()=>{clearTimeout(t);resolve();},{once:true});});retry=Math.min(retry*2,8000);}
}
$('close-room').onclick=()=>confirmAction('结束在线房间','双方将无法继续行动，房间不会计为任何一方获胜。',async()=>{try{receive(await request(`/api/rooms/${session.code}/close`,{id:crypto.randomUUID(),revision:state.revision},session.token));}catch(e){toast(e.message);}});
const params=new URLSearchParams(location.search);if(params.get('room')){onlineDialog();$('room-code').value=params.get('room').replace(/[^A-Z2-9]/gi,'').slice(0,6);if(params.get('server')){$('server-url').value=params.get('server');$('online-status').textContent='邀请含服务器地址，请展开设置、确认地址后保存并检测。';$('server-url').closest('details').open=true;}}
