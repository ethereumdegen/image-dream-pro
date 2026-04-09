import { toast } from '../toast.js';
import { buildField, collectInputs } from '../components/modelForm.js';
import { el, esc } from '../components/dom.js';

// Model ids referenced by the editor's built-in actions.
const VECTORIZE_MODEL_ID = 'fal-ai/recraft/vectorize';
const REMIX_MODEL_ID = 'fal-ai/ideogram/v3/remix';
const REMBG_MODEL_ID = 'smoretalk-ai/rembg-enhance';
const EDIT_MODEL_ID = 'fal-ai/nano-banana-2/edit';
const UPSCALE_MODEL_ID = 'fal-ai/recraft/upscale/creative';
const REMOVE_TEXT_MODEL_ID = 'fal-ai/ideogram/v3/layerize-text';
const REFRAME_MODEL_ID = 'fal-ai/ideogram/v3/reframe';

// Zoom is clamped to [ZOOM_MIN, ZOOM_MAX]. 1.0 is "actual size" / max zoom-in.
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 1.0;
const ZOOM_STEP = 1.15;

// --------- Module state (persists across page visits in the same session) ---------
let state = {
  tiles: [], // { id, x, y, width, height, src, name, kind: 'raster'|'vector', libRef? }
  selectedId: null,
  pan: { x: 0, y: 0 },
  zoom: 1,
  busy: false,
  saveFolder: '',
  library: { folders: [''], files: [], selectedFolder: '', viewMode: 'tiles' },
  subPage: null, // null | 'remix'
  remix: {
    model: null,
    title: 'Remix',
    formState: { inputs: {}, localFiles: {} },
    sourceTileId: null,
  },
};

// Lazy-loaded model list. Populated the first time the user opens the
// remix sub-page, then reused until the page is fully reloaded.
let cachedModels = null;
async function getModels() {
  if (cachedModels) return cachedModels;
  try {
    cachedModels = await window.api.models.list();
  } catch (_) {
    cachedModels = [];
  }
  return cachedModels;
}

let tileIdCounter = 1;
function genId() {
  return `tile_${tileIdCounter++}`;
}

// Cached DOM references populated on render.
let refs = {};

// Generation counter used to cancel in-flight thumbnail reads when the
// sidebar is re-rendered or the folder changes.
let sidebarGen = 0;

function isVector(...values) {
  for (const v of values) {
    const s = String(v || '').toLowerCase();
    if (s.startsWith('data:image/svg')) return true;
    if (s.endsWith('.svg')) return true;
  }
  return false;
}

// --------- Page entry ---------
export async function renderEditorPage(root) {
  // Fetch settings and library listing concurrently.
  const [settings] = await Promise.all([
    window.api.settings.get().catch(() => ({})),
    refreshLibrary(),
  ]);
  state.saveFolder = settings.lastFolder || state.saveFolder || '';

  root.innerHTML = '';
  root.classList.add('editor-page-root');

  refs = { root };

  if (state.subPage === 'remix') {
    root.appendChild(renderRemixSubPage());
    return;
  }

  const layout = el(`
    <div class="editor-layout">
      <div class="editor-canvas-wrap">
        <div class="editor-canvas" id="editor-canvas">
          <div class="editor-grid-bg"></div>
          <div class="editor-tiles-layer" id="editor-tiles-layer"></div>
          <div class="editor-empty-hint" id="editor-empty-hint">
            <div>Drop images here</div>
            <div class="hint-sub">From the sidebar or your desktop</div>
          </div>
          <div class="editor-zoom-controls" id="editor-zoom-controls">
            <button class="zoom-btn" data-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>
            <div class="zoom-level" id="editor-zoom-level">100%</div>
            <button class="zoom-btn" data-zoom="out" title="Zoom out" aria-label="Zoom out">−</button>
          </div>
          <div class="editor-busy-overlay hidden" id="editor-busy">
            <div class="spinner"></div>
            <div id="editor-busy-label">Working…</div>
          </div>
        </div>
      </div>
      <aside class="editor-sidebar" id="editor-sidebar"></aside>
    </div>
  `);
  root.appendChild(layout);

  // Hover popup lives at document level so it can overlay everything.
  let popup = document.getElementById('editor-hover-popup');
  if (!popup) {
    popup = el(`<div id="editor-hover-popup" class="editor-hover-popup hidden"><img alt="preview"/></div>`);
    document.body.appendChild(popup);
  }

  refs.layout = layout;
  refs.canvas = layout.querySelector('#editor-canvas');
  refs.tilesLayer = layout.querySelector('#editor-tiles-layer');
  refs.emptyHint = layout.querySelector('#editor-empty-hint');
  refs.sidebar = layout.querySelector('#editor-sidebar');
  refs.busyOverlay = layout.querySelector('#editor-busy');
  refs.busyLabel = layout.querySelector('#editor-busy-label');
  refs.zoomLevel = layout.querySelector('#editor-zoom-level');
  refs.popup = popup;

  applyTransform();
  setupCanvasInteractions();
  setupZoomControls(layout.querySelector('#editor-zoom-controls'));
  renderTiles();
  renderSidebar();
  updateBusy();
}

