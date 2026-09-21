(function(){
'use strict';
const SEED = window.SEED;
const DEMO_PIN = '1234';
const NBOX = 6, NSLOT = 8, MAXBOX = 27;
const $app = document.getElementById('app');

/* ---------- storage: IndexedDB on the phone (cards, photos, settings) ---------- */
const DBNAME='skittles-scorer';
let dbp=null;
function openDB(){
  return new Promise((res,rej)=>{
    if(!window.indexedDB) return rej(new Error('no indexedDB'));
    const r=indexedDB.open(DBNAME,1);
    r.onupgradeneeded=()=>{ ['kv','cards','photos'].forEach(s=>r.result.createObjectStore(s)); };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error);
  });
}
const db=()=>dbp||(dbp=openDB());
const idbPut=(s,k,v)=>db().then(d=>new Promise((res,rej)=>{
  const t=d.transaction(s,'readwrite'); t.objectStore(s).put(v,k);
  t.oncomplete=()=>res(true); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }));
const idbAll=s=>db().then(d=>new Promise((res,rej)=>{
  const out={}, q=d.transaction(s).objectStore(s).openCursor();
  q.onsuccess=()=>{ const c=q.result; if(c){ out[c.key]=c.value; c.continue(); } else res(out); };
  q.onerror=()=>rej(q.error); }));
function saveFailed(){ ui.msg='This phone could not save that change. Free up some storage space, then try again.'; render(); }
const kvSave=(k,v)=>idbPut('kv',k,v).catch(saveFailed);

let settings = {rubs:2, fines:false};
let session  = null;      // {div,num}
let cards    = {};        // by fixture key
let extra    = {};        // players added on the phone
const photoURLs = {};     // object URLs for the stored chalkboard photos
const ui = { screen:'loading', from:'login', cardKey:null, side:'home', sel:null, entry:'', fresh:true,
             sheet:null, sheetMsg:'', pin:'', pinMsg:'', tries:0, teamSel:'', newName:'', dupe:null, msg:'', updateReady:null, installEvt:null, reorder:null, moveSheet:null };

/* ---------- helpers ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
    return {week:w.week,date:w.date,mi,home:m[0],away:m[1],key,played:SEED.played[key]||null,div:d};
  });
}
function nextFixture(list){
  const t=todayISO();
  return list.find(f=>!f.bye && !f.played && (f.date>=t || (cards[f.key]&&cards[f.key].status!=='submitted')));
}
function venueOf(d,homeNum){ const i=SEED.info[d][homeNum-1]; return i? i.venue+(i.alley?' ('+i.alley+')':'') : ''; }

/* ---------- card model ---------- */
const blankSide = () => Array.from({length:NSLOT},()=>({name:'',boxes:Array(NBOX).fill(null),spare:Array(NBOX).fill(false),fine:Array(NBOX).fill(false)}));
function ensureCard(f){
  if(!cards[f.key]){
    cards[f.key]={key:f.key,div:f.div,week:f.week,mi:f.mi,date:f.date,home:f.home,away:f.away,
      players:{home:blankSide(),away:blankSide()},hasPhoto:false,status:'draft',savedAt:null,submittedAt:null,by:null};
    persist(f.key);
  }
  return cards[f.key];
}
function persist(key){
  if(key && cards[key]){
    cards[key].savedAt=timeNow();
    idbPut('cards',key,cards[key]).then(()=>{ if(ui.msg.startsWith('This phone could not save')){ ui.msg=''; render(); } }).catch(saveFailed);
  }
}
const curCard = () => cards[ui.cardKey];

/* ---------- maths ---------- */
const groups = () => settings.rubs===2 ? [[0,1],[2,3],[4,5]] : [[0],[1],[2],[3],[4],[5]];
const isSpare = (p,b) => { const v=p.boxes[b]; return v!==null && (v>9 || (v===9 && p.spare[b])); };
const pinsOf = p => p.boxes.reduce((s,v)=>s+(v||0),0);
const colTotals = list => Array.from({length:NBOX},(_,c)=>list.reduce((s,p)=>s+(p.boxes[c]||0),0));
const pinsUp = list => { const ct=colTotals(list); return groups().map(g=>g.reduce((s,c)=>s+ct[c],0)); };
const teamTotal = list => list.reduce((s,p)=>s+pinsOf(p),0);
function entryOrder(){
  // home always starts. A team plays its rub(s) through all eight players, then play passes to the other team
  const out=[];
  groups().forEach(g=>['home','away'].forEach(side=>{ for(let slot=0;slot<NSLOT;slot++) g.forEach(c=>out.push({side,slot,box:c})); }));
  return out;
}
function startSide(c){
  const o=entryOrder().find(x=>{ const p=c.players[x.side][x.slot]; return p.name && p.boxes[x.box]===null; });
  return o?o.side:'home';
}

/* ---------- checks before submitting ---------- */
function checkCard(c){
  const blockers=[], warnings=[], lines=[];
  ['home','away'].forEach(side=>{
    const list=c.players[side], nm=teamName(c.div,side==='home'?c.home:c.away);
    const named=list.filter(p=>p.name);
    const empty=named.reduce((n,p)=>n+p.boxes.filter(v=>v===null).length,0);
    const orphan=list.filter(p=>!p.name && p.boxes.some(v=>v!==null)).length;
    if(!named.length){ blockers.push(nm+': no players chosen'); lines.push({t:nm+': no players chosen',s:'no'}); return; }
    if(orphan){ blockers.push(nm+': scores entered for a slot with no player'); lines.push({t:nm+': a score has no player name',s:'no'}); }
    if(empty){ blockers.push(nm+': '+empty+' box'+(empty>1?'es':'')+' still empty'); lines.push({t:nm+': '+empty+' box'+(empty>1?'es':'')+' still empty',s:'no'}); }
    else if(!orphan){
      if(named.length<NSLOT) lines.push({t:nm+': '+named.length+' players, all boxes filled',s:'warn'});
      else lines.push({t:nm+': 8 players, all boxes filled',s:'ok'});
    }
  });
  if(!c.hasPhoto){ blockers.push('Chalkboard photo needed'); lines.push({t:'Photo of the chalkboard needed',s:'no'}); }
  else lines.push({t:'Chalkboard photo attached',s:'ok'});
  return {blockers,warnings,lines};
}
function exportJSON(c){
  const mk=side=>c.players[side].filter(p=>p.name).map(p=>({name:p.name,pins:pinsOf(p),boxes:p.boxes.slice(),spares:p.boxes.map((v,i)=>isSpare(p,i)?i+1:0).filter(Boolean)}));
  return {key:'w'+c.week+'m'+c.mi,division:c.div+1,homeNum:c.home,awayNum:c.away,
    homeTotal:teamTotal(c.players.home),awayTotal:teamTotal(c.players.away),
    savedAt:c.submittedAt,submittedBy:c.by,photo:c.hasPhoto?'attached':null,homePlayers:mk('home'),awayPlayers:mk('away')};
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
    <div class="banner demo">Test build. Every team's PIN is 1234 for now, and results stay on this phone until the league database is connected.</div>
    <h2>Log in to score</h2>
    <p class="muted">Pick your team, then enter your PIN.</p>
    <label class="field" for="teamSel">Your team</label>
    <select id="teamSel">${opts}</select>
    <div class="pin" aria-label="PIN entered: ${ui.pin.length} of 4">${dots}</div>
    <div class="err" role="alert">${esc(ui.pinMsg)}</div>
    <div class="numpad">${keys}</div>
    <p style="text-align:center;margin-top:18px"><button class="linkbtn" data-a="settings">League settings</button></p>
  </div>`;
}
function settingsView(){
  const r=settings.rubs;
  return `<div class="wrap">
    <button class="back" data-a="leave-settings">‹ Back</button>
    <h2 style="margin-top:16px">League settings</h2>
    <p class="muted">These are set once for the whole league by the organiser.</p>
    <button class="radio ${r===2?'on':''}" data-a="rubs" data-v="2"><span class="dot"></span><span><b>Double rubs</b><br><span class="muted small">Boxes are played in pairs. "Pins up" is shown after each pair. South Molton plays this way.</span></span></button>
    <button class="radio ${r===1?'on':''}" data-a="rubs" data-v="1"><span class="dot"></span><span><b>Single rubs</b><br><span class="muted small">Each box is its own rub. "Pins up" is shown after every box.</span></span></button>
    <button class="radio ${settings.fines?'on':''}" data-a="fines"><span class="dot"></span><span><b>Mark fines</b><br><span class="muted small">Adds a Fine button to the keypad. A notch shows in the corner of the box. It never changes the score.</span></span></button>
  </div>`;
}
function fixturesView(){
  const {div:d,num:n}=session, list=fixturesFor(d,n), nx=nextFixture(list);
  let h=`<div class="wrap"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px">
    <div><h2 style="margin:0">${esc(teamName(d,n))}</h2><span class="muted small">Division ${d+1}</span></div>
    <button class="back" data-a="logout">Log out</button></div>`;
  if(ui.updateReady) h+=`<div class="banner ok">A new version of the app is ready.<button class="btn block" data-a="update" style="margin-top:10px">Update the app</button></div>`;
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
    let st='<span class="muted">Not started</span>';
    if(f.played) st=`<span class="state-done">${f.played.h} – ${f.played.a} on the site</span>`;
    else if(c&&c.status==='submitted') st='<span class="state-wait">Submitted, waiting to send</span>';
    else if(c) st='<span class="state-wait">In progress</span>';
    const inner=`<span><b>${fmtDate(f.date)}</b> · Week ${f.week}<br><span class="muted small">${home?'Home':'Away'} v ${esc(opp)}</span></span>${st}`;
    h+= f.played ? `<div class="frow">${inner}</div>` : `<button class="frow" data-a="open" data-key="${f.key}">${inner}</button>`;
  });
  return h+'</div></div>';
}

function boxHTML(c,side,slot,box,locked){
  const p=c.players[side][slot], v=p.boxes[box];
  const sel=ui.sel&&ui.sel.side===side&&ui.sel.slot===slot&&ui.sel.box===box;
  const cls=['box', settings.rubs===2&&box%2===0&&box>0?'gs':'', sel?'sel':'', isSpare(p,box)?'spare':'', settings.fines&&p.fine[box]?'fine':''].join(' ');
  return `<button class="${cls}" ${locked?'disabled':''} data-a="box" data-side="${side}" data-slot="${slot}" data-box="${box}" aria-label="${esc(p.name||'Player '+(slot+1))}, box ${box+1}, ${v===null?'empty':v}">${v===null?'':v}</button>`;
}
function boardView(c,side){
  if(ui.reorder===side && c.status!=='submitted') return reorderView(c,side);
  const list=c.players[side], num=side==='home'?c.home:c.away, locked=c.status==='submitted';
  const ct=colTotals(list), ups=pinsUp(list), tot=teamTotal(list);
  const last=(SEED.lineups[c.div+'-'+num]||[]);
  let h=`<section class="board ${ui.side===side?'on':''}"><div class="btitle"><span class="chalkhead">${side==='home'?'Home':'Away'}</span><span class="tname">${esc(teamName(c.div,num))}</span></div>`;
  if(!locked && list.every(p=>!p.name) && last.length) h+=`<button class="btn chalk" data-a="lineup" data-side="${side}">Use last match's line-up</button>`;
  if(!locked && list.filter(p=>p.name).length>1) h+=`<button class="btn chalk" data-a="reorder" data-side="${side}">Change the batting order</button>`;
  list.forEach((p,slot)=>{
    const nameBtn=p.name
      ? `<button class="pname" ${locked?'disabled':''} data-a="name" data-side="${side}" data-slot="${slot}">${esc(initials(p.name))}<span class="full">${esc(p.name)}</span></button>`
      : `<button class="pname empty" ${locked?'disabled':''} data-a="name" data-side="${side}" data-slot="${slot}">Choose player ${slot+1}</button>`;
    h+=`<div class="prow"><div class="phead">${nameBtn}<div class="ptot">${p.boxes.some(v=>v!==null)?pinsOf(p):''}</div></div><div class="boxes">`+
       Array.from({length:NBOX},(_,b)=>boxHTML(c,side,slot,b,locked)).join('')+`</div></div>`;
  });
  h+=`<div class="bfoot">`;
  if(settings.rubs===2){
    h+=`<div class="lbl">Each rub</div><div class="colrow">${ct.map(x=>`<span>${x||''}</span>`).join('')}</div>
        <div class="lbl">Pins up</div><div class="upsrow">${ups.map(x=>`<span>${x||''}</span>`).join('')}</div>`;
  } else {
    h+=`<div class="lbl">Pins up</div><div class="upsrow">${ups.map(x=>`<span class="one">${x||''}</span>`).join('')}</div>`;
  }
  h+=`<div class="bigtotal"><small>Total</small><b>${tot}</b></div></div></section>`;
  return h;
}
function cardView(){
  const c=curCard(); if(!c) return '';
  const th=teamTotal(c.players.home), ta=teamTotal(c.players.away);
  const hn=teamName(c.div,c.home), an=teamName(c.div,c.away);
  const msg = (th+ta===0) ? 'No scores yet' : th===ta ? 'All square' : (th>ta?hn:an)+' lead by '+Math.abs(th-ta);
  const locked=c.status==='submitted';
  const chk=checkCard(c);
  let h=`<div class="wrap wide">
    <div class="cardhead"><button class="back" data-a="back">‹ Fixtures</button>
      <div><b>Week ${c.week} · ${fmtDate(c.date)}</b><br><span class="muted small">${esc(venueOf(c.div,c.home))}</span></div>
      <div class="saved">${c.savedAt?'Saved on this phone ✓ '+c.savedAt:'Not saved yet'}</div></div>`;
  if(ui.msg) h+=`<div class="banner bad" role="alert">${esc(ui.msg)}</div>`;
  if(locked) h+=`<div class="banner ok">Submitted at ${esc(new Date(c.submittedAt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}))}. It will be sent to the league when there is signal. Tap "Change the card" below if something needs correcting.</div>`;
  h+=`<div class="strip" aria-live="polite"><div class="row">
      <div class="side ${th>ta?'lead':''}"><span class="nm">${esc(hn)}</span><span class="sc">${th}</span></div><span class="dash">–</span>
      <div class="side r ${ta>th?'lead':''}"><span class="nm">${esc(an)}</span><span class="sc">${ta}</span></div></div><div class="msg">${esc(msg)}</div></div>
    <div class="tabs"><button class="${ui.side==='home'?'on':''}" data-a="side" data-side="home">Home · ${esc(hn)}</button><button class="${ui.side==='away'?'on':''}" data-a="side" data-side="away">Away · ${esc(an)}</button></div>
    <div class="boards">${boardView(c,'home')}${boardView(c,'away')}</div>
    <section class="card finish"><h2>Finish the match</h2>
      <p class="muted small" style="margin:0">Take a photo of the chalkboard so the league can check the scores.</p>
      ${c.hasPhoto&&photoURLs[c.key]?`<img class="photo" src="${photoURLs[c.key]}" alt="Photo of the chalkboard">`:''}
      <label class="btn block ${c.hasPhoto?'quiet':''}" style="cursor:pointer">${c.hasPhoto?'Retake photo':'Take photo of the chalkboard'}<input type="file" id="photoIn" accept="image/*" capture="environment" hidden ${locked?'disabled':''}></label>
      <ul class="check">${chk.lines.map(l=>`<li class="${l.s==='ok'?'':l.s}">${esc(l.t)}</li>`).join('')}</ul>`;
  if(locked){
    h+=`<button class="btn quiet block" data-a="edit">Change the card</button>
        <details style="margin-top:14px"><summary class="muted">Result data (what will go to the site)</summary><pre>${esc(JSON.stringify(exportJSON(c),null,1))}</pre></details>`;
  } else {
    h+=`<button class="btn block" data-a="submit" ${chk.blockers.length?'disabled':''}>Submit result</button>`;
    if(chk.blockers.length) h+=`<p class="muted small" style="text-align:center;margin:8px 0 0">Fix the red items to submit.</p>`;
  }
  h+=`</section></div>`;
  return h;
}

function reorderView(c,side){
  const list=c.players[side], num=side==='home'?c.home:c.away;
  let h=`<section class="board ${ui.side===side?'on':''}"><div class="btitle"><span class="chalkhead">Order</span><span class="tname">${esc(teamName(c.div,num))}</span></div>
    <p class="ohint">Tap ▲ or ▼ to move a player one place. Tap a name to move them straight to any position. Scores move with the player.</p>`;
  list.forEach((p,i)=>{
    h+=`<div class="orow"><span class="onum">${i+1}</span>`+(p.name
      ? `<button class="oname" data-a="movepick" data-side="${side}" data-slot="${i}">${esc(initials(p.name))}<span class="full">${esc(p.name)}</span></button>
         <button class="arr" aria-label="Move ${esc(p.name)} up" data-a="up" data-side="${side}" data-slot="${i}" ${i===0?'disabled':''}>▲</button>
         <button class="arr" aria-label="Move ${esc(p.name)} down" data-a="down" data-side="${side}" data-slot="${i}" ${i===list.length-1?'disabled':''}>▼</button>`
      : `<span class="oname empty">Empty</span>`)+`</div>`;
  });
  return h+`<button class="btn brass block" data-a="reorderdone" style="margin-top:14px">Done</button></section>`;
}
function moveSheet(){
  const {side,slot}=ui.moveSheet, list=curCard().players[side], p=list[slot];
  let h=`<div class="sheet tall" role="dialog" aria-label="Move player"><div class="sheethead"><div class="who">Move ${esc(p.name)} to which position?</div><button class="back" data-a="closemove">Close</button></div><div class="rlist">`;
  list.forEach((q,i)=>{ h+=`<button data-a="moveto" data-to="${i}" ${i===slot?'disabled':''}><span><b>${i+1}</b>&nbsp; ${q.name?esc(q.name):'Empty'}</span><small>${i===slot?'Now':''}</small></button>`; });
  return h+'</div></div>';
}
function movePlayer(side,from,to){
  const c=curCard(), list=c.players[side];
  if(to<0||to>=list.length||from===to) return;
  const [p]=list.splice(from,1); list.splice(to,0,p);   // everyone in between shifts by one; scores travel with the player
  ui.resume=null; persist(c.key);
}
function rubLabel(box){
  const g=groups().find(x=>x.includes(box)), n=g.map(x=>x+1).join(' & ');
  return (g.length>1?'Rubs ':'Rub ')+n;
}
function padSheet(){
  const s=ui.sel, c=curCard(), p=c.players[s.side][s.slot], v=p.boxes[s.box];
  const keys=['9','8','7','6','5','4','3','2','1'].map(k=>`<button data-a="k" data-k="${k}">${k}</button>`).join('')+
    `<button data-a="kback" aria-label="Delete">⌫</button><button data-a="k" data-k="0">0</button><button data-a="closepad" style="font-size:20px">Done</button>`;
  return `<div class="sheet" role="dialog" aria-label="Enter score">
    <div class="sheethead"><div class="who">${esc(p.name)}<br><span class="muted small" style="font-weight:500">${esc(teamName(c.div,s.side==='home'?c.home:c.away))} · ${rubLabel(s.box)}</span></div><div class="val">${v===null?'–':v}</div></div>
    <div class="keys">${keys}</div>
    <div class="navrow"><button data-a="prev" aria-label="Previous box">‹ Back</button>
      ${v===9 ? `<button class="${p.spare[s.box]?'on':''}" data-a="spare" aria-pressed="${!!p.spare[s.box]}">Spare ⬡</button>`
        : `<button class="${v>9?'on':''}" disabled>${v>9?'Spare ⬡ (auto)':'Spare ⬡'}</button>`}
      ${settings.fines?`<button class="${p.fine[s.box]?'on':''}" data-a="fine">Fine ◤</button>`:''}
      <button class="next" data-a="next">Next ›</button></div></div>`;
}
function rosterSheet(){
  const {side,slot}=ui.sheet, c=curCard(), num=side==='home'?c.home:c.away;
  const used=new Set(c.players[side].map((p,i)=>i===slot?null:norm(p.name)).filter(Boolean));
  const cur=c.players[side][slot].name;
  const list=rosterFor(c.div,num);
  let h=`<div class="sheet tall" role="dialog" aria-label="Choose player"><div class="sheethead"><div class="who">Player ${slot+1} · ${esc(teamName(c.div,num))}</div><button class="back" data-a="closesheet">Close</button></div>`;
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
  else if(ui.screen==='card') h+=cardView()+(ui.sel?padSheet():'')+(ui.sheet?rosterSheet():'')+(ui.moveSheet?moveSheet():'');
  $app.innerHTML=h;
  if(ui.sel){ scrollToSel(); requestAnimationFrame(scrollToSel); }
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
  const c=curCard(), s=ui.sel; const p=c.players[s.side][s.slot]; p.boxes[s.box]=v; if(v!==9) p.spare[s.box]=false; persist(c.key); render();
}
function move(dir){
  const order=entryOrder(), s=ui.sel;
  const i=order.findIndex(o=>o.side===s.side&&o.slot===s.slot&&o.box===s.box);
  const n=order[i+dir];
  if(!n){ ui.sel=null; render(); return; }
  const c=curCard();
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
  const c=curCard(), {side}=ui.sheet, num=side==='home'?c.home:c.away, k=c.div+'-'+num;
  const clean=name.trim().replace(/\s+/g,' ').split(' ').map(w=>w? w[0].toUpperCase()+w.slice(1):w).join(' ');
  extra[k]=extra[k]||[]; extra[k].push(clean); kvSave('extraRoster',extra);
  pickPlayer(clean);
}
function tryLogin(){
  if(!ui.teamSel){ ui.pinMsg='Choose your team first.'; ui.pin=''; render(); return; }
  if(ui.tries>=5){ ui.pinMsg='Too many wrong tries. Ask the league organiser to reset your PIN.'; ui.pin=''; render(); return; }
  if(ui.pin===DEMO_PIN){
    const [d,n]=ui.teamSel.split('-').map(Number); session={div:d,num:n}; kvSave('session',session); requestPersist();
    ui.pin=''; ui.pinMsg=''; ui.tries=0; ui.screen='fixtures'; render(); window.scrollTo(0,0);
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
    case 'settings': ui.screen='settings'; render(); break;
    case 'leave-settings': ui.screen=session?'fixtures':'login'; render(); break;
    case 'rubs': settings.rubs=+D.v; kvSave('settings',settings); render(); break;
    case 'fines': settings.fines=!settings.fines; kvSave('settings',settings); render(); break;
    case 'install': if(ui.installEvt){ ui.installEvt.prompt(); ui.installEvt.userChoice.finally(()=>{ ui.installEvt=null; render(); }); } break;
    case 'update': if(ui.updateReady&&ui.updateReady.waiting) ui.updateReady.waiting.postMessage('SKIP_WAITING'); break;
    case 'logout': session=null; kvSave('session',null); ui.screen='login'; ui.teamSel=''; render(); break;
    case 'open': {
      const [d,w,mi]=D.key.split('-').map(Number), f=fixturesFor(session.div,session.num).find(x=>x.key===D.key);
      ensureCard(f); ui.cardKey=D.key; ui.side=startSide(cards[D.key]); ui.sel=null; ui.sheet=null; ui.reorder=null; ui.moveSheet=null; ui.screen='card'; render(); window.scrollTo(0,0); break; }
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
      const c=curCard(), {side}=ui.sheet, num=side==='home'?c.home:c.away, sim=similar(t,rosterFor(c.div,num));
      if(sim&&sim.exact){ pickPlayer(sim.name); break; }
      if(sim){ ui.dupe=sim; render(); break; }
      addPlayer(t); break; }
    case 'forceadd': addPlayer(ui.newName); break;
    case 'lineup': {
      const c=curCard(), num=D.side==='home'?c.home:c.away, names=(SEED.lineups[c.div+'-'+num]||[]).slice(0,NSLOT);
      names.forEach((n,i)=>{ c.players[D.side][i].name=n; }); persist(c.key); render(); break; }
    case 'submit': { const c=curCard(); if(checkCard(c).blockers.length) break;
      c.status='submitted'; c.submittedAt=new Date().toISOString(); c.by=teamName(session.div,session.num); persist(c.key); ui.sel=null; render(); window.scrollTo(0,0); break; }
    case 'edit': { const c=curCard(); c.status='draft'; persist(c.key); render(); break; }
  }
});
document.addEventListener('change',e=>{
  if(e.target.id==='teamSel'){ ui.teamSel=e.target.value; ui.pinMsg=''; }
  if(e.target.id==='photoIn' && e.target.files[0]){
    const c=curCard();
    compressBlob(e.target.files[0])
      .then(blob=>idbPut('photos',c.key,blob).then(()=>blob))
      .then(blob=>{ if(photoURLs[c.key]) URL.revokeObjectURL(photoURLs[c.key]); photoURLs[c.key]=URL.createObjectURL(blob); c.hasPhoto=true; ui.msg=''; persist(c.key); render(); })
      .catch(()=>{ ui.msg='That photo could not be saved. Check the phone has some free space, then try again.'; render(); });
  }
});
document.addEventListener('input',e=>{ if(e.target.id==='newName'){ ui.newName=e.target.value; if(ui.dupe){ ui.dupe=null; } } });
window.addEventListener('online',render); window.addEventListener('offline',render);
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); ui.installEvt=e; if(ui.screen==='login') render(); });
window.addEventListener('appinstalled',()=>{ ui.installEvt=null; render(); });

function requestPersist(){ try{ if(navigator.storage&&navigator.storage.persist) navigator.storage.persist(); }catch(e){} }

async function init(){
  render();   // shows "Loading…"
  try{
    const kv=await idbAll('kv');
    if(kv.settings) settings=Object.assign(settings,kv.settings);
    session=kv.session||null; extra=kv.extraRoster||{};
    cards=await idbAll('cards');
    const photos=await idbAll('photos');
    Object.keys(photos).forEach(k=>{ photoURLs[k]=URL.createObjectURL(photos[k]); });
    requestPersist();
  }catch(e){
    ui.msg='This phone is not letting the app save anything, so scores would be lost if the app closed. Try opening it in a normal (not private) browser window.';
  }
  ui.screen = session ? 'fixtures' : 'login';
  render();
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