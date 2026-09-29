(function(){
'use strict';
const SEED = window.SEED;
const MAXBOX = 27;
const $app = document.getElementById('app');

/* ---------- match formats (league + cups) ---------- */
const FORMATS = {
  league: {
    id:'league', name:'League / friendly', short:'Friendly',
    slots:8, rubs:6, scoring:'pins', pairRubs:true, maxScore:null,
    summary:'8 players a side, 6 rubs. Team pin totals (South Molton league style).'
  },
  'western-counties': {
    id:'western-counties', name:'Western Counties', short:'Western Counties',
    slots:8, rubs:6, scoring:'mfm-rub', pairRubs:true, maxScore:48,
    summary:'8 players a side. Man for Man across 6 rubs (max 48). Rubs are played 2 at a time (no head-to-head play order on the final rubs).'
  },
  'sid-squire': {
    id:'sid-squire', name:'Sid Squire', short:'Sid Squire',
    slots:5, rubs:8, scoring:'pins', pairRubs:false, maxScore:null,
    summary:'5 players a side, 8 rubs. Team pin totals.'
  },
  pidler: {
    id:'pidler', name:'Pidler', short:'Pidler',
    slots:8, rubs:6, scoring:'pins', pairRubs:false, maxScore:null,
    summary:'8 players a side, 6 rubs. Team pin totals.'
  },
  'front-pin': {
    id:'front-pin', name:'Front Pin', short:'Front Pin',
    slots:6, rubs:6, scoring:'pins', pairRubs:false, maxScore:null,
    summary:'6 players a side, 6 rubs. Team pin totals.'
  },
  concrete: {
    id:'concrete', name:'Concrete', short:'Concrete',
    slots:7, rubs:6, scoring:'mfm-total', pairRubs:false, maxScore:7,
    summary:'7 players a side. Man for Man on highest total vs opposite number — best out of 7 for each team.'
  }
};
const FORMAT_ORDER = ['league','western-counties','sid-squire','pidler','front-pin','concrete'];
function cardFormat(c){
  if(c && c.format && FORMATS[c.format]) return FORMATS[c.format];
  return FORMATS.league;
}
function formatUsesPairRubs(c){
  const fmt=cardFormat(c);
  if(fmt.id==='league') return settings.rubs===2;
  return !!fmt.pairRubs;
}

/* ---------- storage: IndexedDB on the phone (cards, photos, signatures, settings) ---------- */
const DBNAME='skittles-scorer';
let dbp=null;
function openDB(){
  return new Promise((res,rej)=>{
    if(!window.indexedDB) return rej(new Error('no indexedDB'));
    const r=indexedDB.open(DBNAME,4);
    r.onupgradeneeded=()=>{
      const d=r.result;
      ['kv','cards','photos','sigs','syncQueue','sbQueue'].forEach(s=>{ if(!d.objectStoreNames.contains(s)) d.createObjectStore(s); });
    };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
const db=()=>dbp||(dbp=openDB());
const idbPut=(s,k,v)=>db().then(d=>new Promise((res,rej)=>{
  const t=d.transaction(s,'readwrite'); t.objectStore(s).put(v,k);
  t.oncomplete=()=>res(true); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }));
const idbGet=(s,k)=>db().then(d=>new Promise((res,rej)=>{
  const q=d.transaction(s).objectStore(s).get(k);
  q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); }));
const idbDel=(s,k)=>db().then(d=>new Promise((res,rej)=>{
  const t=d.transaction(s,'readwrite'); t.objectStore(s).delete(k);
  t.oncomplete=()=>res(true); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }));
const idbAll=s=>db().then(d=>new Promise((res,rej)=>{
  const out={}, q=d.transaction(s).objectStore(s).openCursor();
  q.onsuccess=()=>{ const c=q.result; if(c){ out[c.key]=c.value; c.continue(); } else res(out); };
  q.onerror=()=>rej(q.error); }));
function saveFailed(){ ui.msg='This phone could not save that change. Free up some storage space, then try again.'; render(); }
const kvSave=(k,v)=>idbPut('kv',k,v).catch(saveFailed);
function sigStoreKey(cardKey,side){ return cardKey+'::'+side; }
function revokeSigURLs(key){
  const o=sigURLs[key]; if(!o) return;
  if(o.home) URL.revokeObjectURL(o.home);
  if(o.away) URL.revokeObjectURL(o.away);
  delete sigURLs[key];
}

// Backend + match defaults: admin/deploy only via config.js (window.SKITTLES_CONFIG).
// Scorers only enter a team PIN — no URL/key/API setup in the normal flow.
const LEAGUE_DEFAULT_BASE = 'https://smskittles.vercel.app';
const LEAGUE_SITE_DEFAULT = 'https://smskittles.vercel.app';
const LEAGUE_RESULTS_JSON = './data/league-results.json';
const LEAGUE_POINTS = {win:2, draw:1, loss:0};
const LEAGUE_DAILY_CAP = 100; // host deploy/write budget — pair cadence stays under this
const SUPABASE_DEFAULT_URL = 'https://dtctorijynmcdjtzmgnk.supabase.co';
function deployConfig(){
  return (typeof window!=='undefined' && window.SKITTLES_CONFIG) || {};
}
function deploySupabase(){
  const c=deployConfig();
  const url=String(c.supabaseUrl||SUPABASE_DEFAULT_URL).trim().replace(/\/+$/,'')||SUPABASE_DEFAULT_URL;
  const anonKey=String(c.supabaseAnonKey||'').trim();
  return {url, anonKey};
}
function applyDeploySettings(){
  const c=deployConfig();
  if(c.rubs===1||c.rubs===2) settings.rubs=c.rubs;
  // Deploy default for new cards; scorers can still toggle per match
  if(typeof c.fines==='boolean') settings.fines=c.fines;
  else settings.fines=true;
}
function isAdminMode(){
  try{ return new URLSearchParams(location.search||'').has('admin'); }catch(e){ return false; }
}
/** Per-match fines flag (defaults to deploy settings.fines). */
function finesEnabled(c){
  if(c && typeof c.fines==='boolean') return c.fines;
  return !!settings.fines;
}
let settings = { rubs:2, fines:true };
let session  = null;      // {div,num,pin,teamKey}
let cards    = {};        // by fixture key
let extra    = {};        // players added on the phone
const photoURLs = {};     // object URLs for the stored chalkboard photos
const sigURLs = {};       // cardKey -> {home?, away?} object URLs for captain signatures
let syncMeta = {day:'', count:0}; // daily league POST budget tracker
let syncUi = {pending:0, lastOk:null, lastErr:null, flushing:false};
let sbUi = {pending:0, lastOk:null, lastErr:null, flushing:false, pulling:false, ready:false, setupNeeded:false};
/** Live/bundled league scorelines keyed by fixture card key `div-week-mi` → {h,a,source}. */
let leaguePlayedCache = {};
const ui = { screen:'loading', from:'login', cardKey:null, side:'home', sel:null, entry:'', fresh:true,
             sheet:null, sheetMsg:'', pin:'', pinMsg:'', tries:0, teamSel:'', newName:'', dupe:null, msg:'', updateReady:null, installEvt:null, reorder:null, moveSheet:null,
             qmSide:'home', qmOpp:'', qmMsg:'', qmFormat:'league',
             leagueTab:'table', leagueDiv:null, leagueStatsLoading:false, leagueStatsErr:'', leagueStats:null, leagueStatsSource:'' };

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const MISSING_PLAYER = 'Player Missing';
const playerLabel = p => (p && p.name) ? p.name : MISSING_PLAYER;
const teamName = (d,n) => SEED.teams[d][n-1];
const norm = s => s.trim().replace(/\s+/g,' ').toLowerCase();
function surname(n){ const t=n.trim().split(/\s+/); return t[t.length-1].toLowerCase(); }
function initials(name){
  const t=name.trim().split(/\s+/);
  if(t.length===1) return t[0].slice(0,2).toUpperCase();
  const last=t[t.length-1];
  const first=t.slice(0,-1).map(x=>x.includes('.')?x.replace(/\./g,''):x[0]).join('');
  return (first+last[0]).toUpperCase();
}
function lev(a,b){
  const m=a.length,n=b.length, d=Array.from({length:m+1},(_,i)=>[i]);
  for(let j=1;j<=n;j++) d[0][j]=j;
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++) d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  return d[m][n];
}
function similar(typed, list){
  const t=norm(typed); let best=null, bestD=99;
  for(const n of list){
    const r=norm(n);
    if(r===t) return {name:n,exact:true};
    const dist=lev(r,t);
    if(dist<=2 && r[0]===t[0] && dist<bestD){ best={name:n,exact:false}; bestD=dist; }
  }
  return best;
}
function fmtDate(iso){ return new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}); }
function todayISO(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function timeNow(){ return new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); }

function rosterFor(d,n){
  const k=d+'-'+n;
  const all=[...(SEED.rosters[k]||[]), ...(extra[k]||[])];
  const seen=new Set(), out=[];
  all.forEach(x=>{ if(!seen.has(norm(x))){ seen.add(norm(x)); out.push(x); } });
  return out.sort((a,b)=> surname(a).localeCompare(surname(b)) || a.localeCompare(b));
}

/* ---------- fixtures ---------- */
function fixturesFor(d,n){
  return SEED.weeks.map(w=>{
    const mi=w.matches.findIndex(m=>m[0]===n||m[1]===n);
    if(mi<0) return {week:w.week,date:w.date,bye:true};
    const m=w.matches[mi], key=d+'-'+w.week+'-'+mi;
    return {week:w.week,date:w.date,mi,home:m[0],away:m[1],key,played:fixtureResultForKey(key),div:d};
  });
}
function rebuildLeaguePlayedCache(resultsByDiv){
  const next={};
  (resultsByDiv||[]).forEach((divMap, div)=>{
    if(!divMap||typeof divMap!=='object') return;
    Object.keys(divMap).forEach(rk=>{
      const m=/^w(\d+)m(\d+)$/.exec(rk);
      if(!m) return;
      const res=divMap[rk];
      if(!res||!Number.isFinite(res.homeTotal)||!Number.isFinite(res.awayTotal)) return;
      const key=div+'-'+m[1]+'-'+m[2];
      next[key]={h:res.homeTotal, a:res.awayTotal, source:res.source||'league'};
    });
  });
  leaguePlayedCache=next;
}
/** Best-known scoreline for a league fixture key: live/bundled cache, then SEED.played, then league stats map, then local submitted card. */
function fixtureResultForKey(key){
  if(leaguePlayedCache[key]) return leaguePlayedCache[key];
  const seed=SEED.played&&SEED.played[key];
  if(seed && Number.isFinite(seed.h) && Number.isFinite(seed.a)) return {h:seed.h, a:seed.a, source:'seed'};
  // Direct lookup from loaded League stats (same data Results uses) — covers race before cache rebuild
  const parts=String(key).split('-').map(Number);
  if(parts.length===3 && ui.leagueStats && Array.isArray(ui.leagueStats.results)){
    const [div,week,mi]=parts;
    const res=ui.leagueStats.results[div] && ui.leagueStats.results[div]['w'+week+'m'+mi];
    if(res && Number.isFinite(res.homeTotal) && Number.isFinite(res.awayTotal)){
      return {h:res.homeTotal, a:res.awayTotal, source:res.source||'league'};
    }
  }
  const c=cards[key];
  if(c && !c.quick && (c.status==='submitted' || (c.players&&(teamPins(c.players.home)+teamPins(c.players.away)>0)))){
    const sc=matchScore(c);
    if(Number.isFinite(sc.home)&&Number.isFinite(sc.away)&&(sc.home+sc.away>0||sc.pins.home+sc.pins.away>0)){
      return {h:sc.mode==='pins'?sc.home:sc.pins.home, a:sc.mode==='pins'?sc.away:sc.pins.away, source:c.status==='submitted'?'local':'local-draft'};
    }
  }
  return null;
}
/** Scoreline for All fixtures: user's pins first, then opponent, plus W/L/D from their view. */
function fixtureScorelineForUser(f, played, userNum){
  if(!played) return null;
  const userIsHome=f.home===userNum;
  const mine=userIsHome?played.h:played.a;
  const theirs=userIsHome?played.a:played.h;
  let outcome='D', cls='state-draw';
  if(mine>theirs){ outcome='W'; cls='state-win'; }
  else if(mine<theirs){ outcome='L'; cls='state-loss'; }
  return {text:mine+' – '+theirs, outcome, cls};
}
function nextFixture(list){
  const t=todayISO();
  return list.find(f=>!f.bye && !f.played && (f.date>=t || (cards[f.key]&&cards[f.key].status!=='submitted')));
}
function venueOf(d,homeNum){ const i=SEED.info[d][homeNum-1]; return i? i.venue+(i.alley?' ('+i.alley+')':'') : ''; }
function teamKey(d,n){ return d+'-'+n; }
function parseTeamKey(k){ const [d,n]=String(k).split('-').map(Number); return {div:d,num:n}; }
function sideMeta(c,side){
  if(c.quick) return side==='home' ? {div:c.homeDiv,num:c.home} : {div:c.awayDiv,num:c.away};
  return {div:c.div, num:side==='home'?c.home:c.away};
}
function sideName(c,side){ const t=sideMeta(c,side); return teamName(t.div,t.num); }
function sideRosterKey(c,side){ const t=sideMeta(c,side); return teamKey(t.div,t.num); }
function teamOptionsHtml(selected, skipKey){
  let opts='<option value="">Choose a team…</option>';
  SEED.teams.forEach((div,d)=>{
    opts+=`<optgroup label="Division ${d+1}">`+div.map((t,i)=>{
      const k=teamKey(d,i+1);
      if(skipKey && k===skipKey) return '';
      return `<option value="${k}" ${selected===k?'selected':''}>${esc(t)}</option>`;
    }).join('')+'</optgroup>';
  });
  return opts;
}
function quickMatchesFor(d,n){
  return Object.keys(cards).filter(k=>{
    const c=cards[k]; if(!c||!c.quick) return false;
    const me=teamKey(d,n);
    return sideRosterKey(c,'home')===me || sideRosterKey(c,'away')===me;
  }).map(k=>cards[k]).sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.key>a.key?1:-1));
}