// --------- View transform (pan + zoom) ---------
function applyTransform() {
  if (refs.tilesLayer) {
    refs.tilesLayer.style.transform = `translate(${state.pan.x}px, ${state.pan.y}px) scale(${state.zoom})`;
  }
  if (refs.zoomLevel) {
    refs.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  }
}

// Zoom around a fixed focal point in canvas-space (screen pixels relative to
// the canvas element). Keeps the point under the cursor stationary.
function zoomBy(factor, focalX, focalY) {
  const prev = state.zoom;
  const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev * factor));
  if (next === prev) return;
  // Screen point = pan + layer * scale  =>  layer = (screen - pan) / scale
  // We want the same layer point under the same screen point at the new scale.
  state.pan.x = focalX - ((focalX - state.pan.x) * next) / prev;
  state.pan.y = focalY - ((focalY - state.pan.y) * next) / prev;
  state.zoom = next;
  applyTransform();
}

function setupZoomControls(controlsEl) {
  if (!controlsEl) return;
  controlsEl.addEventListener('mousedown', (ev) => ev.stopPropagation());
  controlsEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.zoom-btn');
    if (!btn) return;
    const rect = refs.canvas.getBoundingClientRect();
    const focalX = rect.width / 2;
    const focalY = rect.height / 2;
    zoomBy(btn.dataset.zoom === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP, focalX, focalY);
  });
}

// --------- Library loading ---------
async function refreshLibrary() {
  try {
    const folders = await window.api.library.listFolders();
    state.library.folders = folders;
    if (!folders.includes(state.library.selectedFolder)) {
      state.library.selectedFolder = '';
    }
    state.library.files = await window.api.library.listFiles(state.library.selectedFolder);
  } catch (e) {
    console.error(e);
    state.library.folders = [''];
    state.library.files = [];
  }
}

// --------- Canvas + tile rendering ---------
function renderTiles() {
  const layer = refs.tilesLayer;
  if (!layer) return;
  layer.innerHTML = '';
  for (const tile of state.tiles) {
    layer.appendChild(buildTileEl(tile));
  }
  if (refs.emptyHint) {
    refs.emptyHint.style.display = state.tiles.length ? 'none' : 'flex';
  }
}

function buildTileEl(tile) {
  const tileEl = el(`
    <div class="editor-tile${tile.id === state.selectedId ? ' selected' : ''}" data-id="${esc(
      tile.id
    )}" style="transform: translate(${tile.x}px, ${tile.y}px); width:${tile.width}px; height:${
      tile.height
    }px;">
      <img alt="${esc(tile.name || '')}" draggable="false" />
      <div class="editor-tile-label">${esc(tile.name || '')}</div>
    </div>
  `);
  tileEl.querySelector('img').src = tile.src;

  tileEl.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    beginTileDrag(tile, tileEl, ev);
  });
  tileEl.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    selectTile(tile.id);
    showTileContextMenu(tile, ev.clientX, ev.clientY);
  });
  return tileEl;
}

// --------- Tile context menu ---------
let contextMenuEl = null;
function hideContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.remove();
    contextMenuEl = null;
  }
}

function showTileContextMenu(tile, clientX, clientY) {
  hideContextMenu();
  const hasLibRef = !!(tile.libRef && tile.libRef.folder != null && tile.libRef.name);
  const menu = el(`
    <div class="editor-context-menu" role="menu">
      <button class="ctx-item" data-action="remove">Remove</button>
      <button class="ctx-item${hasLibRef ? '' : ' disabled'}" data-action="reveal"${
    hasLibRef ? '' : ' disabled'
  }>Show in folder</button>
    </div>
  `);
  document.body.appendChild(menu);
  contextMenuEl = menu;

  // Position, flipping to stay on-screen.
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  let left = clientX;
  let top = clientY;
  if (left + rect.width > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - rect.width - margin);
  }
  if (top + rect.height > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - rect.height - margin);
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  menu.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.ctx-item');
    if (!btn || btn.disabled) return;
    const action = btn.dataset.action;
    hideContextMenu();
    if (action === 'remove') {
      removeTile(tile.id);
    } else if (action === 'reveal' && hasLibRef) {
      window.api.library
        .revealInFolder(tile.libRef.folder, tile.libRef.name)
        .catch((e) => toast(e.message || 'Could not reveal file', 'err'));
    }
  });

  // Dismiss on any outside click, escape, scroll, or resize.
  const dismiss = (ev) => {
    if (ev && ev.type === 'keydown' && ev.key !== 'Escape') return;
    hideContextMenu();
    document.removeEventListener('mousedown', dismiss, true);
    document.removeEventListener('keydown', dismiss, true);
    window.removeEventListener('resize', dismiss);
    window.removeEventListener('blur', dismiss);
  };
  // Defer attach so the originating contextmenu event doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', dismiss, true);
    document.addEventListener('keydown', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
  }, 0);
}

