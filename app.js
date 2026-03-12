const EMPTY_DATA = { sources: [], hierarchy: [], units: [], reviews: [], revisions: [] };

function defaultState() {
  return {
    data: structuredClone(EMPTY_DATA),
    view: {
      page: 'sources',
      sources: { searchText: '', sourceTypeFilter: 'all', selectedSourceId: null, scrollOffset: 0 },
      portal: { sourceId: null, selectedHierarchyItemId: null, outlineSearchText: '', viewerPage: 1, viewerZoom: 120 },
      queue: { selectedUnitId: null, preRecallNote: '', postRecallNote: '', timerRunning: false, timerStartedAt: null, elapsedSec: 0 }
    }
  };
}

function isLegacySeedData(data) {
  const legacyTitles = ['Biology Fundamentals.pdf', 'Data Structures.pdf', 'History of Roman Empire [HD]'];
  return Array.isArray(data?.sources) && data.sources.some(s => legacyTitles.includes(s.title));
}

const persisted = JSON.parse(localStorage.getItem('srs-app-state') || 'null');
const state = persisted && !isLegacySeedData(persisted.data) ? persisted : defaultState();

const save = () => localStorage.setItem('srs-app-state', JSON.stringify(state));
const pageRoot = document.getElementById('page-root');
const navButtons = [...document.querySelectorAll('.nav-btn')];
navButtons.forEach(b => b.onclick = () => { state.view.page = b.dataset.page; render(); save(); });

function render() {
  navButtons.forEach(b => b.classList.toggle('active', b.dataset.page === state.view.page));
  if (state.view.page === 'sources') renderSources();
  else if (state.view.page === 'settings') renderSettings();
  else if (state.view.page === 'portal') renderPortal();
  else renderQueue();
}

function importSourceFromForm() {
  const title = document.getElementById('import-title').value.trim();
  const sourceType = document.getElementById('import-type').value;
  const size = document.getElementById('import-size').value.trim();
  const tags = document.getElementById('import-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const origin = document.getElementById('import-origin').value.trim();
  if (!title || !size) return alert('Title and size are required.');

  const sourceId = crypto.randomUUID();
  const source = {
    id: sourceId,
    title,
    sourceType,
    sizeLabel: size,
    tags,
    totalUnits: 0,
    totalReviews: 0,
    averageReviewSeconds: 0,
    totalStudySeconds: 0,
    lastUpdatedAt: new Date().toISOString().slice(0, 10),
    priority: 'none',
    origin: origin || '(user imported)'
  };

  state.data.sources.push(source);
  autoParseSource(source);
  state.view.sources.selectedSourceId = sourceId;
  state.view.portal.sourceId = sourceId;
  state.view.page = 'sources';
  closeImportModal();
  render();
  save();
}

function autoParseSource(source) {
  const sections = ['Introduction', 'Core Concepts', 'Examples', 'Practice', 'Summary'];
  const addedHierarchy = sections.flatMap((title, idx) => {
    const parentId = crypto.randomUUID();
    const leafId = crypto.randomUUID();
    const base = idx * 10 + 1;
    return [
      { id: parentId, sourceId: source.id, parentId: null, title, depth: 0, isLeaf: false, studyState: 'unstudied', inQueue: true, pageStart: base, pageEnd: base + 4 },
      { id: leafId, sourceId: source.id, parentId, title: `${title} — Review Unit`, depth: 1, isLeaf: true, studyState: 'unstudied', inQueue: true, pageStart: base, pageEnd: base + 2 }
    ];
  });
  state.data.hierarchy.push(...addedHierarchy);

  const addedUnits = addedHierarchy.filter(x => x.isLeaf).map((leaf, i) => ({
    id: crypto.randomUUID(),
    title: leaf.title,
    sourceId: source.id,
    sourceTitle: source.title,
    sourceType: source.sourceType,
    fullPath: [leaf.title.replace(' — Review Unit', '')],
    pageStart: source.sourceType === 'pdf' ? leaf.pageStart : undefined,
    pageEnd: source.sourceType === 'pdf' ? leaf.pageEnd : undefined,
    timeStartSec: source.sourceType !== 'pdf' ? i * 180 : undefined,
    timeEndSec: source.sourceType !== 'pdf' ? i * 180 + 150 : undefined,
    sizeLabel: source.sourceType === 'pdf' ? '3 pages' : '2.5 min',
    retentionScore: 0,
    dueAt: null,
    lastReviewedAt: null,
    totalReviews: 0,
    inQueue: true
  }));
  state.data.units.push(...addedUnits);
  source.totalUnits = addedUnits.length;
  state.view.portal.selectedHierarchyItemId = addedHierarchy.find(h => h.isLeaf)?.id || null;
  state.view.queue.selectedUnitId = addedUnits[0]?.id || null;
}

function openImportModal() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'import-modal-wrap';
  wrap.innerHTML = `<div class="panel modal"><div class="row" style="justify-content:space-between"><h2>Import Source</h2><button class="btn" id="close-import">✕</button></div>
    <div class="col">
      <label>Title <input id="import-title" placeholder="e.g. Neurobiology Notes.pdf"></label>
      <label>Type <select id="import-type"><option value="pdf">PDF</option><option value="youtube">YouTube</option><option value="local_video">Local Video</option></select></label>
      <label>Size Label <input id="import-size" placeholder="e.g. 240 pages or 90 min"></label>
      <label>Tags (comma-separated) <input id="import-tags" placeholder="biology, textbook"></label>
      <label>Origin / Path / URL <input id="import-origin" placeholder="/path/file.pdf or https://youtube.com/..." ></label>
      <div class="row"><button class="btn" id="confirm-import">Import</button><button class="btn" id="cancel-import">Cancel</button></div>
    </div></div>`;
  document.body.appendChild(wrap);
  document.getElementById('close-import').onclick = closeImportModal;
  document.getElementById('cancel-import').onclick = closeImportModal;
  document.getElementById('confirm-import').onclick = importSourceFromForm;
}