/* ---------- card model ---------- */
function blankSide(fmt){
  fmt=fmt||FORMATS.league;
  return Array.from({length:fmt.slots},()=>({name:'',boxes:Array(fmt.rubs).fill(null),spare:Array(fmt.rubs).fill(false),fine:Array(fmt.rubs).fill(false)}));
}
function ensureCard(f){
  if(!cards[f.key]){
    const fmt=FORMATS[f.format]||FORMATS.league;
    cards[f.key]={key:f.key,div:f.div,week:f.week,mi:f.mi,date:f.date,home:f.home,away:f.away,format:fmt.id,
      players:{home:blankSide(fmt),away:blankSide(fmt)},hasPhoto:false,hasSigHome:false,hasSigAway:false,
      fines:!!settings.fines,
      status:'draft',savedAt:null,submittedAt:null,by:null};
    if(f.quick){ cards[f.key].quick=true; cards[f.key].homeDiv=f.homeDiv; cards[f.key].awayDiv=f.awayDiv; }
    persist(f.key);
  }
  return cards[f.key];
}
function openCard(key){
  const c=cards[key]; if(!c) return;
  ui.cardKey=key; ui.side=startSide(c); ui.sel=null; ui.sheet=null; ui.reorder=null; ui.moveSheet=null;
  ui.screen='card'; render(); window.scrollTo(0,0);
}
function deleteQuickMatch(key){
  const c=cards[key]; if(!c||!c.quick) return;
  delete cards[key];
  if(photoURLs[key]){ URL.revokeObjectURL(photoURLs[key]); delete photoURLs[key]; }
  revokeSigURLs(key);
  Promise.all([
    idbDel('cards',key), idbDel('photos',key),
    idbDel('sigs',sigStoreKey(key,'home')), idbDel('sigs',sigStoreKey(key,'away'))
  ]).catch(saveFailed);
  if(ui.cardKey===key){ ui.cardKey=null; ui.sel=null; ui.sheet=null; ui.reorder=null; ui.moveSheet=null; ui.screen='fixtures'; }
  render();
}
function startQuickMatch(){
  if(!session){ ui.qmMsg='Log in as a team first.'; render(); return; }
  if(ui.qmSide!=='home' && ui.qmSide!=='away'){ ui.qmMsg='Choose whether you are home or away.'; render(); return; }
  if(!ui.qmOpp){ ui.qmMsg='Choose the opposing team.'; render(); return; }
  const fmt=FORMATS[ui.qmFormat]||FORMATS.league;
  const me={div:session.div,num:session.num};
  const opp=parseTeamKey(ui.qmOpp);
  if(teamKey(opp.div,opp.num)===teamKey(me.div,me.num)){ ui.qmMsg='Pick a different team as the opposition.'; render(); return; }
  const home=ui.qmSide==='home'?me:opp, away=ui.qmSide==='home'?opp:me;
  const key='qm-'+Date.now();
  ensureCard({key,div:home.div,week:0,mi:0,date:todayISO(),home:home.num,away:away.num,quick:true,homeDiv:home.div,awayDiv:away.div,format:fmt.id});
  ui.qmMsg=''; openCard(key);
}
function persist(key){
  if(key && cards[key]){
    cards[key].savedAt=timeNow();
    cards[key].cloudDirty=true;
    idbPut('cards',key,cards[key]).then(()=>{
      if(ui.msg.startsWith('This phone could not save')){ ui.msg=''; render(); }
      queueSupabaseCardUpsert(key).catch(()=>{});
    }).catch(saveFailed);
  }
}
const curCard = () => cards[ui.cardKey];
function sessionTeamKey(){ return session?teamKey(session.div,session.num):''; }

/* ---------- maths ---------- */
function groupsFor(c){
  const fmt=cardFormat(c), n=fmt.rubs;
  if(formatUsesPairRubs(c) && n===6) return [[0,1],[2,3],[4,5]];
  return Array.from({length:n},(_,i)=>[i]);
}
const isSpare = (p,b) => { const v=p.boxes[b]; return v!==null && (v>9 || (v===9 && p.spare[b])); };
const pinsOf = p => p.boxes.reduce((s,v)=>s+(v||0),0);
function colTotals(c,list){
  const n=cardFormat(c).rubs;
  return Array.from({length:n},(_,col)=>list.reduce((s,p)=>s+(p.boxes[col]||0),0));
}
function pinsUp(c,list){
  const ct=colTotals(c,list);
  return groupsFor(c).map(g=>g.reduce((s,col)=>s+ct[col],0));
}
const teamPins = list => list.reduce((s,p)=>s+pinsOf(p),0);
function mfmRubPoints(c){
  const fmt=cardFormat(c); let h=0,a=0;
  for(let slot=0;slot<fmt.slots;slot++){
    const hp=c.players.home[slot], ap=c.players.away[slot];
    for(let box=0;box<fmt.rubs;box++){
      const hv=hp.boxes[box], av=ap.boxes[box];
      if(hv===null||av===null) continue;
      if(hv>av) h++; else if(av>hv) a++;
    }
  }
  return {home:h,away:a};
}
function mfmTotalPoints(c){
  const fmt=cardFormat(c); let h=0,a=0;
  for(let slot=0;slot<fmt.slots;slot++){
    const hp=c.players.home[slot], ap=c.players.away[slot];
    if(hp.boxes.every(v=>v===null) && ap.boxes.every(v=>v===null)) continue;
    const ht=pinsOf(hp), at=pinsOf(ap);
    if(ht>at) h++; else if(at>ht) a++;
  }
  return {home:h,away:a};
}
function matchScore(c){
  const fmt=cardFormat(c);
  const pins={home:teamPins(c.players.home),away:teamPins(c.players.away)};
  if(fmt.scoring==='mfm-rub'){
    const pts=mfmRubPoints(c);
    return {home:pts.home, away:pts.away, pins, mode:'mfm-rub', unit:'pts', max:fmt.maxScore,
      caption:'Man for Man (each rub)'};
  }
  if(fmt.scoring==='mfm-total'){
    const pts=mfmTotalPoints(c);
    return {home:pts.home, away:pts.away, pins, mode:'mfm-total', unit:'pts', max:fmt.maxScore,
      caption:'Man for Man (player totals)'};
  }
  return {home:pins.home, away:pins.away, pins, mode:'pins', unit:'pins', max:null, caption:'Pin total'};
}
function entryOrder(c){
  const fmt=cardFormat(c), out=[];
  // Home starts. For each rub group, one side plays through all players, then the other side.
  // Western Counties uses paired rubs (2 at a time) for all six rubs — no final-rubs head-to-head order.
  groupsFor(c).forEach(g=>['home','away'].forEach(side=>{
    for(let slot=0;slot<fmt.slots;slot++) g.forEach(box=>out.push({side,slot,box}));
  }));
  return out;
}
function startSide(c){
  const o=entryOrder(c).find(x=>{ const p=c.players[x.side][x.slot]; return p.name && p.boxes[x.box]===null; });
  return o?o.side:'home';
}

/* ---------- checks before submitting ---------- */
function checkCard(c){
  const blockers=[], warnings=[], lines=[];
  const fmt=cardFormat(c);
  ['home','away'].forEach(side=>{
    const list=c.players[side], nm=sideName(c,side);
    const named=list.filter(p=>p.name);
    const empty=named.reduce((n,p)=>n+p.boxes.filter(v=>v===null).length,0);
    const orphan=list.filter(p=>!p.name && p.boxes.some(v=>v!==null)).length;
    if(!named.length){ blockers.push(nm+': no players chosen'); lines.push({t:nm+': no players chosen',s:'no'}); return; }
    if(orphan){ blockers.push(nm+': scores entered for a slot with no player'); lines.push({t:nm+': a score has no player name',s:'no'}); }
    if(empty){ blockers.push(nm+': '+empty+' box'+(empty>1?'es':'')+' still empty'); lines.push({t:nm+': '+empty+' box'+(empty>1?'es':'')+' still empty',s:'no'}); }
    else if(!orphan){
      if(named.length<fmt.slots) lines.push({t:nm+': '+named.length+' players, all boxes filled',s:'warn'});
      else lines.push({t:nm+': '+fmt.slots+' players, all boxes filled',s:'ok'});
    }
  });
  if(!c.hasPhoto){ blockers.push('Chalkboard photo needed'); lines.push({t:'Photo of the chalkboard needed',s:'no'}); }
  else lines.push({t:'Chalkboard photo attached',s:'ok'});
  if(!c.hasSigHome){ blockers.push('Home captain signature needed'); lines.push({t:'Home captain signature needed',s:'no'}); }
  else lines.push({t:'Home captain signature captured',s:'ok'});
  if(!c.hasSigAway){ blockers.push('Away captain signature needed'); lines.push({t:'Away captain signature needed',s:'no'}); }
  else lines.push({t:'Away captain signature captured',s:'ok'});
  return {blockers,warnings,lines};
}
function exportJSON(c){
  const mk=side=>c.players[side].filter(p=>p.name).map(p=>({name:p.name,pins:pinsOf(p),boxes:p.boxes.slice(),spares:p.boxes.map((v,i)=>isSpare(p,i)?i+1:0).filter(Boolean)}));
  const home=sideMeta(c,'home'), away=sideMeta(c,'away'), fmt=cardFormat(c), sc=matchScore(c);
  return {key:c.quick?'quick-'+c.key:'w'+c.week+'m'+c.mi,quick:!!c.quick,format:fmt.id,formatName:fmt.name,scoring:fmt.scoring,
    division:c.quick?null:c.div+1, homeDivision:home.div+1,awayDivision:away.div+1,homeNum:home.num,awayNum:away.num,
    homeScore:sc.home,awayScore:sc.away,homePins:sc.pins.home,awayPins:sc.pins.away,
    homeTotal:sc.home,awayTotal:sc.away,
    savedAt:c.submittedAt,submittedBy:c.by,photo:c.hasPhoto?'attached':null,
    homeCaptainSig:c.hasSigHome?'captured':null,awayCaptainSig:c.hasSigAway?'captured':null,
    homePlayers:mk('home'),awayPlayers:mk('away')};
}