function beginTileDrag(tile, tileEl, ev) {
  hideHoverPopup();
  const startX = ev.clientX;
  const startY = ev.clientY;
  const origX = tile.x;
  const origY = tile.y;
  const zoom = state.zoom || 1;
  let moved = false;

  function onMove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && Math.hypot(dx, dy) > 3) moved = true;
    if (moved) {
      // Tile coords are in layer space, so undo the zoom on the screen delta.
      tile.x = origX + dx / zoom;
      tile.y = origY + dy / zoom;
      tileEl.style.transform = `translate(${tile.x}px, ${tile.y}px)`;
    }
  }
  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    selectTile(tile.id);
  }
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function setupCanvasInteractions() {
  const canvas = refs.canvas;
  const tilesLayer = refs.tilesLayer;

  canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    // Only start pan/deselect when clicking empty canvas, not a tile.
    if (ev.target.closest('.editor-tile')) return;
    selectTile(null);
    const startX = ev.clientX;
    const startY = ev.clientY;
    const origPanX = state.pan.x;
    const origPanY = state.pan.y;
    canvas.classList.add('panning');
    function onMove(e) {
      state.pan.x = origPanX + (e.clientX - startX);
      state.pan.y = origPanY + (e.clientY - startY);
      applyTransform();
    }
    function onUp() {
      canvas.classList.remove('panning');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Mouse wheel zoom, centered on the cursor.
  canvas.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const focalX = ev.clientX - rect.left;
      const focalY = ev.clientY - rect.top;
      // Scrolling up (deltaY < 0) zooms in.
      const factor = ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomBy(factor, focalX, focalY);
    },
    { passive: false }
  );

  // Drag-over / drop handling for library items and OS files.
  canvas.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    canvas.classList.add('drag-target');
  });
  canvas.addEventListener('dragleave', (ev) => {
    // Only clear the highlight when the pointer actually leaves the canvas
    // (not when it crosses onto a child element like a tile).
    if (!canvas.contains(ev.relatedTarget)) canvas.classList.remove('drag-target');
  });
  canvas.addEventListener('drop', async (ev) => {
    ev.preventDefault();
    canvas.classList.remove('drag-target');
    const rect = refs.canvas.getBoundingClientRect();
    // Convert screen point to layer (tile) coordinates: invert pan then scale.
    const zoom = state.zoom || 1;
    const dropX = (ev.clientX - rect.left - state.pan.x) / zoom;
    const dropY = (ev.clientY - rect.top - state.pan.y) / zoom;

    // 1. Library drop (custom data).
    const libPayload = ev.dataTransfer.getData('application/x-idp-library-file');
    if (libPayload) {
      try {
        const ref = JSON.parse(libPayload);
        await addTileFromLibrary(ref.folder, ref.name, dropX, dropY);
      } catch (e) {
        toast(e.message || 'Drop failed', 'err');
      }
      return;
    }

    // 2. OS file drop. Persist every dropped file into the media library so
    // the resulting tiles are backed by real files on disk (every editor
    // tile must reference a library file). Saves run in parallel, and
    // failures are collected so a single bad file doesn't bail the batch.
    const files = Array.from(ev.dataTransfer.files || []).filter(
      (f) => /^image\//.test(f.type) || /\.svg$/i.test(f.name)
    );
    if (!files.length) return;
    await importDroppedFiles(files, dropX, dropY);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function loadImageDims(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 180, h: img.naturalHeight || 180 });
    img.onerror = () => resolve({ w: 180, h: 180 });
    img.src = src;
  });
}