function closeImportModal() {
  document.getElementById('import-modal-wrap')?.remove();
}

function renderSources() {
  const v = state.view.sources;
  const d = state.data;
  const types = {
    all: () => true,
    pdf: s => s.sourceType === 'pdf',
    video: s => ['youtube', 'local_video'].includes(s.sourceType),
    other: s => !['pdf', 'youtube', 'local_video'].includes(s.sourceType)
  };
  const list = d.sources.filter(s => s.title.toLowerCase().includes(v.searchText.toLowerCase()) && types[v.sourceTypeFilter](s));
  const selected = d.sources.find(s => s.id === v.selectedSourceId) || null;

  pageRoot.innerHTML = `<section class="sources-grid">
    <div>
      <h1>Sources</h1>
      <div class="toolbar"><input id="src-search" placeholder="Search sources..." value="${v.searchText}"><select id="src-type"><option value="all">All</option><option value="pdf">PDF</option><option value="video">Video</option><option value="other">Other</option></select><button class="btn" id="add-source">+ Add Source</button></div>
      <div class="panel">${list.length ? `<table class="table"><thead><tr><th>Name & Type</th><th>Size</th><th>Tags</th><th>Total Units</th><th>Reviews</th></tr></thead>
      <tbody>${list.map(s => `<tr data-source-row="${s.id}" class="${s.id === v.selectedSourceId ? 'selected' : ''}"><td><a href="#" class="source-link" data-open-portal="${s.id}">${s.title}</a><div class="small">${s.sourceType}</div></td><td>${s.sizeLabel}</td><td>${s.tags.map(t => `<span class=chip>${t}</span>`).join(' ') || '<span class="small">—</span>'}</td><td>${s.totalUnits}</td><td>${s.totalReviews}</td></tr>`).join('')}</tbody></table>` : `<div class="empty"><h3>No sources yet</h3><p class="small">Import your first PDF, YouTube link, or local video to generate outline + review units.</p><button class="btn" id="add-source-empty">+ Add Source</button></div>`}</div>
    </div>
    <aside class="panel" style="padding:12px">${selected ? `<h2>${selected.title}</h2><div class="small">${selected.sourceType} / ${selected.sizeLabel}</div><div class="chips">${selected.tags.map(t => `<span class=chip>${t}</span>`).join(' ') || '<span class="small">No tags</span>'}</div><hr><div class="row"><div><div>${selected.totalUnits}</div><div class=small>Total Units</div></div><div><div>${selected.totalReviews}</div><div class=small>Total Reviews</div></div></div><p>Avg Time: ${Math.round((selected.averageReviewSeconds || 0) / 60)}m ${(selected.averageReviewSeconds || 0) % 60}s</p><p>Study Time: ${Math.round((selected.totalStudySeconds || 0) / 3600)}h</p><p>Last Updated: ${selected.lastUpdatedAt || '—'}</p><p class=small>${selected.origin}</p><div class="row"><button class="btn" data-open-portal="${selected.id}">Open Source</button><button class="btn">More Actions</button></div>` : `<h2>Source Details</h2><p class="small">Select a source to inspect details, or import a new one.</p>`}</aside>
  </section>`;

  document.getElementById('src-search').oninput = e => { v.searchText = e.target.value; renderSources(); save(); };
  document.getElementById('src-type').value = v.sourceTypeFilter;
  document.getElementById('src-type').onchange = e => { v.sourceTypeFilter = e.target.value; renderSources(); save(); };
  document.getElementById('add-source').onclick = openImportModal;
  document.getElementById('add-source-empty')?.addEventListener('click', openImportModal);

  document.querySelectorAll('[data-source-row]').forEach(r => {
    r.onclick = e => {
      if (e.target.closest('[data-open-portal]')) return;
      v.selectedSourceId = r.dataset.sourceRow;
      renderSources();
      save();
    };
    r.oncontextmenu = e => openContextMenu(e, r.dataset.sourceRow);
  });

  document.querySelectorAll('[data-open-portal]').forEach(a => a.onclick = e => {
    e.preventDefault();
    state.view.portal.sourceId = a.dataset.openPortal;
    state.view.page = 'portal';
    render();
    save();
  });
}

