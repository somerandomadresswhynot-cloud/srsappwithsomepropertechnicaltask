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
const importDraft = { file: null, parsedSections: [], parsing: false };

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
  autoParseSource(source, importDraft.parsedSections);
  state.view.sources.selectedSourceId = sourceId;
  state.view.portal.sourceId = sourceId;
  state.view.page = 'sources';
  closeImportModal();
  render();
  save();
}

function autoParseSource(source, parsedSections = []) {
  const sections = parsedSections.length
    ? parsedSections
    : [
      { title: 'Chapter 1 Introduction', pageStart: 1, level: 0 },
      { title: 'Section 1.1 Core Concepts', pageStart: 3, level: 1 },
      { title: 'Subsection 1.1.1 Examples', pageStart: 6, level: 2 },
      { title: 'Section 1.2 Practice', pageStart: 9, level: 1 },
      { title: 'Chapter 2 Summary', pageStart: 13, level: 0 }
    ];

  const normalized = sections.map((section, idx) => ({
    title: section.title,
    pageStart: section.pageStart || idx * 5 + 1,
    level: Number.isInteger(section.level) ? Math.max(0, Math.min(6, section.level)) : 0
  }));

  const parentStack = [];
  const addedHierarchy = normalized.map((node, idx) => {
    parentStack.length = node.level;
    const parentId = parentStack[parentStack.length - 1] || null;
    const id = crypto.randomUUID();
    parentStack.push(id);
    const pageEnd = normalized[idx + 1]?.pageStart ? Math.max(node.pageStart, normalized[idx + 1].pageStart - 1) : node.pageStart + 3;
    return {
      id,
      sourceId: source.id,
      parentId,
      title: node.title,
      depth: node.level,
      isLeaf: false,
      studyState: 'unstudied',
      inQueue: true,
      pageStart: node.pageStart,
      pageEnd
    };
  });

  const parentIds = new Set(addedHierarchy.filter(item => item.parentId).map(item => item.parentId));
  addedHierarchy.forEach(item => { item.isLeaf = !parentIds.has(item.id); });
  state.data.hierarchy.push(...addedHierarchy);

  const addedUnits = addedHierarchy.filter(x => x.isLeaf).map((leaf, i) => ({
    id: crypto.randomUUID(),
    title: leaf.title,
    hierarchyId: leaf.id,
    sourceId: source.id,
    sourceTitle: source.title,
    sourceType: source.sourceType,
    fullPath: getHierarchyPath(leaf.id, addedHierarchy),
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

async function parsePdfHeaders(file) {
  if (!window.pdfjsLib) throw new Error('PDF parser not loaded.');

  const pypdfEntries = await parseWithPyPdfService(file);
  if (pypdfEntries.length >= 4) return pypdfEntries;

  const arrayBuffer = await file.arrayBuffer();
  const task = window.pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await task.promise;

  const outlineEntries = await parsePdfOutline(pdf);
  if (outlineEntries.length >= 8) {
    return outlineEntries;
  }

  const pageCap = Math.min(pdf.numPages, 40);
  const candidates = [];
  const tocCandidates = [];

  for (let pageNo = 1; pageNo <= pageCap; pageNo += 1) {
    const page = await pdf.getPage(pageNo);
    const text = await page.getTextContent();
    const items = text.items.map(item => {
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      const size = Math.round(Math.abs(item.transform[0]) || item.height || 0);
      return { str: item.str.trim(), y, x, size };
    }).filter(item => item.str);

    const grouped = new Map();
    items.forEach(item => {
      const bucket = Math.round(item.y / 2) * 2;
      if (!grouped.has(bucket)) grouped.set(bucket, []);
      grouped.get(bucket).push(item);
    });

    const lines = [...grouped.entries()].map(([bucketY, lineItems]) => {
      const ordered = lineItems.sort((a, b) => a.x - b.x);
      const textLine = ordered.map(i => i.str).join(' ').replace(/\s+/g, ' ').trim();
      const avgSize = ordered.reduce((sum, i) => sum + i.size, 0) / ordered.length;
      const minX = Math.min(...ordered.map(i => i.x));
      return { text: textLine, avgSize, y: bucketY, minX };
    });

    const sizeValues = lines.map(line => line.avgSize).sort((a, b) => a - b);
    const medianSize = sizeValues[Math.floor(sizeValues.length / 2)] || 10;

    const tocEntries = extractTocEntries(lines);
    if (tocEntries.length >= 6) tocCandidates.push(...tocEntries);

    lines.forEach(line => {
      const cleaned = line.text.replace(/^[-•\d.\s]+/, '').trim();
      if (cleaned.length < 4 || cleaned.length > 90) return;
      const words = cleaned.split(/\s+/);
      let score = 0;
      if (/^(chapter|section|subsection|part)\s+\d+/i.test(line.text)) score += 3;
      if (/^\d+(\.\d+){0,2}\s+[A-Za-z]/.test(line.text)) score += 3;
      if (line.avgSize >= medianSize + 1) score += 2;
      if (words.length <= 10) score += 1;
      if (/^[A-Z0-9\s:,-]+$/.test(cleaned) && words.length <= 8) score += 1;
      if (/^([A-Z][\w'-]+\s){1,9}[A-Z][\w'-]+$/.test(cleaned)) score += 1;
      if (score >= 3) {
        candidates.push({ title: cleaned, pageStart: pageNo, score, level: inferHeaderLevel(cleaned, line.avgSize, medianSize) });
      }
    });
  }

  if (tocCandidates.length >= 8) {
    const dedup = dedupeCandidates(tocCandidates, c => `${c.title.toLowerCase()}|${c.pageStart}`);
    return dedup
      .sort((a, b) => a.pageStart - b.pageStart || a.level - b.level)
      .slice(0, 80);
  }

  const unique = dedupeCandidates(
    candidates.sort((a, b) => b.score - a.score || a.pageStart - b.pageStart),
    c => c.title.toLowerCase()
  );

  return unique.slice(0, 24).sort((a, b) => a.pageStart - b.pageStart || a.level - b.level);
}

async function parseWithPyPdfService(file) {
  const endpoint = localStorage.getItem('srs-pypdf-endpoint') || '/api/parse-pdf-outline';
  try {
    const formData = new FormData();
    formData.append('file', file, file.name || 'source.pdf');
    const response = await fetch(endpoint, { method: 'POST', body: formData });
    if (!response.ok) return [];
    const data = await response.json();
    if (!Array.isArray(data?.sections)) return [];
    return data.sections
      .map(item => ({
        title: (item.title || '').trim(),
        pageStart: Number(item.pageStart),
        level: Number.isInteger(item.level) ? Math.max(0, Math.min(6, item.level)) : 0,
        score: 30
      }))
      .filter(item => item.title && Number.isFinite(item.pageStart) && item.pageStart > 0)
      .sort((a, b) => a.pageStart - b.pageStart || a.level - b.level);
  } catch {
    return [];
  }
}

async function parsePdfOutline(pdf) {
  const outline = await pdf.getOutline();
  if (!outline?.length) return [];
  const entries = [];

  async function walk(items, depth) {
    for (const item of items) {
      const title = (item?.title || '').replace(/\s+/g, ' ').trim();
      if (!title) {
        if (item?.items?.length) await walk(item.items, depth + 1);
        continue;
      }
      const pageStart = await resolveOutlinePageNumber(pdf, item.dest);
      entries.push({
        title,
        pageStart,
        level: Math.max(0, Math.min(6, depth)),
        score: 20
      });
      if (item?.items?.length) await walk(item.items, depth + 1);
    }
  }

  await walk(outline, 0);

  return dedupeCandidates(entries, c => `${c.title.toLowerCase()}|${c.pageStart || -1}`)
    .filter(entry => entry.pageStart !== null)
    .sort((a, b) => a.pageStart - b.pageStart || a.level - b.level)
    .slice(0, 120);
}

async function resolveOutlinePageNumber(pdf, dest) {
  if (!dest) return null;
  try {
    const resolvedDest = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(resolvedDest) || !resolvedDest.length) return null;
    const ref = resolvedDest[0];
    const pageIndex = await pdf.getPageIndex(ref);
    return pageIndex + 1;
  } catch {
    return null;
  }
}

function extractTocEntries(lines) {
  const entryRegex = /^(.*?)\s(?:\.{2,}\s*|\s)(\d{1,4})$/;
  const tocLines = lines
    .map(line => {
      const match = line.text.match(entryRegex);
      if (!match) return null;
      const rawTitle = match[1].replace(/[•·]+/g, ' ').replace(/\s+/g, ' ').trim();
      const pageStart = Number(match[2]);
      if (!rawTitle || rawTitle.length < 3 || rawTitle.length > 120 || Number.isNaN(pageStart)) return null;
      if (/^(index|references|bibliography)$/i.test(rawTitle)) return null;
      return { title: rawTitle, pageStart, minX: line.minX };
    })
    .filter(Boolean);

  if (!tocLines.length) return [];
  const baseX = Math.min(...tocLines.map(line => line.minX));

  return tocLines.map(entry => ({
    title: entry.title,
    pageStart: entry.pageStart,
    score: 10,
    level: inferHeaderLevel(entry.title, 0, 0, entry.minX - baseX)
  }));
}

function dedupeCandidates(list, keyFn) {
  const unique = [];
  const seen = new Set();
  list.forEach(candidate => {
    const key = keyFn(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(candidate);
  });
  return unique;
}

function inferHeaderLevel(title, avgSize, medianSize, indentOffset = 0) {
  if (/^(chapter|part)\s+/i.test(title)) return 0;
  if (/^section\s+/i.test(title)) return 1;
  if (/^subsection\s+/i.test(title)) return 2;
  const numberingMatch = title.match(/^(\d+(?:\.\d+){0,2})\b/);
  if (numberingMatch) {
    const parts = numberingMatch[1].split('.').length;
    return Math.max(0, Math.min(6, parts - 1));
  }
  if (indentOffset > 28) return 2;
  if (indentOffset > 12) return 1;
  if (medianSize <= 0) return 0;
  if (avgSize >= medianSize + 3) return 0;
  if (avgSize >= medianSize + 1) return 1;
  return 2;
}

function getHierarchyPath(itemId, allHierarchy) {
  const byId = new Map(allHierarchy.map(item => [item.id, item]));
  const path = [];
  let cursor = byId.get(itemId);
  while (cursor) {
    path.unshift(cursor.title);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  return path;
}

function getDescendantIds(itemId, hierarchy) {
  const descendants = [];
  const stack = [itemId];
  while (stack.length) {
    const parent = stack.pop();
    hierarchy.filter(item => item.parentId === parent).forEach(child => {
      descendants.push(child.id);
      stack.push(child.id);
    });
  }
  return descendants;
}

async function processImportedFile(file) {
  importDraft.file = file;
  importDraft.parsedSections = [];
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const status = document.getElementById('import-parse-status');

  document.getElementById('import-title').value = file.name;
  document.getElementById('import-origin').value = file.name;
  document.getElementById('import-size').value = isPdf ? `${Math.max(1, Math.round(file.size / 1024 / 1024))} MB PDF` : `${Math.max(1, Math.round(file.size / 1024))} KB file`;
  if (isPdf) document.getElementById('import-type').value = 'pdf';

  if (!isPdf) {
    status.textContent = 'Loaded file metadata. Header parsing is currently PDF-only.';
    return;
  }

  importDraft.parsing = true;
  status.textContent = 'Parsing PDF headers…';
  try {
    const headers = await parsePdfHeaders(file);
    importDraft.parsedSections = headers.map(h => ({ title: h.title, pageStart: h.pageStart, level: h.level }));
    status.textContent = headers.length
      ? `Detected ${headers.length} candidate headers: ${headers.slice(0, 3).map(h => h.title).join(', ')}${headers.length > 3 ? '…' : ''}`
      : 'No strong headers detected; default sections will be used.';
  } catch (error) {
    console.error(error);
    status.textContent = 'Could not parse PDF headers in-browser. Default sections will be used.';
  } finally {
    importDraft.parsing = false;
  }
}

function openImportModal() {
  importDraft.file = null;
  importDraft.parsedSections = [];
  importDraft.parsing = false;

  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'import-modal-wrap';
  wrap.innerHTML = `<div class="panel modal"><div class="row" style="justify-content:space-between"><h2>Import Source</h2><button class="btn" id="close-import">✕</button></div>
    <div class="col">
      <label>Drag & drop file (or click to browse)
        <div id="import-dropzone" class="dropzone" tabindex="0">Drop PDF here for automatic header parsing<input id="import-file" type="file" accept=".pdf,video/*" hidden></div>
      </label>
      <p id="import-parse-status" class="small">Add a PDF to auto-detect section headers.</p>
      <label>Title <input id="import-title" placeholder="e.g. Neurobiology Notes.pdf"></label>
      <label>Type <select id="import-type"><option value="pdf">PDF</option><option value="youtube">YouTube</option><option value="local_video">Local Video</option></select></label>
      <label>Size Label <input id="import-size" placeholder="e.g. 240 pages or 90 min"></label>
      <label>Tags (comma-separated) <input id="import-tags" placeholder="biology, textbook"></label>
      <label>Origin / Path / URL <input id="import-origin" placeholder="/path/file.pdf or https://youtube.com/..." ></label>
      <div class="row"><button class="btn" id="confirm-import">Import</button><button class="btn" id="cancel-import">Cancel</button></div>
    </div></div>`;
  document.body.appendChild(wrap);

  const dropzone = document.getElementById('import-dropzone');
  const fileInput = document.getElementById('import-file');
  const onFile = async file => {
    if (!file) return;
    await processImportedFile(file);
  };

  dropzone.onclick = () => fileInput.click();
  dropzone.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  };
  fileInput.onchange = e => onFile(e.target.files?.[0]);
  ['dragenter', 'dragover'].forEach(type => {
    dropzone.addEventListener(type, e => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(type => {
    dropzone.addEventListener(type, e => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });
  dropzone.addEventListener('drop', e => onFile(e.dataTransfer?.files?.[0]));

  document.getElementById('close-import').onclick = closeImportModal;
  document.getElementById('cancel-import').onclick = closeImportModal;
  document.getElementById('confirm-import').onclick = importSourceFromForm;
}

function closeImportModal() {
  document.getElementById('import-modal-wrap')?.remove();
}

function openDeleteSourceModal(source) {
  if (!source) return;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'delete-source-modal-wrap';
  wrap.innerHTML = `<div class="panel modal"><div class="row" style="justify-content:space-between"><h2>Delete Source</h2><button class="btn" id="close-delete-source">✕</button></div>
    <p>You are going to <strong>delete</strong> source <strong>${source.title}</strong>.</p>
    <p class="small">Type <code>delete</code> to confirm.</p>
    <label>Confirmation <input id="delete-source-confirmation" placeholder="delete" autocomplete="off"></label>
    <div class="row"><button class="btn danger" id="confirm-delete-source" disabled>Delete Source</button><button class="btn" id="cancel-delete-source">Cancel</button></div>
  </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  const confirmation = document.getElementById('delete-source-confirmation');
  const confirmButton = document.getElementById('confirm-delete-source');

  confirmation.oninput = e => {
    confirmButton.disabled = e.target.value.trim() !== 'delete';
  };

  document.getElementById('close-delete-source').onclick = close;
  document.getElementById('cancel-delete-source').onclick = close;
  confirmButton.onclick = () => {
    deleteSource(source.id);
    close();
  };
}

function deleteSource(sourceId) {
  const sourceIndex = state.data.sources.findIndex(s => s.id === sourceId);
  if (sourceIndex === -1) return;

  const removedSource = state.data.sources[sourceIndex];
  const unitIds = new Set(state.data.units.filter(u => u.sourceId === sourceId).map(u => u.id));

  state.data.sources.splice(sourceIndex, 1);
  state.data.hierarchy = state.data.hierarchy.filter(item => item.sourceId !== sourceId);
  state.data.units = state.data.units.filter(unit => unit.sourceId !== sourceId);
  state.data.reviews = state.data.reviews.filter(review => !unitIds.has(review.unitId));
  state.data.revisions = state.data.revisions.filter(revision => {
    if (!revision.reviewId) return true;
    return state.data.reviews.some(review => review.id === revision.reviewId);
  });

  if (state.view.sources.selectedSourceId === sourceId) {
    state.view.sources.selectedSourceId = state.data.sources[0]?.id || null;
  }
  if (state.view.portal.sourceId === sourceId) {
    state.view.portal.sourceId = state.data.sources[0]?.id || null;
    state.view.portal.selectedHierarchyItemId = state.data.hierarchy.find(item => item.sourceId === state.view.portal.sourceId)?.id || null;
  }
  if (state.view.queue.selectedUnitId && unitIds.has(state.view.queue.selectedUnitId)) {
    state.view.queue.selectedUnitId = state.data.units[0]?.id || null;
  }

  if (!state.data.sources.length && state.view.page === 'portal') {
    state.view.page = 'sources';
  }

  console.info(`Deleted source: ${removedSource.title}`);
  render();
  save();
}

function renderSources() {
  const v = state.view.sources;
  const rows = state.data.sources
    .filter(s => (!v.searchText || s.title.toLowerCase().includes(v.searchText.toLowerCase()) || s.tags.join(',').toLowerCase().includes(v.searchText.toLowerCase())) && (v.sourceTypeFilter === 'all' || s.sourceType === v.sourceTypeFilter));

  pageRoot.innerHTML = `<section class="sources-grid"><div class="panel" style="padding:12px"><div class="toolbar"><input id="src-search" placeholder="Search title/tags" value="${v.searchText}"><select id="src-type"><option value="all">All types</option><option value="pdf">PDF</option><option value="youtube">YouTube</option><option value="local_video">Local Video</option></select><button class="btn" id="add-source">Add Source</button></div><table class="table"><thead><tr><th>Title</th><th>Type</th><th>Size</th><th>Tags</th><th>Units</th><th>Last Update</th></tr></thead><tbody>${rows.map(s => `<tr data-id="${s.id}" class="${s.id === v.selectedSourceId ? 'selected' : ''}"><td><a href="#" class="source-link" data-open="${s.id}">${s.title}</a></td><td>${s.sourceType}</td><td>${s.sizeLabel}</td><td>${s.tags.map(t => `<span class="chip">${t}</span>`).join(' ')}</td><td>${s.totalUnits || 0}</td><td>${s.lastUpdatedAt || '-'}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No sources yet. Click Add Source to import one.</td></tr>'}</tbody></table></div>
  <aside class="panel" style="padding:12px"><h3>Source Meta</h3>${(() => {
    const s = state.data.sources.find(x => x.id === v.selectedSourceId) || rows[0];
    if (!s) return '<p class="small">Select a source to view metadata and open its portal.</p>';
    return `<div class="col"><div><strong>${s.title}</strong></div><div class="small">Origin: ${s.origin}</div><div class="chips">${s.tags.map(t => `<span class="chip">${t}</span>`).join(' ') || '<span class="small">No tags</span>'}</div><div class="row"><button class="btn" id="open-portal">Open Source Portal</button><button class="btn danger" id="delete-source">Delete Source</button></div></div>`;
  })()}</aside></section>`;

  document.getElementById('src-type').value = v.sourceTypeFilter;
  document.getElementById('src-search').oninput = e => { v.searchText = e.target.value; renderSources(); save(); };
  document.getElementById('src-type').onchange = e => { v.sourceTypeFilter = e.target.value; renderSources(); save(); };
  document.getElementById('add-source').onclick = openImportModal;
  document.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { v.selectedSourceId = tr.dataset.id; renderSources(); save(); });
  document.querySelectorAll('[data-open]').forEach(a => a.onclick = e => {
    e.preventDefault();
    const id = a.dataset.open;
    v.selectedSourceId = id;
    state.view.portal.sourceId = id;
    state.view.page = 'portal';
    render();
    save();
  });
  const open = document.getElementById('open-portal');
  if (open) open.onclick = () => {
    const id = (state.data.sources.find(x => x.id === v.selectedSourceId) || rows[0])?.id;
    if (!id) return;
    state.view.portal.sourceId = id;
    state.view.page = 'portal';
    render();
    save();
  };
  const deleteButton = document.getElementById('delete-source');
  if (deleteButton) deleteButton.onclick = () => {
    const source = state.data.sources.find(x => x.id === v.selectedSourceId) || rows[0];
    openDeleteSourceModal(source);
  };
}

function renderPortal() {
  const v = state.view.portal;
  const source = state.data.sources.find(s => s.id === v.sourceId) || state.data.sources[0] || null;
  if (!source) {
    pageRoot.innerHTML = `<section class="panel" style="padding:16px"><h2>Source Portal</h2><p class="small">No source loaded. Import from Sources first.</p></section>`;
    return;
  }

  const outline = state.data.hierarchy.filter(h => h.sourceId === source.id);
  const filtered = outline.filter(h => !v.outlineSearchText || h.title.toLowerCase().includes(v.outlineSearchText.toLowerCase()));
  const selected = outline.find(h => h.id === v.selectedHierarchyItemId) || outline[0] || null;
  if (!v.selectedHierarchyItemId && selected) v.selectedHierarchyItemId = selected.id;

  pageRoot.innerHTML = `<div class="portal"><aside class="panel"><div style="padding:10px"><h3>${source.title}</h3><input id="outline-search" placeholder="Search outline" value="${v.outlineSearchText}"></div><div class="outline-list">${filtered.map(item => `<div class="outline-item ${item.id === selected?.id ? 'selected' : ''}" data-item="${item.id}"><div class="indent" style="--depth:${item.depth}">${item.isLeaf ? '📄' : '📁'} ${item.title}</div>${renderQueueBars(item)}</div>`).join('') || '<p class="small" style="padding:8px">No outline items.</p>'}</div></aside>
  <section class="panel viewer"><div class="row" style="justify-content:space-between"><h3>Viewer</h3><div class="controls"><button class="btn" id="zoom-out">-</button><span>${v.viewerZoom || 120}%</span><button class="btn" id="zoom-in">+</button></div></div><div class="small">${source.sourceType === 'pdf' ? `PDF Page ${selected?.pageStart || v.viewerPage}` : `Time ${selected?.timeStartSec || 0}s`}</div><div class="viewer-doc" style="font-size:${(v.viewerZoom || 120) / 100}em"><h2>${selected?.title || 'No item selected'}</h2><p>Simulated embedded source viewer region. In production this panel maps to actual PDF/video location and allows highlighting.</p></div></section>
  <aside class="panel" style="padding:12px"><h3>Unit Meta</h3><div class="small">Source Type: ${source.sourceType}</div><div class="small">Priority: ${source.priority}</div><div class="small">Units: ${source.totalUnits}</div><div class="small">Queue On/Off via bars in outline.</div></aside></div>`;

  document.getElementById('outline-search').oninput = e => { v.outlineSearchText = e.target.value; renderPortal(); save(); };
  document.querySelectorAll('[data-item]').forEach(el => el.onclick = () => {
    v.selectedHierarchyItemId = el.dataset.item;
    const item = outline.find(x => x.id === v.selectedHierarchyItemId);
    const unit = state.data.units.find(u => u.sourceId === source.id && u.hierarchyId === item.id);
    if (unit) state.view.queue.selectedUnitId = unit.id;
    renderPortal();
    save();
  });

  const onToggleQueue = e => {
    e.stopPropagation();
    const toggleId = e.currentTarget?.dataset.toggle;
    const i = state.data.hierarchy.find(x => x.id === toggleId);
    if (!i) return;

    const nextState = !i.inQueue;
    const related = state.data.hierarchy.filter(x => x.sourceId === i.sourceId);
    const affected = new Set([i.id, ...getDescendantIds(i.id, related)]);

    state.data.hierarchy.forEach(node => {
      if (affected.has(node.id)) node.inQueue = nextState;
    });
    state.data.units.forEach(unit => {
      if (affected.has(unit.hierarchyId)) unit.inQueue = nextState;
    });

    affected.forEach(id => {
      const target = document.querySelector(`[data-item="${id}"] .bars`);
      const node = state.data.hierarchy.find(x => x.id === id);
      if (!target || !node) return;
      target.outerHTML = renderQueueBars(node);
      const replacement = document.querySelector(`[data-item="${id}"] .bars`);
      if (replacement) replacement.onclick = onToggleQueue;
    });

    save();
  };

  document.querySelectorAll('[data-toggle]').forEach(el => el.onclick = onToggleQueue);
  document.getElementById('zoom-in').onclick = () => { v.viewerZoom = Math.min(200, (v.viewerZoom || 120) + 10); renderPortal(); save(); };
  document.getElementById('zoom-out').onclick = () => { v.viewerZoom = Math.max(50, (v.viewerZoom || 120) - 10); renderPortal(); save(); };
}

function renderQueueBars(item) {
  const filledBars = getFilledBarsCount(item.studyState);
  const queueClass = item.inQueue ? 'queue-on' : 'queue-off';
  const bars = [0, 1].map(index => `<span class="bar ${index < filledBars ? 'fill' : ''} ${queueClass}"></span>`).join('');
  return `<div class="bars ${queueClass}" title="toggle queue" data-toggle="${item.id}">${bars}</div>`;
}

function getFilledBarsCount(studyState) {
  if (studyState === 'started') return 1;
  if (studyState === 'mastered') return 2;
  return 0;
}

let timer;
function renderQueue() {
  const v = state.view.queue;
  const units = state.data.units.filter(u => u.inQueue);
  const u = units.find(x => x.id === v.selectedUnitId) || units[0] || null;
  if (!v.selectedUnitId && u) v.selectedUnitId = u.id;

  pageRoot.innerHTML = `<div class="queue"><aside class="panel queue-list"><h2>Study Queue</h2>${units.length ? units.map(x => `<div class="queue-item ${x.id === u?.id ? 'active' : ''}" data-unit="${x.id}"><strong>${x.title}</strong><div class="small">${x.sourceTitle} • ${x.sizeLabel}</div><div>${x.retentionScore}%</div></div>`).join('') : '<p class="small">No units in queue yet. Import a source and keep units enabled in queue from Source Portal.</p>'}</aside>
  <section class="col"><div class="panel" style="padding:12px"><h3>${u?.title || 'No unit selected'}</h3><div class="small">${u ? `${u.sourceTitle} • ${u.pageStart ? `pp.${u.pageStart}-${u.pageEnd}` : `${u.timeStartSec || 0}-${u.timeEndSec || 0}s`}` : 'Select a unit to begin.'}</div><div class="row"><button class="btn" id="open-history" ${u ? '' : 'disabled'}>Review History</button><div class="small">Retention<div>${u?.retentionScore || 0}%</div></div></div></div>
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