// Approximate the decoded byte size of a data: URL. Base64 payloads are
// 4 chars -> 3 bytes (minus padding); URL-encoded payloads decode to UTF-8.
function dataUrlByteSize(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const header = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/;base64/i.test(header)) {
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
  }
  try {
    return new Blob([decodeURIComponent(payload)]).size;
  } catch (_) {
    return payload.length;
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function computeDisplaySize(natW, natH, maxDim = 180) {
  const m = Math.max(natW, natH) || 1;
  const scale = Math.min(1, maxDim / m);
  return {
    width: Math.max(60, Math.round(natW * scale)),
    height: Math.max(60, Math.round(natH * scale)),
  };
}

// Create a tile and add it to the canvas. `opts` accepts either:
//   { cx, cy } — tile centered at canvas-space coordinate, or
//   { x, y }   — tile positioned at canvas-space top-left coordinate.
async function addTile({ src, name, libRef = null, kind, cx, cy, x, y, select = true }) {
  const dims = await loadImageDims(src);
  const { width, height } = computeDisplaySize(dims.w, dims.h);
  let tileX = x;
  let tileY = y;
  if (tileX == null || tileY == null) {
    tileX = Math.round((cx ?? 0) - width / 2);
    tileY = Math.round((cy ?? 0) - height / 2);
  }
  const tile = {
    id: genId(),
    x: tileX,
    y: tileY,
    width,
    height,
    natW: dims.w,
    natH: dims.h,
    src,
    name: name || 'image',
    kind: kind || (isVector(name, src) ? 'vector' : 'raster'),
    libRef,
  };
  state.tiles.push(tile);
  renderTiles();
  if (select) selectTile(tile.id);
  return tile;
}

function addTileAtCenter(src, name, cx, cy, libRef = null) {
  return addTile({ src, name, cx, cy, libRef });
}

async function addTileFromLibrary(folder, name, cx, cy) {
  const dataUrl = await window.api.library.readAsDataUrl(folder, name);
  if (!dataUrl) throw new Error('Could not load file');
  return addTileAtCenter(dataUrl, name, cx, cy, { folder, name });
}

// Persist a batch of OS-dropped files into the media library, then add a
// tile per file in a single render pass. Failures are collected and
// surfaced via toast so a single bad file doesn't lose the rest.
async function importDroppedFiles(files, dropX, dropY) {
  const targetFolder = state.saveFolder || '';
  const dataUrls = await Promise.all(
    files.map((f) => fileToDataUrl(f).catch((e) => ({ __err: e })))
  );

  // Save and measure each file independently. Each entry resolves to either
  // { ok: true, dataUrl, ref, dims } or { ok: false, name, error }.
  const results = await Promise.all(
    files.map(async (file, i) => {
      const dataUrl = dataUrls[i];
      if (dataUrl && dataUrl.__err) {
        return { ok: false, name: file.name, error: dataUrl.__err.message || 'Read failed' };
      }
      try {
        const [ref, dims] = await Promise.all([
          window.api.library.saveDataUrl(targetFolder, file.name, dataUrl),
          loadImageDims(dataUrl),
        ]);
        return { ok: true, dataUrl, ref, dims };
      } catch (e) {
        return { ok: false, name: file.name, error: e.message || 'Save failed' };
      }
    })
  );

  // Build all successful tiles, push them, then render once.
  let lastTileId = null;
  let okCount = 0;
  results.forEach((r, i) => {
    if (!r.ok) return;
    okCount += 1;
    const offset = i * 24;
    const { width, height } = computeDisplaySize(r.dims.w, r.dims.h);
    const tile = {
      id: genId(),
      x: Math.round(dropX + offset - width / 2),
      y: Math.round(dropY + offset - height / 2),
      width,
      height,
      natW: r.dims.w,
      natH: r.dims.h,
      src: r.dataUrl,
      name: r.ref.name,
      kind: isVector(r.ref.name, r.dataUrl) ? 'vector' : 'raster',
      libRef: r.ref,
    };
    state.tiles.push(tile);
    lastTileId = tile.id;
  });
  renderTiles();

  // Refresh library state before any sidebar render so the library list is
  // current the next time the user views it.
  await refreshLibrary();

  if (lastTileId) {
    // selectTile will renderSidebar (showing the newly-selected tile).
    selectTile(lastTileId);
  } else {
    renderSidebar();
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    toast(
      `Imported ${okCount} of ${results.length}. Failed: ${failed
        .map((f) => f.name)
        .join(', ')}`,
      'err'
    );
  }
}

// Place a new tile immediately to the right of `sourceTile`. `stackIndex`
// offsets the tile vertically so multiple outputs can be dropped in a column.
async function addTileAdjacent(sourceTile, { src, name, libRef = null, kind, stackIndex = 0 }) {
  const dims = await loadImageDims(src);
  const size = computeDisplaySize(dims.w, dims.h);
  const x = sourceTile.x + sourceTile.width + 24;
  const y = sourceTile.y + stackIndex * (size.height + 24);
  return addTile({ src, name, libRef, kind, x, y, select: stackIndex === 0 });
}

function selectTile(id) {
  if (state.selectedId === id) {
    renderSidebar();
    return;
  }
  state.selectedId = id;
  // Update only the selected class on tiles (avoid full re-render).
  for (const tileEl of refs.tilesLayer.querySelectorAll('.editor-tile')) {
    if (tileEl.dataset.id === id) tileEl.classList.add('selected');
    else tileEl.classList.remove('selected');
  }
  renderSidebar();
}

function removeTile(id) {
  const idx = state.tiles.findIndex((t) => t.id === id);
  if (idx === -1) return;
  state.tiles.splice(idx, 1);
  if (state.selectedId === id) state.selectedId = null;
  renderTiles();
  renderSidebar();
}

// --------- Hover popup ---------
let popupTileId = null;
function showHoverPopup(tileEl, tile) {
  const popup = refs.popup;
  popupTileId = tile.id;
  popup.querySelector('img').src = tile.src;
  popup.classList.remove('hidden');
  // Defer positioning until layout is known (after src load can change size,
  // but max-width/max-height in CSS constrain it predictably).
  requestAnimationFrame(() => {
    if (popupTileId !== tile.id) return;
    const rect = tileEl.getBoundingClientRect();
    const popRect = popup.getBoundingClientRect();
    const margin = 12;
    let left = rect.right + margin;
    let top = rect.top + rect.height / 2 - popRect.height / 2;
    if (left + popRect.width > window.innerWidth - margin) {
      left = rect.left - popRect.width - margin;
    }
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    if (top + popRect.height > window.innerHeight - margin) {
      top = window.innerHeight - popRect.height - margin;
    }
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  });
}
function hideHoverPopup() {
  popupTileId = null;
  if (refs.popup) {
    refs.popup.classList.add('hidden');
    // Release the potentially-large image so it isn't pinned in memory.
    const img = refs.popup.querySelector('img');
    if (img) img.removeAttribute('src');
  }
}

// --------- Sidebar ---------
function renderSidebar() {
  const sidebar = refs.sidebar;
  if (!sidebar) return;
  sidebarGen += 1;
  sidebar.innerHTML = '';

  const selected = state.tiles.find((t) => t.id === state.selectedId) || null;
  if (selected) {
    sidebar.appendChild(renderSelectedTileSidebar(selected));
  } else {
    sidebar.appendChild(renderLibrarySidebar());
  }
}

function renderSelectedTileSidebar(tile) {
  const wrap = el(`
    <div class="editor-sidebar-inner">
      <div class="editor-sidebar-title">Selected tile</div>
      <div class="editor-selected-preview">
        <img alt="${esc(tile.name || '')}" />
      </div>
      <div class="editor-selected-name">${esc(tile.name || '')}</div>
      <div class="editor-selected-meta">
        <span class="tag">${tile.kind === 'vector' ? 'VECTOR' : 'RASTER'}</span>
        ${
          tile.natW && tile.natH
            ? `<span class="tag">${tile.natW}×${tile.natH}</span>`
            : ''
        }
        <span class="tag">${esc(formatBytes(dataUrlByteSize(tile.src)))}</span>
      </div>
      <div class="editor-actions"></div>
      <div class="editor-sidebar-hint">Click empty canvas to deselect.</div>
    </div>
  `);
  wrap.querySelector('img').src = tile.src;

  const previewEl = wrap.querySelector('.editor-selected-preview');
  previewEl.addEventListener('mouseenter', () => {
    if (state.busy) return;
    showHoverPopup(previewEl, tile);
  });
  previewEl.addEventListener('mouseleave', () => hideHoverPopup());

  const actions = wrap.querySelector('.editor-actions');

  const removeBtn = el(`<button class="btn danger">Remove</button>`);
  removeBtn.addEventListener('click', () => removeTile(tile.id));
  actions.appendChild(removeBtn);

  const saveAsBtn = el(`<button class="btn">Save as…</button>`);
  saveAsBtn.addEventListener('click', () => saveTileAs(tile));
  actions.appendChild(saveAsBtn);

  if (tile.kind === 'vector') {
    const rasterBtn = el(`<button class="btn primary">Rasterize</button>`);
    rasterBtn.disabled = state.busy;
    rasterBtn.addEventListener('click', () => runRasterize(tile));
    actions.appendChild(rasterBtn);
  }

  if (tile.kind === 'raster') {
    const vbtn = el(`<button class="btn primary">Vectorize</button>`);
    vbtn.disabled = state.busy;
    vbtn.addEventListener('click', () => runVectorize(tile));
    actions.appendChild(vbtn);

    const ebtn = el(`<button class="btn primary">Edit</button>`);
    ebtn.disabled = state.busy;
    ebtn.addEventListener('click', () => openEditSubPage(tile));
    actions.appendChild(ebtn);

    const rbtn = el(`<button class="btn primary">Remix</button>`);
    rbtn.disabled = state.busy;
    rbtn.addEventListener('click', () => openRemixSubPage(tile));
    actions.appendChild(rbtn);

    const bgbtn = el(`<button class="btn primary">Remove BG</button>`);
    bgbtn.disabled = state.busy;
    bgbtn.addEventListener('click', () => runRemoveBg(tile));
    actions.appendChild(bgbtn);

    const ubtn = el(`<button class="btn primary">Upscale</button>`);
    ubtn.disabled = state.busy;
    ubtn.addEventListener('click', () => runUpscale(tile));
    actions.appendChild(ubtn);

    const txtbtn = el(`<button class="btn primary">Remove text</button>`);
    txtbtn.disabled = state.busy;
    txtbtn.addEventListener('click', () => runRemoveText(tile));
    actions.appendChild(txtbtn);

    const rfbtn = el(`<button class="btn primary">Reframe</button>`);
    rfbtn.disabled = state.busy;
    rfbtn.addEventListener('click', () => openReframeSubPage(tile));
    actions.appendChild(rfbtn);
  }

  return wrap;
}

function renderLibrarySidebar() {
  const mode = state.library.viewMode === 'list' ? 'list' : 'tiles';
  const wrap = el(`
    <div class="editor-sidebar-inner">
      <div class="editor-sidebar-title">Media Library</div>
      <div class="editor-sidebar-hint">Drag a file onto the canvas. You can also drop images from your desktop.</div>
      <label class="field" style="margin-top:10px;">
        <span class="label">Folder</span>
        <select id="editor-folder-select"></select>
      </label>
      <div class="editor-lib-viewtoggle" role="tablist">
        <button class="btn ${mode === 'tiles' ? 'primary' : ''}" data-view="tiles">Tiles</button>
        <button class="btn ${mode === 'list' ? 'primary' : ''}" data-view="list">List</button>
      </div>
      <div class="editor-lib-files ${mode}" id="editor-lib-files"></div>
      <div class="editor-sidebar-footer">
        <button class="btn" id="editor-lib-refresh">Refresh</button>
      </div>
    </div>
  `);

  const sel = wrap.querySelector('#editor-folder-select');
  for (const f of state.library.folders) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f === '' ? '(root)' : f;
    if (f === state.library.selectedFolder) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', async () => {
    state.library.selectedFolder = sel.value;
    state.library.files = await window.api.library.listFiles(sel.value);
    renderLibraryFilesInto(wrap.querySelector('#editor-lib-files'), sidebarGen);
  });

  for (const btn of wrap.querySelectorAll('.editor-lib-viewtoggle [data-view]')) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.view;
      if (state.library.viewMode === next) return;
      state.library.viewMode = next;
      renderSidebar();
    });
  }

  wrap.querySelector('#editor-lib-refresh').addEventListener('click', async () => {
    await refreshLibrary();
    renderSidebar();
  });

  renderLibraryFilesInto(wrap.querySelector('#editor-lib-files'), sidebarGen);
  return wrap;
}