/* ---------- league site sync: end of each rub pair/group (not per box) ---------- */
function leagueBaseUrl(){
  const c=deployConfig();
  const raw=String(c.leagueBaseUrl||LEAGUE_DEFAULT_BASE).trim()||LEAGUE_DEFAULT_BASE;
  return raw.replace(/\/+$/,'');
}
function leagueCardsUrl(){ return leagueBaseUrl()+'/api/cards'; }
function leagueSyncEnabled(){ return !!deployConfig().leagueSync && !!leagueBaseUrl(); }
/** Public SM Skittles league site URL (admin config only; scorers get a deep link, not keys). */
function leagueSiteUrl(){
  const c=deployConfig();
  const raw=String(c.leagueSiteUrl||LEAGUE_SITE_DEFAULT).trim()||LEAGUE_SITE_DEFAULT;
  return raw.replace(/\/+$/,'');
}
function emptyLeagueResults(){
  return [{},{},{}];
}
function seedPlayedIntoResults(target){
  const played=SEED.played||{};
  Object.keys(played).forEach(key=>{
    const parts=String(key).split('-').map(Number);
    if(parts.length!==3||parts.some(n=>!Number.isFinite(n))) return;
    const [div,week,mi]=parts;
    if(div<0||div>2) return;
    const weekRow=(SEED.weeks||[]).find(w=>w.week===week);
    const pair=weekRow&&weekRow.matches&&weekRow.matches[mi];
    if(!pair) return;
    const row=played[key]||{};
    const ht=Number(row.h), at=Number(row.a);
    if(!Number.isFinite(ht)||!Number.isFinite(at)) return;
    target[div]['w'+week+'m'+mi]={
      homeNum:pair[0], awayNum:pair[1], homeTotal:ht, awayTotal:at,
      homePlayers:[], awayPlayers:[], savedAt:null, source:'seed'
    };
  });
}
function applyBundledLeagueResults(target, data){
  if(!data||!Array.isArray(data.results)) return;
  data.results.forEach((divMap, div)=>{
    if(div>2||!divMap||typeof divMap!=='object') return;
    Object.keys(divMap).forEach(k=>{
      const res=divMap[k];
      if(!res||typeof res!=='object') return;
      if(!Number.isFinite(res.homeTotal)||!Number.isFinite(res.awayTotal)) return;
      target[div][k]=Object.assign({}, res, {
        homePlayers:Array.isArray(res.homePlayers)?res.homePlayers:[],
        awayPlayers:Array.isArray(res.awayPlayers)?res.awayPlayers:[],
        source:res.source||'bundle'
      });
    });
  });
}
function applyApiLeagueCards(target, cards){
  (cards||[]).forEach(card=>{
    if(!card||card.quick) return;
    if(card.format && card.format!=='league') return;
    const div=Number.isInteger(card.divIndex)?card.divIndex:(Number.isInteger(card.div)?card.div:null);
    const week=card.week, mi=card.matchIndex!=null?card.matchIndex:card.mi;
    if(div==null||div<0||div>2||!Number.isFinite(week)||!Number.isFinite(mi)) return;
    if(!Number.isFinite(card.homeTotal)||!Number.isFinite(card.awayTotal)) return;
    const key='w'+week+'m'+mi;
    target[div][key]={
      homeNum:card.homeNum, awayNum:card.awayNum,
      homeTotal:card.homeTotal, awayTotal:card.awayTotal,
      homePlayers:Array.isArray(card.homePlayers)?card.homePlayers:[],
      awayPlayers:Array.isArray(card.awayPlayers)?card.awayPlayers:[],
      savedAt:card.savedAt||card.updatedAt||null,
      source:'live'
    };
  });
}
function computeLeagueTable(divIdx, resultsMap){
  const teams=SEED.teams[divIdx]||[];
  const stats=teams.map((name,i)=>({num:i+1,name,played:0,won:0,drawn:0,lost:0,pinsFor:0,pinsAgainst:0,points:0}));
  Object.values(resultsMap||{}).forEach(res=>{
    const home=stats[res.homeNum-1], away=stats[res.awayNum-1];
    if(!home||!away||!home.name||!away.name) return;
    home.played++; away.played++;
    home.pinsFor+=res.homeTotal; home.pinsAgainst+=res.awayTotal;
    away.pinsFor+=res.awayTotal; away.pinsAgainst+=res.homeTotal;
    if(res.homeTotal>res.awayTotal){ home.won++; away.lost++; home.points+=LEAGUE_POINTS.win; away.points+=LEAGUE_POINTS.loss; }
    else if(res.homeTotal<res.awayTotal){ away.won++; home.lost++; away.points+=LEAGUE_POINTS.win; home.points+=LEAGUE_POINTS.loss; }
    else { home.drawn++; away.drawn++; home.points+=LEAGUE_POINTS.draw; away.points+=LEAGUE_POINTS.draw; }
  });
  return stats.filter(s=>s.name).sort((a,b)=> b.points-a.points
    || (b.pinsFor-b.pinsAgainst)-(a.pinsFor-a.pinsAgainst)
    || b.pinsFor-a.pinsFor
    || a.name.localeCompare(b.name));
}
function listLeagueResults(divIdx, resultsMap){
  const teams=SEED.teams[divIdx]||[];
  return Object.keys(resultsMap||{}).map(key=>{
    const m=/^w(\d+)m(\d+)$/.exec(key);
    if(!m) return null;
    const week=+m[1], mi=+m[2], res=resultsMap[key];
    const weekRow=(SEED.weeks||[]).find(w=>w.week===week);
    return {
      key, week, mi, date:weekRow?weekRow.date:null, label:weekRow?weekRow.label:('Week '+week),
      homeNum:res.homeNum, awayNum:res.awayNum,
      homeName:teams[res.homeNum-1]||('Team '+res.homeNum),
      awayName:teams[res.awayNum-1]||('Team '+res.awayNum),
      homeTotal:res.homeTotal, awayTotal:res.awayTotal,
      savedAt:res.savedAt||null, source:res.source||''
    };
  }).filter(Boolean).sort((a,b)=> b.week-a.week || a.mi-b.mi);
}
function computePlayerAverages(divIdx, resultsMap){
  const teams=SEED.teams[divIdx]||[];
  const index={};
  Object.keys(resultsMap||{}).forEach(key=>{
    const res=resultsMap[key];
    const homeTeam=teams[res.homeNum-1], awayTeam=teams[res.awayNum-1];
    function add(players, team){
      (players||[]).forEach(p=>{
        if(!p||!p.name) return;
        const name=String(p.name).trim();
        if(!name || name.toLowerCase()==='team total') return;
        const pins=Number(p.pins);
        if(!Number.isFinite(pins)) return;
        const id=name.toLowerCase()+'|'+team;
        if(!index[id]) index[id]={name, team, games:0, pins:0};
        index[id].games++; index[id].pins+=pins;
      });
    }
    add(res.homePlayers, homeTeam||'');
    add(res.awayPlayers, awayTeam||'');
  });
  return Object.values(index).map(p=>({
    name:p.name, team:p.team, games:p.games, pins:p.pins,
    avg:p.games?Math.round((p.pins/p.games)*10)/10:0
  })).sort((a,b)=> b.avg-a.avg || b.pins-a.pins || a.name.localeCompare(b.name));
}
async function fetchJsonQuiet(url){
  const res=await fetch(url,{cache:'no-store'});
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}
async function loadNativeLeagueStats(opts){
  const quiet=!!(opts&&opts.quiet);
  if(!quiet){ ui.leagueStatsLoading=true; ui.leagueStatsErr=''; render(); }
  const results=emptyLeagueResults();
  const sources=[];
  seedPlayedIntoResults(results);
  if(Object.keys(results[0]).length||Object.keys(results[1]).length||Object.keys(results[2]).length) sources.push('seed');
  try{
    const bundled=await fetchJsonQuiet(LEAGUE_RESULTS_JSON);
    applyBundledLeagueResults(results, bundled);
    sources.push('bundle');
  }catch(e){ /* offline shell may still have seed */ }
  let liveErr='';
  if(navigator.onLine!==false){
    try{
      const api=await fetchJsonQuiet(leagueCardsUrl());
      if(api && Array.isArray(api.cards)){
        applyApiLeagueCards(results, api.cards);
        if(api.source) sources.push('api:'+api.source);
        else sources.push('api');
      }
    }catch(e){
      liveErr=(e&&e.message)?e.message:'Could not reach live league scores.';
    }
    if(supabaseConfigured()){
      try{
        const remote=await supabaseRpc('skittles_league_cards', {});
        if(Array.isArray(remote) && remote.length){
          applyApiLeagueCards(results, remote);
          sources.push('supabase');
        }
      }catch(e){ /* optional; API may already cover */ }
    }
  } else if(!sources.length){
    liveErr='offline';
  }
  const total=results.reduce((n,m)=>n+Object.keys(m).length,0);
  ui.leagueStats={results, total};
  ui.leagueStatsSource=sources.join('+')||'none';
  rebuildLeaguePlayedCache(results);
  // Keep SEED.played in sync so All fixtures sees the same totals as Results immediately
  try{
    Object.keys(leaguePlayedCache).forEach(k=>{
      SEED.played=SEED.played||{};
      SEED.played[k]={h:leaguePlayedCache[k].h, a:leaguePlayedCache[k].a};
    });
  }catch(e){}
  if(!total){
    ui.leagueStatsErr=liveErr==='offline'
      ? 'No signal and no saved league results on this phone yet.'
      : (liveErr || 'No league results to show yet.');
  } else if(liveErr && liveErr!=='offline'){
    ui.leagueStatsErr='Showing saved results — live update failed ('+liveErr+').';
  } else {
    ui.leagueStatsErr='';
  }
  ui.leagueStatsLoading=false; render();
}
function leagueStatsDiv(){
  if(ui.leagueDiv===0||ui.leagueDiv===1||ui.leagueDiv===2) return ui.leagueDiv;
  return session?session.div:0;
}
function isRubGroupComplete(c, groupBoxes){
  return ['home','away'].every(side=>{
    const named=c.players[side].filter(p=>p.name);
    if(!named.length) return false;
    return named.every(p=>groupBoxes.every(b=>p.boxes[b]!==null));
  });
}
function rubGroupsCompleteFlags(c){
  return groupsFor(c).map(g=>isRubGroupComplete(c,g));
}
function exportPairPayload(c, groupIndex){
  const groups=groupsFor(c);
  const base=exportJSON(c);
  return Object.assign({}, base, {
    localKey:c.key,
    status:c.status||'draft',
    groupIndex,
    groupBoxes:groups[groupIndex]?groups[groupIndex].slice():[],
    partial:true,
    event:'rub-pair-complete',
    completedGroups:rubGroupsCompleteFlags(c),
    syncedAt:new Date().toISOString(),
    submittedByTeam:session?{div:session.div,num:session.num,name:teamName(session.div,session.num)}:null
  });
}
function exportFinalPayload(c){
  return Object.assign({}, exportJSON(c), {
    localKey:c.key,
    status:c.status||'submitted',
    partial:false,
    event:'match-submitted',
    completedGroups:rubGroupsCompleteFlags(c),
    syncedAt:new Date().toISOString(),
    submittedByTeam:session?{div:session.div,num:session.num,name:teamName(session.div,session.num)}:null
  });
}
async function loadSyncMeta(){
  try{
    const m=await idbGet('kv','syncMeta');
    if(m&&m.day) syncMeta=m;
  }catch(e){}
  const day=todayISO();
  if(syncMeta.day!==day){ syncMeta={day, count:0}; }
}
function saveSyncMeta(){ return idbPut('kv','syncMeta',syncMeta).catch(()=>{}); }
async function refreshSyncPendingCount(){
  try{
    const all=await idbAll('syncQueue');
    syncUi.pending=Object.values(all).filter(j=>j&&j.status==='pending').length;
  }catch(e){ syncUi.pending=0; }
}
async function enqueueLeagueSync(jobId, payload){
  if(!leagueSyncEnabled()) return;
  const job={
    id:jobId, status:'pending', payload, createdAt:new Date().toISOString(),
    attempts:0, lastError:null, url:leagueCardsUrl()
  };
  await idbPut('syncQueue', jobId, job);
  await refreshSyncPendingCount();
  flushLeagueSyncQueue();
}
function maybeQueueRubPairSync(c, beforeFlags){
  if(!leagueSyncEnabled()||!c) return;
  const after=rubGroupsCompleteFlags(c);
  after.forEach((done,i)=>{
    if(done && !(beforeFlags&&beforeFlags[i])){
      const payload=exportPairPayload(c,i);
      enqueueLeagueSync(c.key+'::pair::'+i, payload).catch(saveFailed);
    }
  });
}
async function queueFinalMatchSync(c){
  if(!leagueSyncEnabled()||!c) return;
  return enqueueLeagueSync(c.key+'::final', exportFinalPayload(c));
}
async function postLeagueCard(payload){
  const url=leagueCardsUrl();
  const res=await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json'},
    body:JSON.stringify(payload),
    mode:'cors',
    credentials:'omit',
    cache:'no-store'
  });
  const text=await res.text().catch(()=> '');
  let data=null;
  try{ data=text?JSON.parse(text):null; }catch(e){ data={raw:text}; }
  if(!res.ok){
    const err=new Error('League API '+res.status+(text?' '+text.slice(0,160):''));
    err.status=res.status; err.body=data; throw err;
  }
  return data;
}
async function flushLeagueSyncQueue(){
  if(!leagueSyncEnabled()||syncUi.flushing) return;
  if(navigator.onLine===false) return;
  syncUi.flushing=true;
  try{
    await loadSyncMeta();
    const all=await idbAll('syncQueue');
    const pending=Object.values(all).filter(j=>j&&j.status==='pending')
      .sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
    for(const job of pending){
      if(syncMeta.count>=LEAGUE_DAILY_CAP){
        syncUi.lastErr='Daily sync cap ('+LEAGUE_DAILY_CAP+') reached — waiting until tomorrow.';
        break;
      }
      try{
        job.attempts=(job.attempts||0)+1;
        await postLeagueCard(job.payload);
        job.status='sent';
        job.sentAt=new Date().toISOString();
        job.lastError=null;
        syncMeta.count+=1;
        syncUi.lastOk=job.sentAt;
        syncUi.lastErr=null;
        await idbPut('syncQueue', job.id, job);
        await saveSyncMeta();
      }catch(err){
        job.lastError=(err&&err.message)?err.message:String(err);
        await idbPut('syncQueue', job.id, job);
        syncUi.lastErr=job.lastError;
        // stop this flush pass on hard failures (network / 5xx); leave job pending
        break;
      }
    }
  }catch(e){
    syncUi.lastErr=(e&&e.message)?e.message:String(e);
  }finally{
    syncUi.flushing=false;
    await refreshSyncPendingCount();
  }
}
function leagueSyncStatusHtml(){
  if(!leagueSyncEnabled()) return '';
  const base=leagueBaseUrl();
  let line='League sync → '+esc(base)+'/api/cards';
  if(syncUi.pending) line+=' · '+syncUi.pending+' waiting';
  else if(syncUi.lastOk) line+=' · last sent '+esc(syncUi.lastOk.slice(11,19));
  if(syncUi.lastErr) line+=' · '+esc(syncUi.lastErr);
  return `<p class="muted small league-sync-status" style="margin:8px 0 0">${line}</p>`;
}

