const EMPTY_DATA = { sources: [], hierarchy: [], units: [], reviews: [], revisions: [] };

function defaultState() {
  return {
    data: structuredClone(EMPTY_DATA),
    view: {
      page: 'sources',
      sources: { searchText: '', sourceTypeFilter: 'all', selectedSourceId: null, scrollOffset: 0 },
      portal: { sourceId: null, selectedHierarchyItemId: null, outlineSearchText: '', viewerPage: 1, viewerZoom: 120, viewerPositionBySource: {} },
      queue: { selectedUnitId: null, preRecallNote: '', postRecallNote: '', timerRunning: false, timerStartedAt: null, elapsedSec: 0 }
    }
  };
}

function isLegacySeedData(data) {
  const legacyTitles = ['Biology Fundamentals.pdf', 'Data Structures.pdf', 'History of Roman Empire [HD]'];
  return Array.isArray(data?.sources) && data.sources.some(s => legacyTitles.includes(s.title));
}

function hydratePersistedState(persistedState) {
  const base = defaultState();
  if (!persistedState || typeof persistedState !== 'object') return base;

  const data = persistedState.data && typeof persistedState.data === 'object' ? persistedState.data : {};
  const view = persistedState.view && typeof persistedState.view === 'object' ? persistedState.view : {};

  const sources = Array.isArray(data.sources) ? data.sources.map(normalizePersistedSource) : [];
  const hierarchy = Array.isArray(data.hierarchy) ? data.hierarchy : [];
  const units = Array.isArray(data.units)
    ? data.units.map(unit => normalizePersistedUnit(unit, sources, hierarchy))
    : [];
  const unitsBySource = new Map();
  units.forEach(unit => {
    if (!unitsBySource.has(unit.sourceId)) unitsBySource.set(unit.sourceId, []);
    unitsBySource.get(unit.sourceId).push(unit);
  });
  const hydratedSources = sources.map(source => ({
    ...source,
    ...inferSourceMetadata(source, unitsBySource.get(source.id) || [])
  }));

  return {
    data: {
      sources: hydratedSources,
      hierarchy,
      units,
      reviews: Array.isArray(data.reviews) ? data.reviews : [],
      revisions: Array.isArray(data.revisions) ? data.revisions : []
    },
    view: {
      page: typeof view.page === 'string' ? view.page : base.view.page,
      sources: { ...base.view.sources, ...(view.sources || {}) },
      portal: { ...base.view.portal, ...(view.portal || {}) },
      queue: { ...base.view.queue, ...(view.queue || {}) }
    }
  };
}

function normalizePersistedSource(source) {
  if (!source || typeof source !== 'object') return source;
  const normalized = normalizeSourceOrigin(source.sourceType, source.origin || source.originRef || '(unknown)');
  const hasAsset = typeof source.assetId === 'string' && source.assetId.trim();
  return {
    ...source,
    origin: hasAsset ? '(stored in app)' : (normalized.ok ? normalized.origin : (source.origin || source.originRef || '(unknown)')),
    originRef: hasAsset ? '(stored in app)' : (normalized.ok ? normalized.originRef : (source.originRef || source.origin || '(unknown)')),
    assetId: hasAsset ? source.assetId.trim() : null,
    totalPages: Number.isFinite(source.totalPages) ? source.totalPages : null,
    durationSec: Number.isFinite(source.durationSec) ? source.durationSec : null
  };
}

function normalizePersistedUnit(unit, sources, hierarchy) {
  if (!unit || typeof unit !== 'object') return unit;

  const source = sources.find(item => item.id === unit.sourceId);
  const hierarchyItem = hierarchy.find(item => item.id === unit.hierarchyId);
  const inferredSourceType = unit.sourceType || source?.sourceType || 'doc';
  const normalized = { ...unit, sourceType: inferredSourceType };

  if (inferredSourceType === 'pdf') {
    const start = Number.isFinite(unit.pageStart) ? unit.pageStart : hierarchyItem?.pageStart;
    const end = Number.isFinite(unit.pageEnd) ? unit.pageEnd : hierarchyItem?.pageEnd;
    normalized.pageStart = Number.isFinite(start) ? start : null;
    normalized.pageEnd = Number.isFinite(end) ? Math.max(end, normalized.pageStart || end) : normalized.pageStart;
  } else if (inferredSourceType === 'youtube' || inferredSourceType === 'local_video' || inferredSourceType === 'video') {
    normalized.timeStartSec = Number.isFinite(unit.timeStartSec) ? unit.timeStartSec : null;
    normalized.timeEndSec = Number.isFinite(unit.timeEndSec) ? Math.max(unit.timeEndSec, normalized.timeStartSec || unit.timeEndSec) : normalized.timeStartSec;
  } else {
    normalized.locatorType = typeof unit.locatorType === 'string' && unit.locatorType.trim() ? unit.locatorType : 'section';
    normalized.locatorStart = unit.locatorStart ?? unit.pageStart ?? null;
    normalized.locatorEnd = unit.locatorEnd ?? unit.pageEnd ?? normalized.locatorStart;
  }

  if (!normalized.sizeLabel || /^\s*$/.test(normalized.sizeLabel)) {
    normalized.sizeLabel = buildUnitSizeLabel(normalized);
  }

  return normalized;
}

function buildUnitSizeLabel(unit) {
  if (Number.isFinite(unit.pageStart) && Number.isFinite(unit.pageEnd)) {
    const pages = Math.max(1, unit.pageEnd - unit.pageStart + 1);
    return `${pages} page${pages === 1 ? '' : 's'}`;
  }
  if (Number.isFinite(unit.timeStartSec) && Number.isFinite(unit.timeEndSec)) {
    const seconds = Math.max(1, unit.timeEndSec - unit.timeStartSec);
    if (seconds >= 60) {
      const mins = (seconds / 60).toFixed(1).replace(/\.0$/, '');
      return `${mins} min`;
    }
    return `${seconds}s`;
  }
  if (unit.locatorStart != null && unit.locatorEnd != null) {
    const type = unit.locatorType || 'section';
    return unit.locatorStart === unit.locatorEnd
      ? `${type} ${unit.locatorStart}`
      : `${type} ${unit.locatorStart}-${unit.locatorEnd}`;
  }
  return 'Span unknown';
}

function inferSourceMetadata(source, units = []) {
  const metadata = {
    origin: source.origin || source.originRef || '(unknown)',
    originRef: source.originRef || source.origin || '(unknown)',
    totalPages: null,
    durationSec: null
  };

  if (source.sourceType === 'pdf') {
    const maxPage = Math.max(...units.map(u => Number.isFinite(u.pageEnd) ? u.pageEnd : (Number.isFinite(u.pageStart) ? u.pageStart : 0)), 0);
    const parsedTotalPages = Number.isFinite(source.totalPages) ? source.totalPages : 0;
    metadata.totalPages = Math.max(maxPage, parsedTotalPages) || null;
  } else if (['youtube', 'local_video', 'video'].includes(source.sourceType)) {
    const maxTime = Math.max(...units.map(u => Number.isFinite(u.timeEndSec) ? u.timeEndSec : (Number.isFinite(u.timeStartSec) ? u.timeStartSec : 0)), 0);
    metadata.durationSec = maxTime > 0 ? maxTime : null;
  }

  return metadata;
}




const viewerPdfCache = new Map();
const viewerPdfPageCountCache = new Map();
const viewerPdfBytesCache = new Map();
const viewerPdfPageCache = new Map();
const viewerPdfRenderCache = new Map();
const viewerAssetUrlCache = new Map();

const PDF_BYTES_BUDGET = 150 * 1024 * 1024;
const PDF_RENDER_BUDGET = 64 * 1024 * 1024;
const PDF_RENDER_MAX_ENTRIES = 12;
const PDF_ACTIVE_DOC_LIMIT = 2;
const PDF_PAGE_WINDOW_RADIUS = 2;

const ASSET_DB_NAME = 'srs-app-assets';
const ASSET_DB_VERSION = 1;
const ASSET_STORE_NAME = 'assets';
let assetDbPromise = null;

function openAssetDb() {
  if (assetDbPromise) return assetDbPromise;
  assetDbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is unavailable in this browser.'));
      return;
    }
    const request = window.indexedDB.open(ASSET_DB_NAME, ASSET_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB.'));
  });
  return assetDbPromise;
}

async function putAssetBlob(file) {
  const db = await openAssetDb();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
    const store = tx.objectStore(ASSET_STORE_NAME);
    const request = store.put({ id, blob: file, name: file.name || 'uploaded-file', type: file.type || '', createdAt: Date.now() });
    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error || new Error('Failed to store asset blob.'));
  });
}