function renderLibraryFilesInto(container, gen) {
  container.innerHTML = '';
  if (!state.library.files.length) {
    container.appendChild(
      el('<div class="editor-lib-empty">No files in this folder.</div>')
    );
    return;
  }
  for (const file of state.library.files) {
    const item = el(`
      <div class="editor-lib-file" draggable="true" title="${esc(file.name)}">
        <div class="editor-lib-thumb"></div>
        <div class="editor-lib-name">${esc(file.name)}</div>
      </div>
    `);
    const thumb = item.querySelector('.editor-lib-thumb');
    window.api.library
      .readAsDataUrl(file.folder, file.name)
      .then((data) => {
        // Bail if the sidebar has been re-rendered (e.g., folder change)
        // while this read was in flight.
        if (gen !== sidebarGen) return;
        if (!data) return;
        const img = document.createElement('img');
        img.src = data;
        img.draggable = false;
        thumb.appendChild(img);
      })
      .catch(() => {});

    item.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData(
        'application/x-idp-library-file',
        JSON.stringify({ folder: file.folder, name: file.name })
      );
    });

    // Double-click to add at canvas center.
    item.addEventListener('dblclick', async () => {
      const rect = refs.canvas.getBoundingClientRect();
      const zoom = state.zoom || 1;
      const cx = (rect.width / 2 - state.pan.x) / zoom;
      const cy = (rect.height / 2 - state.pan.y) / zoom;
      try {
        await addTileFromLibrary(file.folder, file.name, cx, cy);
      } catch (e) {
        toast(e.message || 'Could not add file', 'err');
      }
    });

    container.appendChild(item);
  }
}

