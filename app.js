const STORAGE_KEY = 'srs_app_state_v1';

function seedData() {
  const sources = [
    { id:'s1', title:'Biology Fundamentals.pdf', sourceType:'pdf', sizeLabel:'876 pages', tags:['biology','science'], totalUnits:142, totalReviews:850, averageReviewSeconds:517, totalStudySeconds:828720, lastUpdatedAt:'2024-01-15', priority:'high', origin:'/Sourcefiles/Biology Fundamentals.pdf' },
    { id:'s2', title:'Photosynthesis Lecture.mp4', sourceType:'local_video', sizeLabel:'35 min', tags:['biology','video'], totalUnits:16, totalReviews:78, averageReviewSeconds:412, totalStudySeconds:43000, lastUpdatedAt:'2024-01-12', priority:'medium', origin:'/Sourcefiles/Photosynthesis Lecture.mp4' },
    { id:'s3', title:'History of Roman Empire [HD]', sourceType:'youtube', sizeLabel:'45 min', tags:['history'], totalUnits:14, totalReviews:63, averageReviewSeconds:388, totalStudySeconds:29000, lastUpdatedAt:'2024-01-09', priority:'low', origin:'https://youtube.com/watch?v=demo' }
  ];

  const hierarchy = [
    {id:'h1',sourceId:'s1',parentId:null,title:'Introduction',depth:0,isLeaf:false,studyState:'started',inQueue:true,pageStart:1,pageEnd:16},
    {id:'h2',sourceId:'s1',parentId:null,title:'Cells',depth:0,isLeaf:false,studyState:'started',inQueue:true,pageStart:17,pageEnd:90},
    {id:'h3',sourceId:'s1',parentId:null,title:'Membranes',depth:0,isLeaf:false,studyState:'mastered',inQueue:true,pageStart:91,pageEnd:160},
    {id:'h31',sourceId:'s1',parentId:'h3',title:'Structure & Function',depth:1,isLeaf:true,studyState:'started',inQueue:true,pageStart:96,pageEnd:110},
    {id:'h32',sourceId:'s1',parentId:'h3',title:'Passive Transport',depth:1,isLeaf:true,studyState:'mastered',inQueue:true,pageStart:111,pageEnd:120},
    {id:'h33',sourceId:'s1',parentId:'h3',title:'Active Transport',depth:1,isLeaf:true,studyState:'started',inQueue:false,pageStart:121,pageEnd:128},
    {id:'h34',sourceId:'s1',parentId:'h3',title:'Membrane Proteins',depth:1,isLeaf:true,studyState:'started',inQueue:true,pageStart:129,pageEnd:140},
    {id:'h4',sourceId:'s1',parentId:null,title:'Genetics',depth:0,isLeaf:false,studyState:'unstudied',inQueue:false,pageStart:401,pageEnd:520}
  ];

  const atomicUnits = hierarchy.filter(h=>h.isLeaf).map((h,i)=>({
    id:`u${i+1}`,
    title:h.title,
    sourceId:h.sourceId,
    sourceTitle:sources.find(s=>s.id===h.sourceId).title,
    sourceType:'pdf',
    fullPath:['Biology Fundamentals','Chapter 3','Membranes',h.title],
    pageStart:h.pageStart,
    pageEnd:h.pageEnd,
    sizeLabel:`${h.pageEnd-h.pageStart+1} pages`,
    retentionScore:Math.floor(35 + Math.random()*60),
    dueAt:new Date(Date.now()+86400000*(i+1)).toISOString(),
    lastReviewedAt:new Date(Date.now()-86400000*(i+2)).toISOString(),
    totalReviews:6+i,
    inQueue:h.inQueue
  }));

  return {
    app:{ route:'queue', selectedSourceId:'s1', selectedUnitId:atomicUnits[0].id, selectedHierarchyItemId:'h31', timer:{running:false,startTs:null,elapsed:0}, reviewHistoryOpen:false },
    sources,
    hierarchy,
    atomicUnits,
    reviews:[],
    reviewRevisions:[],
    views:{
      sources:{ searchText:'', activeTags:[], sourceTypeFilter:'all', selectedSourceId:'s1', sortKey:'title', sortDirection:'asc', scrollOffset:0 },
      portal:{ sourceId:'s1', selectedHierarchyItemId:'h31', expandedItemIds:['h3'], outlineSearchText:'', viewerPage:96, viewerZoom:120 },
      queue:{ selectedUnitId:atomicUnits[0].id, scrollOffset:0, preRecallNote:'', postRecallNote:'' }
    }
  };
}