async function getAssetBlob(assetId) {
  if (!assetId) return null;
  const db = await openAssetDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, 'readonly');
    const store = tx.objectStore(ASSET_STORE_NAME);
    const request = store.get(assetId);
    request.onsuccess = () => resolve(request.result?.blob || null);
    request.onerror = () => reject(request.error || new Error('Failed to load asset blob.'));
  });
}

async function deleteAssetBlob(assetId) {
  if (!assetId) return;
  const db = await openAssetDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(ASSET_STORE_NAME, 'readwrite');
    const store = tx.objectStore(ASSET_STORE_NAME);
    const request = store.delete(assetId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Failed to delete asset blob.'));
  });
  const cachedUrl = viewerAssetUrlCache.get(assetId);
  if (cachedUrl) {
    URL.revokeObjectURL(cachedUrl);
    viewerAssetUrlCache.delete(assetId);
  }

  const pdfCacheKey = `asset:${assetId}`;
  const cachedPdf = viewerPdfCache.get(pdfCacheKey);
  if (cachedPdf?.destroy) {
    try { cachedPdf.destroy(); } catch {}
  }
  viewerPdfCache.delete(pdfCacheKey);
  viewerPdfPageCountCache.delete(pdfCacheKey);
  viewerPdfBytesCache.delete(pdfCacheKey);
  for (const pageKey of [...viewerPdfPageCache.keys()]) {
    if (pageKey.startsWith(`${pdfCacheKey}:`)) viewerPdfPageCache.delete(pageKey);
  }
  for (const renderKey of [...viewerPdfRenderCache.keys()]) {
    if (renderKey.startsWith(`${pdfCacheKey}:`)) viewerPdfRenderCache.delete(renderKey);
  }
}