// --------- Busy overlay ---------
function updateBusy(label = 'Working…') {
  if (!refs.busyOverlay) return;
  if (state.busy) {
    refs.busyLabel.textContent = label;
    refs.busyOverlay.classList.remove('hidden');
  } else {
    refs.busyOverlay.classList.add('hidden');
  }
}

// --------- Save-as flow ---------
async function saveTileAs(tile) {
  try {
    const saved = await window.api.dialog.saveDataUrlAs({
      dataUrl: tile.src,
      defaultName: tile.name || 'image',
    });
    if (saved) toast('Saved', 'ok');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Save failed', 'err');
  }
}

// --------- Remove background flow ---------
async function runRemoveBg(tile) {
  if (state.busy) return;
  state.busy = true;
  updateBusy('Removing background…');
  renderSidebar();
  window.appState?.incrementJobs?.();
  try {
    const res = await window.api.fal.run({
      modelId: REMBG_MODEL_ID,
      input: { image_url: tile.src },
      saveFolder: state.saveFolder || '',
    });
    const saved = ((res && res.saved) || []).filter((s) => !s.error);
    if (!saved.length) throw new Error('Remove BG returned no files');
    const first = saved[0];
    const dataUrl = await window.api.library.readAsDataUrl(first.folder, first.name);
    if (!dataUrl) throw new Error('Could not load output');
    await addTileAdjacent(tile, {
      src: dataUrl,
      name: first.name,
      libRef: { folder: first.folder, name: first.name },
      kind: 'raster',
    });
    toast('Background removed', 'ok');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Remove BG failed', 'err');
  } finally {
    state.busy = false;
    window.appState?.decrementJobs?.();
    updateBusy();
    renderSidebar();
  }
}