/* ---------- Supabase shared team sync (PIN-gated RPCs; offline-first) ---------- */
function supabaseConfigured(){
  const {url, anonKey}=deploySupabase();
  if(!url || !anonKey) return false;
  if(anonKey.includes('PASTE_ANON') || anonKey.includes('YOUR_ANON')) return false;
  return anonKey.length > 20;
}
function supabaseEnabled(){ return supabaseConfigured() && session && session.pin; }
function supabaseRpcUrl(fn){
  return deploySupabase().url+'/rest/v1/rpc/'+fn;
}
async function supabaseRpc(fn, body){
  const key=deploySupabase().anonKey;
  const res=await fetch(supabaseRpcUrl(fn),{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Accept':'application/json',
      'apikey':key,
      'Authorization':'Bearer '+key
    },
    body:JSON.stringify(body||{}),
    mode:'cors',
    credentials:'omit',
    cache:'no-store'
  });
  const text=await res.text().catch(()=> '');
  let data=null;
  try{ data=text?JSON.parse(text):null; }catch(e){ data={raw:text}; }
  if(!res.ok){
    const msg=(data&&data.message)||(data&&data.error)||text||('HTTP '+res.status);
    const err=new Error(String(msg));
    err.status=res.status; err.body=data; throw err;
  }
  return data;
}
function cardParticipantKeys(c){
  const home=sideMeta(c,'home'), away=sideMeta(c,'away');
  return {home_team_key:teamKey(home.div,home.num), away_team_key:teamKey(away.div,away.num)};
}
async function blobToBase64(blob){
  const buf=new Uint8Array(await blob.arrayBuffer());
  let s=''; const chunk=0x8000;
  for(let i=0;i<buf.length;i+=chunk) s+=String.fromCharCode.apply(null, buf.subarray(i, i+chunk));
  return btoa(s);
}
function base64ToBlob(b64, type){
  const bin=atob(b64);
  const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:type||'application/octet-stream'});
}
async function refreshSbPendingCount(){
  try{
    const all=await idbAll('sbQueue');
    sbUi.pending=Object.values(all).filter(j=>j&&j.status==='pending').length;
  }catch(e){ sbUi.pending=0; }
}
async function enqueueSbJob(id, kind, body){
  const job={id, kind, body, status:'pending', createdAt:new Date().toISOString(), attempts:0, lastError:null};
  await idbPut('sbQueue', id, job);
  await refreshSbPendingCount();
  flushSupabaseQueue();
}
async function queueSupabaseCardUpsert(cardKey){
  if(!supabaseEnabled()) return;
  const c=cards[cardKey]; if(!c) return;
  const parts=cardParticipantKeys(c);
  const payload=Object.assign({}, c, {cloudDirty:undefined});
  delete payload.cloudDirty;
  await enqueueSbJob('card::'+cardKey, 'upsert_card', {
    p_team_key:sessionTeamKey(),
    p_pin:session.pin,
    p_card_key:cardKey,
    p_home_team_key:parts.home_team_key,
    p_away_team_key:parts.away_team_key,
    p_payload:payload
  });
}
async function queueSupabaseMedia(cardKey, kind, blob){
  if(!supabaseEnabled()||!blob) return;
  const b64=await blobToBase64(blob);
  await enqueueSbJob('media::'+cardKey+'::'+kind, 'upsert_media', {
    p_team_key:sessionTeamKey(),
    p_pin:session.pin,
    p_card_key:cardKey,
    p_kind:kind,
    p_content_type:blob.type||'application/octet-stream',
    p_data_base64:b64
  });
}
async function flushSupabaseQueue(){
  if(!supabaseEnabled()||sbUi.flushing) return;
  if(navigator.onLine===false) return;
  sbUi.flushing=true;
  try{
    const all=await idbAll('sbQueue');
    const pending=Object.values(all).filter(j=>j&&j.status==='pending')
      .sort((a,b)=>(a.createdAt||'').localeCompare(b.createdAt||''));
    for(const job of pending){
      try{
        job.attempts=(job.attempts||0)+1;
        // refresh PIN fields from current session
        if(job.body){
          job.body.p_team_key=sessionTeamKey();
          job.body.p_pin=session.pin;
        }
        const fn=job.kind==='upsert_media'?'skittles_upsert_media':'skittles_upsert_card';
        await supabaseRpc(fn, job.body);
        job.status='sent';
        job.sentAt=new Date().toISOString();
        job.lastError=null;
        sbUi.lastOk=job.sentAt;
        sbUi.lastErr=null;
        await idbPut('sbQueue', job.id, job);
        if(job.kind==='upsert_card' && job.body&&job.body.p_card_key && cards[job.body.p_card_key]){
          cards[job.body.p_card_key].cloudDirty=false;
          cards[job.body.p_card_key].cloudUpdatedAt=job.sentAt;
          await idbPut('cards', job.body.p_card_key, cards[job.body.p_card_key]);
        }
      }catch(err){
        job.lastError=(err&&err.message)?err.message:String(err);
        await idbPut('sbQueue', job.id, job);
        sbUi.lastErr=job.lastError;
        const lower=String(job.lastError||'').toLowerCase();
        if(lower.includes('invalid team or pin') || lower.includes('42501')) sbUi.setupNeeded=true;
        break;
      }
    }
  }catch(e){
    sbUi.lastErr=(e&&e.message)?e.message:String(e);
  }finally{
    sbUi.flushing=false;
    await refreshSbPendingCount();
  }
}
async function applyRemoteCard(row){
  if(!row||!row.card_key||!row.payload) return;
  const key=row.card_key;
  const remote=row.payload;
  const local=cards[key];
  const remoteTs=row.updated_at?Date.parse(row.updated_at):0;
  const localTs=local&&local.cloudUpdatedAt?Date.parse(local.cloudUpdatedAt):0;
  // Prefer remote unless local has unsynced edits newer than last cloud stamp
  if(local && local.cloudDirty && localTs && remoteTs && localTs>remoteTs) return;
  const merged=Object.assign({}, remote, {key, cloudUpdatedAt:row.updated_at||null, cloudDirty:false});
  cards[key]=merged;
  await idbPut('cards', key, merged);
  const media=row.media||{};
  for(const kind of Object.keys(media)){
    const m=media[kind];
    if(!m||!m.data_base64) continue;
    const blob=base64ToBlob(m.data_base64, m.content_type||'application/octet-stream');
    if(kind==='photo'){
      await idbPut('photos', key, blob);
      if(photoURLs[key]) URL.revokeObjectURL(photoURLs[key]);
      photoURLs[key]=URL.createObjectURL(blob);
      cards[key].hasPhoto=true;
      await idbPut('cards', key, cards[key]);
    } else if(kind==='sig_home'||kind==='sig_away'){
      const side=kind==='sig_home'?'home':'away';
      await idbPut('sigs', sigStoreKey(key,side), blob);
      if(!sigURLs[key]) sigURLs[key]={};
      if(sigURLs[key][side]) URL.revokeObjectURL(sigURLs[key][side]);
      sigURLs[key][side]=URL.createObjectURL(blob);
      if(side==='home') cards[key].hasSigHome=true; else cards[key].hasSigAway=true;
      await idbPut('cards', key, cards[key]);
    }
  }
}
async function pullSupabaseTeamData(){
  if(!supabaseEnabled()) return {ok:false, reason:'disabled'};
  sbUi.pulling=true;
  try{
    const rows=await supabaseRpc('skittles_pull',{
      p_team_key:sessionTeamKey(),
      p_pin:session.pin
    });
    const list=Array.isArray(rows)?rows:[];
    for(const row of list) await applyRemoteCard(row);
    sbUi.lastOk=new Date().toISOString();
    sbUi.lastErr=null;
    sbUi.ready=true;
    sbUi.setupNeeded=false;
    return {ok:true, count:list.length};
  }catch(err){
    const msg=(err&&err.message)?err.message:String(err);
    sbUi.lastErr=msg;
    sbUi.ready=false;
    // Local PIN matched seed.js, but Supabase teams table rejected it → seed_teams.sql not applied
    const lower=msg.toLowerCase();
    sbUi.setupNeeded=lower.includes('invalid team or pin') || lower.includes('42501');
    return {ok:false, reason:msg, setupNeeded:sbUi.setupNeeded};
  }finally{
    sbUi.pulling=false;
  }
}
function cloudSyncStatusHtml(){
  if(!supabaseConfigured()||!session) return '';
  if(sbUi.pulling) return `<div class="banner demo" role="status">Checking phone sync…</div>`;
  if(sbUi.setupNeeded){
    return `<div class="banner bad" role="status">Phone sync is not on yet — scores still save on this phone. Ask the league organiser to finish Supabase setup (team PIN list), then log in again.</div>`;
  }
  if(sbUi.ready){
    const pending=sbUi.pending?` · ${sbUi.pending} change${sbUi.pending===1?'':'s'} waiting to upload`:'';
    return `<div class="banner ok" role="status">Phone sync is on${pending}. Other phones on this team see shared cards when online.</div>`;
  }
  if(sbUi.lastErr){
    return `<div class="banner bad" role="status">Phone sync hiccup: ${esc(sbUi.lastErr)}. Scoring still works on this phone.</div>`;
  }
  return '';
}
/* ---------- result PDF (offline, no library) ---------- */
function pdfSafe(s){
  // Helvetica here is ASCII/WinAnsi-safe ASCII only — map common punctuation so PDFs
  // do not fill with "?" for middots, dashes, etc.
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[\u2018\u2019\u02BC\u0060]/g,"'")
    .replace(/[\u201C\u201D]/g,'"')
    .replace(/[\u2013\u2014\u2212]/g,'-')
    .replace(/[\u00A0\u202F\u2009]/g,' ')
    .replace(/[\u00B7\u2022\u2023\u22C5]/g,'|')
    .replace(/\u2026/g,'...')
    .replace(/\u00D7/g,'x')
    .replace(/[^\x20-\x7E]/g,'');
}
function pdfEscape(s){ return pdfSafe(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)'); }
function pdfPad(s,w,dir){
  s=pdfSafe(String(s==null?'':s));
  if(s.length>w) s=s.slice(0,w);
  return dir==='r' ? s.padStart(w,' ') : s.padEnd(w,' ');
}
function matchPdfFileName(c){
  const slug=s=>pdfSafe(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  return 'skittles-'+slug(sideName(c,'home'))+'-v-'+slug(sideName(c,'away'))+'-'+(c.date||todayISO())+'.pdf';
}
function matchPdfLines(c){
  const hn=sideName(c,'home'), an=sideName(c,'away');
  const sc=matchScore(c), fmt=cardFormat(c);
  const home=sideMeta(c,'home');
  const unit=sc.mode==='pins'?'':' pts';
  const rubs=fmt.rubs;
  // Portrait mono table: name + rub cols + total (~62 Courier chars)
  const nameW=Math.max(12, 62 - (rubs*4) - 5);
  const colW=4, totW=5;
  const tableW=nameW + rubs*colW + totW;
  const rule=(ch)=>({t:ch.repeat(tableW), mono:true, size:8, gap:2});
  const rowPlayer=(label, boxes, tot, fines)=>{
    let t=pdfPad(label,nameW);
    for(let i=0;i<rubs;i++){
      const v=boxes[i];
      let cell=v===null||v===undefined?'-':String(v);
      if(fines && fines[i] && cell!=='-') cell=cell+'*'; // * = fine (display only; score unchanged)
      t+=pdfPad(cell, colW, 'r');
    }
    t+=pdfPad(tot===null||tot===undefined?'-':String(tot), totW, 'r');
    return {t, mono:true, size:8, gap:2};
  };
  const hdr=(()=>{
    let t=pdfPad('Player',nameW);
    for(let i=0;i<rubs;i++) t+=pdfPad('R'+(i+1), colW, 'r');
    t+=pdfPad('Tot', totW, 'r');
    return {t, mono:true, size:8, gap:2};
  })();

  const lines=[];
  // RESULT AT TOP (screenshot-friendly)
  lines.push({t:'SKITTLES SCORER', bold:true, size:13, gap:8});
  lines.push({t:'RESULT', bold:true, size:11, gap:4});
  lines.push(rule('='));
  lines.push({t:pdfPad(hn, Math.min(40, tableW-10))+pdfPad(String(sc.home)+unit, 10, 'r'), mono:true, size:11, gap:3});
  lines.push({t:pdfPad(an, Math.min(40, tableW-10))+pdfPad(String(sc.away)+unit, 10, 'r'), mono:true, size:11, gap:3});
  lines.push(rule('='));
  if(sc.home===sc.away) lines.push({t:'DRAW', bold:true, size:12, gap:6});
  else lines.push({t:pdfSafe((sc.home>sc.away?hn:an)+' win by '+Math.abs(sc.home-sc.away)+unit), bold:true, size:12, gap:6});
  if(sc.mode!=='pins') lines.push({t:'Pins  '+sc.pins.home+' - '+sc.pins.away, size:10, gap:6});

  const kind=c.quick?(fmt.id==='league'?'Quick Match':fmt.name+' cup'):('Week '+c.week);
  lines.push({t:pdfSafe(kind)+'  |  '+pdfSafe(fmtDate(c.date)), size:10, gap:2});
  const ven=venueOf(home.div,home.num);
  if(ven) lines.push({t:pdfSafe(ven), size:9, gap:2});
  if(c.status==='submitted' && c.submittedAt){
    lines.push({t:'Submitted '+pdfSafe(new Date(c.submittedAt).toLocaleString('en-GB'))+(c.by?' by '+pdfSafe(c.by):''), size:9, gap:10});
  } else {
    lines.push({t:'Draft - saved on this phone'+(c.savedAt?' - '+pdfSafe(c.savedAt):''), size:9, gap:10});
  }

  ['home','away'].forEach(side=>{
    const list=c.players[side], tot=teamPins(list), nm=sideName(c,side);
    const ct=colTotals(c,list), ups=pinsUp(c,list);
    lines.push({t:(side==='home'?'HOME':'AWAY')+'  '+pdfSafe(nm), bold:true, size:11, gap:2});
    lines.push({t:'Pins total  '+tot, size:10, gap:4});
    lines.push(rule('-'));
    lines.push(hdr);
    lines.push(rule('-'));
    let anyFine=false;
    list.forEach(p=>{
      if(p.fine && p.fine.some(Boolean)) anyFine=true;
      lines.push(rowPlayer(playerLabel(p), p.boxes, p.name?pinsOf(p):null, p.fine));
    });
    lines.push(rule('-'));
    if(anyFine) lines.push({t:'* = fine (display only; does not change the score)', size:8, gap:2});
    if(formatUsesPairRubs(c)){
      // Show paired rub scores under the grid (3 values for 6 rubs)
      let rubLine=pdfPad('Rub score', nameW);
      ups.forEach(x=>{ rubLine+=pdfPad(x||'-', colW*2, 'r'); });
      lines.push({t:rubLine.slice(0, tableW), mono:true, size:8, gap:2});
      lines.push(rowPlayer('Each rub', ct, tot));
    } else {
      lines.push(rowPlayer('Rub score', ups, tot));
    }
    lines.push({t:' ', size:8, gap:8});
  });

  // Captured captain signatures from the app pads are drawn into these boxes
  lines.push({t:'CAPTAIN SIGNATURES', bold:true, size:11, gap:6});
  lines.push({
    sigBoxes:[
      {title:'HOME CAPTAIN', team:hn, side:'home'},
      {title:'AWAY CAPTAIN', team:an, side:'away'}
    ],
    gap:10
  });

  lines.push({t:'Skittles Scorer', size:8, gap:2});
  return lines;
}
function jpegSize(u8){
  let i=2;
  while(i+8<u8.length){
    if(u8[i]!==0xFF) break;
    const marker=u8[i+1];
    if(marker===0xD8||marker===0xD9){ i+=2; continue; }
    const len=(u8[i+2]<<8)|u8[i+3];
    if(marker>=0xC0&&marker<=0xC3&&marker!==0xC4&&len>=7){
      return {h:(u8[i+5]<<8)|u8[i+6], w:(u8[i+7]<<8)|u8[i+8]};
    }
    i+=2+len;
  }
  return {w:400, h:160};
}
async function loadSigJpeg(c,side){
  try{
    const blob=await idbGet('sigs', sigStoreKey(c.key,side));
    if(!blob) return null;
    const buf=new Uint8Array(await blob.arrayBuffer());
    if(buf.length<4||buf[0]!==0xFF||buf[1]!==0xD8) return null;
    const dim=jpegSize(buf);
    return {buf, w:dim.w, h:dim.h};
  }catch(e){ return null; }
}
function pdfJoin(parts){
  // Mix ASCII strings and binary Uint8Array (JPEG) without UTF-8 corruption
  const enc=new TextEncoder(), chunks=[];
  parts.forEach(p=>{ chunks.push(typeof p==='string'?enc.encode(p):p); });
  return new Blob(chunks,{type:'application/pdf'});
}
async function buildMatchPdf(c){
  // Portrait A4 — signature images from IndexedDB pads when present
  const pageW=595, pageH=842, margin=40;
  const contentW=pageW-margin*2;
  const sigBoxH=78, sigLabelH=12, sigTeamH=10, sigBlockH=sigLabelH+sigTeamH+4+sigBoxH+14;
  const sigImgs={
    home: await loadSigJpeg(c,'home'),
    away: await loadSigJpeg(c,'away')
  };
  const lines=matchPdfLines(c);
  const pages=[];
  let y=pageH-margin, buf=[];
  const flush=()=>{ pages.push(buf); buf=[]; y=pageH-margin; };
  lines.forEach(line=>{
    if(line.sigBoxes){
      const need=sigBlockH+(line.gap==null?10:line.gap);
      if(y-need<margin) flush();
      buf.push({...line, y, kind:'sig'});
      y-=need;
      return;
    }
    const size=line.size||11, gap=line.gap==null?3:line.gap, need=size+gap;
    if(y-need<margin) flush();
    buf.push({...line, y, kind:'text'});
    y-=need;
  });
  if(buf.length) flush();
  if(!pages.length) pages.push([{t:'No scores yet', y:pageH-margin, size:12, kind:'text'}]);

  // objects: string body OR {asciiBefore, bin, asciiAfter} for image streams
  const objects=[];
  const obj=body=>{ objects.push(body); return objects.length; };
  const objImage=img=>{
    const dict='<< /Type /XObject /Subtype /Image /Width '+img.w+' /Height '+img.h+
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+img.buf.length+' >>\nstream\n';
    return obj({asciiBefore:dict, bin:img.buf, asciiAfter:'\nendstream'});
  };
  const catalogId=obj('');
  const pagesId=obj('');
  const font1=obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2=obj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const font3=obj('<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const imgIds={};
  if(sigImgs.home) imgIds.home=objImage(sigImgs.home);
  if(sigImgs.away) imgIds.away=objImage(sigImgs.away);
  const pageIds=[];
  pages.forEach(pageLines=>{
    let graphics='', text='BT\n';
    const usedImgs={};
    pageLines.forEach(L=>{
      if(L.kind==='sig' && L.sigBoxes){
        const gapX=16;
        const boxW=Math.floor((contentW-gapX)/2);
        L.sigBoxes.forEach((box,i)=>{
          const x=margin+i*(boxW+gapX);
          const titleY=L.y;
          const teamY=titleY-sigLabelH-2;
          const boxBottom=teamY-sigTeamH-4-sigBoxH;
          text+='/F2 9 Tf\n1 0 0 1 '+x+' '+titleY+' Tm\n('+pdfEscape(box.title)+') Tj\n';
          text+='/F1 8 Tf\n1 0 0 1 '+x+' '+teamY+' Tm\n('+pdfEscape(box.team)+') Tj\n';
          graphics+='0.9 w\n'+x+' '+boxBottom+' '+boxW+' '+sigBoxH+' re S\n';
          const img=sigImgs[box.side], imgId=imgIds[box.side];
          if(img&&imgId){
            usedImgs[box.side]=imgId;
            const pad=4;
            const maxW=boxW-pad*2, maxH=sigBoxH-pad*2;
            const scale=Math.min(maxW/img.w, maxH/img.h);
            const dw=img.w*scale, dh=img.h*scale;
            const ix=x+pad+(maxW-dw)/2, iy=boxBottom+pad+(maxH-dh)/2;
            const name=box.side==='home'?'/ImHome':'/ImAway';
            graphics+='q '+dw.toFixed(2)+' 0 0 '+dh.toFixed(2)+' '+ix.toFixed(2)+' '+iy.toFixed(2)+' cm '+name+' Do Q\n';
          } else {
            text+='/F1 7 Tf\n1 0 0 1 '+(x+6)+' '+(boxBottom+sigBoxH-12)+' Tm\n('+pdfEscape('Sign in the app')+') Tj\n';
          }
        });
        return;
      }
      const font=L.mono?'/F3':(L.bold?'/F2':'/F1');
      const size=L.size||11;
      text+=font+' '+size+' Tf\n1 0 0 1 '+margin+' '+L.y+' Tm\n('+pdfEscape(L.t)+') Tj\n';
    });
    text+='ET';
    const stream=(graphics?graphics:'')+text;
    const contentId=obj('<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream');
    let xObj='';
    if(usedImgs.home) xObj+='/ImHome '+usedImgs.home+' 0 R ';
    if(usedImgs.away) xObj+='/ImAway '+usedImgs.away+' 0 R ';
    const xRes=xObj?(' /XObject << '+xObj+'>>'):'';
    pageIds.push(obj('<< /Type /Page /Parent '+pagesId+' 0 R /MediaBox [0 0 '+pageW+' '+pageH+'] /Contents '+contentId+' 0 R /Resources << /Font << /F1 '+font1+' 0 R /F2 '+font2+' 0 R /F3 '+font3+' 0 R >>'+xRes+' >> >>'));
  });
  objects[catalogId-1]='<< /Type /Catalog /Pages '+pagesId+' 0 R >>';
  objects[pagesId-1]='<< /Type /Pages /Kids ['+pageIds.map(id=>id+' 0 R').join(' ')+'] /Count '+pageIds.length+' >>';

  const enc=new TextEncoder();
  const parts=['%PDF-1.4\n'];
  const offsets=[0];
  let abs=parts[0].length;
  objects.forEach((body,i)=>{
    offsets.push(abs);
    const head=(i+1)+' 0 obj\n';
    const tail='\nendobj\n';
    if(body && typeof body==='object' && body.bin){
      parts.push(head, body.asciiBefore, body.bin, body.asciiAfter, tail);
      abs+=enc.encode(head).length+enc.encode(body.asciiBefore).length+body.bin.length+enc.encode(body.asciiAfter).length+enc.encode(tail).length;
    } else {
      const chunk=head+body+tail;
      parts.push(chunk);
      abs+=enc.encode(chunk).length;
    }
  });
  const xrefStart=abs;
  let xref='xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n';
  for(let i=1;i<=objects.length;i++) xref+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  xref+='trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xrefStart+'\n%%EOF';
  parts.push(xref);
  return pdfJoin(parts);
}
async function shareMatchPdf(c){
  try{
    const blob=await buildMatchPdf(c);
    const name=matchPdfFileName(c);
    const file=new File([blob],name,{type:'application/pdf'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title:sideName(c,'home')+' v '+sideName(c,'away'), text:'Skittles match result'});
      ui.msg=''; render();
      return;
    }
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=name; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
    ui.msg='';
    const note=document.createElement('div');
    note.className='banner ok'; note.setAttribute('role','status');
    note.textContent='PDF saved — check your downloads.';
    const finish=$app.querySelector('.finish'); if(finish) finish.prepend(note);
    setTimeout(()=>{ note.remove(); }, 3500);
  }catch(err){
    if(err && err.name==='AbortError') return;
    ui.msg='Could not share the PDF. Try again, or use Download PDF.';
    render();
  }
}
async function downloadMatchPdf(c){
  try{
    const blob=await buildMatchPdf(c);
    const name=matchPdfFileName(c);
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url; a.download=name; a.rel='noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  }catch(err){
    ui.msg='Could not create the PDF on this phone.';
    render();
  }
}
function pdfActionsHtml(c){
  const sc=matchScore(c);
  const ready=c.status==='submitted' || (sc.pins.home+sc.pins.away>0 && !checkCard(c).blockers.length);
  if(!ready) return '';
  const label=c.status==='submitted'?'Share result PDF':'Share PDF of this result';
  return `<div class="pdf-actions">
    <p class="muted small" style="margin:14px 0 10px">Portrait PDF with the result, score tables, and captain signatures — made for sharing.</p>
    <button class="btn block" data-a="share-pdf">${label}</button>
    <button class="btn quiet block" data-a="download-pdf" style="margin-top:8px">Download PDF</button>
  </div>`;
}
function sigPadsHtml(c){
  const locked=c.status==='submitted';
  const pad=(side)=>{
    const label=side==='home'?'Home captain':'Away captain';
    const nm=sideName(c,side);
    const has=side==='home'?c.hasSigHome:c.hasSigAway;
    const url=sigURLs[c.key]&&sigURLs[c.key][side];
    let body='';
    if(locked && has && url){
      body=`<img class="sig-img" src="${url}" alt="${esc(label)} signature">`;
    } else {
      body=`<canvas class="sig-pad" data-side="${side}" aria-label="${esc(label)} signature pad"></canvas>`;
      if(!locked) body+=`<button type="button" class="btn quiet block sig-clear" data-a="sig-clear" data-side="${side}">Clear ${side} signature</button>`;
    }
    return `<div class="sig-pad-wrap" data-side="${side}">
      <div class="sig-label">${label} · ${esc(nm)}${has?' <span class="sig-ok">✓</span>':''}</div>
      <p class="muted small sig-hint">Print or draw signature with a finger or stylus</p>
      ${body}
    </div>`;
  };
  return `<div class="sigs">
    <h3>Captain signatures</h3>
    <p class="muted small" style="margin:0 0 4px">Both captains sign below. Signatures are saved on this phone and go onto the result PDF.</p>
    ${pad('home')}${pad('away')}
  </div>`;
}
function refreshFinishChecks(c){
  const ul=$app.querySelector('.finish ul.check');
  if(!ul) return;
  const chk=checkCard(c);
  ul.innerHTML=chk.lines.map(l=>`<li class="${l.s==='ok'?'':l.s}">${esc(l.t)}</li>`).join('');
  const submit=$app.querySelector('.finish [data-a="submit"]');
  if(submit){
    submit.disabled=!!chk.blockers.length;
    const hint=$app.querySelector('.finish [data-a="submit"] + p.muted');
    if(hint && hint.textContent && hint.textContent.includes('Fix the red')){
      hint.style.display=chk.blockers.length?'':'none';
    }
  }
  // Update ✓ marks on pad labels without remounting canvases
  ['home','away'].forEach(side=>{
    const wrap=$app.querySelector('.sig-pad-wrap[data-side="'+side+'"] .sig-label');
    if(!wrap) return;
    const has=side==='home'?c.hasSigHome:c.hasSigAway;
    const nm=sideName(c,side);
    const label=side==='home'?'Home captain':'Away captain';
    wrap.innerHTML=label+' · '+esc(nm)+(has?' <span class="sig-ok">✓</span>':'');
  });
  // Show/hide PDF actions when blockers clear
  const finish=$app.querySelector('.finish');
  if(!finish||c.status==='submitted') return;
  let pdf=$app.querySelector('.pdf-actions');
  const html=pdfActionsHtml(c);
  if(html && !pdf){
    const submit=finish.querySelector('[data-a="submit"]');
    const holder=document.createElement('div');
    holder.innerHTML=html;
    const node=holder.firstElementChild;
    if(submit&&submit.nextSibling) finish.insertBefore(node, submit.nextSibling);
    else finish.appendChild(node);
  } else if(!html && pdf) pdf.remove();
}
function saveSignatureFromCanvas(c,side,cv){
  // Flatten onto white JPEG for IndexedDB + PDF embed
  const w=cv.width, h=cv.height;
  const out=document.createElement('canvas');
  out.width=w; out.height=h;
  const octx=out.getContext('2d');
  octx.fillStyle='#ffffff';
  octx.fillRect(0,0,w,h);
  octx.drawImage(cv,0,0);
  out.toBlob(blob=>{
    if(!blob) return;
    idbPut('sigs', sigStoreKey(c.key,side), blob).then(()=>{
      if(!sigURLs[c.key]) sigURLs[c.key]={};
      if(sigURLs[c.key][side]) URL.revokeObjectURL(sigURLs[c.key][side]);
      sigURLs[c.key][side]=URL.createObjectURL(blob);
      if(side==='home') c.hasSigHome=true; else c.hasSigAway=true;
      persist(c.key);
      queueSupabaseMedia(c.key, side==='home'?'sig_home':'sig_away', blob).catch(()=>{});
      refreshFinishChecks(c);
    }).catch(saveFailed);
  }, 'image/jpeg', 0.92);
}
function clearSignature(side){
  const c=curCard(); if(!c||c.status==='submitted') return;
  idbDel('sigs', sigStoreKey(c.key,side)).catch(saveFailed);
  if(sigURLs[c.key]&&sigURLs[c.key][side]){ URL.revokeObjectURL(sigURLs[c.key][side]); delete sigURLs[c.key][side]; }
  if(side==='home') c.hasSigHome=false; else c.hasSigAway=false;
  persist(c.key);
  const cv=$app.querySelector('canvas.sig-pad[data-side="'+side+'"]');
  if(cv){
    const ctx=cv.getContext('2d');
    const dpr=cv._sigDpr||1;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,cv.width,cv.height);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.strokeStyle='#1a1a1a';
    ctx.lineWidth=2.4;
    ctx.lineCap='round';
    ctx.lineJoin='round';
  }
  refreshFinishChecks(c);
}
function mountSignaturePads(){
  const c=curCard(); if(!c||ui.screen!=='card') return;
  $app.querySelectorAll('canvas.sig-pad').forEach(cv=>{
    const side=cv.dataset.side;
    const dpr=Math.min(window.devicePixelRatio||1, 2);
    const cssW=Math.max(280, cv.clientWidth||cv.parentElement.clientWidth||300);
    const cssH=150;
    cv.width=Math.round(cssW*dpr);
    cv.height=Math.round(cssH*dpr);
    cv.style.width='100%';
    cv.style.height=cssH+'px';
    cv._sigDpr=dpr;
    const ctx=cv.getContext('2d');
    ctx.setTransform(1,0,0,1,0,0);
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,cv.width,cv.height);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.strokeStyle='#1a1a1a';
    ctx.lineWidth=2.4;
    ctx.lineCap='round';
    ctx.lineJoin='round';
    const url=sigURLs[c.key]&&sigURLs[c.key][side];
    if(url){
      const img=new Image();
      img.onload=()=>{ ctx.drawImage(img,0,0,cssW,cssH); };
      img.src=url;
    }
    if(c.status==='submitted'){ cv.style.pointerEvents='none'; return; }
    let drawing=false, last=null, dirty=false;
    const pos=e=>{
      const r=cv.getBoundingClientRect();
      return {x:(e.clientX-r.left)*(cssW/r.width), y:(e.clientY-r.top)*(cssH/r.height)};
    };
    cv.onpointerdown=e=>{
      drawing=true; dirty=false; last=pos(e);
      try{ cv.setPointerCapture(e.pointerId); }catch(err){}
      e.preventDefault();
    };
    cv.onpointermove=e=>{
      if(!drawing) return;
      const p=pos(e);
      ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke();
      last=p; dirty=true;
      e.preventDefault();
    };
    const end=e=>{
      if(!drawing) return;
      drawing=false;
      if(dirty) saveSignatureFromCanvas(c, side, cv);
      e.preventDefault();
    };
    cv.onpointerup=end;
    cv.onpointercancel=end;
  });
}