function openContextMenu(e, sourceId) {
  e.preventDefault();
  const menu = document.getElementById('context-menu');
  const source = state.data.sources.find(s => s.id === sourceId);
  if (!source) return;
  menu.classList.remove('hidden');
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  const items = ['Open Source', 'Rename', 'Priority: High', 'Priority: Medium', 'Priority: Low', 'Priority: No Priority', 'Download', 'Remove Source'];
  menu.innerHTML = items.map(label => `<div class="item" data-item="${label}">${label}${label === `Priority: ${source.priority[0].toUpperCase()}${source.priority.slice(1)}` ? ' ✓' : ''}</div>`).join('');

  [...menu.querySelectorAll('.item')].forEach((el, i) => el.onclick = () => {
    const actions = [
      () => { state.view.portal.sourceId = sourceId; state.view.page = 'portal'; },
      () => { const n = prompt('New name', source.title); if (n) source.title = n; },
      () => source.priority = 'high', () => source.priority = 'medium', () => source.priority = 'low', () => source.priority = 'none',
      () => alert('Download queued'),
      () => {
        state.data.sources = state.data.sources.filter(s => s.id !== sourceId);
        state.data.hierarchy = state.data.hierarchy.filter(h => h.sourceId !== sourceId);
        state.data.units = state.data.units.filter(u => u.sourceId !== sourceId);
        if (state.view.sources.selectedSourceId === sourceId) state.view.sources.selectedSourceId = state.data.sources[0]?.id || null;
      }
    ];
    actions[i]();
    menu.classList.add('hidden');
    render();
    save();
  });
  window.onclick = () => menu.classList.add('hidden');
}