// --------- Remove text flow ---------
async function runRemoveText(tile) {
  if (state.busy) return;
  state.busy = true;
  updateBusy('Removing text…');
  renderSidebar();
  window.appState?.incrementJobs?.();
  try {
    const res = await window.api.fal.run({
      modelId: REMOVE_TEXT_MODEL_ID,
      input: { image_url: tile.src },
      saveFolder: state.saveFolder || '',
    });
    const saved = ((res && res.saved) || []).filter((s) => !s.error);
    if (!saved.length) throw new Error('Remove text returned no files');
    const first = saved[0];
    const dataUrl = await window.api.library.readAsDataUrl(first.folder, first.name);
    if (!dataUrl) throw new Error('Could not load output');
    await addTileAdjacent(tile, {
      src: dataUrl,
      name: first.name,
      libRef: { folder: first.folder, name: first.name },
      kind: 'raster',
    });
    toast('Text removed', 'ok');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Remove text failed', 'err');
  } finally {
    state.busy = false;
    window.appState?.decrementJobs?.();
    updateBusy();
    renderSidebar();
  }
}

// --------- Upscale flow ---------
async function runUpscale(tile) {
  if (state.busy) return;
  state.busy = true;
  updateBusy('Upscaling…');
  renderSidebar();
  window.appState?.incrementJobs?.();
  try {
    const res = await window.api.fal.run({
      modelId: UPSCALE_MODEL_ID,
      input: { image_url: tile.src },
      saveFolder: state.saveFolder || '',
    });
    const saved = ((res && res.saved) || []).filter((s) => !s.error);
    if (!saved.length) throw new Error('Upscale returned no files');
    const first = saved[0];
    const dataUrl = await window.api.library.readAsDataUrl(first.folder, first.name);
    if (!dataUrl) throw new Error('Could not load output');
    await addTileAdjacent(tile, {
      src: dataUrl,
      name: first.name,
      libRef: { folder: first.folder, name: first.name },
      kind: 'raster',
    });
    toast('Upscaled', 'ok');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Upscale failed', 'err');
  } finally {
    state.busy = false;
    window.appState?.decrementJobs?.();
    updateBusy();
    renderSidebar();
  }
}

// --------- Rasterize flow (non-AI, client-side canvas) ---------
// Load an SVG data URL into an <img>, draw it onto a canvas, and export as PNG.
// SVGs without intrinsic dimensions are rasterized at TARGET_LONG_EDGE.
async function rasterizeSvgToPng(src, targetLongEdge = 2048) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || img.width || 0;
      let h = img.naturalHeight || img.height || 0;
      if (!w || !h) {
        w = targetLongEdge;
        h = targetLongEdge;
      } else {
        const longest = Math.max(w, h);
        const scale = targetLongEdge / longest;
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Failed to load SVG'));
    img.src = src;
  });
}

async function runRasterize(tile) {
  if (state.busy) return;
  state.busy = true;
  updateBusy('Rasterizing…');
  renderSidebar();
  try {
    const pngDataUrl = await rasterizeSvgToPng(tile.src);
    const baseName = (tile.name || 'image').replace(/\.svg$/i, '');
    const desiredName = `${baseName}.png`;
    const ref = await window.api.library.saveDataUrl(
      state.saveFolder || '',
      desiredName,
      pngDataUrl
    );
    await addTileAdjacent(tile, {
      src: pngDataUrl,
      name: ref?.name || desiredName,
      libRef: ref ? { folder: ref.folder, name: ref.name } : undefined,
      kind: 'raster',
    });
    toast('Rasterized', 'ok');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Rasterize failed', 'err');
  } finally {
    state.busy = false;
    updateBusy();
    renderSidebar();
  }
}

// --------- Vectorize flow ---------
async function runVectorize(tile) {
  if (state.busy) return;
  state.busy = true;
  updateBusy('Vectorizing…');
  renderSidebar();
  window.appState?.incrementJobs?.();
  try {
    const res = await window.api.fal.run({
      modelId: VECTORIZE_MODEL_ID,
      input: { image_url: tile.src },
      saveFolder: state.saveFolder || '',
    });
    const saved = ((res && res.saved) || []).filter((s) => !s.error);
    if (!saved.length) throw new Error('Vectorize returned no files');
    const first = saved[0];
    const dataUrl = await window.api.library.readAsDataUrl(first.folder, first.name);
    if (!dataUrl) throw new Error('Could not load vectorized output');
    await addTileAdjacent(tile, {
      src: dataUrl,
      name: first.name,
      libRef: { folder: first.folder, name: first.name },
      kind: 'vector',
    });
    toast('Vectorized', 'ok');
  } catch (e) {
    console.error(e);
    toast(e.message || 'Vectorize failed', 'err');
  } finally {
    state.busy = false;
    window.appState?.decrementJobs?.();
    updateBusy();
    renderSidebar();
  }
}

// --------- Model-on-tile sub-page (used by Remix and Edit) ---------
async function findModelById(modelId) {
  const list = await getModels();
  return list.find((m) => m.id === modelId) || null;
}

async function openRemixSubPage(tile) {
  return openModelSubPage(tile, REMIX_MODEL_ID, 'Remix');
}

async function openEditSubPage(tile) {
  return openModelSubPage(tile, EDIT_MODEL_ID, 'Edit');
}

async function openReframeSubPage(tile) {
  return openModelSubPage(tile, REFRAME_MODEL_ID, 'Reframe');
}