/* ---------- views ---------- */
function appBar(){
  const on=navigator.onLine!==false;
  return `<header class="appbar"><h1>Skittles Scorer</h1><span class="pill ${on?'':'off'}">${on?'Online':'No signal · saving on this phone'}</span></header>`;
}
function isStandalone(){ return (window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone===true; }
function isIOS(){ return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1); }
function installCard(){
  if(isStandalone()) return '';
  if(ui.installEvt) return `<div class="card install"><b>Put the scorer on your phone</b><p class="muted small" style="margin:6px 0 12px">It opens like any other app and works with no signal.</p><button class="btn block" data-a="install">Install the app</button></div>`;
  if(isIOS()) return `<div class="card install"><b>Put the scorer on your iPhone</b><ol class="steps"><li>Open this page in <b>Safari</b>, not inside WhatsApp or Facebook.</li><li>Tap the <b>Share</b> button, the square with an arrow.</li><li>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="muted small" style="margin:0">After that, open it from the new icon on your Home Screen.</p></div>`;
  return `<div class="card install"><b>Put the scorer on your phone</b><ol class="steps"><li>Open this page in <b>Chrome</b>.</li><li>Tap the menu, the three dots at the top right.</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol><p class="muted small" style="margin:0">After that, open it from the new icon on your Home Screen.</p></div>`;
}
function loginView(){
  let opts='<option value="">Choose your team…</option>';
  SEED.teams.forEach((div,d)=>{
    opts+=`<optgroup label="Division ${d+1}">`+div.map((t,i)=>`<option value="${d}-${i+1}" ${ui.teamSel===d+'-'+(i+1)?'selected':''}>${esc(t)}</option>`).join('')+'</optgroup>';
  });
  const dots=[0,1,2,3].map(i=>`<i class="${i<ui.pin.length?'on':''}"></i>`).join('');
  const keys=['1','2','3','4','5','6','7','8','9'].map(k=>`<button data-a="pin" data-k="${k}">${k}</button>`).join('')+
    `<button data-a="pinback" aria-label="Delete">⌫</button><button data-a="pin" data-k="0">0</button><span></span>`;
  return `<div class="wrap">
    ${installCard()}
    ${supabaseConfigured()?'<div class="banner demo">After login, cards can sync across phones when the league organiser has cloud sync switched on.</div>':''}
    <h2>Log in to score</h2>
    <p class="muted">Pick your team, then enter your 4-digit team PIN.</p>
    <label class="field" for="teamSel">Your team</label>
    <select id="teamSel">${opts}</select>
    <div class="pin" aria-label="PIN entered: ${ui.pin.length} of 4">${dots}</div>
    <div class="err" role="alert">${esc(ui.pinMsg)}</div>
    <div class="numpad">${keys}</div>
    ${isAdminMode()?'<p style="text-align:center;margin-top:18px"><button class="linkbtn" data-a="settings">Admin</button></p>':''}
  </div>`;
}
function settingsView(){
  // Hidden admin only (?admin=1). Scorers never see this in the normal PIN flow.
  const r=settings.rubs;
  const sb=deploySupabase();
  const leagueOn=leagueSyncEnabled();
  return `<div class="wrap">
    <button class="back" data-a="leave-settings">‹ Back</button>
    <h2 style="margin-top:16px">Admin</h2>
    <p class="muted small">Maintainer only. Backend keys live in <code>config.js</code> — not on this screen. Scorers only use a team PIN.</p>
    <p class="muted small" style="margin:10px 0">Supabase: ${supabaseConfigured()?'configured ('+esc(sb.url)+')':'not configured — paste anon key in config.js'} · pending ${sbUi.pending||0}</p>
    <p class="muted small" style="margin:0 0 14px">League site: ${esc(leagueSiteUrl())} · API: ${leagueOn?'on → '+esc(leagueCardsUrl()):'off (set leagueSync in config.js)'} · pending ${syncUi.pending||0}</p>
    <button class="radio ${r===2?'on':''}" data-a="rubs" data-v="2"><span class="dot"></span><span><b>Double rubs</b><br><span class="muted small">Boxes in pairs (South Molton).</span></span></button>
    <button class="radio ${r===1?'on':''}" data-a="rubs" data-v="1"><span class="dot"></span><span><b>Single rubs</b><br><span class="muted small">Each box is its own rub.</span></span></button>
    <button class="radio ${settings.fines?'on':''}" data-a="fines"><span class="dot"></span><span><b>Default: mark fines</b><br><span class="muted small">New cards start with the Fine button on. Scorers can still toggle per match on the card.</span></span></button>
    <button class="btn quiet block" data-a="league-flush" style="margin-top:16px">Retry league queue</button>
    <button class="btn quiet block" data-a="supabase-flush" style="margin-top:8px">Retry Supabase queue</button>
  </div>`;
}
function sessionTopNav(active){
  if(!session) return '';
  const {div:d,num:n}=session;
  const onStats=active==='league-stats';
  return `<div class="session-top">
    <div class="session-top-team"><h2 style="margin:0">${esc(teamName(d,n))}</h2><span class="muted small">Division ${d+1}</span></div>
    <div class="session-top-nav" role="navigation" aria-label="Account">
      <button type="button" class="navtab ${onStats?'on':''}" data-a="league-stats" aria-current="${onStats?'page':'false'}">League stats</button>
      <button type="button" class="back" data-a="logout">Log out</button>
    </div>
  </div>`;
}
function fixturesView(){
  const {div:d,num:n}=session, list=fixturesFor(d,n), nx=nextFixture(list), qms=quickMatchesFor(d,n);
  let h=`<div class="wrap">${sessionTopNav('fixtures')}`;
  if(ui.updateReady) h+=`<div class="banner ok">A new version of the app is ready.<button class="btn block" data-a="update" style="margin-top:10px">Update the app</button></div>`;
  h+=cloudSyncStatusHtml();
  h+=`<div class="card"><b>Quick Match / Cup</b>
    <p class="muted small" style="margin:6px 0 12px">Score as your team against any opponent — league-style friendly or a cup format (Western Counties, Sid Squire, Pidler, Front Pin, Concrete).</p>
    <button class="btn block" data-a="quick">Set up a Quick Match or Cup</button></div>`;
  if(qms.length){
    h+=`<div class="card"><b>Your Quick Matches & Cups</b>`;
    qms.forEach(c=>{
      const home=sideName(c,'home'), away=sideName(c,'away'), fmt=cardFormat(c);
      const kind=fmt.id==='league'?'Quick Match':fmt.short+' cup';
      let st='<span class="muted">Not started</span>';
      if(c.status==='submitted') st='<span class="state-wait">Submitted, waiting to send</span>';
      else if(c.players.home.some(p=>p.name||p.boxes.some(v=>v!==null))||c.players.away.some(p=>p.name||p.boxes.some(v=>v!==null))) st='<span class="state-wait">In progress</span>';
      h+=`<div class="qm-row">
        <button class="frow qm-open" data-a="open-quick" data-key="${esc(c.key)}"><span><b>${fmtDate(c.date)}</b> · ${esc(kind)}<br><span class="muted small">${esc(home)} v ${esc(away)}</span></span>${st}</button>
        <button class="qm-del" data-a="delete-quick" data-key="${esc(c.key)}" aria-label="Delete ${esc(kind)} ${esc(home)} versus ${esc(away)}">Delete</button>
      </div>`;
    });
    h+='</div>';
  }
  if(nx){
    const c=cards[nx.key], home=nx.home===n;
    const opp=teamName(d,home?nx.away:nx.home);
    const label=!c?'Start scoring':c.status==='submitted'?'View or change the card':'Carry on scoring';
    h+=`<div class="card hero"><div class="when">Next match · ${fmtDate(nx.date)} · Week ${nx.week}</div>
      <div class="vs">${esc(teamName(d,nx.home))} v ${esc(teamName(d,nx.away))}</div>
      <div><span class="tag">${home?'You are home':'You are away'}</span><span class="muted small">${esc(venueOf(d,nx.home))}</span></div>
      <p class="muted small" style="margin:10px 0 14px">${home?'As the home team, you score this one. ':'The home team scores this one, but you can score it if they can\'t. '}Either team can make changes.</p>
      <button class="btn block" data-a="open" data-key="${nx.key}">${label}</button></div>`;
  }
  h+=`<div class="card"><b>All fixtures</b>`;
  list.forEach(f=>{
    if(f.bye){ h+=`<div class="frow"><span>${fmtDate(f.date)} · Week ${f.week}</span><span class="muted">Bye</span></div>`; return; }
    const c=cards[f.key], home=f.home===n, opp=teamName(d,home?f.away:f.home);
    const played=fixtureResultForKey(f.key);
    let st='<span class="muted">Not started</span>';
    if(played){
      st=`<span class="state-done">${esc(fixtureScorelineForUser(f, played, n))}</span>`;
    } else if(c&&c.status==='submitted') st='<span class="state-wait">Submitted, waiting to send</span>';
    else if(c) st='<span class="state-wait">In progress</span>';
    const inner=`<span><b>${fmtDate(f.date)}</b> · Week ${f.week}<br><span class="muted small">${home?'Home':'Away'} v ${esc(opp)}</span></span>${st}`;
    h+=`<button class="frow" data-a="open" data-key="${f.key}">${inner}</button>`;
  });
  return h+'</div></div>';
}