async function getAssetObjectUrl(assetId) {
  if (!assetId) return null;
  if (viewerAssetUrlCache.has(assetId)) return viewerAssetUrlCache.get(assetId);
  const blob = await getAssetBlob(assetId);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  viewerAssetUrlCache.set(assetId, url);
  return url;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getPdfSourceCacheKey(source) {
  return source?.assetId ? `asset:${source.assetId}` : `origin:${source?.origin || ''}`;
}

function evictPdfBytesCacheIfNeeded() {
  let total = [...viewerPdfBytesCache.values()].reduce((sum, entry) => sum + (entry.sizeBytes || 0), 0);
  if (total <= PDF_BYTES_BUDGET) return;
  const entries = [...viewerPdfBytesCache.entries()].sort((a, b) => (a[1].lastUsedAt || 0) - (b[1].lastUsedAt || 0));
  for (const [key, entry] of entries) {
    viewerPdfBytesCache.delete(key);
    total -= entry.sizeBytes || 0;
    if (total <= PDF_BYTES_BUDGET) break;
  }
}

function evictPdfDocumentsIfNeeded(activeKey) {
  const entries = [...viewerPdfCache.entries()];
  if (entries.length <= PDF_ACTIVE_DOC_LIMIT) return;
  const candidates = entries
    .filter(([key]) => key !== activeKey)
    .sort((a, b) => ((a[1]?.__lastUsedAt || 0) - (b[1]?.__lastUsedAt || 0)));

  for (const [key, doc] of candidates) {
    if (viewerPdfCache.size <= PDF_ACTIVE_DOC_LIMIT) break;
    viewerPdfCache.delete(key);
    if (doc?.destroy) {
      try { doc.destroy(); } catch {}
    }
    for (const pageKey of [...viewerPdfPageCache.keys()]) {
      if (pageKey.startsWith(`${key}:`)) viewerPdfPageCache.delete(pageKey);
    }
    for (const renderKey of [...viewerPdfRenderCache.keys()]) {
      if (renderKey.startsWith(`${key}:`)) viewerPdfRenderCache.delete(renderKey);
    }
  }
}

function evictPdfRenderCacheIfNeeded() {
  let total = [...viewerPdfRenderCache.values()].reduce((sum, entry) => sum + (entry.bytesEstimate || 0), 0);
  if (total <= PDF_RENDER_BUDGET && viewerPdfRenderCache.size <= PDF_RENDER_MAX_ENTRIES) return;
  const entries = [...viewerPdfRenderCache.entries()].sort((a, b) => (a[1].lastUsedAt || 0) - (b[1].lastUsedAt || 0));
  for (const [key, entry] of entries) {
    viewerPdfRenderCache.delete(key);
    total -= entry.bytesEstimate || 0;
    if (total <= PDF_RENDER_BUDGET && viewerPdfRenderCache.size <= PDF_RENDER_MAX_ENTRIES) break;
  }
}

function trimPdfPageCache(sourceKey, currentPage) {
  for (const pageKey of [...viewerPdfPageCache.keys()]) {
    if (!pageKey.startsWith(`${sourceKey}:`)) continue;
    const page = Number(pageKey.split(':').pop());
    if (!Number.isFinite(page)) continue;
    if (Math.abs(page - currentPage) > PDF_PAGE_WINDOW_RADIUS) {
      viewerPdfPageCache.delete(pageKey);
    }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function deriveYouTubeEmbedUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '');
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') {
        const id = parsed.searchParams.get('v');
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      if (parsed.pathname.startsWith('/embed/')) return parsed.toString();
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.split('/').filter(Boolean)[1];
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function getParserAdapterKey(sourceType) {
  if (['youtube', 'local_video', 'video'].includes(sourceType)) return 'video';
  return sourceType;
}

function normalizeSourceOrigin(sourceType, rawOrigin) {
  const origin = (rawOrigin || '').trim();
  if (!origin) return { ok: true, origin: '(user imported)', originRef: '(user imported)' };

  const localTypes = new Set(['pdf', 'local_video']);
  const remoteTypes = new Set(['youtube']);
  const adapterKey = getParserAdapterKey(sourceType);

  let parsedUrl = null;
  try {
    parsedUrl = new URL(origin);
  } catch {
    parsedUrl = null;
  }

  const isHttp = parsedUrl && ['http:', 'https:'].includes(parsedUrl.protocol);
  const isFileUrl = parsedUrl && parsedUrl.protocol === 'file:';
  const isBlobUrl = parsedUrl && parsedUrl.protocol === 'blob:';
  const looksLikeLocalPath = /^(\/|~\/|\.\.?\/|[A-Za-z]:[\\/]|\\\\)/.test(origin) || (!parsedUrl && /[\\/]/.test(origin));

  if (localTypes.has(sourceType)) {
    if (!origin) {
      return { ok: true, origin: '(stored in app)', originRef: '(stored in app)' };
    }
    if (!isFileUrl && !isBlobUrl && !looksLikeLocalPath) {
      return { ok: true, origin: '(stored in app)', originRef: '(stored in app)' };
    }
    const normalized = (isFileUrl || isBlobUrl) ? parsedUrl.toString() : origin.replaceAll('\\', '/');
    return { ok: true, origin: normalized, originRef: normalized };
  }

  if (remoteTypes.has(sourceType) || adapterKey === 'video') {
    if (!isHttp) {
      return { ok: false, error: 'This source type requires an HTTP(S) link.' };
    }
    return { ok: true, origin: parsedUrl.toString(), originRef: parsedUrl.toString() };
  }

  return { ok: true, origin, originRef: origin };
}

function parseTimestampToSeconds(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const parts = value.split(':').map(token => Number(token.trim()));
  if (parts.some(num => !Number.isFinite(num) || num < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function parseVideoChapterMarkers(rawText) {
  return String(rawText || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const match = line.match(/^(\d{1,2}:\d{2}(?::\d{2})?|\d+)\s+(.+)$/);
      if (!match) return null;
      const seconds = parseTimestampToSeconds(match[1]);
      if (!Number.isFinite(seconds)) return null;
      return { timeStartSec: seconds, title: match[2].trim() };
    })
    .filter(Boolean)
    .sort((a, b) => a.timeStartSec - b.timeStartSec);
}

function generateAutoVideoSections(durationSec) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [];
  const segmentCount = clamp(Math.round(durationSec / 600), 3, 12);
  const segmentSize = Math.max(60, Math.ceil(durationSec / segmentCount));
  const sections = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const start = index * segmentSize;
    if (start >= durationSec) break;
    const end = Math.min(durationSec, (index + 1) * segmentSize);
    sections.push({
      title: `Auto-generated segment ${index + 1}`,
      timeStartSec: start,
      timeEndSec: end,
      level: 0,
      autoGenerated: true
    });
  }
  return sections;
}

function buildVideoSectionsFromMetadata(chaptersText, durationSec) {
  const chapters = parseVideoChapterMarkers(chaptersText);
  if (chapters.length) {
    return chapters.map((entry, idx) => ({
      title: entry.title || `Chapter ${idx + 1}`,
      timeStartSec: entry.timeStartSec,
      timeEndSec: Number.isFinite(chapters[idx + 1]?.timeStartSec)
        ? chapters[idx + 1].timeStartSec
        : (Number.isFinite(durationSec) ? durationSec : entry.timeStartSec),
      level: 0,
      autoGenerated: false
    }));
  }
  return generateAutoVideoSections(durationSec);
}

async function parseSourceViaAdapter(sourceType, context) {
  const adapterKey = getParserAdapterKey(sourceType);
  const adapters = {
    pdf: async () => ({
      sections: context.draft.parsedSections,
      pdfTotalPages: context.draft.parsedPdfTotalPages,
      durationSec: null
    }),
    video: async () => {
      const durationFromInput = parseTimestampToSeconds(context.videoDurationRaw);
      const durationSec = Number.isFinite(durationFromInput)
        ? durationFromInput
        : context.draft.detectedVideoDurationSec;
      return {
        sections: buildVideoSectionsFromMetadata(context.videoChaptersRaw, durationSec),
        pdfTotalPages: null,
        durationSec: Number.isFinite(durationSec) ? durationSec : null
      };
    }
  };
  const adapter = adapters[adapterKey];
  if (!adapter) return { sections: [], pdfTotalPages: null, durationSec: null };
  return adapter();
}


function getLocatorForHierarchyItem(source, hierarchyItem) {
  if (!source || !hierarchyItem) return null;

  if (source.sourceType === 'pdf') {
    if (!Number.isFinite(hierarchyItem.pageStart)) return null;
    return {
      kind: 'page',
      page: Math.max(1, Math.floor(hierarchyItem.pageStart)),
      pageEnd: Number.isFinite(hierarchyItem.pageEnd) ? Math.max(Math.floor(hierarchyItem.pageEnd), Math.floor(hierarchyItem.pageStart)) : Math.floor(hierarchyItem.pageStart)
    };
  }

  if (source.sourceType === 'youtube' || source.sourceType === 'local_video') {
    if (!Number.isFinite(hierarchyItem.timeStartSec)) return null;
    return {
      kind: 'time',
      seconds: Math.max(0, Math.floor(hierarchyItem.timeStartSec)),
      timeEndSec: Number.isFinite(hierarchyItem.timeEndSec) ? Math.max(Math.floor(hierarchyItem.timeEndSec), Math.floor(hierarchyItem.timeStartSec)) : Math.floor(hierarchyItem.timeStartSec)
    };
  }

  if (hierarchyItem.locatorStart == null) return null;
  return {
    kind: 'locator',
    locatorType: hierarchyItem.locatorType || 'section',
    start: hierarchyItem.locatorStart,
    end: hierarchyItem.locatorEnd ?? hierarchyItem.locatorStart
  };
}

function getLocatorForUnit(unit) {
  if (!unit) return null;

  if (unit.sourceType === 'pdf') {
    if (!Number.isFinite(unit.pageStart)) return null;
    return {
      kind: 'page',
      page: Math.max(1, Math.floor(unit.pageStart)),
      pageEnd: Number.isFinite(unit.pageEnd) ? Math.max(Math.floor(unit.pageEnd), Math.floor(unit.pageStart)) : Math.floor(unit.pageStart)
    };
  }

  if (unit.sourceType === 'youtube' || unit.sourceType === 'local_video' || unit.sourceType === 'video') {
    if (!Number.isFinite(unit.timeStartSec)) return null;
    return {
      kind: 'time',
      seconds: Math.max(0, Math.floor(unit.timeStartSec)),
      timeEndSec: Number.isFinite(unit.timeEndSec) ? Math.max(Math.floor(unit.timeEndSec), Math.floor(unit.timeStartSec)) : Math.floor(unit.timeStartSec)
    };
  }

  if (unit.locatorStart == null) return null;
  return {
    kind: 'locator',
    locatorType: unit.locatorType || 'section',
    start: unit.locatorStart,
    end: unit.locatorEnd ?? unit.locatorStart
  };
}

function createViewerController(source, containerEl) {
  if (!source || !containerEl) {
    return {
      goToPage: () => {},
      seekTo: () => {},
      getPosition: () => null,
      hasLocator: () => false
    };
  }

  if (source.sourceType === 'pdf') {
    return {
      goToPage(page) {
        if (!Number.isFinite(page)) return;
        state.view.portal.viewerPage = Math.max(1, Math.floor(page));
      },
      seekTo: () => {},
      getPosition() {
        return { kind: 'page', page: state.view.portal.viewerPage || 1 };
      },
      hasLocator(locator) {
        return Boolean(locator && locator.kind === 'page' && Number.isFinite(locator.page));
      }
    };
  }

  if (source.sourceType === 'youtube') {
    return {
      goToPage: () => {},
      seekTo(seconds) {
        if (!Number.isFinite(seconds)) return;
        const iframe = containerEl.querySelector('iframe.video-frame');
        if (!iframe) return;
        const base = deriveYouTubeEmbedUrl(source.origin || '');
        if (!base) return;
        const sec = Math.max(0, Math.floor(seconds));
        iframe.src = `${base}${base.includes('?') ? '&' : '?'}start=${sec}`;
      },
      getPosition() {
        return null;
      },
      hasLocator(locator) {
        return Boolean(locator && locator.kind === 'time' && Number.isFinite(locator.seconds));
      }
    };
  }

  if (source.sourceType === 'local_video') {
    return {
      goToPage: () => {},
      seekTo(seconds) {
        if (!Number.isFinite(seconds)) return;
        const videoEl = containerEl.querySelector('video.video-player');
        if (!videoEl) return;
        const sec = Math.max(0, Math.floor(seconds));
        if (videoEl.readyState >= 1) {
          try { videoEl.currentTime = sec; } catch {}
        } else {
          videoEl.addEventListener('loadedmetadata', () => {
            try { videoEl.currentTime = sec; } catch {}
          }, { once: true });
        }
      },
      getPosition() {
        const videoEl = containerEl.querySelector('video.video-player');
        if (!videoEl || !Number.isFinite(videoEl.currentTime)) return null;
        return { kind: 'time', seconds: Math.floor(videoEl.currentTime) };
      },
      hasLocator(locator) {
        return Boolean(locator && locator.kind === 'time' && Number.isFinite(locator.seconds));
      }
    };
  }

  return {
    goToPage: () => {},
    seekTo: () => {},
    getPosition: () => null,
    hasLocator(locator) {
      return Boolean(locator);
    }
  };
}

function syncSelectionAcrossPortalAndQueue(source, hierarchyItem, unit) {
  state.view.portal.selectedHierarchyItemId = hierarchyItem?.id || null;
  state.view.queue.selectedUnitId = unit?.id || null;
  if (source?.id && hierarchyItem) {
    state.view.portal.sourceId = source.id;
  }
}

function rememberViewerPosition(sourceId, position) {
  if (!sourceId || !position) return;
  const current = state.view.portal.viewerPositionBySource && typeof state.view.portal.viewerPositionBySource === 'object'
    ? state.view.portal.viewerPositionBySource
    : {};
  state.view.portal.viewerPositionBySource = { ...current, [sourceId]: position };
}

function getSavedViewerPosition(sourceId) {
  const map = state.view.portal.viewerPositionBySource;
  if (!sourceId || !map || typeof map !== 'object') return null;
  return map[sourceId] || null;
}
function renderUnsupportedViewer(source, containerEl, reason) {
  containerEl.innerHTML = `<div class="viewer-fallback"><h4>Viewer unavailable</h4><p>${escapeHtml(reason || `No renderer available for source type "${source?.sourceType || 'unknown'}".`)}</p></div>`;
}

async function getPdfBytesForSource(source) {
  const sourceKey = getPdfSourceCacheKey(source);
  const cached = viewerPdfBytesCache.get(sourceKey);
  if (cached?.bytes) {
    cached.lastUsedAt = Date.now();
    return cached.bytes;
  }

  let bytes;
  if (source?.assetId) {
    const blob = await getAssetBlob(source.assetId);
    if (!blob) throw new Error('Stored PDF file is missing. Re-upload this source from Sources page.');
    bytes = new Uint8Array(await blob.arrayBuffer());
  } else if (source?.origin) {
    try {
      const response = await fetch(source.origin);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      return null;
    }
  } else {
    throw new Error('PDF source file is missing.');
  }

  viewerPdfBytesCache.set(sourceKey, { bytes, sizeBytes: bytes.byteLength, lastUsedAt: Date.now() });
  evictPdfBytesCacheIfNeeded();
  return bytes;
}

async function loadPdfDocument(source) {
  if (!window.pdfjsLib) throw new Error('pdf.js is not loaded in this session.');
  const cacheKey = getPdfSourceCacheKey(source);
  if (viewerPdfCache.has(cacheKey)) {
    const cached = viewerPdfCache.get(cacheKey);
    cached.__lastUsedAt = Date.now();
    return cached;
  }

  const bytes = await getPdfBytesForSource(source);
  let task;
  if (bytes) {
    task = window.pdfjsLib.getDocument({ data: bytes });
  } else if (source?.origin) {
    task = window.pdfjsLib.getDocument(source.origin);
  } else {
    throw new Error('PDF source file is missing.');
  }

  const pdf = await task.promise;
  pdf.__lastUsedAt = Date.now();
  viewerPdfCache.set(cacheKey, pdf);
  evictPdfDocumentsIfNeeded(cacheKey);
  return pdf;
}

async function loadPdfPage(pdf, sourceKey, pageNumber) {
  const pageKey = `${sourceKey}:${pageNumber}`;
  if (viewerPdfPageCache.has(pageKey)) return viewerPdfPageCache.get(pageKey);
  const page = await pdf.getPage(pageNumber);
  viewerPdfPageCache.set(pageKey, page);
  trimPdfPageCache(sourceKey, pageNumber);
  return page;
}

async function renderPdfPageToCanvas({ pdf, sourceKey, pageNumber, scale, targetCanvas }) {
  const renderScale = Number(scale.toFixed(2));
  const renderKey = `${sourceKey}:${pageNumber}:${renderScale}`;
  const cached = viewerPdfRenderCache.get(renderKey);

  const ctx = targetCanvas.getContext('2d', { alpha: false });
  if (cached?.canvas) {
    cached.lastUsedAt = Date.now();
    targetCanvas.width = cached.width;
    targetCanvas.height = cached.height;
    targetCanvas.style.width = `${cached.width}px`;
    targetCanvas.style.height = `${cached.height}px`;
    ctx.drawImage(cached.canvas, 0, 0);
    return { width: cached.width, height: cached.height, fromCache: true };
  }

  const page = await loadPdfPage(pdf, sourceKey, pageNumber);
  const viewport = page.getViewport({ scale: renderScale });
  const width = Math.ceil(viewport.width);
  const height = Math.ceil(viewport.height);

  targetCanvas.width = width;
  targetCanvas.height = height;
  targetCanvas.style.width = `${width}px`;
  targetCanvas.style.height = `${height}px`;

  await page.render({ canvasContext: ctx, viewport }).promise;

  const cacheCanvas = document.createElement('canvas');
  cacheCanvas.width = width;
  cacheCanvas.height = height;
  const cacheCtx = cacheCanvas.getContext('2d', { alpha: false });
  cacheCtx.drawImage(targetCanvas, 0, 0);

  viewerPdfRenderCache.set(renderKey, {
    canvas: cacheCanvas,
    width,
    height,
    bytesEstimate: width * height * 4,
    lastUsedAt: Date.now()
  });
  evictPdfRenderCacheIfNeeded();
  return { width, height, fromCache: false };
}

async function renderPdfViewer(source, selectedUnitOrOutlineItem, containerEl, options = {}) {
  const renderToken = `${Date.now()}-${Math.random()}`;
  containerEl.dataset.renderToken = renderToken;

  try {
    const pdfCacheKey = getPdfSourceCacheKey(source);
    let pageWrap = containerEl.querySelector('.pdf-page-wrap');
    let canvas = containerEl.querySelector('canvas.pdf-canvas');
    let locationEl = containerEl.querySelector('.viewer-location');

    if (!pageWrap || !canvas || !locationEl || containerEl.dataset.pdfSourceCacheKey !== pdfCacheKey) {
      containerEl.innerHTML = '<div class="small">Loading PDF preview…</div>';
    }

    let totalPages = viewerPdfPageCountCache.get(pdfCacheKey);
    const pdf = await loadPdfDocument(source);
    if (!Number.isFinite(totalPages)) {
      totalPages = pdf.numPages;
      viewerPdfPageCountCache.set(pdfCacheKey, totalPages);
    }

    const requestedPage = Number.isFinite(selectedUnitOrOutlineItem?.pageStart)
      ? selectedUnitOrOutlineItem.pageStart
      : Number.isFinite(options.defaultPage)
        ? options.defaultPage
        : 1;

    const pageNumber = clamp(Math.floor(requestedPage), 1, totalPages);
    const scale = clamp((options.zoomPercent || 120) / 100, 0.5, 2.4);

    if (containerEl.dataset.renderToken !== renderToken) return;

    if (!pageWrap || !canvas || !locationEl || containerEl.dataset.pdfSourceCacheKey !== pdfCacheKey) {
      containerEl.dataset.pdfSourceCacheKey = pdfCacheKey;
      containerEl.innerHTML = `<div class="viewer-location">PDF page ${pageNumber} of ${totalPages}</div><div class="pdf-page-wrap"><canvas class="pdf-canvas"></canvas></div>`;
      locationEl = containerEl.querySelector('.viewer-location');
      pageWrap = containerEl.querySelector('.pdf-page-wrap');
      canvas = containerEl.querySelector('canvas.pdf-canvas');
    } else {
      locationEl.textContent = `PDF page ${pageNumber} of ${totalPages}`;
    }

    await renderPdfPageToCanvas({
      pdf,
      sourceKey: pdfCacheKey,
      pageNumber,
      scale,
      targetCanvas: canvas
    });

    pageWrap.style.width = `${canvas.width}px`;
  } catch (error) {
    renderUnsupportedViewer(source, containerEl, `Unable to render PDF preview: ${error.message}`);
  }
}

async function renderVideoViewer(source, selectedUnitOrOutlineItem, containerEl) {
  const startSec = Math.max(0, Math.floor(selectedUnitOrOutlineItem?.timeStartSec || 0));
  if (source?.sourceType === 'youtube') {
    const baseEmbed = deriveYouTubeEmbedUrl(source.origin || '');
    if (!baseEmbed) {
      renderUnsupportedViewer(source, containerEl, 'Invalid YouTube URL. Add a full youtube.com or youtu.be link in source origin.');
      return;
    }
    const withStart = startSec ? `${baseEmbed}${baseEmbed.includes('?') ? '&' : '?'}start=${startSec}` : baseEmbed;
    containerEl.innerHTML = `<div class="viewer-location">Video at ${startSec}s</div><iframe class="video-frame" src="${withStart}" title="YouTube viewer" allowfullscreen loading="lazy"></iframe>`;
    return;
  }

  if (source?.sourceType === 'local_video') {
    const localVideoUrl = source.assetId ? await getAssetObjectUrl(source.assetId) : source.origin;
    if (!localVideoUrl) {
      renderUnsupportedViewer(source, containerEl, 'Stored video file is missing. Re-upload this source from Sources page.');
      return;
    }
    containerEl.innerHTML = `<div class="viewer-location">Video at ${startSec}s</div><video class="video-player" controls src="${localVideoUrl}"></video>`;
    const videoEl = containerEl.querySelector('video');
    videoEl.addEventListener('loadedmetadata', () => {
      try { videoEl.currentTime = startSec; } catch {}
    }, { once: true });
    return;
  }

  renderUnsupportedViewer(source, containerEl);
}

function renderSourceViewer(source, selectedUnitOrOutlineItem, containerEl, options = {}) {
  if (!containerEl) return;
  if (!source) {
    renderUnsupportedViewer(source, containerEl, 'No source selected for this viewer.');
    return;
  }
  if (source.sourceType === 'pdf') {
    renderPdfViewer(source, selectedUnitOrOutlineItem, containerEl, options);
    return;
  }
  if (source.sourceType === 'youtube' || source.sourceType === 'local_video') {
    void renderVideoViewer(source, selectedUnitOrOutlineItem, containerEl, options);
    return;
  }
  renderUnsupportedViewer(source, containerEl);
}

function ensureQueueConsistency() {
  const hierarchyById = new Map(state.data.hierarchy.map(item => [item.id, item]));

  state.data.hierarchy.forEach(item => {
    if (typeof item.inQueue !== 'boolean') item.inQueue = true;
  });

  state.data.units.forEach(unit => {
    const hierarchyItem = hierarchyById.get(unit.hierarchyId);
    if (typeof unit.inQueue !== 'boolean') {
      unit.inQueue = typeof hierarchyItem?.inQueue === 'boolean' ? hierarchyItem.inQueue : true;
    }
    if (hierarchyItem && hierarchyItem.inQueue !== unit.inQueue) {
      hierarchyItem.inQueue = unit.inQueue;
    }
  });
}

const persisted = JSON.parse(localStorage.getItem('srs-app-state') || 'null');
const state = persisted && !isLegacySeedData(persisted.data) ? hydratePersistedState(persisted) : defaultState();
ensureQueueConsistency();
normalizeQueueSelection();
const importDraft = {
  file: null,
  objectUrl: null,
  parsedSections: [],
  parsedPdfTotalPages: null,
  detectedVideoDurationSec: null,
  parsing: false
};

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

async function importSourceFromForm() {
  const title = document.getElementById('import-title').value.trim();
  const sourceType = document.getElementById('import-type').value;
  const size = document.getElementById('import-size').value.trim();
  const tags = document.getElementById('import-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const origin = document.getElementById('import-origin').value.trim();
  const videoChaptersRaw = document.getElementById('import-video-chapters')?.value || '';
  const videoDurationRaw = document.getElementById('import-video-duration')?.value || '';
  if (!title || !size) return alert('Title and size are required.');

  const requiresUploadedAsset = sourceType === 'pdf' || sourceType === 'local_video';
  if (requiresUploadedAsset && !importDraft.file) {
    return alert('Please upload the source file in the dropzone first. This source type is stored inside the app.');
  }

  const normalizedOrigin = normalizeSourceOrigin(sourceType, origin);
  if (!normalizedOrigin.ok) return alert(normalizedOrigin.error);

  const parsedByAdapter = await parseSourceViaAdapter(sourceType, {
    draft: importDraft,
    videoChaptersRaw,
    videoDurationRaw
  });

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
    origin: requiresUploadedAsset ? '(stored in app)' : normalizedOrigin.origin,
    originRef: requiresUploadedAsset ? '(stored in app)' : normalizedOrigin.originRef,
    assetId: null,
    totalPages: null,
    durationSec: Number.isFinite(parsedByAdapter.durationSec) ? parsedByAdapter.durationSec : null
  };

  if (requiresUploadedAsset) {
    try {
      source.assetId = await putAssetBlob(importDraft.file);
    } catch (error) {
      alert(`Could not store uploaded file in app storage: ${error.message}`);
      return;
    }
  }

  state.data.sources.push(source);
  if (source.sourceType === 'pdf' && Number.isFinite(parsedByAdapter.pdfTotalPages)) {
    source.totalPages = parsedByAdapter.pdfTotalPages;
  }
  autoParseSource(source, parsedByAdapter.sections, parsedByAdapter.pdfTotalPages);
  state.view.sources.selectedSourceId = sourceId;
  state.view.portal.sourceId = sourceId;
  state.view.page = 'sources';
  closeImportModal();
  render();
  save();
}

function autoParseSource(source, parsedSections = [], pdfTotalPages = null) {
  const sections = parsedSections.length
    ? parsedSections
    : [
      { title: 'Chapter 1 Introduction', pageStart: 1, level: 0 },
      { title: 'Section 1.1 Core Concepts', pageStart: 3, level: 1 },
      { title: 'Subsection 1.1.1 Examples', pageStart: 6, level: 2 },
      { title: 'Section 1.2 Practice', pageStart: 9, level: 1 },
      { title: 'Chapter 2 Summary', pageStart: 13, level: 0 }
    ];

  const normalized = sections.map((section, index) => ({
    title: section.title,
    pageStart: Number.isFinite(section.pageStart) ? Math.max(1, Math.floor(section.pageStart)) : null,
    pageEnd: Number.isFinite(section.pageEnd) ? Math.max(1, Math.floor(section.pageEnd)) : null,
    timeStartSec: Number.isFinite(section.timeStartSec) ? section.timeStartSec : null,
    timeEndSec: Number.isFinite(section.timeEndSec) ? section.timeEndSec : null,
    locatorStart: section.locatorStart ?? null,
    locatorEnd: section.locatorEnd ?? null,
    locatorType: typeof section.locatorType === 'string' && section.locatorType.trim() ? section.locatorType : null,
    level: Number.isInteger(section.level) ? Math.max(0, Math.min(6, section.level)) : 0,
    score: Number.isFinite(section.score) ? section.score : 0,
    index
  }));

  const isPdfSource = source.sourceType === 'pdf';
  const normalizedPdfTotalPages = Number.isFinite(pdfTotalPages) && pdfTotalPages > 0
    ? Math.max(1, Math.floor(pdfTotalPages))
    : (Number.isFinite(source.totalPages) && source.totalPages > 0 ? Math.max(1, Math.floor(source.totalPages)) : null);

  const normalizedSections = isPdfSource
    ? collapseSectionsByStart(normalized)
    : normalized;

  const parentStack = [];
  const addedHierarchy = normalizedSections.map((node, idx) => {
    parentStack.length = node.level;
    const parentId = parentStack[parentStack.length - 1] || null;
    const id = crypto.randomUUID();
    parentStack.push(id);
    const next = normalizedSections[idx + 1];
    const pageStart = Number.isFinite(normalizedPdfTotalPages) && Number.isFinite(node.pageStart)
      ? clamp(node.pageStart, 1, normalizedPdfTotalPages)
      : node.pageStart;
    let pageEnd = Number.isFinite(node.pageEnd)
      ? Math.max(node.pageEnd, pageStart || node.pageEnd)
      : null;
    if (isPdfSource) {
      const nextDistinct = normalizedSections.slice(idx + 1).find(candidate => Number.isFinite(candidate.pageStart) && candidate.pageStart > node.pageStart);
      if (!Number.isFinite(pageEnd) && Number.isFinite(pageStart) && Number.isFinite(nextDistinct?.pageStart)) {
        pageEnd = nextDistinct.pageStart - 1;
      }
      if (!Number.isFinite(pageEnd) && Number.isFinite(pageStart) && Number.isFinite(normalizedPdfTotalPages)) {
        pageEnd = normalizedPdfTotalPages;
      }
      if (!Number.isFinite(pageEnd) && Number.isFinite(pageStart)) {
        pageEnd = pageStart;
      }
      if (Number.isFinite(pageStart) && Number.isFinite(pageEnd) && pageEnd < pageStart) {
        pageEnd = pageStart;
      }
      if (Number.isFinite(normalizedPdfTotalPages) && Number.isFinite(pageEnd)) {
        pageEnd = clamp(pageEnd, 1, normalizedPdfTotalPages);
      }
    }
    const timeEndSec = Number.isFinite(node.timeEndSec)
      ? Math.max(node.timeEndSec, node.timeStartSec || node.timeEndSec)
      : (Number.isFinite(node.timeStartSec) && Number.isFinite(next?.timeStartSec)
        ? Math.max(node.timeStartSec, next.timeStartSec)
        : (Number.isFinite(node.timeStartSec) ? node.timeStartSec : null));
    return {
      id,
      sourceId: source.id,
      parentId,
      title: node.autoGenerated ? `[Auto] ${node.title}` : node.title,
      depth: node.level,
      isLeaf: false,
      studyState: 'unstudied',
      inQueue: true,
      pageStart,
      pageEnd,
      timeStartSec: node.timeStartSec,
      timeEndSec,
      locatorStart: node.locatorStart,
      locatorEnd: node.locatorEnd,
      locatorType: node.locatorType
    };
  });

  const parentIds = new Set(addedHierarchy.filter(item => item.parentId).map(item => item.parentId));
  addedHierarchy.forEach(item => { item.isLeaf = !parentIds.has(item.id); });
  state.data.hierarchy.push(...addedHierarchy);

  const addedUnits = addedHierarchy.filter(x => x.isLeaf).map((leaf) => {
    const unit = {
      id: crypto.randomUUID(),
      title: leaf.title,
      hierarchyId: leaf.id,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceType: source.sourceType,
      fullPath: getHierarchyPath(leaf.id, addedHierarchy),
      pageStart: null,
      pageEnd: null,
      timeStartSec: null,
      timeEndSec: null,
      locatorStart: null,
      locatorEnd: null,
      locatorType: null,
      retentionScore: 0,
      dueAt: null,
      lastReviewedAt: null,
      totalReviews: 0,
      inQueue: true
    };

    if (source.sourceType === 'pdf') {
      unit.pageStart = Number.isFinite(leaf.pageStart) ? leaf.pageStart : null;
      unit.pageEnd = Number.isFinite(leaf.pageEnd) ? leaf.pageEnd : unit.pageStart;
    } else if (['youtube', 'local_video', 'video'].includes(source.sourceType)) {
      unit.timeStartSec = Number.isFinite(leaf.timeStartSec) ? leaf.timeStartSec : null;
      unit.timeEndSec = Number.isFinite(leaf.timeEndSec) ? leaf.timeEndSec : unit.timeStartSec;
    } else {
      unit.locatorType = leaf.locatorType || 'section';
      unit.locatorStart = leaf.locatorStart ?? unit.fullPath;
      unit.locatorEnd = leaf.locatorEnd ?? unit.locatorStart;
    }

    unit.sizeLabel = buildUnitSizeLabel(unit);
    return unit;
  });
  state.data.units.push(...addedUnits);
  Object.assign(source, inferSourceMetadata(source, addedUnits));
  source.totalUnits = addedUnits.length;
  state.view.portal.selectedHierarchyItemId = addedHierarchy.find(h => h.isLeaf)?.id || null;
  state.view.queue.selectedUnitId = addedUnits[0]?.id || null;
}

async function parsePdfHeaders(file) {
  if (!window.pdfjsLib) throw new Error('PDF parser not loaded.');

  const pypdfResult = await parseWithPyPdfService(file);
  if (pypdfResult.sections.length >= 4) return pypdfResult;

  const arrayBuffer = await file.arrayBuffer();
  const task = window.pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await task.promise;

  const outlineEntries = await parsePdfOutline(pdf);
  if (outlineEntries.length >= 8) {
    return { sections: outlineEntries, pdfTotalPages: pdf.numPages };
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
    return {
      sections: dedup
        .sort((a, b) => a.pageStart - b.pageStart || a.level - b.level)
        .slice(0, 80),
      pdfTotalPages: pdf.numPages
    };
  }

  const unique = dedupeCandidates(
    candidates.sort((a, b) => b.score - a.score || a.pageStart - b.pageStart),
    c => c.title.toLowerCase()
  );

  return {
    sections: unique.slice(0, 24).sort((a, b) => a.pageStart - b.pageStart || a.level - b.level),
    pdfTotalPages: pdf.numPages
  };
}

async function parseWithPyPdfService(file) {
  const endpoint = localStorage.getItem('srs-pypdf-endpoint') || '/api/parse-pdf-outline';
  try {
    const formData = new FormData();
    formData.append('file', file, file.name || 'source.pdf');
    const response = await fetch(endpoint, { method: 'POST', body: formData });
    if (!response.ok) return { sections: [], pdfTotalPages: null };
    const data = await response.json();
    if (!Array.isArray(data?.sections)) return { sections: [], pdfTotalPages: null };
    return {
      sections: data.sections
        .map(item => ({
          title: (item.title || '').trim(),
          pageStart: Number(item.pageStart),
          level: Number.isInteger(item.level) ? Math.max(0, Math.min(6, item.level)) : 0,
          score: Number.isFinite(item.score) ? Number(item.score) : 30
        }))
        .filter(item => item.title && Number.isFinite(item.pageStart) && item.pageStart > 0)
        .sort((a, b) => a.pageStart - b.pageStart || a.level - b.level),
      pdfTotalPages: Number.isFinite(data?.pdfTotalPages) ? Number(data.pdfTotalPages) : null
    };
  } catch {
    return { sections: [], pdfTotalPages: null };
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


function collapseSectionsByStart(sections) {
  const sorted = [...sections].sort((a, b) => {
    const aStart = Number.isFinite(a.pageStart) ? a.pageStart : Number.POSITIVE_INFINITY;
    const bStart = Number.isFinite(b.pageStart) ? b.pageStart : Number.POSITIVE_INFINITY;
    if (aStart !== bStart) return aStart - bStart;
    if (a.level !== b.level) return a.level - b.level;
    if (a.score !== b.score) return b.score - a.score;
    return a.index - b.index;
  });

  const collapsed = [];
  for (const section of sorted) {
    const prev = collapsed[collapsed.length - 1];
    if (prev && Number.isFinite(prev.pageStart) && prev.pageStart === section.pageStart) {
      if (section.level < prev.level || (section.level === prev.level && section.score > prev.score)) {
        collapsed[collapsed.length - 1] = section;
      }
      continue;
    }
    collapsed.push(section);
  }
  return collapsed;
}

function formatRangeLabel(item) {
  if (!item) return '';
  if (Number.isFinite(item.pageStart) && Number.isFinite(item.pageEnd)) return `pp.${item.pageStart}-${item.pageEnd}`;
  if (Number.isFinite(item.timeStartSec) && Number.isFinite(item.timeEndSec)) return `${item.timeStartSec}-${item.timeEndSec}s`;
  return '';
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

function reconcileQueueFlagsFromHierarchy() {
  const hierarchyById = new Map(state.data.hierarchy.map(item => [item.id, item]));
  state.data.units.forEach(unit => {
    const hierarchyItem = hierarchyById.get(unit.hierarchyId);
    if (hierarchyItem) unit.inQueue = !!hierarchyItem.inQueue;
  });
}

async function processImportedFile(file) {
  if (importDraft.objectUrl) {
    URL.revokeObjectURL(importDraft.objectUrl);
    importDraft.objectUrl = null;
  }

  importDraft.file = file;
  importDraft.objectUrl = URL.createObjectURL(file);
  importDraft.parsedSections = [];
  importDraft.parsedPdfTotalPages = null;
  importDraft.detectedVideoDurationSec = null;
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/i.test(file.name);
  const status = document.getElementById('import-parse-status');

  document.getElementById('import-title').value = file.name;
  const typeField = document.getElementById('import-type');
  if (isPdf) typeField.value = 'pdf';
  if (isVideo) typeField.value = 'local_video';
  document.getElementById('import-origin').value = typeField.value === 'youtube' ? '' : '(stored in app)';
  document.getElementById('import-size').value = isPdf ? `${Math.max(1, Math.round(file.size / 1024 / 1024))} MB PDF` : `${Math.max(1, Math.round(file.size / 1024))} KB file`;
  updateImportTypeHints();

  if (isVideo) {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.src = URL.createObjectURL(file);
    await new Promise(resolve => {
      probe.onloadedmetadata = () => {
        importDraft.detectedVideoDurationSec = Number.isFinite(probe.duration) ? Math.floor(probe.duration) : null;
        URL.revokeObjectURL(probe.src);
        resolve();
      };
      probe.onerror = () => {
        URL.revokeObjectURL(probe.src);
        resolve();
      };
    });
    const durationField = document.getElementById('import-video-duration');
    if (durationField && Number.isFinite(importDraft.detectedVideoDurationSec)) durationField.value = String(importDraft.detectedVideoDurationSec);
    status.textContent = 'Loaded video metadata. Add optional timestamp chapters, or leave empty for auto-generated segments.';
    return;
  }

  if (!isPdf) {
    status.textContent = 'Loaded file metadata. Header parsing is currently PDF-only.';
    return;
  }

  importDraft.parsing = true;
  status.textContent = 'Parsing PDF headers…';
  try {
    const parsed = await parsePdfHeaders(file);
    const headers = parsed.sections || [];
    importDraft.parsedPdfTotalPages = Number.isFinite(parsed.pdfTotalPages) ? parsed.pdfTotalPages : null;
    importDraft.parsedSections = headers.map(h => ({ title: h.title, pageStart: h.pageStart, level: h.level, score: h.score }));
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

function updateImportTypeHints() {
  const type = document.getElementById('import-type')?.value;
  const hint = document.getElementById('import-type-hint');
  const chaptersWrap = document.getElementById('import-video-chapters-wrap');
  const durationWrap = document.getElementById('import-video-duration-wrap');
  const originField = document.getElementById('import-origin');
  if (!hint) return;

  if (type === 'pdf') {
    hint.textContent = 'PDF hint: upload file in dropzone; app stores it locally and parses headers automatically.';
    chaptersWrap?.classList.add('hidden');
    durationWrap?.classList.add('hidden');
    if (originField) {
      originField.disabled = true;
      originField.value = '(stored in app)';
      originField.placeholder = 'Stored in app after upload';
    }
    return;
  }

  if (type === 'youtube') {
    hint.textContent = 'YouTube hint: paste a full URL. Timestamp chapters are optional.';
    chaptersWrap?.classList.remove('hidden');
    durationWrap?.classList.remove('hidden');
    if (originField) {
      originField.disabled = false;
      if (originField.value === '(stored in app)') originField.value = '';
      originField.placeholder = 'https://youtube.com/watch?v=...';
    }
    return;
  }

  if (type === 'local_video') {
    hint.textContent = 'Local video hint: upload file in dropzone; app stores it locally. Chapters are optional.';
    chaptersWrap?.classList.remove('hidden');
    durationWrap?.classList.remove('hidden');
    if (originField) {
      originField.disabled = true;
      originField.value = '(stored in app)';
      originField.placeholder = 'Stored in app after upload';
    }
    return;
  }

  hint.textContent = 'Fill in metadata and import.';
  chaptersWrap?.classList.add('hidden');
  durationWrap?.classList.add('hidden');
  if (originField) originField.disabled = false;
}


function openImportModal() {
  importDraft.file = null;
  importDraft.objectUrl = null;
  importDraft.parsedSections = [];
  importDraft.parsedPdfTotalPages = null;
  importDraft.detectedVideoDurationSec = null;
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
      <p id="import-type-hint" class="small">PDF hint: dropping a PDF tries to detect outline headers automatically.</p>
      <label id="import-video-chapters-wrap" class="hidden">Timestamp chapters (optional, one per line: <code>00:00 Intro</code>)<textarea id="import-video-chapters" rows="4" placeholder="00:00 Intro
08:30 Core idea
21:45 Demo"></textarea></label>
      <label id="import-video-duration-wrap" class="hidden">Video duration seconds (optional, used when chapters missing)<input id="import-video-duration" placeholder="e.g. 5420 or 01:30:20"></label>
      <label>Size Label <input id="import-size" placeholder="e.g. 240 pages or 90 min"></label>
      <label>Tags (comma-separated) <input id="import-tags" placeholder="biology, textbook"></label>
      <label>Source URL (YouTube only) <input id="import-origin" placeholder="https://youtube.com/..." ></label>
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

  document.getElementById('import-type').onchange = updateImportTypeHints;
  updateImportTypeHints();
  document.getElementById('close-import').onclick = closeImportModal;
  document.getElementById('cancel-import').onclick = closeImportModal;
  document.getElementById('confirm-import').onclick = importSourceFromForm;
}

function closeImportModal() {
  if (importDraft.objectUrl) {
    URL.revokeObjectURL(importDraft.objectUrl);
  }
  importDraft.file = null;
  importDraft.objectUrl = null;
  importDraft.parsedSections = [];
  importDraft.parsedPdfTotalPages = null;
  importDraft.detectedVideoDurationSec = null;
  importDraft.parsing = false;
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
  confirmButton.onclick = async () => {
    await deleteSource(source.id);
    close();
  };
}

async function deleteSource(sourceId) {
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

  if (removedSource.assetId) {
    try {
      await deleteAssetBlob(removedSource.assetId);
    } catch (error) {
      console.warn('Failed to remove stored asset blob:', error);
    }
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

  if (v.sourceId !== source.id) v.sourceId = source.id;
  const savedPosition = getSavedViewerPosition(source.id);
  if (savedPosition?.kind === 'page' && Number.isFinite(savedPosition.page)) {
    v.viewerPage = Math.max(1, Math.floor(savedPosition.page));
  }

  const outline = state.data.hierarchy.filter(h => h.sourceId === source.id);
  const filtered = outline.filter(h => !v.outlineSearchText || h.title.toLowerCase().includes(v.outlineSearchText.toLowerCase()));
  const selected = outline.find(h => h.id === v.selectedHierarchyItemId) || outline[0] || null;
  const selectedUnit = selected ? state.data.units.find(u => u.sourceId === source.id && u.hierarchyId === selected.id) || null : null;
  const selectedLocator = selected ? (getLocatorForHierarchyItem(source, selected) || getLocatorForUnit(selectedUnit)) : null;
  const allInQueue = outline.length ? outline.every(item => item.inQueue) : true;
  if (!v.selectedHierarchyItemId && selected) v.selectedHierarchyItemId = selected.id;

  pageRoot.innerHTML = `<div class="portal"><aside class="panel"><div style="padding:10px"><h3>${source.title}</h3><input id="outline-search" placeholder="Search outline" value="${v.outlineSearchText}"></div><div class="outline-tools"><span class="small">Queue all</span><button class="queue-master ${allInQueue ? 'queue-on' : 'queue-off'}" id="toggle-all-queue" title="${allInQueue ? 'Turn all OFF in queue' : 'Turn all ON in queue'}" aria-label="${allInQueue ? 'Turn all OFF in queue' : 'Turn all ON in queue'}"></button></div><div class="outline-list">${filtered.map(item => `<div class="outline-item ${item.id === selected?.id ? 'selected' : ''}" data-item="${item.id}"><div><div class="indent" style="--depth:${item.depth}">${item.isLeaf ? '📄' : '📁'} ${item.title}</div>${formatRangeLabel(item) ? `<div class="small" style="padding-left:${Math.min(item.depth + 1, 6) * 16}px">${formatRangeLabel(item)}</div>` : ''}</div>${renderQueueBars(item)}</div>`).join('') || '<p class="small" style="padding:8px">No outline items.</p>'}</div></aside>
  <section class="panel viewer"><div class="row" style="justify-content:space-between"><h3>Viewer</h3><div class="controls"><button class="btn" id="zoom-out">-</button><span id="portal-zoom-label">${v.viewerZoom || 120}%</span><button class="btn" id="zoom-in">+</button><button class="btn" id="portal-jump" ${selectedLocator ? '' : 'disabled'}>Jump to selected</button></div></div><div class="small" id="portal-selected-title">${selected?.title || 'No item selected'}</div><div class="small" id="portal-selected-location">${selectedLocator ? 'Location available' : 'location unavailable'}</div><div id="portal-viewer-content" class="viewer-doc"></div></section>
  <aside class="panel" style="padding:12px"><h3>Unit Meta</h3><div class="small">Source Type: ${source.sourceType}</div><div class="small">Priority: ${source.priority}</div><div class="small">Units: ${source.totalUnits}</div><div class="small">Queue On/Off via bars in outline.</div></aside></div>`;

  const viewerEl = document.getElementById('portal-viewer-content');
  renderSourceViewer(source, selectedUnit || selected, viewerEl, {
    zoomPercent: v.viewerZoom || 120,
    defaultPage: v.viewerPage || 1
  });
  const controller = createViewerController(source, viewerEl);

  document.getElementById('outline-search').oninput = e => { v.outlineSearchText = e.target.value; renderPortal(); save(); };
  document.getElementById('toggle-all-queue').onclick = () => {
    const nextState = !outline.every(item => item.inQueue);
    setQueueStateForHierarchyIds(outline.map(item => item.id), nextState);
    save();
    render();
  };
  document.querySelectorAll('[data-item]').forEach(el => el.onclick = () => {
    const item = outline.find(x => x.id === el.dataset.item);
    const unit = item ? state.data.units.find(u => u.sourceId === source.id && u.hierarchyId === item.id) || null : null;
    const locator = item ? (getLocatorForHierarchyItem(source, item) || getLocatorForUnit(unit)) : null;
    syncSelectionAcrossPortalAndQueue(source, item, unit);
    if (locator?.kind === 'page') controller.goToPage(locator.page);
    if (locator?.kind === 'time') controller.seekTo(locator.seconds);

    const selectedTitleEl = document.getElementById('portal-selected-title');
    const selectedLocationEl = document.getElementById('portal-selected-location');
    const jumpEl = document.getElementById('portal-jump');
    if (selectedTitleEl) selectedTitleEl.textContent = item?.title || 'No item selected';
    if (selectedLocationEl) selectedLocationEl.textContent = locator ? 'Location available' : 'location unavailable';
    if (jumpEl) jumpEl.disabled = !locator;

    document.querySelectorAll('.outline-item[data-item]').forEach(node => {
      node.classList.toggle('selected', node.getAttribute('data-item') === item?.id);
    });

    renderSourceViewer(source, unit || item, viewerEl, {
      zoomPercent: v.viewerZoom || 120,
      defaultPage: v.viewerPage || 1
    });

    rememberViewerPosition(source.id, locator || controller.getPosition());
    save();
  });

  document.getElementById('portal-jump').onclick = () => {
    const activeItem = outline.find(x => x.id === v.selectedHierarchyItemId) || null;
    const activeUnit = activeItem ? state.data.units.find(u => u.sourceId === source.id && u.hierarchyId === activeItem.id) || null : null;
    const activeLocator = activeItem ? (getLocatorForHierarchyItem(source, activeItem) || getLocatorForUnit(activeUnit)) : null;
    if (!activeLocator) return;
    if (activeLocator.kind === 'page') controller.goToPage(activeLocator.page);
    if (activeLocator.kind === 'time') controller.seekTo(activeLocator.seconds);

    renderSourceViewer(source, activeUnit || activeItem, viewerEl, {
      zoomPercent: v.viewerZoom || 120,
      defaultPage: v.viewerPage || 1
    });

    rememberViewerPosition(source.id, activeLocator || controller.getPosition());
    save();
  };

  const onToggleQueue = e => {
    e.stopPropagation();
    const toggleId = e.currentTarget?.dataset.toggle;
    const i = state.data.hierarchy.find(x => x.id === toggleId);
    if (!i) return;

    const nextState = !i.inQueue;
    const related = state.data.hierarchy.filter(x => x.sourceId === i.sourceId);
    const affected = [i.id, ...getDescendantIds(i.id, related)];
    setQueueStateForHierarchyIds(affected, nextState);
    save();
    render();
  };

  document.querySelectorAll('[data-toggle]').forEach(el => el.onclick = onToggleQueue);
  document.getElementById('zoom-in').onclick = () => {
    v.viewerZoom = Math.min(200, (v.viewerZoom || 120) + 10);
    const selectedItem = outline.find(x => x.id === v.selectedHierarchyItemId) || selected;
    const selectedItemUnit = selectedItem ? state.data.units.find(u => u.sourceId === source.id && u.hierarchyId === selectedItem.id) || null : null;
    const zoomLabel = document.getElementById('portal-zoom-label');
    if (zoomLabel) zoomLabel.textContent = `${v.viewerZoom}%`;
    renderSourceViewer(source, selectedItemUnit || selectedItem, viewerEl, {
      zoomPercent: v.viewerZoom || 120,
      defaultPage: v.viewerPage || 1
    });
    save();
  };
  document.getElementById('zoom-out').onclick = () => {
    v.viewerZoom = Math.max(50, (v.viewerZoom || 120) - 10);
    const selectedItem = outline.find(x => x.id === v.selectedHierarchyItemId) || selected;
    const selectedItemUnit = selectedItem ? state.data.units.find(u => u.sourceId === source.id && u.hierarchyId === selectedItem.id) || null : null;
    const zoomLabel = document.getElementById('portal-zoom-label');
    if (zoomLabel) zoomLabel.textContent = `${v.viewerZoom}%`;
    renderSourceViewer(source, selectedItemUnit || selectedItem, viewerEl, {
      zoomPercent: v.viewerZoom || 120,
      defaultPage: v.viewerPage || 1
    });
    save();
  };
  rememberViewerPosition(source.id, controller.getPosition() || selectedLocator);
}

function normalizeQueueSelection() {
  const queuedUnits = state.data.units.filter(unit => unit.inQueue);
  const selectedUnitIsQueued = queuedUnits.some(unit => unit.id === state.view.queue.selectedUnitId);
  if (!selectedUnitIsQueued) {
    state.view.queue.selectedUnitId = queuedUnits[0]?.id || null;
  }
}

function setQueueStateForHierarchyIds(hierarchyIds, nextState) {
  const itemIds = new Set(hierarchyIds);
  state.data.hierarchy.forEach(node => {
    if (itemIds.has(node.id)) node.inQueue = nextState;
  });
  state.data.units.forEach(unit => {
    if (itemIds.has(unit.hierarchyId)) unit.inQueue = nextState;
  });
  normalizeQueueSelection();
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
  normalizeQueueSelection();
  const units = state.data.units.filter(u => u.inQueue);
  const u = units.find(x => x.id === v.selectedUnitId) || units[0] || null;
  if (!v.selectedUnitId && u) v.selectedUnitId = u.id;

  const queueSource = u ? state.data.sources.find(source => source.id === u.sourceId) || null : null;
  const queueHierarchyItem = u ? state.data.hierarchy.find(item => item.id === u.hierarchyId) || null : null;
  const queueLocator = getLocatorForUnit(u) || getLocatorForHierarchyItem(queueSource, queueHierarchyItem);

  pageRoot.innerHTML = `<div class="queue"><aside class="panel queue-list"><h2>Study Queue</h2>${units.length ? units.map(x => `<div class="queue-item ${x.id === u?.id ? 'active' : ''}" data-unit="${x.id}"><strong>${x.title}</strong><div class="small">${x.sourceTitle} • ${x.sizeLabel}</div><div>${x.retentionScore}%</div></div>`).join('') : '<p class="small">No units in queue yet. Import a source and keep units enabled in queue from Source Portal.</p>'}</aside>
  <section class="col"><div class="panel" style="padding:12px"><h3>${u?.title || 'No unit selected'}</h3><div class="small">${u ? `${u.sourceTitle} • ${u.pageStart ? `pp.${u.pageStart}-${u.pageEnd}` : `${u.timeStartSec || 0}-${u.timeEndSec || 0}s`}` : 'Select a unit to begin.'}</div><div class="row"><button class="btn" id="open-history" ${u ? '' : 'disabled'}>Review History</button><div class="small">Retention<div>${u?.retentionScore || 0}%</div></div></div></div>
  <div class="panel" style="padding:12px"><div class="controls"><strong id="timer">${format(v.elapsedSec)}</strong><button class="btn" id="start-stop" ${u ? '' : 'disabled'}>${v.timerRunning ? 'Pause' : 'Start'}</button><button class="btn" id="restart" ${u ? '' : 'disabled'}>Restart</button><button class="btn outcome" data-outcome="easy" ${u ? '' : 'disabled'}>Easy</button><button class="btn outcome" data-outcome="with_effort" ${u ? '' : 'disabled'}>With Effort</button><button class="btn outcome" data-outcome="hard" ${u ? '' : 'disabled'}>Hard</button><button class="btn outcome" data-outcome="skip" ${u ? '' : 'disabled'}>Skip</button><button class="btn" id="queue-jump" ${queueLocator ? '' : 'disabled'}>Jump to unit</button></div><div class="small">${queueLocator ? 'Location available' : 'location unavailable'}</div><div class="row"><textarea id="pre-note" rows="3" placeholder="Pre-recall note" style="flex:1">${v.preRecallNote || ''}</textarea><textarea id="post-note" rows="3" placeholder="Post-recall note" style="flex:1">${v.postRecallNote || ''}</textarea></div></div>
  <div class="panel viewer" style="min-height:220px"><div class="small">${u?.title || 'No unit loaded'}</div><div id="queue-viewer-content" class="viewer-doc"></div></div></section></div>`;

  const viewerEl = document.getElementById('queue-viewer-content');
  renderSourceViewer(queueSource, u, viewerEl, {
    zoomPercent: state.view.portal.viewerZoom || 120,
    defaultPage: state.view.portal.viewerPage || 1
  });
  const controller = createViewerController(queueSource, viewerEl);

  document.querySelectorAll('[data-unit]').forEach(el => el.onclick = () => {
    const selectedUnit = units.find(item => item.id === el.dataset.unit) || null;
    const selectedSource = selectedUnit ? state.data.sources.find(source => source.id === selectedUnit.sourceId) || null : null;
    const selectedHierarchyItem = selectedUnit ? state.data.hierarchy.find(item => item.id === selectedUnit.hierarchyId) || null : null;
    const locator = getLocatorForUnit(selectedUnit) || getLocatorForHierarchyItem(selectedSource, selectedHierarchyItem);
    syncSelectionAcrossPortalAndQueue(selectedSource, selectedHierarchyItem, selectedUnit);
    if (locator?.kind === 'page') controller.goToPage(locator.page);
    if (locator?.kind === 'time') controller.seekTo(locator.seconds);
    if (selectedSource?.id) rememberViewerPosition(selectedSource.id, controller.getPosition() || locator);
    renderQueue();
    save();
  });
  document.getElementById('queue-jump').onclick = () => {
    if (!queueLocator) return;
    if (queueLocator.kind === 'page') controller.goToPage(queueLocator.page);
    if (queueLocator.kind === 'time') controller.seekTo(queueLocator.seconds);
    if (queueSource?.id) rememberViewerPosition(queueSource.id, controller.getPosition() || queueLocator);
    renderQueue();
    save();
  };
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
