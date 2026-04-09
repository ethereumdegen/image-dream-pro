import { toast } from '../toast.js';
import { promptModal, confirmModal } from '../dialog.js';

let state = {
  folders: [],
  selectedFolder: '',
  files: [],
};

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function renderLibraryPage(root) {
  state.folders = await window.api.library.listFolders();
  if (!state.folders.includes(state.selectedFolder)) {
    state.selectedFolder = '';
  }
  state.files = await window.api.library.listFiles(state.selectedFolder);

  root.innerHTML = '';
  root.appendChild(
    el(`
    <div class="page-header">
      <div>
        <h1>Media Library</h1>
        <div class="subtitle">All your imported and generated media lives here. Folders are real folders on disk.</div>
      </div>
      <div>
        <button class="btn" id="open-in-finder">Open current folder</button>
      </div>
    </div>
  `)
  );

  const grid = el(`<div class="library-grid"></div>`);

  // Folder tree
  const tree = el(`
    <div class="folder-tree">
      <div class="tree-header">
        <div style="font-weight:600;">Folders</div>
        <button class="btn btn-sm" id="new-folder">New</button>
      </div>
      <div id="folder-list"></div>
    </div>
  `);
  grid.appendChild(tree);

  // Files panel
  const panel = el(`
    <div class="library-panel">
      <div class="library-toolbar">
        <div>
          <div class="title" id="current-folder-title"></div>
          <div class="path-hint" id="current-folder-path"></div>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn primary" id="add-images">Add images…</button>
          <button class="btn" id="refresh-lib">Refresh</button>
        </div>
      </div>
      <div id="files-grid"></div>
    </div>
  `);
  grid.appendChild(panel);
  root.appendChild(grid);

  const paths = await window.api.settings.paths();
  panel.querySelector('#current-folder-path').textContent = `${paths.currentLibrary}${
    state.selectedFolder ? `/${state.selectedFolder}` : ''
  }`;

  renderFolderList();
  renderFilesGrid();

  tree.querySelector('#new-folder').addEventListener('click', async () => {
    const name = await promptModal({
      title: 'New folder',
      label: 'Folder path (supports subfolders e.g. "projects/winter"):',
      defaultValue: state.selectedFolder ? `${state.selectedFolder}/new-folder` : 'new-folder',
    });
    if (!name) return;
    try {
      await window.api.library.createFolder(name);
      state.folders = await window.api.library.listFolders();
      state.selectedFolder = name.replace(/^[\\/]+/, '');
      state.files = await window.api.library.listFiles(state.selectedFolder);
      renderFolderList();
      renderFilesGrid();
      updatePathHint();
    } catch (e) {
      toast(e.message, 'err');
    }
  });

  panel.querySelector('#add-images').addEventListener('click', async () => {
    const srcs = await window.api.dialog.pickImages();
    if (!srcs || !srcs.length) return;
    const results = await window.api.library.importFiles(state.selectedFolder, srcs);
    const ok = results.filter((r) => r.ok).length;
    toast(`Imported ${ok} of ${srcs.length}`, ok === srcs.length ? 'ok' : 'err');
    state.files = await window.api.library.listFiles(state.selectedFolder);
    renderFilesGrid();
  });

  panel.querySelector('#refresh-lib').addEventListener('click', async () => {
    state.folders = await window.api.library.listFolders();
    state.files = await window.api.library.listFiles(state.selectedFolder);
    renderFolderList();
    renderFilesGrid();
  });

  root.querySelector('#open-in-finder').addEventListener('click', () => {
    window.api.library.openFolder(state.selectedFolder);
  });

  function updatePathHint() {
    panel.querySelector('#current-folder-path').textContent = `${paths.currentLibrary}${
      state.selectedFolder ? `/${state.selectedFolder}` : ''
    }`;
  }

  function renderFolderList() {
    const list = tree.querySelector('#folder-list');
    list.innerHTML = '';
    for (const f of state.folders) {
      const depth = f === '' ? 0 : f.split('/').length;
      const label = f === '' ? '(root)' : f.split('/').pop();
      const item = el(`
        <div class="folder-item" style="padding-left:${8 + depth * 12}px;">
          <span class="name">${esc(label)}</span>
          ${f === '' ? '' : '<button class="del" title="Delete">Delete</button>'}
        </div>
      `);
      if (f === state.selectedFolder) item.classList.add('selected');
      item.addEventListener('click', async (ev) => {
        if (ev.target && ev.target.classList.contains('del')) return;
        state.selectedFolder = f;
        state.files = await window.api.library.listFiles(f);
        renderFolderList();
        renderFilesGrid();
        updatePathHint();
      });
      const delBtn = item.querySelector('.del');
      if (delBtn) {
        delBtn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const ok = await confirmModal({
            title: 'Delete folder?',
            message: `Delete folder "${f}" and everything inside it? This cannot be undone.`,
            okLabel: 'Delete',
            danger: true,
          });
          if (!ok) return;
          try {
            await window.api.library.deleteFolder(f);
            state.folders = await window.api.library.listFolders();
            if (state.selectedFolder.startsWith(f)) state.selectedFolder = '';
            state.files = await window.api.library.listFiles(state.selectedFolder);
            renderFolderList();
            renderFilesGrid();
            updatePathHint();
          } catch (e) {
            toast(e.message, 'err');
          }
        });
      }
      list.appendChild(item);
    }
    panel.querySelector('#current-folder-title').textContent =
      state.selectedFolder === '' ? 'All media (root)' : state.selectedFolder;
  }

  function renderFilesGrid() {
    const fg = panel.querySelector('#files-grid');
    fg.innerHTML = '';
    if (!state.files.length) {
      fg.appendChild(
        el(
          '<div class="library-empty">This folder is empty. Click "Add images…" to import some, or run a model on the Models page.</div>'
        )
      );
      return;
    }
    const innerGrid = el('<div class="results-grid"></div>');
    fg.appendChild(innerGrid);
    for (const file of state.files) {
      const box = el(`
        <div class="file-item">
          <div class="media-holder"></div>
          <div class="info">
            <span class="name" title="${esc(file.name)}">${esc(file.name)}</span>
            <span style="display:flex; gap:4px;">
              <button class="btn btn-sm" data-act="reveal">Open</button>
              <button class="btn btn-sm danger" data-act="delete">×</button>
            </span>
          </div>
        </div>
      `);
      const holder = box.querySelector('.media-holder');
      window.api.library
        .readAsDataUrl(file.folder, file.name)
        .then((data) => {
          if (!data) return;
          if (file.kind === 'video') {
            const v = document.createElement('video');
            v.src = data;
            v.muted = true;
            v.controls = true;
            holder.appendChild(v);
          } else {
            const img = document.createElement('img');
            img.src = data;
            holder.appendChild(img);
          }
        })
        .catch(() => {});
      box.querySelector('[data-act="reveal"]').addEventListener('click', () => {
        window.api.library.revealInFolder(file.folder, file.name);
      });
      box.querySelector('[data-act="delete"]').addEventListener('click', async () => {
        const ok = await confirmModal({
          title: 'Delete file?',
          message: `Delete ${file.name}? This cannot be undone.`,
          okLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        try {
          await window.api.library.deleteFile(file.folder, file.name);
          state.files = await window.api.library.listFiles(state.selectedFolder);
          renderFilesGrid();
        } catch (e) {
          toast(e.message, 'err');
        }
      });
      innerGrid.appendChild(box);
    }
  }
}