function quickView(){
  if(!session) return `<div class="wrap"><button class="back" data-a="back">‹ Fixtures</button><p class="muted">Log in first.</p></div>`;
  const meName=teamName(session.div,session.num);
  const meKey=teamKey(session.div,session.num);
  const side=ui.qmSide==='away'?'away':'home';
  const fmtId=FORMATS[ui.qmFormat]?ui.qmFormat:'league';
  const fmt=FORMATS[fmtId];
  const fmtOpts=FORMAT_ORDER.map(id=>{
    const f=FORMATS[id];
    const cup=id==='league'?'':' · Cup';
    return `<option value="${id}" ${fmtId===id?'selected':''}>${esc(f.name)}${cup}</option>`;
  }).join('');
  const oppLabel=ui.qmOpp ? (()=>{ const t=parseTeamKey(ui.qmOpp); return teamName(t.div,t.num); })() : 'Opposing team';
  const homeLine=side==='home' ? meName : (ui.qmOpp?oppLabel:'Opposing team');
  const awayLine=side==='away' ? meName : (ui.qmOpp?oppLabel:'Opposing team');
  return `<div class="wrap">
    <button class="back" data-a="back">‹ Fixtures</button>
    <h2 style="margin-top:16px">Quick Match / Cup</h2>
    <p class="muted">You are logged in as <b>${esc(meName)}</b>. Set up the game below.</p>
    <div class="card">
      <b>Game setup</b>
      <label class="field" for="qmFormat">Match format</label>
      <select id="qmFormat">${fmtOpts}</select>
      <p class="muted small" style="margin:8px 0 0">${esc(fmt.summary)}</p>
      <p class="field" style="margin-bottom:8px;margin-top:16px">Your team’s side</p>
      <p class="muted small" style="margin:0 0 10px">Choose whether <b>${esc(meName)}</b> is home or away. The opponent fills the other side.</p>
      <div class="setup-side" role="group" aria-label="Your team side">
        <button type="button" class="setup-side-btn ${side==='home'?'on':''}" data-a="qm-side" data-side="home" aria-pressed="${side==='home'}">
          <span class="setup-side-title">Home</span>
          <span class="setup-side-sub">${esc(meName)}</span>
        </button>
        <button type="button" class="setup-side-btn ${side==='away'?'on':''}" data-a="qm-side" data-side="away" aria-pressed="${side==='away'}">
          <span class="setup-side-title">Away</span>
          <span class="setup-side-sub">${esc(meName)}</span>
        </button>
      </div>
      <label class="field" for="qmOpp">Opposing team</label>
      <select id="qmOpp">${teamOptionsHtml(ui.qmOpp, meKey)}</select>
      <div class="setup-preview" aria-live="polite">
        <div><span class="muted small">Home</span><br><b>${esc(homeLine)}</b>${side==='home'?' <span class="tag">You</span>':''}</div>
        <div class="setup-preview-v">v</div>
        <div style="text-align:right"><span class="muted small">Away</span><br><b>${esc(awayLine)}</b>${side==='away'?' <span class="tag">You</span>':''}</div>
      </div>
      <div class="err" role="alert" style="margin-top:10px">${esc(ui.qmMsg)}</div>
      <button class="btn block" data-a="quick-start" style="margin-top:8px">Start scoring</button>
    </div>
  </div>`;
}

function leagueStatsView(){
  if(!session) return `<div class="wrap"><button class="back" data-a="back">‹ Fixtures</button><p class="muted">Log in first.</p></div>`;
  const div=leagueStatsDiv();
  const tab=(ui.leagueTab==='results'||ui.leagueTab==='averages')?ui.leagueTab:'table';
  const meName=teamName(session.div,session.num);
  let h=`<div class="wrap wide">
    ${sessionTopNav('league-stats')}
    <p class="muted" style="margin:0 0 8px"><button type="button" class="linkbtn" data-a="back" style="padding-left:0">‹ Back to fixtures</button></p>
    <h2 style="margin-top:4px">League stats</h2>
    <p class="muted">Division tables, results and averages in the scorer. Scoring still works offline.</p>
    <div class="league-divswitch" role="group" aria-label="Division">
      ${[0,1,2].map(d=>`<button type="button" class="${div===d?'on':''}" data-a="league-div" data-div="${d}">Division ${d+1}</button>`).join('')}
    </div>
    <div class="league-stats-tabs" role="tablist" aria-label="League stats">
      <button type="button" class="${tab==='table'?'on':''}" data-a="league-tab" data-tab="table" role="tab" aria-selected="${tab==='table'}">Table</button>
      <button type="button" class="${tab==='results'?'on':''}" data-a="league-tab" data-tab="results" role="tab" aria-selected="${tab==='results'}">Results</button>
      <button type="button" class="${tab==='averages'?'on':''}" data-a="league-tab" data-tab="averages" role="tab" aria-selected="${tab==='averages'}">Averages</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px">
      <button type="button" class="btn quiet" data-a="league-stats-reload"${ui.leagueStatsLoading?' disabled':''} style="flex:1;min-width:140px">${ui.leagueStatsLoading?'Refreshing…':'Refresh'}</button>
    </div>`;
  if(ui.leagueStatsLoading && !ui.leagueStats){
    h+=`<div class="card"><p class="muted" style="margin:0">Loading league stats…</p></div></div>`;
    return h;
  }
  if(ui.leagueStatsErr){
    const soft=ui.leagueStats && ui.leagueStats.total;
    h+=`<div class="banner ${soft?'demo':'bad'}" role="status">${esc(ui.leagueStatsErr)}</div>`;
  }
  if(!ui.leagueStats || !ui.leagueStats.total){
    h+=`<div class="card"><b>No results yet</b>
      <p class="muted small" style="margin:6px 0 0">When league fixtures are scored on phones (or already on the league site), they show up here.</p></div></div>`;
    return h;
  }
  const map=ui.leagueStats.results[div]||{};
  if(tab==='table'){
    const table=computeLeagueTable(div, map);
    h+=`<div class="card">
      <b>Division ${div+1} table</b>
      <p class="muted small" style="margin:6px 0 0">Win 2 pts · Draw 1 · Loss 0. Your team: <b>${esc(meName)}</b>.</p>`;
    if(!table.length) h+=`<p class="muted" style="margin:12px 0 0">No completed results in this division yet.</p>`;
    else {
      h+=`<div class="league-stats-scroll"><table class="league-stats-table">
        <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>F</th><th>A</th><th>+/−</th><th>Pts</th></tr></thead><tbody>`;
      table.forEach((row,i)=>{
        const mine=session.div===div && session.num===row.num;
        const diff=row.pinsFor-row.pinsAgainst;
        h+=`<tr class="${mine?'league-me':''}"><td class="num">${i+1}</td><td class="name">${esc(row.name)}${mine?' <span class="tag">You</span>':''}</td>
          <td class="num">${row.played}</td><td class="num">${row.won}</td><td class="num">${row.drawn}</td><td class="num">${row.lost}</td>
          <td class="num">${row.pinsFor}</td><td class="num">${row.pinsAgainst}</td><td class="num">${diff>0?'+':''}${diff}</td><td class="num pts">${row.points}</td></tr>`;
      });
      h+=`</tbody></table></div>`;
    }
    h+=`</div>`;
  } else if(tab==='results'){
    const list=listLeagueResults(div, map);
    h+=`<div class="card"><b>Division ${div+1} results</b>`;
    if(!list.length) h+=`<p class="muted" style="margin:12px 0 0">No results in this division yet.</p>`;
    else {
      list.forEach(r=>{
        const homeMine=session.div===div&&session.num===r.homeNum;
        const awayMine=session.div===div&&session.num===r.awayNum;
        h+=`<div class="league-result-row">
          <div class="muted small">${esc(r.label||('Week '+r.week))}${r.date?' · '+fmtDate(r.date):''}</div>
          <div class="league-result-score">
            <span class="${homeMine?'league-me-text':''}">${esc(r.homeName)}</span>
            <b>${r.homeTotal} – ${r.awayTotal}</b>
            <span class="${awayMine?'league-me-text':''}">${esc(r.awayName)}</span>
          </div>
        </div>`;
      });
    }
    h+=`</div>`;
  } else {
    const avgs=computePlayerAverages(div, map).slice(0,40);
    h+=`<div class="card"><b>Division ${div+1} averages</b>
      <p class="muted small" style="margin:6px 0 0">Top averages from completed results that include player scores.</p>`;
    if(!avgs.length) h+=`<p class="muted" style="margin:12px 0 0">No player averages yet for this division.</p>`;
    else {
      h+=`<div class="league-stats-scroll"><table class="league-stats-table">
        <thead><tr><th>#</th><th>Player</th><th>Team</th><th>G</th><th>Pins</th><th>Avg</th></tr></thead><tbody>`;
      avgs.forEach((p,i)=>{
        h+=`<tr><td class="num">${i+1}</td><td class="name">${esc(p.name)}</td><td>${esc(p.team)}</td>
          <td class="num">${p.games}</td><td class="num">${p.pins}</td><td class="num pts">${p.avg}</td></tr>`;
      });
      h+=`</tbody></table></div>`;
    }
    h+=`</div>`;
  }
  return h+'</div>';
}

