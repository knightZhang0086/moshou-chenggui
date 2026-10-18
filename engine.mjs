// One deterministic rules engine shared by browser, AI, server and tests.
export const VERSION = '0.4.1';
export const DEFAULTS = Object.freeze({ size: 5, pool: 36, wins: 5 });
export const SIDES = ['red', 'blue'];
export const NAMES = { red: '公输盘', blue: '墨子' };
export const other = p => p === 'red' ? 'blue' : 'red';
export const CARDS = [
  {id:'r1',side:'red',name:'云梯',kind:'place',rule:'edge',guard:'self',text:'在触及宋城或楚营边界的空桥位置红木，并保护新木片至对手完成下一次行动。'},
  {id:'r2',side:'red',name:'先登',kind:'place',rule:'support',guard:'self',text:'在至少一端接已有红木的空桥位置红木，并保护新木片至对手完成下一次行动。'},
  {id:'r3',side:'red',name:'连营',kind:'place',rule:'support',guard:'touch',text:'在至少一端接已有红木的空桥位置红木；保护与新木片共端点的所有旧红木至对手完成下一次行动（不保护新木）。'},
  {id:'r4',side:'red',name:'乘势',kind:'rotate',guard:'self',text:'按易械全部四项限制夺取一片蓝木，并保护所得红木至对手完成下一次行动。'},
  {id:'r5',side:'red',name:'破障',kind:'remove',rule:'support',text:'拆除一片蓝木：它不得两端皆受蓝木接应，且假设在该处置红木时至少一端有红木接应。保护中的目标不可拆。'},
  {id:'r6',side:'red',name:'调兵',kind:'move',rule:'near',text:'将一片红木移到相邻空桥位。相邻指两桥位中心曼哈顿距离为2；方向随新桥位改变。'},
  {id:'r7',side:'red',name:'长驱',kind:'move',rule:'line',text:'将一片红木移到与原桥位同一行或同一列的任意空桥位。方向随新桥位改变。'},
  {id:'r8',side:'red',name:'据险',kind:'place',block:'near',text:'在空桥位置红木，并封锁与它相邻的所有空桥位，直到对手完成下一次行动。封锁只禁止放置及移入。'},
  {id:'r9',side:'red',name:'整甲',kind:'guard',guard:'network',text:'选择一片红木，保护它及与它共端点的所有红木，直到对手完成下一次行动。保护禁止敌方易械和拆除。'},
  {id:'b1',side:'blue',name:'守隘',kind:'place',rule:'edge',guard:'self',text:'在触及西垣或东垣边界的空桥位置蓝木，并保护新木片至对手完成下一次行动。'},
  {id:'b2',side:'blue',name:'横阵',kind:'place',guard:'row',text:'在空桥位置蓝木；保护与新木片中心同一行的所有旧蓝木至对手完成下一次行动（不保护新木）。'},
  {id:'b3',side:'blue',name:'非攻',kind:'rotate',guard:'self',text:'按易械全部四项限制夺取一片红木，并保护所得蓝木至对手完成下一次行动。'},
  {id:'b4',side:'blue',name:'拆梯',kind:'remove',rule:'edge',text:'拆除一片触及宋城或楚营边界的红木；目标不得两端皆受红木接应，也不能处于保护中。'},
  {id:'b5',side:'blue',name:'截流',kind:'remove',rule:'single',text:'拆除一片恰有一个端点受其他红木接应的红木；保护中的目标不可拆。'},
  {id:'b6',side:'blue',name:'回防',kind:'move',rule:'edge',text:'将一片蓝木移到触及西垣或东垣边界的空桥位。方向随新桥位改变。'},
  {id:'b7',side:'blue',name:'换防',kind:'move',rule:'support',text:'将一片蓝木移到空桥位，移走原木后，新位置至少一端须与另一片蓝木相接。'},
  {id:'b8',side:'blue',name:'留障',kind:'move',rule:'near',block:'source',text:'将一片蓝木移到相邻空桥位，并封锁原位至对手完成下一次行动。'},
  {id:'b9',side:'blue',name:'封关',kind:'block',text:'选择一个未封锁的空桥位，封锁该位及所有相邻空桥位，直到对手完成下一次行动。封锁只禁止放置及移入。'}
];
export const cardById = id => CARDS.find(c => c.id === id);
const key = p => p.join(',');
const same = (a,b) => a[0] === b[0] && a[1] === b[1];
const cache = new Map();
export function geometry(n = DEFAULTS.size) {
  if (cache.has(n)) return cache.get(n);
  const slots = [];
  for (let y=1;y<2*n;y++) for(let x=1;x<2*n;x++) {
    if (x%2 !== y%2) continue;
    const odd = x%2 === 1;
    slots.push({id:slots.length,x,y,red:odd?[[x,y-1],[x,y+1]]:[[x-1,y],[x+1,y]],blue:odd?[[x-1,y],[x+1,y]]:[[x,y-1],[x,y+1]]});
  }
  cache.set(n,slots); return slots;
}
export const adjacent = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y) === 2;
export function touches(a,b,p) { return a[p].some(x => b[p].some(y => same(x,y))); }
export function edge(s,p,n) { return s[p].some(v => p === 'red' ? v[1]===0||v[1]===2*n : v[0]===0||v[0]===2*n); }
export function support(state,id,p) {
  const slots = geometry(state.config.size), slot=slots[id];
  if (!slot) return 0;
  return slot[p].filter(pt => slots.some(s => s.id!==id && state.board[s.id]===p && s[p].some(v=>same(v,pt)))).length;
}
export function winningPath(state,p) {
  const n=state.config.size, slots=geometry(n), axis=p==='red'?1:0, graph=new Map();
  for(const s of slots) if(state.board[s.id]===p) {
    const [a,b]=s[p].map(key);
    for(const [u,v] of [[a,b],[b,a]]) { if(!graph.has(u)) graph.set(u,[]); graph.get(u).push([v,s.id]); }
  }
  const queue=[], seen=new Map();
  for(const k of graph.keys()) if(Number(k.split(',')[axis])===0) { queue.push(k); seen.set(k,null); }
  for(let i=0;i<queue.length;i++) {
    const u=queue[i];
    if(Number(u.split(',')[axis])===2*n) {
      const path=[]; let v=u;
      while(seen.get(v)) { const [prev,id]=seen.get(v);path.push(id);v=prev; } return path;
    }
    for(const [v,id] of graph.get(u)||[]) if(!seen.has(v)) {seen.set(v,[u,id]);queue.push(v);}
  }
  return null;
}
export function seeded(seed) { let x=seed>>>0;return ()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;}; }
function draw(p,rng,count) { const cards=CARDS.filter(c=>c.side===p).map(c=>c.id);for(let i=cards.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[cards[i],cards[j]]=[cards[j],cards[i]];}return cards.slice(0,count); }
export function newMatch(seed=Date.now(), config={}) {
  const cfg={...DEFAULTS,...config};
  if(!Number.isInteger(cfg.size)||cfg.size<3||cfg.size>6||!Number.isInteger(cfg.pool)||cfg.pool<10||cfg.pool>80||![2,3,4,5].includes(cfg.wins))throw Error('棋盘、木片池或赛制参数不合法');
  const rng=seeded(seed);
  return newRound({version:VERSION,seed,config:cfg,round:1,revision:0,hands:{red:draw('red',rng,cfg.wins),blue:draw('blue',rng,cfg.wins)},removed:{red:[],blue:[]},history:[]});
}
function newRound(s) {return {...s,phase:'playing',turn:'red',board:geometry(s.config.size).map(()=>null),pool:s.config.pool,ply:0,used:{red:[],blue:[]},lastOwn:{red:null,blue:null},lastAction:null,guards:{},blocks:{},roundWinner:null,reason:null,path:[],log:[]};}
const active = (map,id,ply) => map[id] != null && map[id]>ply;
export const protectedAt=(s,id)=>active(s.guards,id,s.ply);
export const blockedAt=(s,id)=>active(s.blocks,id,s.ply);
export function actionError(s,a,p=s.turn, checkingPass=false) {
  if(s.phase!=='playing')return '当前不是行动阶段';
  if(p!==s.turn)return '还未轮到你';
  if(!a||typeof a!=='object')return '行动格式错误';
  const card=a.card?cardById(a.card):null;
  if(a.card && (!card||card.side!==p||!s.hands[p].includes(a.card)||s.removed[p].includes(a.card)||s.used[p].includes(a.card)))return '这张牌当前不可用';
  const kind=card?.kind||a.type;
  if(card&&a.type!==card.kind)return '牌与行动类型不符';
  if(!card&&!['place','rotate','pass'].includes(kind))return '该行动需要技能牌';
  if(kind==='pass')return checkingPass||legalActions(s,false).length===0?null:'仍有合法行动，不能停手';
  const slots=geometry(s.config.size), t=slots[a.target], source=slots[a.source];
  if(!Number.isInteger(a.target)||!t)return '请选择棋盘内的桥位';
  if(['place','move','block'].includes(kind) && (s.board[t.id]||blockedAt(s,t.id)))return '目标必须是未封锁的空桥位';
  if(kind==='place') {
    if(card?.rule==='edge'&&!edge(t,p,s.config.size))return '须触及己方目标边界';
    if(card?.rule==='support'&&support(s,t.id,p)===0)return '目标至少一端须有己方木片接应';
  } else if(kind==='rotate'||kind==='remove') {
    if(s.board[t.id]!==other(p))return '请选择对方木片';
    if(protectedAt(s,t.id))return '该木片受保护';
    if(support(s,t.id,other(p))===2)return '目标两端均有同阵营接应，不可夺或拆';
    if(kind==='rotate') {
      if(support(s,t.id,p)===0)return '有援：转换后至少一端须接己方木片';
      if(s.lastOwn[p]==='rotate')return '禁连：自己的两次连续行动不能都易械';
      if(s.lastAction?.kind==='rotate'&&s.lastAction.target===t.id)return '禁劫：不能立即易回上一手易械的目标';
    } else {
      if(card.rule==='support'&&support(s,t.id,p)===0)return '假设置己方木片后须至少一端有援';
      if(card.rule==='edge'&&!edge(t,other(p),s.config.size))return '目标须触及敌方目标边界';
      if(card.rule==='single'&&support(s,t.id,other(p))!==1)return '目标必须恰有一端受援';
    }
  } else if(kind==='move') {
    if(!Number.isInteger(a.source)||!source||s.board[source.id]!==p)return '先选择要移动的己方木片';
    if(card.rule==='near'&&!adjacent(source,t))return '目标须与原位相邻（中心曼哈顿距离2）';
    if(card.rule==='line'&&source.x!==t.x&&source.y!==t.y)return '目标须与原位同一行或列';
    if(card.rule==='edge'&&!edge(t,p,s.config.size))return '目标须触及己方目标边界';
    if(card.rule==='support') {const b={...s,board:[...s.board]};b.board[source.id]=null;if(!support(b,t.id,p))return '移走原木后，新位置须有另一片己木接应';}
  } else if(kind==='guard') { if(s.board[t.id]!==p)return '请选择己方木片'; }
  else if(kind!=='block')return '未知行动';
  return null;
}
export function legalActions(s,includePass=true) {
  if(s.phase!=='playing')return [];
  const result=[], slots=geometry(s.config.size);
  const specs=[{kind:'place'},{kind:'rotate'},...s.hands[s.turn].filter(id=>!s.removed[s.turn].includes(id)&&!s.used[s.turn].includes(id)).map(cardById)];
  for(const c of specs) for(const t of slots) {
    const sources=c.kind==='move'?slots.filter(x=>s.board[x.id]===s.turn):[null];
    for(const src of sources) {const a={type:c.kind,target:t.id,...(c.id?{card:c.id}:{}),...(src?{source:src.id}:{})};if(!actionError(s,a))result.push(a);}
  }
  if(!result.length&&includePass)result.push({type:'pass'});return result;
}
export function applyAction(state,a,p=state.turn) {
  const err=actionError(state,a,p); if(err)throw Error(err);
  const s=structuredClone(state), slots=geometry(s.config.size), c=a.card?cardById(a.card):null, kind=c?.kind||a.type, t=slots[a.target];
  const expires=s.ply+2;
  if(kind==='move'){s.board[a.source]=null;delete s.guards[a.source];s.board[a.target]=p;}
  if(kind==='place'||kind==='rotate')s.board[a.target]=p;
  if(kind==='remove'){s.board[a.target]=null;delete s.guards[a.target];}
  if(c?.guard)for(const x of slots)if(s.board[x.id]===p) {
    const yes=c.guard==='self'?x.id===t.id:c.guard==='row'?x.id!==t.id&&x.y===t.y:c.guard==='touch'?x.id!==t.id&&touches(x,t,p):x.id===t.id||touches(x,t,p);
    if(yes)s.guards[x.id]=expires;
  }
  if(c?.block==='source')s.blocks[a.source]=expires;
  if(c?.block==='near'||kind==='block')for(const x of slots)if(!s.board[x.id]&&(adjacent(x,t)||(kind==='block'&&x.id===t.id)))s.blocks[x.id]=expires;
  if(c)s.used[p].push(c.id);
  s.pool--;s.ply++;s.revision++;s.lastOwn[p]=kind;s.lastAction={kind,target:a.target??null,player:p};
  for(const map of [s.guards,s.blocks])for(const id of Object.keys(map))if(map[id]<=s.ply)delete map[id];
  const labels={place:'置木',rotate:'易械',move:'移木',remove:'拆木',guard:'护木',block:'封锁',pass:'无着停手'};
  s.log.push({ply:s.ply,player:p,text:`${NAMES[p]}${c?'·'+c.name:''} ${labels[kind]}${t?' #'+(t.id+1):''}${a.source!=null?'（自 #'+(a.source+1)+'）':''}`});
  for(const side of [p,other(p)]){const path=winningPath(s,side);if(path){s.roundWinner=side;s.reason=side==='red'?'楚营至宋城贯通':'西垣至东垣贯通';s.path=path;break;}}
  if(!s.roundWinner&&s.pool===0){s.roundWinner='blue';s.reason='公共木片池耗尽';}
  if(s.roundWinner){s.phase='roundOver';s.history.push({round:s.round,winner:s.roundWinner,reason:s.reason,plies:s.ply});}
  else s.turn=other(p);
  return s;
}
export function removeWinnerCard(state,id,player) {
  if(state.phase!=='roundOver')throw Error('当前不是移除牌阶段');
  const winner=state.roundWinner;
  if(player!==other(winner))throw Error('只有小局败者可以选择移除牌');
  if(!state.hands[winner].includes(id)||state.removed[winner].includes(id))throw Error('请选择胜者尚未移除的牌');
  const s=structuredClone(state);s.removed[winner].push(id);s.revision++;s.history.at(-1).removed=id;
  if(s.removed[winner].length===s.config.wins){s.phase='matchOver';s.matchWinner=winner;return s;}
  s.round++;return newRound(s);
}
// Dijkstra-like relaxation: cost of filling empty crossings, impassable opponent bridges.
export function distance(s,p) {
  const n=s.config.size, slots=geometry(n), axis=p==='red'?1:0, d=new Map();
  for(const t of slots)for(const v of t[p])d.set(key(v),v[axis]===0?0:100);
  for(let i=0;i<2*n*n;i++) {let changed=false;for(const t of slots){if(s.board[t.id]===other(p))continue;const cost=s.board[t.id]===p?0:1;const [a,b]=t[p].map(key);if(d.get(a)+cost<d.get(b)){d.set(b,d.get(a)+cost);changed=true;}if(d.get(b)+cost<d.get(a)){d.set(a,d.get(b)+cost);changed=true;}}if(!changed)break;}
  return Math.min(...[...d].filter(([k])=>+k.split(',')[axis]===2*n).map(([,v])=>v));
}
export function chooseAI(s, rng=Math.random) {
  const p=s.turn, foe=other(p), actions=legalActions(s);let best=actions[0], score=-Infinity;
  for(const a of actions) {
    const next=applyAction(s,a), won=next.roundWinner;
    let value=won?(won===p?10000:-10000):distance(next,foe)*6-distance(next,p)*9;
    if(!won) {
      // Block immediate ordinary winning moves. Skill lookahead is intentionally shallow.
      for(const t of geometry(s.config.size))if(!next.board[t.id]&&!blockedAt(next,t.id)){next.board[t.id]=foe;if(winningPath(next,foe))value-=800;next.board[t.id]=null;}
      value+=Object.keys(next.guards).filter(id=>next.board[id]===p).length*.15;
      value-=a.card ? .1 : 0; // tiny preference to preserve a card when positional value ties
    }
    value+=rng()*.05;
    if(value>score){score=value;best=a;}
  }
  return best;
}