async function openModelSubPage(tile, modelId, title) {
  if (state.busy) return;
  const model = await findModelById(modelId);
  if (!model) {
    toast(`${title} model not configured`, 'err');
    return;
  }
  state.subPage = 'remix';
  state.remix.model = model;
  state.remix.title = title;
  state.remix.sourceTileId = tile.id;
  // Pre-fill whichever image input the model exposes with the source tile.
  // Single-image inputs get the data URL; array inputs get a 1-element array.
  const inputs = {};
  const localFiles = {};
  const label = tile.name || 'selected tile';
  for (const inp of model.inputs || []) {
    if (inp.type === 'image') {
      inputs[inp.name] = tile.src;
      localFiles[inp.name] = label;
      break;
    }
    if (inp.type === 'image_array') {
      inputs[inp.name] = [tile.src];
      localFiles[inp.name] = [label];
      break;
    }
  }
  state.remix.formState = { inputs, localFiles };
  await renderEditorPage(refs.root);
}

async function closeRemixSubPage() {
  state.subPage = null;
  state.remix.model = null;
  state.remix.title = 'Remix';
  state.remix.sourceTileId = null;
  state.remix.formState = { inputs: {}, localFiles: {} };
  await renderEditorPage(refs.root);
}

function renderRemixSubPage() {
  const model = state.remix.model;
  const title = state.remix.title || 'Remix';
  const sourceTile = state.tiles.find((t) => t.id === state.remix.sourceTileId);
  const wrap = el(`
    <div class="editor-subpage">
      <div class="editor-subpage-header">
        <button class="btn" id="remix-back">← Back</button>
        <h1 style="margin:0;">${esc(title)}</h1>
        <span class="tag" style="margin-left:8px;">${esc(model.id)}</span>
      </div>
      <div class="editor-subpage-body">
        <div class="panel">
          <div class="panel-title">Source</div>
          <div class="editor-remix-source">
            <div class="editor-remix-source-img"></div>
            <div class="editor-remix-source-meta">
              <div class="name">${esc(sourceTile?.name || 'selected tile')}</div>
              <div class="desc">${esc(model.description || '')}</div>
            </div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-title">Inputs</div>
          <div id="remix-form"></div>
          <button class="btn primary" id="remix-run" style="margin-top:6px;">${
            state.busy
              ? '<span class="spinner"></span> Running…'
              : `Run ${esc(title.toLowerCase())}`
          }</button>
        </div>
      </div>
    </div>
  `);

  if (sourceTile) {
    const holder = wrap.querySelector('.editor-remix-source-img');
    const img = document.createElement('img');
    img.src = sourceTile.src;
    img.alt = sourceTile.name || '';
    holder.appendChild(img);
  }

  const form = wrap.querySelector('#remix-form');
  for (const input of model.inputs || []) {
    form.appendChild(buildField(input, state.remix.formState));
  }

  const runBtn = wrap.querySelector('#remix-run');
  runBtn.disabled = state.busy;
  wrap.querySelector('#remix-back').addEventListener('click', () => closeRemixSubPage());
  runBtn.addEventListener('click', () => runRemix());

  return wrap;
}

async function runRemix() {
  if (state.busy) return;
  const model = state.remix.model;
  const sourceTile = state.tiles.find((t) => t.id === state.remix.sourceTileId);
  if (!model || !sourceTile) return;

  let input;
  try {
    input = collectInputs(model, state.remix.formState);
  } catch (e) {
    toast(e.message || 'Invalid form', 'err');
    return;
  }

  state.busy = true;
  // Re-render the sub-page so the run button picks up the busy state.
  const root = refs.root;
  root.innerHTML = '';
  root.appendChild(renderRemixSubPage());
  window.appState?.incrementJobs?.();
  try {
    const res = await window.api.fal.run({
      modelId: model.id,
      input,
      saveFolder: state.saveFolder || '',
    });
    const saved = ((res && res.saved) || []).filter((s) => !s.error);
    if (!saved.length) throw new Error(`${state.remix.title} returned no files`);

    // Load all outputs in parallel before touching the DOM.
    const dataUrls = await Promise.all(
      saved.map((f) => window.api.library.readAsDataUrl(f.folder, f.name))
    );

    // Return to the main editor view and drop in the new tiles.
    state.subPage = null;
    state.busy = false;
    await renderEditorPage(root);

    for (let i = 0; i < saved.length; i++) {
      const dataUrl = dataUrls[i];
      if (!dataUrl) continue;
      // eslint-disable-next-line no-await-in-loop
      await addTileAdjacent(sourceTile, {
        src: dataUrl,
        name: saved[i].name,
        libRef: { folder: saved[i].folder, name: saved[i].name },
        stackIndex: i,
      });
    }
    toast(
      `${state.remix.title} saved ${saved.length} file${saved.length === 1 ? '' : 's'}`,
      'ok'
    );
  } catch (e) {
    console.error(e);
    toast(e.message || `${state.remix.title} failed`, 'err');
    state.busy = false;
    // Stay on the sub-page but re-render so the run button is re-enabled.
    root.innerHTML = '';
    root.appendChild(renderRemixSubPage());
  } finally {
    window.appState?.decrementJobs?.();
  }
}