function boxHTML(c,side,slot,box,locked){
  const p=c.players[side][slot], v=p.boxes[box];
  const sel=ui.sel&&ui.sel.side===side&&ui.sel.slot===slot&&ui.sel.box===box;
  const pair=formatUsesPairRubs(c);
  const cls=['box', pair&&box%2===0&&box>0?'gs':'', sel?'sel':'', isSpare(p,box)?'spare':'', p.fine[box]?'fine':''].join(' ');
  const fineNote=p.fine[box]?', fine':'';
  return `<button class="${cls}" ${locked?'disabled':''} data-a="box" data-side="${side}" data-slot="${slot}" data-box="${box}" aria-label="${esc(playerLabel(p))}, box ${box+1}, ${v===null?'empty':v}${fineNote}">${v===null?'':v}</button>`;
}
function boardView(c,side){
  if(ui.reorder===side && c.status!=='submitted') return reorderView(c,side);
  const list=c.players[side], meta=sideMeta(c,side), locked=c.status==='submitted', fmt=cardFormat(c);
  const ct=colTotals(c,list), ups=pinsUp(c,list), tot=teamPins(list);
  const last=(SEED.lineups[teamKey(meta.div,meta.num)]||[]);
  const grid=`grid-template-columns:repeat(${fmt.rubs},minmax(0,1fr))`;
  let h=`<section class="board ${ui.side===side?'on':''}"><div class="btitle"><span class="chalkhead">${side==='home'?'Home':'Away'}</span><span class="tname">${esc(sideName(c,side))}</span></div>`;
  if(!locked && list.every(p=>!p.name) && last.length) h+=`<button class="btn chalk" data-a="lineup" data-side="${side}">Use last match's line-up</button>`;
  if(!locked && list.filter(p=>p.name).length>1) h+=`<button class="btn chalk" data-a="reorder" data-side="${side}">Change the line up</button>`;
  list.forEach((p,slot)=>{
    const nameBtn=p.name
      ? `<button class="pname" ${locked?'disabled':''} data-a="name" data-side="${side}" data-slot="${slot}">${esc(initials(p.name))}<span class="full">${esc(p.name)}</span></button>`
      : `<button class="pname empty" ${locked?'disabled':''} data-a="name" data-side="${side}" data-slot="${slot}">${MISSING_PLAYER}</button>`;
    h+=`<div class="prow"><div class="phead">${nameBtn}<div class="ptot">${p.boxes.some(v=>v!==null)?pinsOf(p):''}</div></div><div class="boxes${fmt.rubs>6?' many':''}" style="${grid}">`+
       Array.from({length:fmt.rubs},(_,b)=>boxHTML(c,side,slot,b,locked)).join('')+`</div></div>`;
  });
  h+=`<div class="bfoot">`;
  if(formatUsesPairRubs(c)){
    h+=`<div class="lbl">Rub Score</div><div class="upsrow" style="${grid}">${ups.map(x=>`<span>${x||''}</span>`).join('')}</div>
        <div class="lbl">Each rub</div><div class="colrow" style="${grid}">${ct.map(x=>`<span>${x||''}</span>`).join('')}</div>`;
  } else {
    h+=`<div class="lbl">Rub Score</div><div class="upsrow" style="${grid}">${ups.map(x=>`<span class="one">${x||''}</span>`).join('')}</div>`;
  }
  h+=`<div class="bigtotal"><small>Pins</small><b>${tot}</b></div></div></section>`;
  return h;
}
function cardView(){
  const c=curCard(); if(!c) return '';
  const sc=matchScore(c), fmt=cardFormat(c);
  const th=sc.home, ta=sc.away;
  const hn=sideName(c,'home'), an=sideName(c,'away');
  const home=sideMeta(c,'home');
  let msg;
  if(th+ta===0 && sc.pins.home+sc.pins.away===0) msg='No scores yet';
  else if(th===ta) msg='All square';
  else msg=(th>ta?hn:an)+' lead by '+Math.abs(th-ta)+(sc.mode==='pins'?'':' pts');
  if(sc.mode!=='pins' && (sc.pins.home||sc.pins.away)) msg+=' · pins '+sc.pins.home+'–'+sc.pins.away;
  const locked=c.status==='submitted';
  const chk=checkCard(c);
  const title=c.quick
    ? (fmt.id==='league' ? `Quick Match · ${fmtDate(c.date)}` : `${fmt.name} cup · ${fmtDate(c.date)}`)
    : `Week ${c.week} · ${fmtDate(c.date)}`;
  let h=`<div class="wrap wide">
    <div class="cardhead"><button class="back" data-a="back">‹ Fixtures</button>
      <div><b>${title}</b><br><span class="muted small">${esc(fmt.summary)}</span><br><span class="muted small">${esc(venueOf(home.div,home.num)||'Venue not set')}</span></div>
      <div class="saved">${c.savedAt?'Saved on this phone ✓ '+c.savedAt:'Not saved yet'}</div></div>`;
  if(ui.msg) h+=`<div class="banner bad" role="alert">${esc(ui.msg)}</div>`;
  if(locked) h+=`<div class="banner ok">Submitted at ${esc(new Date(c.submittedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}))}. Saved on this phone only for now — nothing is emailed or uploaded to a league server yet. Use Share / Download PDF to send the result. Tap "Change the card" if something needs correcting.</div>`;
  h+=`<div class="strip" aria-live="polite"><div class="row">
      <div class="side ${th>ta?'lead':''}"><span class="nm">${esc(hn)}</span><span class="sc">${th}</span></div><span class="dash">–</span>
      <div class="side r ${ta>th?'lead':''}"><span class="nm">${esc(an)}</span><span class="sc">${ta}</span></div></div>
      <div class="msg">${esc(msg)}${sc.max?` · max ${sc.max}`:''}${leagueSyncEnabled()&&syncUi.pending?` · ${syncUi.pending} sync waiting`:''}</div></div>
    ${locked?'':`<div style="margin:10px 0 4px"><button class="radio ${finesEnabled(c)?'on':''}" data-a="card-fines"><span class="dot"></span><span><b>Mark fines</b><br><span class="muted small">Adds a Fine button on the score pad. A brass corner mark shows on the box. It never changes the score.</span></span></button></div>`}
    <div class="tabs"><button class="${ui.side==='home'?'on':''}" data-a="side" data-side="home">Home · ${esc(hn)}</button><button class="${ui.side==='away'?'on':''}" data-a="side" data-side="away">Away · ${esc(an)}</button></div>
    <div class="boards">${boardView(c,'home')}${boardView(c,'away')}</div>
    <section class="card finish"><h2>Finish the match</h2>
      <p class="muted small" style="margin:0">Take a photo of the chalkboard so the league can check the scores.</p>
      ${c.hasPhoto&&photoURLs[c.key]?`<img class="photo" src="${photoURLs[c.key]}" alt="Photo of the chalkboard">`:''}
      <label class="btn block ${c.hasPhoto?'quiet':''}" style="cursor:pointer">${c.hasPhoto?'Retake photo':'Take photo of the chalkboard'}<input type="file" id="photoIn" accept="image/*" capture="environment" hidden ${locked?'disabled':''}></label>
      ${sigPadsHtml(c)}
      <ul class="check">${chk.lines.map(l=>`<li class="${l.s==='ok'?'':l.s}">${esc(l.t)}</li>`).join('')}</ul>`;
  if(locked){
    h+=`${pdfActionsHtml(c)}
        <button class="btn quiet block" data-a="edit" style="margin-top:8px">Change the card</button>
        <details style="margin-top:14px"><summary class="muted">Result data (what will go to the site)</summary><pre>${esc(JSON.stringify(exportJSON(c),null,1))}</pre></details>`;
  } else {
    h+=`<button class="btn block" data-a="submit" ${chk.blockers.length?'disabled':''}>Submit result</button>`;
    if(chk.blockers.length) h+=`<p class="muted small" style="text-align:center;margin:8px 0 0">Fix the red items to submit.</p>`;
    h+=pdfActionsHtml(c);
  }
  h+=`</section></div>`;
  return h;
}

function reorderView(c,side){
  const list=c.players[side];
  let h=`<section class="board ${ui.side===side?'on':''}"><div class="btitle"><span class="chalkhead">Line up</span><span class="tname">${esc(sideName(c,side))}</span></div>
    <p class="ohint">Tap ▲ or ▼ to move a player one place. Tap a name to move them straight to any position. Scores move with the player.</p>`;
  list.forEach((p,i)=>{
    h+=`<div class="orow"><span class="onum">${i+1}</span>`+(p.name
      ? `<button class="oname" data-a="movepick" data-side="${side}" data-slot="${i}">${esc(initials(p.name))}<span class="full">${esc(p.name)}</span></button>
         <button class="arr" aria-label="Move ${esc(p.name)} up" data-a="up" data-side="${side}" data-slot="${i}" ${i===0?'disabled':''}>▲</button>
         <button class="arr" aria-label="Move ${esc(p.name)} down" data-a="down" data-side="${side}" data-slot="${i}" ${i===list.length-1?'disabled':''}>▼</button>`
      : `<span class="oname empty">${MISSING_PLAYER}</span>`)+`</div>`;
  });
  return h+`<button class="btn brass block" data-a="reorderdone" style="margin-top:14px">Done</button></section>`;
}
function moveSheet(){
  const {side,slot}=ui.moveSheet, list=curCard().players[side], p=list[slot];
  let h=`<div class="sheet tall" role="dialog" aria-label="Move player"><div class="sheethead"><div class="who">Move ${esc(p.name)} to which position?</div><button class="back" data-a="closemove">Close</button></div><div class="rlist">`;
  list.forEach((q,i)=>{ h+=`<button data-a="moveto" data-to="${i}" ${i===slot?'disabled':''}><span><b>${i+1}</b>&nbsp; ${q.name?esc(q.name):MISSING_PLAYER}</span><small>${i===slot?'Now':''}</small></button>`; });
  return h+'</div></div>';
}
function movePlayer(side,from,to){
  const c=curCard(), list=c.players[side];
  if(to<0||to>=list.length||from===to) return;
  const [p]=list.splice(from,1); list.splice(to,0,p);   // everyone in between shifts by one; scores travel with the player
  ui.resume=null; persist(c.key);
}
function rubLabel(c,box){
  const g=groupsFor(c).find(x=>x.includes(box)), n=g.map(x=>x+1).join(' & ');
  return (g.length>1?'Rubs ':'Rub ')+n;
}
function padSheet(){
  const s=ui.sel, c=curCard(), p=c.players[s.side][s.slot], v=p.boxes[s.box];
  const keys=['9','8','7','6','5','4','3','2','1'].map(k=>`<button data-a="k" data-k="${k}">${k}</button>`).join('')+
    `<button data-a="kback" aria-label="Delete">⌫</button><button data-a="k" data-k="0">0</button><button data-a="closepad" style="font-size:20px">Done</button>`;
  return `<div class="sheet" role="dialog" aria-label="Enter score">
    <div class="sheethead"><div class="who">${esc(p.name)}<br><span class="muted small" style="font-weight:500">${esc(sideName(c,s.side))} · ${rubLabel(c,s.box)}</span></div><div class="val">${v===null?'–':v}</div></div>
    <div class="keys">${keys}</div>
    <div class="navrow"><button data-a="prev" aria-label="Previous box">‹ Back</button>
      ${v===9 ? `<button class="${p.spare[s.box]?'on':''}" data-a="spare" aria-pressed="${!!p.spare[s.box]}">Spare ⬡</button>`
        : `<button class="${v>9?'on':''}" disabled>${v>9?'Spare ⬡ (auto)':'Spare ⬡'}</button>`}
      ${finesEnabled(c)?`<button class="${p.fine[s.box]?'on':''}" data-a="fine">Fine ◤</button>`:''}
      <button class="next" data-a="next">Next ›</button></div></div>`;
}
function rosterSheet(){
  const {side,slot}=ui.sheet, c=curCard(), meta=sideMeta(c,side);
  const used=new Set(c.players[side].map((p,i)=>i===slot?null:norm(p.name)).filter(Boolean));
  const cur=c.players[side][slot].name;
  const list=rosterFor(meta.div,meta.num);
  let h=`<div class="sheet tall" role="dialog" aria-label="Choose player"><div class="sheethead"><div class="who">Player ${slot+1} · ${esc(sideName(c,side))}</div><button class="back" data-a="closesheet">Close</button></div>`;
  h+=`<div class="rlist">`+list.map(n=>`<button data-a="pick" data-n="${esc(n)}" ${used.has(norm(n))?'disabled':''}><span>${esc(n)}</span><small>${used.has(norm(n))?'Already playing':(norm(n)===norm(cur)?'Selected':'')}</small></button>`).join('')+`</div>`;
  if(cur) h+=`<button class="btn quiet block" data-a="movefromroster" style="margin-bottom:8px">Move this player to a different position</button>`;
  if(cur) h+=`<button class="btn quiet block" data-a="clearname" style="margin-bottom:12px">Take this player out</button>`;
  h+=`<label class="field" for="newName" style="margin-top:4px">Not on the list? Add a new player</label>
      <input type="text" id="newName" placeholder="First initial and surname, e.g. J. Smith" value="${esc(ui.newName)}" autocomplete="off" autocapitalize="words">`;
  if(ui.sheetMsg) h+=`<div class="banner bad" role="alert" style="margin-top:10px">${esc(ui.sheetMsg)}</div>`;
  if(ui.dupe){
    h+=`<div class="dupe"><b>Is this ${esc(ui.dupe.name)}?</b><br><span class="small">"${esc(ui.newName.trim())}" looks very like a player already on the list.</span>
      <button class="btn block" data-a="pick" data-n="${esc(ui.dupe.name)}">Yes, use ${esc(ui.dupe.name)}</button>
      <button class="btn quiet block" data-a="forceadd">No, add "${esc(ui.newName.trim())}" as a new player</button></div>`;
  } else {
    h+=`<button class="btn block" data-a="addnew" style="margin-top:10px">Add player</button>`;
  }
  return h+'</div>';
}

function render(){
  document.body.classList.toggle('has-sheet', !!(ui.sel||ui.sheet||ui.moveSheet));
  let h=appBar();
  if(ui.msg && ui.screen!=='card') h+=`<div class="wrap" style="padding-bottom:0"><div class="banner bad" role="alert">${esc(ui.msg)}</div></div>`;
  if(ui.screen==='loading') h+='<div class="wrap"><p class="muted">Loading…</p></div>';
  else if(ui.screen==='login') h+=loginView();
  else if(ui.screen==='settings') h+=settingsView();
  else if(ui.screen==='fixtures') h+=fixturesView();
  else if(ui.screen==='quick') h+=quickView();
  else if(ui.screen==='league-stats') h+=leagueStatsView();
  else if(ui.screen==='card') h+=cardView()+(ui.sel?padSheet():'')+(ui.sheet?rosterSheet():'')+(ui.moveSheet?moveSheet():'');
  $app.innerHTML=h;
  if(ui.sel){ scrollToSel(); requestAnimationFrame(scrollToSel); }
  if(ui.screen==='card') requestAnimationFrame(mountSignaturePads);
}
// Sit the selected player's row (name and boxes) directly above the keypad, clear of the score bar
function scrollToSel(){
  const box=$app.querySelector('.box.sel'), sheet=$app.querySelector('.sheet'); if(!box||!sheet) return;
  const row=box.closest('.prow'), strip=$app.querySelector('.strip');
  const top=(strip?strip.getBoundingClientRect().bottom:0)+8;
  const bottom=sheet.getBoundingClientRect().top-8;
  const r=row.getBoundingClientRect();
  let delta=r.bottom-bottom;               // row's bottom edge just above the keypad
  if(r.top-delta<top) delta=r.top-top;     // but never tuck its top under the score bar
  if(Math.abs(delta)>1) window.scrollBy(0,delta);
}

