import { toast } from '../toast.js';
import { promptModal } from '../dialog.js';
import { buildField, collectInputs } from '../components/modelForm.js';
import { el, esc } from '../components/dom.js';

let state = {
  models: [],
  selectedId: null,
  inputs: {}, // name -> value
  localFiles: {}, // name -> absolute local path (for image fields)
  running: false,
  saveFolder: '',
  folders: [''],
  lastResult: null,
  starredIds: new Set(),
};

export async function renderModelsPage(root) {
  if (!state.models.length) {
    state.models = await window.api.models.list();
    const settings = await window.api.settings.get();
    state.selectedId = settings.lastModelId || state.models[0]?.id || null;
    state.saveFolder = settings.lastFolder || '';
    state.starredIds = new Set(settings.starredModelIds || []);
  }
  state.folders = await window.api.library.listFolders();

  root.innerHTML = '';
  root.appendChild(
    el(`
    <div class="page-header">
      <div>
        <h1>Models</h1>
        <div class="subtitle">Pick a fal.ai model, configure its inputs, and run it. Results are saved to your library.</div>
      </div>
    </div>
  `)
  );

  const grid = el(`<div class="models-grid"></div>`);
  const list = el(`<div class="panel model-list-panel">
      <div class="panel-title">Available models</div>
      <div class="model-list"></div>
    </div>`);
  const detail = el(`<div class="panel model-detail"></div>`);
  grid.appendChild(list);
  grid.appendChild(detail);
  root.appendChild(grid);

  const listEl = list.querySelector('.model-list');

  function sortedModels() {
    return [...state.models].sort((a, b) => {
      const aStar = state.starredIds.has(a.id) ? 0 : 1;
      const bStar = state.starredIds.has(b.id) ? 0 : 1;
      if (aStar !== bStar) return aStar - bStar;
      return 0;
    });
  }

  async function toggleStar(id) {
    if (state.starredIds.has(id)) state.starredIds.delete(id);
    else state.starredIds.add(id);
    await window.api.settings.set({ starredModelIds: [...state.starredIds] });
    renderList();
  }

  function renderList() {
    listEl.innerHTML = '';
    for (const m of sortedModels()) {
      const starred = state.starredIds.has(m.id);
      const card = el(`
        <div class="model-card${m.id === state.selectedId ? ' selected' : ''}" data-id="${esc(m.id)}">
          <button class="star-btn${starred ? ' starred' : ''}" title="${starred ? 'Unstar' : 'Star'}" aria-label="${starred ? 'Unstar model' : 'Star model'}">${starred ? '★' : '☆'}</button>
          <div class="model-card-body">
            <div class="title">${esc(m.name)}</div>
            <div class="meta">
              <span class="tag">${esc(m.category)}</span>
              <span>${esc(m.id)}</span>
            </div>
          </div>
        </div>
      `);
      card.addEventListener('click', async (e) => {
        if (e.target.closest('.star-btn')) return;
        state.selectedId = m.id;
        state.inputs = {};
        state.localFiles = {};
        await window.api.settings.set({ lastModelId: m.id });
        renderList();
        renderDetail();
      });
      card.querySelector('.star-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleStar(m.id);
      });
      listEl.appendChild(card);
    }
  }

  function currentModel() {
    return state.models.find((m) => m.id === state.selectedId) || state.models[0];
  }

  function renderDetail() {
    const m = currentModel();
    if (!m) {
      detail.innerHTML = '<div class="subtitle">No models configured.</div>';
      return;
    }
    detail.innerHTML = '';
    detail.appendChild(
      el(`
      <div>
        <h2 style="color:var(--text); font-size: 18px; margin-bottom:6px;">${esc(m.name)}</h2>
        <div class="description">${esc(m.description || '')}</div>
        <div style="margin-bottom:14px;">
          <span class="tag">${esc(m.category)}</span>
          <span class="tag">in: ${esc((m.inputMedia || []).join(',') || 'text')}</span>
          <span class="tag">out: ${esc((m.outputMedia || []).join(','))}</span>
          <span style="color:var(--muted); font-size:11px; margin-left:6px;">${esc(m.id)}</span>
        </div>
      </div>
    `)
    );

    const form = el('<div></div>');
    for (const input of m.inputs || []) {
      form.appendChild(buildField(input, state));
    }

    // Save folder selector
    const folderRow = el(`
      <label class="field">
        <span class="label">Save results to folder</span>
        <div class="row" style="gap:8px;">
          <select id="save-folder-select" style="flex:2"></select>
          <button class="btn" id="new-folder-btn" style="flex:0 0 auto;">New folder</button>
        </div>
      </label>
    `);
    form.appendChild(folderRow);

    const runBtn = el(`<button class="btn primary" style="margin-top:6px;">${
      state.running ? '<span class="spinner"></span> Running…' : 'Run model'
    }</button>`);
    runBtn.disabled = state.running;
    runBtn.addEventListener('click', () => runModel());
    form.appendChild(runBtn);

    detail.appendChild(form);

    // Populate folder select
    const sel = form.querySelector('#save-folder-select');
    for (const f of state.folders) {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f === '' ? '(root)' : f;
      if (f === state.saveFolder) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', async () => {
      state.saveFolder = sel.value;
      await window.api.settings.set({ lastFolder: sel.value });
    });
    form.querySelector('#new-folder-btn').addEventListener('click', async () => {
      const name = await promptModal({
        title: 'New folder',
        label: 'Folder path (e.g. "renders/flux")',
        defaultValue: 'renders/flux',
      });
      if (!name) return;
      await window.api.library.createFolder(name);
      state.folders = await window.api.library.listFolders();
      state.saveFolder = name.replace(/^[\\/]+/, '');
      renderDetail();
    });

    // Results area
    const resultsPanel = el(`
      <div class="panel" style="margin-top:18px;">
        <div class="panel-title">Last run output</div>
        <div class="results-grid" id="results-grid"></div>
        <div id="results-empty" class="library-empty" style="padding:22px;">No runs yet.</div>
      </div>
    `);
    detail.appendChild(resultsPanel);
    renderResults();
  }

  function renderResults() {
    const grid = detail.querySelector('#results-grid');
    const empty = detail.querySelector('#results-empty');
    if (!grid) return;
    grid.innerHTML = '';
    const saved = state.lastResult?.saved || [];
    if (!saved.length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    for (const item of saved) {
      if (item.error) continue;
      const box = el(`
        <div class="result-item">
          <div class="media-holder"></div>
          <div class="info">
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(
              item.name
            )}</span>
            <button class="btn btn-sm">Reveal</button>
          </div>
        </div>
      `);
      const holder = box.querySelector('.media-holder');
      window.api.library
        .readAsDataUrl(item.folder, item.name)
        .then((data) => {
          if (!data) return;
          const ext = item.name.toLowerCase().split('.').pop();
          if (['mp4', 'webm', 'mov', 'mkv'].includes(ext)) {
            const v = document.createElement('video');
            v.src = data;
            v.controls = true;
            holder.appendChild(v);
          } else {
            const img = document.createElement('img');
            img.src = data;
            holder.appendChild(img);
          }
        })
        .catch(() => {});
      box.querySelector('button').addEventListener('click', () => {
        window.api.library.revealInFolder(item.folder, item.name);
      });
      grid.appendChild(box);
    }
  }

  async function runModel() {
    const m = currentModel();
    if (!m) return;
    let input;
    try {
      input = collectInputs(m, state);
    } catch (e) {
      toast(e.message || 'Invalid form', 'err');
      return;
    }

    state.running = true;
    window.appState?.incrementJobs?.();
    renderDetail();
    try {
      const res = await window.api.fal.run({
        modelId: m.id,
        input,
        saveFolder: state.saveFolder,
      });
      state.lastResult = res;
      const savedCount = (res.saved || []).filter((x) => !x.error).length;
      toast(`Saved ${savedCount} file${savedCount === 1 ? '' : 's'} to library`, 'ok');
      // Refresh library page next time it's opened
      window.appState?.showPage && (window.appState.__libraryDirty = true);
    } catch (e) {
      console.error(e);
      toast(e.message || 'Run failed', 'err');
    } finally {
      state.running = false;
      window.appState?.decrementJobs?.();
      renderDetail();
    }
  }

  renderList();
  renderDetail();
}