function renderPortal() {
  const source = state.data.sources.find(s => s.id === state.view.portal.sourceId);
  if (!source) {
    pageRoot.innerHTML = `<section class="panel" style="padding:16px"><h1>Source Portal</h1><p class="small">No source is selected. Go to Sources and import one first.</p><button class="btn" id="go-sources">Go to Sources</button></section>`;
    document.getElementById('go-sources').onclick = () => { state.view.page = 'sources'; render(); save(); };
    return;
  }

  const v = state.view.portal;
  const items = state.data.hierarchy.filter(h => h.sourceId === source.id && h.title.toLowerCase().includes(v.outlineSearchText.toLowerCase()));
  const selected = items.find(i => i.id === v.selectedHierarchyItemId) || items[0] || null;

  pageRoot.innerHTML = `<div class="portal">
    <aside class="panel col" style="padding:10px"><div class="row"><button class="btn" id="back-sources">← Sources</button></div><input id="outline-search" placeholder="Search outline..." value="${v.outlineSearchText}"><div class="outline-list panel">${items.length ? items.map(i => {
      const fills = i.studyState === 'mastered' ? 2 : i.studyState === 'started' ? 1 : 0;
      return `<div class="outline-item ${selected?.id === i.id ? 'selected' : ''}" data-item="${i.id}"><div class="indent" style="--depth:${i.depth}"><span>${i.title}</span></div><div class="bars" data-toggle="${i.id}">${[0, 1].map(idx => `<span class="bar ${idx < fills ? `fill ${i.inQueue ? 'inq' : 'outq'}` : ''}"></span>`).join('')}</div></div>`;
    }).join('') : '<div class="small" style="padding:10px">No parsed outline items yet.</div>'}</div></aside>
    <section class="panel viewer"><div class="row"><strong>${source.title}</strong><span class="small">Page ${v.viewerPage || selected?.pageStart || 1} • Zoom ${v.viewerZoom}%</span><button class="btn" id="zoom-in">+</button><button class="btn" id="zoom-out">-</button></div><div class="viewer-doc"><h1>${selected?.title || 'No item selected'}</h1><p>Embedded viewer placeholder for ${source.sourceType.toUpperCase()} content.</p><p>Selection maps to ${source.sourceType === 'pdf' ? `page ${selected?.pageStart || 1}-${selected?.pageEnd || 1}` : `time ${selected?.timeStartSec || 0}s`}.</p></div></section>
    <aside class="panel" style="padding:10px"><h2>${source.title}</h2><div class="small">${source.sourceType} • ${source.sizeLabel}</div><div class="chips">${source.tags.map(t => `<span class=chip>${t}</span>`).join(' ')}</div><hr><div class="row"><div>${source.totalUnits}<div class="small">Total Units</div></div><div>${source.totalReviews}<div class="small">Reviews</div></div></div><p>Avg Review: ${Math.round((source.averageReviewSeconds || 0) / 60)}m</p><p>Total Study: ${Math.round((source.totalStudySeconds || 0) / 3600)}h</p><p>Updated: ${source.lastUpdatedAt}</p></aside>
  </div>`;

  document.getElementById('back-sources').onclick = () => { state.view.page = 'sources'; render(); save(); };
  document.getElementById('outline-search').oninput = e => { v.outlineSearchText = e.target.value; renderPortal(); save(); };
  document.querySelectorAll('[data-item]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-toggle]')) return;
    v.selectedHierarchyItemId = el.dataset.item;
    const i = state.data.hierarchy.find(x => x.id === el.dataset.item);
    if (i?.pageStart) v.viewerPage = i.pageStart;
    renderPortal();
    save();
  });
  document.querySelectorAll('[data-toggle]').forEach(el => el.onclick = e => {
    e.stopPropagation();
    const i = state.data.hierarchy.find(x => x.id === el.dataset.toggle);
    i.inQueue = !i.inQueue;
    const unit = state.data.units.find(u => u.sourceId === i.sourceId && u.title.startsWith(i.title));
    if (unit) unit.inQueue = i.inQueue;
    renderPortal();
    save();
  });
  document.getElementById('zoom-in').onclick = () => { v.viewerZoom = Math.min(200, (v.viewerZoom || 120) + 10); renderPortal(); save(); };
  document.getElementById('zoom-out').onclick = () => { v.viewerZoom = Math.max(50, (v.viewerZoom || 120) - 10); renderPortal(); save(); };
}