/* ---------- actions ---------- */
function setVal(v){
  const c=curCard(), s=ui.sel;
  const before=rubGroupsCompleteFlags(c);
  const p=c.players[s.side][s.slot]; p.boxes[s.box]=v; if(v!==9) p.spare[s.box]=false;
  persist(c.key);
  maybeQueueRubPairSync(c, before);
  render();
}
function move(dir){
  const c=curCard(), order=entryOrder(c), s=ui.sel;
  const i=order.findIndex(o=>o.side===s.side&&o.slot===s.slot&&o.box===s.box);
  const n=order[i+dir];
  if(!n){ ui.sel=null; render(); return; }
  ui.side=n.side;   // play has passed to the other team: show their board
  // if the next player has no name yet, ask for one
  if(!c.players[n.side][n.slot].name){ ui.sel=null; ui.sheet={side:n.side,slot:n.slot}; ui.resume=n; render(); return; }
  ui.sel={side:n.side,slot:n.slot,box:n.box}; const p=c.players[n.side][n.slot];
  ui.entry=p.boxes[n.box]===null?'':String(p.boxes[n.box]); ui.fresh=true; render(); scrollToSel();
}
function pickPlayer(name){
  const c=curCard(), {side,slot}=ui.sheet;
  c.players[side][slot].name=name; persist(c.key);
  ui.sheet=null; ui.newName=''; ui.dupe=null;
  if(ui.resume){ const r=ui.resume; ui.resume=null; ui.side=side; ui.sel={side,slot:r.slot,box:r.box}; ui.entry=''; ui.fresh=true; render(); scrollToSel(); }
  else render();
}
function addPlayer(name){
  const c=curCard(), {side}=ui.sheet, k=sideRosterKey(c,side);
  const clean=name.trim().replace(/\s+/g,' ').split(' ').map(w=>w? w[0].toUpperCase()+w.slice(1):w).join(' ');
  extra[k]=extra[k]||[]; extra[k].push(clean); kvSave('extraRoster',extra);
  pickPlayer(clean);
}
function tryLogin(){
  if(!ui.teamSel){ ui.pinMsg='Choose your team first.'; ui.pin=''; render(); return; }
  if(ui.tries>=5){ ui.pinMsg='Too many wrong tries. Ask the league organiser to reset your PIN.'; ui.pin=''; render(); return; }
  const cred=SEED.logins && SEED.logins[ui.teamSel];
  if(cred && ui.pin===cred.pin){
    const [d,n]=ui.teamSel.split('-').map(Number);
    const pin=ui.pin;
    session={div:d,num:n,pin,teamKey:teamKey(d,n)};
    kvSave('session',session); requestPersist();
    ui.pin=''; ui.pinMsg=''; ui.tries=0; ui.screen='fixtures';
    render(); window.scrollTo(0,0);
    loadNativeLeagueStats({quiet:true});
    // Pull shared team cards into IndexedDB so a new device sees prior matches
    pullSupabaseTeamData().then(r=>{
      render();
      if(r&&r.ok) flushSupabaseQueue();
    }).catch(()=>{ render(); });
  } else { ui.tries++; ui.pin=''; ui.pinMsg='That PIN is not right. Try again.'; render(); }
}
function compressBlob(file){
  return new Promise((res,rej)=>{
    const fr=new FileReader();
    fr.onload=()=>{ const img=new Image(); img.onload=()=>{
        const s=Math.min(1,1800/Math.max(img.width,img.height)), cv=document.createElement('canvas');
        cv.width=Math.round(img.width*s); cv.height=Math.round(img.height*s);
        cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
        cv.toBlob(b=>b?res(b):rej(new Error('encode')),'image/jpeg',0.72); };
      img.onerror=rej; img.src=fr.result; };
    fr.onerror=rej; fr.readAsDataURL(file);
  });
}

document.addEventListener('click',e=>{
  const el=e.target.closest('[data-a]'); if(!el||el.disabled) return;
  const a=el.dataset.a, D=el.dataset;
  switch(a){
    case 'pin': if(ui.pin.length<4){ ui.pin+=D.k; ui.pinMsg=''; render(); if(ui.pin.length===4) setTimeout(tryLogin,150); } break;
    case 'pinback': ui.pin=ui.pin.slice(0,-1); render(); break;
    case 'settings': if(!isAdminMode()) break; ui.screen='settings'; render(); break;
    case 'leave-settings': ui.screen=session?'fixtures':'login'; render(); break;
    case 'rubs': if(!isAdminMode()) break; settings.rubs=+D.v; kvSave('settings',settings); render(); break;
    case 'fines': if(!isAdminMode()) break; settings.fines=!settings.fines; kvSave('settings',settings); render(); break;
    case 'card-fines': {
      const c=curCard(); if(!c||c.status==='submitted') break;
      c.fines=!finesEnabled(c); persist(c.key); render(); break; }
    case 'supabase-flush': if(!isAdminMode()) break; flushSupabaseQueue().then(()=>render()); break;
    case 'install': if(ui.installEvt){ ui.installEvt.prompt(); ui.installEvt.userChoice.finally(()=>{ ui.installEvt=null; render(); }); } break;
    case 'update': if(ui.updateReady&&ui.updateReady.waiting) ui.updateReady.waiting.postMessage('SKIP_WAITING'); break;
    case 'logout': session=null; kvSave('session',null); sbUi.ready=false; sbUi.setupNeeded=false; sbUi.lastErr=null; ui.screen='login'; ui.teamSel=''; ui.qmSide='home'; ui.qmOpp=''; ui.qmMsg=''; ui.qmFormat='league'; ui.leagueTab='table'; ui.leagueDiv=null; ui.leagueStats=null; ui.leagueStatsErr=''; ui.leagueStatsSource=''; render(); break;
    case 'quick': ui.qmSide='home'; ui.qmOpp=''; ui.qmMsg=''; ui.qmFormat=ui.qmFormat||'league'; ui.screen='quick'; render(); window.scrollTo(0,0); break;
    case 'league-stats':
      ui.screen='league-stats';
      ui.leagueTab=(ui.leagueTab==='results'||ui.leagueTab==='averages')?ui.leagueTab:'table';
      if(ui.leagueDiv==null && session) ui.leagueDiv=session.div;
      render(); window.scrollTo(0,0);
      loadNativeLeagueStats();
      break;
    case 'league-tab': {
      const next=D.tab==='results'?'results':(D.tab==='averages'?'averages':'table');
      ui.leagueTab=next; render();
      break; }
    case 'league-div': {
      const d=+D.div;
      if(d===0||d===1||d===2){ ui.leagueDiv=d; render(); }
      break; }
    case 'league-stats-reload': loadNativeLeagueStats(); break;
    case 'qm-side': {
      const next=String(D.side||'').toLowerCase()==='away'?'away':'home';
      ui.qmSide=next; ui.qmMsg=''; render(); break; }
    case 'quick-start': startQuickMatch(); break;
    case 'open-quick': openCard(D.key); break;
    case 'delete-quick': {
      const c=cards[D.key];
      if(!c||!c.quick) break;
      const label=sideName(c,'home')+' v '+sideName(c,'away');
      if(window.confirm('Delete Quick Match '+label+' from this phone? This cannot be undone.')) deleteQuickMatch(D.key);
      break; }
    case 'open': {
      const f=fixturesFor(session.div,session.num).find(x=>x.key===D.key);
      if(!f||f.bye) break;
      ensureCard(f); openCard(D.key); break; }
    case 'back': ui.sel=null; ui.sheet=null; ui.reorder=null; ui.moveSheet=null; ui.screen='fixtures'; render(); break;
    case 'side': ui.side=D.side; render(); break;
    case 'box': {
      const c=curCard(); if(c.status==='submitted') break;
      const s={side:D.side,slot:+D.slot,box:+D.box}, p=c.players[s.side][s.slot];
      if(!p.name){ ui.sel=null; ui.sheet={side:s.side,slot:s.slot}; ui.resume={slot:s.slot,box:s.box}; render(); break; }
      ui.sel=s; ui.entry=p.boxes[s.box]===null?'':String(p.boxes[s.box]); ui.fresh=true; render(); scrollToSel(); break; }
    case 'k': {
      let e=ui.fresh?'':ui.entry; ui.fresh=false; e=e+D.k;
      if(e.length>2||+e>MAXBOX) e=D.k;
      ui.entry=e; setVal(+e); scrollToSel(); break; }
    case 'kback': { ui.fresh=false; ui.entry=ui.entry.slice(0,-1); setVal(ui.entry===''?null:+ui.entry); scrollToSel(); break; }
    case 'next': move(1); break;
    case 'prev': move(-1); break;
    case 'closepad': ui.sel=null; render(); break;
    case 'spare': { const c=curCard(), s=ui.sel, p=c.players[s.side][s.slot]; if(p.boxes[s.box]!==9) break; p.spare[s.box]=!p.spare[s.box]; persist(c.key); render(); scrollToSel(); break; }
    case 'fine':  { const c=curCard(), s=ui.sel, p=c.players[s.side][s.slot]; p.fine[s.box]=!p.fine[s.box]; persist(c.key); render(); scrollToSel(); break; }
    case 'name': ui.sel=null; ui.sheet={side:D.side,slot:+D.slot}; ui.resume=null; ui.newName=''; ui.dupe=null; render(); break;
    case 'reorder': ui.reorder=D.side; ui.side=D.side; ui.sel=null; ui.sheet=null; ui.resume=null; render(); break;
    case 'reorderdone': ui.reorder=null; render(); break;
    case 'up': movePlayer(D.side,+D.slot,+D.slot-1); render(); break;
    case 'down': movePlayer(D.side,+D.slot,+D.slot+1); render(); break;
    case 'movepick': ui.moveSheet={side:D.side,slot:+D.slot}; render(); break;
    case 'movefromroster': ui.moveSheet={side:ui.sheet.side,slot:ui.sheet.slot}; ui.sheet=null; ui.resume=null; render(); break;
    case 'moveto': { const m=ui.moveSheet; ui.moveSheet=null; movePlayer(m.side,m.slot,+D.to); render(); break; }
    case 'closemove': ui.moveSheet=null; render(); break;
    case 'closesheet': ui.sheet=null; ui.resume=null; ui.dupe=null; render(); break;
    case 'pick': pickPlayer(D.n); break;
    case 'clearname': { const c=curCard(), {side,slot}=ui.sheet; c.players[side][slot].name=''; persist(c.key); ui.sheet=null; render(); break; }
    case 'addnew': {
      const t=ui.newName.trim(); if(t.length<3){ ui.sheetMsg='Type the player\'s initial and surname first.'; render(); break; }
      ui.sheetMsg='';
      const c=curCard(), {side}=ui.sheet, meta=sideMeta(c,side), sim=similar(t,rosterFor(meta.div,meta.num));
      if(sim&&sim.exact){ pickPlayer(sim.name); break; }
      if(sim){ ui.dupe=sim; render(); break; }
      addPlayer(t); break; }
    case 'forceadd': addPlayer(ui.newName); break;
    case 'lineup': {
      const c=curCard(), meta=sideMeta(c,D.side), fmt=cardFormat(c);
      const names=(SEED.lineups[teamKey(meta.div,meta.num)]||[]).slice(0,fmt.slots);
      names.forEach((n,i)=>{ c.players[D.side][i].name=n; }); persist(c.key); render(); break; }
    case 'submit': { const c=curCard(); if(checkCard(c).blockers.length) break;
      c.status='submitted'; c.submittedAt=new Date().toISOString(); c.by=teamName(session.div,session.num); persist(c.key);
      queueFinalMatchSync(c).catch(()=>{}); ui.sel=null; render(); window.scrollTo(0,0); break; }
    case 'league-flush': if(!isAdminMode()) break; flushLeagueSyncQueue().then(()=>render()); break;
    case 'edit': { const c=curCard(); c.status='draft'; persist(c.key); render(); break; }
    case 'share-pdf': { const c=curCard(); if(c) shareMatchPdf(c); break; }
    case 'download-pdf': { const c=curCard(); if(c) downloadMatchPdf(c); break; }
    case 'sig-clear': { clearSignature(D.side); break; }
  }
});
document.addEventListener('change',e=>{
  if(e.target.id==='teamSel'){ ui.teamSel=e.target.value; ui.pinMsg=''; }
  if(e.target.id==='qmOpp'){ ui.qmOpp=e.target.value; ui.qmMsg=''; render(); }
  if(e.target.id==='qmFormat'){ ui.qmFormat=e.target.value; ui.qmMsg=''; render(); }
  if(e.target.id==='photoIn' && e.target.files[0]){
    const c=curCard();
    compressBlob(e.target.files[0])
      .then(blob=>idbPut('photos',c.key,blob).then(()=>blob))
      .then(blob=>{
        if(photoURLs[c.key]) URL.revokeObjectURL(photoURLs[c.key]);
        photoURLs[c.key]=URL.createObjectURL(blob);
        c.hasPhoto=true; ui.msg=''; persist(c.key);
        queueSupabaseMedia(c.key,'photo',blob).catch(()=>{});
        render();
      })
      .catch(()=>{ ui.msg='That photo could not be saved. Check the phone has some free space, then try again.'; render(); });
  }
});
document.addEventListener('input',e=>{ if(e.target.id==='newName'){ ui.newName=e.target.value; if(ui.dupe){ ui.dupe=null; } } });
window.addEventListener('online',()=>{
  Promise.all([flushLeagueSyncQueue(), flushSupabaseQueue()]).finally(render);
});
window.addEventListener('offline',render);
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); ui.installEvt=e; if(ui.screen==='login') render(); });
window.addEventListener('appinstalled',()=>{ ui.installEvt=null; render(); });

function requestPersist(){ try{ if(navigator.storage&&navigator.storage.persist) navigator.storage.persist(); }catch(e){} }

async function init(){
  render();   // shows "Loading…"
  try{
    const kv=await idbAll('kv');
    if(kv.settings) settings=Object.assign(settings,kv.settings);
    // Backend never lives in per-device settings — config.js is the only source
    delete settings.supabaseSync;
    delete settings.supabaseUrl;
    delete settings.supabaseAnonKey;
    delete settings.leagueSync;
    delete settings.leagueBaseUrl;
    applyDeploySettings();
    // Admin ?admin=1 may override rubs/fines on this phone after deploy defaults apply;
    // re-read device overrides only when admin mode is on
    if(isAdminMode() && kv.settings){
      if(kv.settings.rubs===1||kv.settings.rubs===2) settings.rubs=kv.settings.rubs;
      if(typeof kv.settings.fines==='boolean') settings.fines=kv.settings.fines;
    }
    try{
      localStorage.removeItem('skittles.supabaseUrl');
      localStorage.removeItem('skittles.supabaseAnonKey');
    }catch(e){}
    session=kv.session||null; extra=kv.extraRoster||{};
    // Older sessions lack pin — Supabase sync needs a fresh login
    if(session && !session.teamKey && session.div!=null) session.teamKey=teamKey(session.div,session.num);
    cards=await idbAll('cards');
    const photos=await idbAll('photos');
    Object.keys(photos).forEach(k=>{ photoURLs[k]=URL.createObjectURL(photos[k]); });
    const sigs=await idbAll('sigs');
    Object.keys(sigs).forEach(k=>{
      const parts=String(k).split('::');
      if(parts.length<2) return;
      const side=parts.pop();
      const cardKey=parts.join('::');
      if(side!=='home'&&side!=='away') return;
      if(!sigURLs[cardKey]) sigURLs[cardKey]={};
      sigURLs[cardKey][side]=URL.createObjectURL(sigs[k]);
      if(cards[cardKey]){
        if(side==='home') cards[cardKey].hasSigHome=true;
        else cards[cardKey].hasSigAway=true;
      }
    });
    await loadSyncMeta();
    await refreshSyncPendingCount();
    await refreshSbPendingCount();
    requestPersist();
  }catch(e){
    ui.msg='This phone is not letting the app save anything, so scores would be lost if the app closed. Try opening it in a normal (not private) browser window.';
  }
  ui.screen = session ? 'fixtures' : 'login';
  render();
  flushLeagueSyncQueue();
  if(session) loadNativeLeagueStats({quiet:true});
  if(supabaseEnabled()){
    pullSupabaseTeamData().then(()=>{ render(); flushSupabaseQueue(); }).catch(()=>{ render(); });
  }
}

// the offline copy of the app is swapped for a newer one only when the person taps "Update the app" on the fixtures screen
function registerWorker(){
  if(!('serviceWorker' in navigator)) return;
  const hadController=!!navigator.serviceWorker.controller; let reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(!hadController||reloading) return; reloading=true; location.reload(); });
  navigator.serviceWorker.register('./sw.js').then(reg=>{
    const flag=()=>{ if(reg.waiting && navigator.serviceWorker.controller){ ui.updateReady=reg; if(ui.screen==='fixtures') render(); } };
    flag();
    reg.addEventListener('updatefound',()=>{ const w=reg.installing; if(w) w.addEventListener('statechange',()=>{ if(w.state==='installed') flag(); }); });
    const check=()=>reg.update().catch(()=>{});
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) check(); });
    window.addEventListener('online',check);
  }).catch(()=>{});
}

init();
registerWorker();
})();