let state = load();
let timerHandle = null;

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return seedData();
  try { return JSON.parse(raw); } catch { return seedData(); }
}
function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function setState(mutator) { mutator(state); save(); render(); }

function fmtSec(sec){const m=Math.floor(sec/60);const s=sec%60;return `${m}m ${s}s`;}
function fmtDur(sec){if(!sec) return '0m'; const h=Math.floor(sec/3600); const m=Math.floor((sec%3600)/60); return h?`${h}h ${m}m`:`${m}m ${sec%60}s`;}

function topNav(){
  const tabs = [['queue','Study Queue'],['sources','Sources'],['settings','Settings']];
  return `<div class="top-nav"><div class="brand">📘</div>${tabs.map(([id,label])=>`<button data-nav="${id}" class="${state.app.route===id?'active':''}">${label}</button>`).join('')}<div style="flex:1"></div><span>🔍 🔔 👤</span></div>`;
}

function renderSources(){
  const v=state.views.sources;
  let rows = [...state.sources];
  if (v.searchText) rows=rows.filter(s=>s.title.toLowerCase().includes(v.searchText.toLowerCase())||s.tags.join(' ').includes(v.searchText.toLowerCase()));
  if (v.sourceTypeFilter==='pdf') rows=rows.filter(s=>s.sourceType==='pdf');
  if (v.sourceTypeFilter==='video') rows=rows.filter(s=>['youtube','local_video'].includes(s.sourceType));
  if (v.activeTags.length) rows=rows.filter(s=>v.activeTags.every(t=>s.tags.includes(t)));
  rows.sort((a,b)=>String(a[v.sortKey]??'').localeCompare(String(b[v.sortKey]??''))*(v.sortDirection==='asc'?1:-1));
  const selected = state.sources.find(s=>s.id===v.selectedSourceId) || rows[0];

  return `<div class="page grid-2">
    <div class="panel">
      <h1>Sources</h1>
      <div class="controls-row"><input class="search" placeholder="Search sources..." value="${v.searchText}" data-action="sources-search"><select data-action="sources-type"><option value="all" ${v.sourceTypeFilter==='all'?'selected':''}>All</option><option value="pdf" ${v.sourceTypeFilter==='pdf'?'selected':''}>PDF</option><option value="video" ${v.sourceTypeFilter==='video'?'selected':''}>Video</option></select><button data-action="sources-add">+ Add Source</button></div>
      <table class="table" id="sources-table"><thead><tr><th>Name & Type</th><th>Size</th><th>Tags</th><th>Total Units</th><th>Reviews</th></tr></thead>
      <tbody>${rows.map(s=>`<tr data-source-row="${s.id}" class="${selected?.id===s.id?'selected':''}"><td><a href="#" class="title-link" data-open-source="${s.id}">${s.title}</a><div class="muted">${s.sourceType}</div></td><td>${s.sizeLabel}</td><td>${s.tags.map(t=>`<span class="badge">${t}</span>`).join('')}</td><td>${s.totalUnits}</td><td>${s.totalReviews}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="panel">${selected?`<h2>${selected.title}</h2><div class="muted">${selected.sourceType} / ${selected.sizeLabel}</div><div>${selected.tags.map(t=>`<span class="badge">${t}</span>`).join('')}</div><hr><div class="split"><div><div class="muted">Total Units</div><div>${selected.totalUnits}</div></div><div><div class="muted">Reviews</div><div>${selected.totalReviews}</div></div><div><div class="muted">Avg Time</div><div>${fmtSec(selected.averageReviewSeconds)}</div></div></div><hr><div>${fmtDur(selected.totalStudySeconds)} total study</div><div class="muted">Last updated ${selected.lastUpdatedAt}</div><div class="muted">Imported from ${selected.origin}</div><div class="row"><button data-open-source="${selected.id}">Open Source</button><button data-action="source-more">More Actions</button></div>`:'No source selected'}</div>
  </div>`;
}

function renderPortal(){
  const src = state.sources.find(s=>s.id===state.views.portal.sourceId) || state.sources[0];
  const items = state.hierarchy.filter(h=>h.sourceId===src.id).filter(h=>h.title.toLowerCase().includes(state.views.portal.outlineSearchText.toLowerCase()));
  const selected = items.find(i=>i.id===state.views.portal.selectedHierarchyItemId) || items[0];

  return `<div class="page grid-3">
    <div class="panel col"><div class="row"><button data-nav="sources">← Sources</button><strong>${src.title}</strong></div><input class="search" placeholder="Search outline..." value="${state.views.portal.outlineSearchText}" data-action="outline-search"><div class="list">${items.map(i=>{
      const filled = i.studyState==='mastered'?2:i.studyState==='started'?1:0;
      return `<div class="tree-row indent-${Math.min(i.depth,3)} ${selected?.id===i.id?'selected':''}" data-select-h="${i.id}"><span>${i.title}</span><span class="row"><small class="muted">${i.pageStart||''}${i.pageEnd?`-${i.pageEnd}`:''}</small><div class="two-bar ${i.inQueue?'in-queue':'not-queue'}" data-toggle-queue="${i.id}"><span class="${filled>0?'filled':''}"></span><span class="${filled>1?'filled':''}"></span></div></span></div>`;
    }).join('')}</div></div>
    <div class="panel"><div class="toolbar"><button data-action="zoom-out">-</button><span>${state.views.portal.viewerZoom}%</span><button data-action="zoom-in">+</button><button data-action="page-prev">Prev</button><button data-action="page-next">Next</button><span>Page ${state.views.portal.viewerPage}</span></div><div class="viewer">${src.sourceType==='pdf'?'PDF Viewer':'Video Viewer'} for <strong style="margin-left:6px;">${selected?.title||src.title}</strong></div></div>
    <div class="panel"><h2>${src.title}</h2><div class="muted">${src.sourceType} / ${src.sizeLabel}</div><div>${src.tags.map(t=>`<span class="badge">${t}</span>`).join('')}</div><hr><div class="split"><div><div class="muted">Units</div>${src.totalUnits}</div><div><div class="muted">Reviews</div>${src.totalReviews}</div><div><div class="muted">Avg</div>${fmtSec(src.averageReviewSeconds)}</div></div><hr><div>${fmtDur(src.totalStudySeconds)} total</div><div class="muted">Last updated ${src.lastUpdatedAt}</div><div class="muted">${src.origin}</div></div>
  </div>`;
}

function renderQueue(){
  const units = state.atomicUnits.filter(u=>u.inQueue);
  const unit = units.find(u=>u.id===state.views.queue.selectedUnitId) || units[0];
  const timer = state.app.timer;
  const sec = timer.running && timer.startTs ? timer.elapsed + Math.floor((Date.now()-timer.startTs)/1000) : timer.elapsed;
  const unitReviews = state.reviews.filter(r=>r.unitId===unit?.id && !r.deletedAt);

  return `<div class="page grid-3">
    <div class="panel col"><h1>Study Queue</h1><div class="muted">${units.length} units</div><div class="list">${units.map(u=>`<div class="list-item ${u.id===unit?.id?'selected':''}" data-select-unit="${u.id}"><div><strong>${u.title}</strong><div class="muted small">${u.sourceTitle}</div><div class="small">${u.sizeLabel}</div></div><div>${u.retentionScore}%</div></div>`).join('')}</div></div>
    <div class="col"><div class="panel"><div class="split"><div><h2>${unit?.title||'No unit'}</h2><div class="muted">${unit?.fullPath.join(' › ')||''}</div></div><button data-action="open-history">Review History</button></div><hr><div class="split"><div><div class="muted">Last reviewed</div>${unit?.lastReviewedAt?new Date(unit.lastReviewedAt).toDateString():'—'}</div><div><div class="muted">Total reviews</div>${unit?.totalReviews||0}</div><div><div class="muted">Retention</div>${unit?.retentionScore||0}%</div></div></div>
      <div class="panel"><div class="split"><div><strong>⏱ ${Math.floor(sec/3600).toString().padStart(2,'0')}:${Math.floor((sec%3600)/60).toString().padStart(2,'0')}:${(sec%60).toString().padStart(2,'0')}</strong></div><div class="row"><button data-action="timer-start">${timer.running?'Restart':'Start'}</button><button data-action="timer-pause">Pause</button><button data-action="timer-stop">Stop</button></div></div><div class="row"><label><input type="checkbox" ${state.views.queue.preRecallNote?'checked':''} data-action="toggle-pre"> Pre-recall note</label><label><input type="checkbox" ${state.views.queue.postRecallNote?'checked':''} data-action="toggle-post"> Post-recall note</label></div><div class="outcome row"><button class="easy" data-outcome="easy">Easy</button><button class="with_effort" data-outcome="with_effort">With Effort</button><button class="hard" data-outcome="hard">Hard</button><button class="skip" data-outcome="skip">Skip</button></div></div>
      <div class="panel"><div class="split"><strong>Notes</strong></div><div class="split"><div style="width:50%"><div class="muted">Pre</div><textarea data-note="pre">${state.views.queue.preRecallNote||''}</textarea></div><div style="width:50%"><div class="muted">Post</div><textarea data-note="post">${state.views.queue.postRecallNote||''}</textarea></div></div></div>
      <div class="panel"><div class="viewer">Embedded reader on pages ${unit?.pageStart||'-'}-${unit?.pageEnd||'-'}</div></div>
    </div>
    <div class="panel"><h3>Today</h3><div class="muted">Custom queue and projections are planned; currently recording reviews.</div><hr><div>Pending: ${units.length}</div><div>Recorded reviews: ${state.reviews.length}</div><div>Revisions: ${state.reviewRevisions.length}</div><h4>Recent</h4>${unitReviews.slice(-5).reverse().map(r=>`<div class="list-item"><span>${new Date(r.createdAt).toLocaleDateString()} ${r.outcome}</span><span>${fmtSec(r.durationSeconds)}</span></div>`).join('') || '<div class="muted">No reviews yet.</div>'}</div>
    ${state.app.reviewHistoryOpen ? renderReviewHistoryModal(unit, unitReviews) : ''}
  </div>`;
}

function renderReviewHistoryModal(unit, reviews) {
  return `<div class="modal-backdrop" data-action="close-history"><div class="panel modal" onclick="event.stopPropagation()"><div class="split"><h2>Review History</h2><button data-action="close-history">✕</button></div><div><strong>${unit.title}</strong><div class="muted">${unit.fullPath.join(' › ')}</div></div><table class="table"><thead><tr><th>Date</th><th>Study Time</th><th>Pre Note</th><th>Post Note</th><th>Outcome</th><th></th></tr></thead><tbody>${reviews.map(r=>`<tr><td>${new Date(r.createdAt).toLocaleDateString()}</td><td>${fmtSec(r.durationSeconds)}</td><td><input value="${(r.preRecallNote||'').replaceAll('"','&quot;')}" data-edit-pre="${r.id}"></td><td><input value="${(r.postRecallNote||'').replaceAll('"','&quot;')}" data-edit-post="${r.id}"></td><td><select data-edit-outcome="${r.id}"><option ${r.outcome==='easy'?'selected':''} value="easy">easy</option><option ${r.outcome==='with_effort'?'selected':''} value="with_effort">with effort</option><option ${r.outcome==='hard'?'selected':''} value="hard">hard</option><option ${r.outcome==='skip'?'selected':''} value="skip">skip</option></select></td><td><button data-review-save="${r.id}">Save</button><button data-review-delete="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table></div></div>`;
}

function renderSettings(){
  return `<div class="page"><div class="panel"><h1>Settings</h1><p class="muted">Settings page scaffold is included in app shell and can be expanded later.</p><button data-action="reset">Reset demo data</button></div></div>`;
}

function render(){
  const app = document.getElementById('app');
  app.innerHTML = `<div class="app-shell">${topNav()}${state.app.route==='sources'?renderSources():state.app.route==='portal'?renderPortal():state.app.route==='settings'?renderSettings():renderQueue()}</div>`;
  bind();
}

function addRevision(recordId, before, after, reason) {
  state.reviewRevisions.push({ id:crypto.randomUUID(), recordId, before, after, reason, createdAt:new Date().toISOString() });
}

function bind(){
  document.querySelectorAll('[data-nav]').forEach(el=>el.onclick=()=>setState(s=>{s.app.route=el.dataset.nav;}));

  const sSearch=document.querySelector('[data-action="sources-search"]');
  if(sSearch) sSearch.oninput=e=>setState(s=>{s.views.sources.searchText=e.target.value;});
  const sType=document.querySelector('[data-action="sources-type"]');
  if(sType) sType.onchange=e=>setState(s=>{s.views.sources.sourceTypeFilter=e.target.value;});
  document.querySelectorAll('[data-source-row]').forEach(row=>{
    row.onclick=()=>setState(s=>{s.views.sources.selectedSourceId=row.dataset.sourceRow; s.app.selectedSourceId=row.dataset.sourceRow;});
    row.oncontextmenu=(e)=>{e.preventDefault();openContextMenu(e.clientX,e.clientY,row.dataset.sourceRow);};
  });
  document.querySelectorAll('[data-open-source]').forEach(el=>el.onclick=(e)=>{e.preventDefault();setState(s=>{const id=el.dataset.openSource; s.views.sources.selectedSourceId=id; s.views.portal.sourceId=id; s.app.route='portal';});});

  const oSearch=document.querySelector('[data-action="outline-search"]');
  if(oSearch) oSearch.oninput=e=>setState(s=>{s.views.portal.outlineSearchText=e.target.value;});
  document.querySelectorAll('[data-select-h]').forEach(el=>el.onclick=()=>setState(s=>{const id=el.dataset.selectH; s.views.portal.selectedHierarchyItemId=id; const h=s.hierarchy.find(x=>x.id===id); if(h?.pageStart) s.views.portal.viewerPage=h.pageStart;}));
  document.querySelectorAll('[data-toggle-queue]').forEach(el=>el.onclick=(e)=>{e.stopPropagation(); setState(s=>{const h=s.hierarchy.find(x=>x.id===el.dataset.toggleQueue); if(!h) return; h.inQueue=!h.inQueue; if(h.isLeaf){ const u=s.atomicUnits.find(x=>x.title===h.title && x.sourceId===h.sourceId); if(u) u.inQueue=h.inQueue; }});});
  [['zoom-in',10],['zoom-out',-10]].forEach(([k,v])=>{const btn=document.querySelector(`[data-action="${k}"]`); if(btn) btn.onclick=()=>setState(s=>{s.views.portal.viewerZoom=Math.max(50,Math.min(200,s.views.portal.viewerZoom+v));});});
  const pp=document.querySelector('[data-action="page-prev"]'); if(pp) pp.onclick=()=>setState(s=>s.views.portal.viewerPage=Math.max(1,s.views.portal.viewerPage-1));
  const pn=document.querySelector('[data-action="page-next"]'); if(pn) pn.onclick=()=>setState(s=>s.views.portal.viewerPage=s.views.portal.viewerPage+1);

  document.querySelectorAll('[data-select-unit]').forEach(el=>el.onclick=()=>setState(s=>{s.views.queue.selectedUnitId=el.dataset.selectUnit;}));
  const pre=document.querySelector('[data-note="pre"]'); if(pre) pre.oninput=e=>setState(s=>{s.views.queue.preRecallNote=e.target.value;});
  const post=document.querySelector('[data-note="post"]'); if(post) post.oninput=e=>setState(s=>{s.views.queue.postRecallNote=e.target.value;});

  const start=document.querySelector('[data-action="timer-start"]');
  if(start) start.onclick=()=>setState(s=>{s.app.timer.running=true; s.app.timer.startTs=Date.now(); s.app.timer.elapsed=0;});
  const pause=document.querySelector('[data-action="timer-pause"]');
  if(pause) pause.onclick=()=>setState(s=>{if(s.app.timer.running&&s.app.timer.startTs){s.app.timer.elapsed += Math.floor((Date.now()-s.app.timer.startTs)/1000);} s.app.timer.running=false; s.app.timer.startTs=null;});
  const stop=document.querySelector('[data-action="timer-stop"]');
  if(stop) stop.onclick=()=>setState(s=>{if(s.app.timer.running&&s.app.timer.startTs){s.app.timer.elapsed += Math.floor((Date.now()-s.app.timer.startTs)/1000);} s.app.timer.running=false; s.app.timer.startTs=null;});

  document.querySelectorAll('[data-outcome]').forEach(el=>el.onclick=()=>setState(s=>{
    const unitId=s.views.queue.selectedUnitId;
    if(!unitId) return;
    let duration=s.app.timer.elapsed;
    if(s.app.timer.running&&s.app.timer.startTs){duration += Math.floor((Date.now()-s.app.timer.startTs)/1000);}    
    const rec={ id:crypto.randomUUID(), unitId, startedAt:new Date(Date.now()-duration*1000).toISOString(), endedAt:new Date().toISOString(), durationSeconds:duration, preRecallNote:s.views.queue.preRecallNote||undefined, postRecallNote:s.views.queue.postRecallNote||undefined, outcome:el.dataset.outcome, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null};
    s.reviews.push(rec);
    const unit=s.atomicUnits.find(u=>u.id===unitId);
    if(unit){ unit.lastReviewedAt=rec.endedAt; unit.totalReviews +=1; unit.retentionScore=Math.max(0,Math.min(100,unit.retentionScore + (rec.outcome==='easy'?6:rec.outcome==='with_effort'?2:rec.outcome==='hard'?-5:-1))); }
    s.app.timer={running:false,startTs:null,elapsed:0};
  }));

  const oh=document.querySelector('[data-action="open-history"]'); if(oh) oh.onclick=()=>setState(s=>s.app.reviewHistoryOpen=true);
  document.querySelectorAll('[data-action="close-history"]').forEach(el=>el.onclick=()=>setState(s=>s.app.reviewHistoryOpen=false));
  document.querySelectorAll('[data-review-save]').forEach(el=>el.onclick=()=>setState(s=>{
    const r=s.reviews.find(x=>x.id===el.dataset.reviewSave); if(!r) return;
    const before={...r};
    const pre=document.querySelector(`[data-edit-pre="${r.id}"]`)?.value;
    const post=document.querySelector(`[data-edit-post="${r.id}"]`)?.value;
    const out=document.querySelector(`[data-edit-outcome="${r.id}"]`)?.value;
    r.preRecallNote=pre; r.postRecallNote=post; r.outcome=out; r.updatedAt=new Date().toISOString();
    addRevision(r.id,before,{...r},'manual_edit');
  }));
  document.querySelectorAll('[data-review-delete]').forEach(el=>el.onclick=()=>setState(s=>{
    const r=s.reviews.find(x=>x.id===el.dataset.reviewDelete); if(!r || r.deletedAt) return;
    const before={...r};
    r.deletedAt=new Date().toISOString();
    addRevision(r.id,before,{...r},'soft_delete');
  }));

  const reset=document.querySelector('[data-action="reset"]'); if(reset) reset.onclick=()=>{state=seedData(); save(); render();};

  if (timerHandle) clearInterval(timerHandle);
  if (state.app.route==='queue' && state.app.timer.running) {
    timerHandle = setInterval(()=>render(),1000);
  }
}

function openContextMenu(x,y,sourceId){
  document.querySelector('.context-menu')?.remove();
  const src=state.sources.find(s=>s.id===sourceId);
  const menu=document.createElement('div');
  menu.className='context-menu';
  menu.style.left=`${x}px`; menu.style.top=`${y}px`;
  const priorities=['high','medium','low','none'];
  menu.innerHTML=`<button data-cm="open">Open Source</button><button data-cm="rename">Rename</button><div class="small muted" style="padding:4px 8px">Priority</div>${priorities.map(p=>`<button data-priority="${p}">${src.priority===p?'✓ ':''}${p}</button>`).join('')}<button data-cm="download">Download</button><button data-cm="remove">Remove Source</button>`;
  document.body.append(menu);
  setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);
  menu.querySelector('[data-cm="open"]').onclick=()=>setState(s=>{s.views.portal.sourceId=sourceId; s.app.route='portal'; menu.remove();});
  menu.querySelectorAll('[data-priority]').forEach(b=>b.onclick=()=>setState(s=>{const t=s.sources.find(v=>v.id===sourceId); if(t) t.priority=b.dataset.priority; menu.remove();}));
}

render();