let timer;
function renderQueue() {
  const v = state.view.queue;
  const units = state.data.units.filter(u => u.inQueue);
  const u = units.find(x => x.id === v.selectedUnitId) || units[0] || null;
  if (!v.selectedUnitId && u) v.selectedUnitId = u.id;

  pageRoot.innerHTML = `<div class="queue"><aside class="panel queue-list"><h2>Study Queue</h2>${units.length ? units.map(x => `<div class="queue-item ${x.id === u?.id ? 'active' : ''}" data-unit="${x.id}"><strong>${x.title}</strong><div class="small">${x.sourceTitle} • ${x.sizeLabel}</div><div>${x.retentionScore}%</div></div>`).join('') : '<p class="small">No units in queue yet. Import a source and keep units enabled in queue from Source Portal.</p>'}</aside>
  <section class="col"><div class="panel" style="padding:12px"><div class="row" style="justify-content:space-between"><div><h1>${u?.title || 'No unit selected'}</h1><div class="small">${u?.sourceTitle || '—'} • ${u?.fullPath?.join(' › ') || ''}</div></div><button class="btn" id="open-history" ${u ? '' : 'disabled'}>Review History</button></div><div class="row"><div>Last Reviewed<div>${u?.lastReviewedAt || '—'}</div></div><div>Total Reviews<div>${u?.totalReviews || 0}</div></div><div>Retention<div>${u?.retentionScore || 0}%</div></div></div></div>
  <div class="panel" style="padding:12px"><div class="controls"><strong id="timer">${format(v.elapsedSec)}</strong><button class="btn" id="start-stop" ${u ? '' : 'disabled'}>${v.timerRunning ? 'Pause' : 'Start'}</button><button class="btn" id="restart" ${u ? '' : 'disabled'}>Restart</button><button class="btn outcome" data-outcome="easy" ${u ? '' : 'disabled'}>Easy</button><button class="btn outcome" data-outcome="with_effort" ${u ? '' : 'disabled'}>With Effort</button><button class="btn outcome" data-outcome="hard" ${u ? '' : 'disabled'}>Hard</button><button class="btn outcome" data-outcome="skip" ${u ? '' : 'disabled'}>Skip</button></div><div class="row"><textarea id="pre-note" rows="3" placeholder="Pre-recall note" style="flex:1">${v.preRecallNote || ''}</textarea><textarea id="post-note" rows="3" placeholder="Post-recall note" style="flex:1">${v.postRecallNote || ''}</textarea></div></div>
  <div class="panel viewer" style="min-height:220px"><div class="small">Embedded ${u?.sourceType || 'source'} viewer @ ${u?.pageStart ? `page ${u.pageStart}` : `${u?.timeStartSec || 0}s`}</div><div class="viewer-doc"><h3>${u?.title || 'No unit loaded'}</h3><p>${u ? 'Context viewer opens at mapped location for quick review.' : 'Import and parse sources first to see review context here.'}</p></div></div></section></div>`;

  document.querySelectorAll('[data-unit]').forEach(el => el.onclick = () => { v.selectedUnitId = el.dataset.unit; renderQueue(); save(); });
  document.getElementById('pre-note').oninput = e => { v.preRecallNote = e.target.value; save(); };
  document.getElementById('post-note').oninput = e => { v.postRecallNote = e.target.value; save(); };
  document.getElementById('restart').onclick = () => { v.elapsedSec = 0; v.timerStartedAt = Date.now(); v.timerRunning = true; tick(); save(); renderQueue(); };
  document.getElementById('start-stop').onclick = () => { if (v.timerRunning) { v.elapsedSec += Math.floor((Date.now() - v.timerStartedAt) / 1000); v.timerRunning = false; } else { v.timerStartedAt = Date.now(); v.timerRunning = true; tick(); } save(); renderQueue(); };
  document.querySelectorAll('.outcome').forEach(b => b.onclick = () => u && completeReview(b.dataset.outcome, u));
  document.getElementById('open-history').onclick = () => u && openHistory(u.id);
}

function tick() {
  clearInterval(timer);
  timer = setInterval(() => {
    if (!state.view.queue.timerRunning) return;
    const e = state.view.queue.elapsedSec + Math.floor((Date.now() - state.view.queue.timerStartedAt) / 1000);
    const t = document.getElementById('timer');
    if (t) t.textContent = format(e);
  }, 1000);
}

function format(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}

function completeReview(outcome, unit) {
  const q = state.view.queue;
  let elapsed = q.elapsedSec;
  if (q.timerRunning) {
    elapsed += Math.floor((Date.now() - q.timerStartedAt) / 1000);
    q.timerRunning = false;
  }
  const now = new Date().toISOString();
  state.data.reviews.unshift({ id: crypto.randomUUID(), unitId: unit.id, startedAt: now, endedAt: now, durationSeconds: elapsed, preRecallNote: q.preRecallNote, postRecallNote: q.postRecallNote, outcome, createdAt: now, updatedAt: now, deletedAt: null });
  unit.totalReviews = (unit.totalReviews || 0) + 1;
  unit.lastReviewedAt = now.slice(0, 10);
  q.elapsedSec = 0;
  q.preRecallNote = '';
  q.postRecallNote = '';
  save();
  renderQueue();
}

function openHistory(unitId) {
  const rows = state.data.reviews.filter(r => r.unitId === unitId && !r.deletedAt);
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="panel modal"><div class="row" style="justify-content:space-between"><h2>Review History</h2><button class="btn" id="close">✕</button></div><table class="table"><thead><tr><th>Date</th><th>Study Time</th><th>Pre-Recall</th><th>Post-Recall</th><th>Outcome</th><th></th></tr></thead><tbody>${rows.map(r => `<tr data-rid="${r.id}"><td>${r.startedAt.slice(0, 10)}</td><td>${Math.floor(r.durationSeconds / 60)}m ${r.durationSeconds % 60}s</td><td><input data-edit="preRecallNote" value="${r.preRecallNote || ''}"></td><td><input data-edit="postRecallNote" value="${r.postRecallNote || ''}"></td><td>${r.outcome}</td><td><button class="btn" data-del="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
  document.body.appendChild(wrap);
  wrap.querySelector('#close').onclick = () => wrap.remove();
  wrap.querySelectorAll('[data-edit]').forEach(inp => inp.onchange = () => {
    const tr = inp.closest('tr');
    const r = state.data.reviews.find(x => x.id === tr.dataset.rid);
    state.data.revisions.push({ id: crypto.randomUUID(), reviewId: r.id, field: inp.dataset.edit, oldValue: r[inp.dataset.edit], newValue: inp.value, at: new Date().toISOString() });
    r[inp.dataset.edit] = inp.value;
    r.updatedAt = new Date().toISOString();
    save();
  });
  wrap.querySelectorAll('[data-del]').forEach(btn => btn.onclick = () => {
    const r = state.data.reviews.find(x => x.id === btn.dataset.del);
    state.data.revisions.push({ id: crypto.randomUUID(), reviewId: r.id, field: 'deletedAt', oldValue: r.deletedAt, newValue: new Date().toISOString(), at: new Date().toISOString() });
    r.deletedAt = new Date().toISOString();
    save();
    wrap.remove();
    openHistory(unitId);
  });
}

function renderSettings() {
  pageRoot.innerHTML = `<section class="panel" style="padding:16px"><h1>Settings</h1><p class="small">No default dataset is preloaded. You can import sources from the Sources page.</p><h3>Review Revision Audit JSON</h3><textarea rows="14" style="width:100%">${JSON.stringify(state.data.revisions, null, 2)}</textarea></section>`;
}

render();
if (state.view.queue.timerRunning) tick();
