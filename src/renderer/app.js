import { renderModelsPage } from './pages/models.js';
import { renderLibraryPage } from './pages/library.js';
import { renderSettingsPage } from './pages/settings.js';
import { renderEditorPage } from './pages/editor.js';
import { toast } from './toast.js';

const pages = {
  editor: { el: document.getElementById('page-editor'), render: renderEditorPage, rendered: false },
  models: { el: document.getElementById('page-models'), render: renderModelsPage, rendered: false },
  library: {
    el: document.getElementById('page-library'),
    render: renderLibraryPage,
    rendered: false,
  },
  settings: {
    el: document.getElementById('page-settings'),
    render: renderSettingsPage,
    rendered: false,
  },
};

async function showPage(name) {
  Object.values(pages).forEach((p) => p.el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${name}"]`)?.classList.add('active');
  pages[name].el.classList.add('active');
  // Re-render library and editor each visit so file list is fresh.
  if (name === 'library' || name === 'editor' || !pages[name].rendered) {
    try {
      await pages[name].render(pages[name].el);
      pages[name].rendered = true;
    } catch (e) {
      console.error(e);
      toast(e.message || String(e), 'err');
    }
  }
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed';
function applySidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const btn = document.getElementById('sidebar-toggle');
  if (btn) {
    btn.innerHTML = collapsed ? '&raquo;' : '&laquo;';
    btn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  }
}
applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1');
document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  const next = !document.body.classList.contains('sidebar-collapsed');
  applySidebarCollapsed(next);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
});

async function refreshApiKeyStatus() {
  const s = await window.api.settings.get();
  const pill = document.getElementById('api-key-status');
  if (s.falApiKey && s.falApiKey.trim()) {
    pill.textContent = 'API key set';
    pill.classList.add('ok');
    pill.classList.remove('warn');
  } else {
    pill.textContent = 'No API key';
    pill.classList.add('warn');
    pill.classList.remove('ok');
  }
}

let activeJobs = 0;
function renderActiveJobsPill() {
  const pill = document.getElementById('active-jobs-status');
  if (!pill) return;
  if (activeJobs <= 0) {
    pill.textContent = 'Idle';
    pill.classList.remove('busy');
  } else {
    pill.innerHTML = '';
    const spinner = document.createElement('span');
    spinner.className = 'mini-spinner';
    const label = document.createElement('span');
    label.textContent = `${activeJobs} job${activeJobs === 1 ? '' : 's'}`;
    pill.appendChild(spinner);
    pill.appendChild(label);
    pill.classList.add('busy');
  }
}
function incrementJobs() {
  activeJobs += 1;
  renderActiveJobsPill();
}
function decrementJobs() {
  activeJobs = Math.max(0, activeJobs - 1);
  renderActiveJobsPill();
}

window.appState = {
  refreshApiKeyStatus,
  showPage,
  incrementJobs,
  decrementJobs,
  getActiveJobs: () => activeJobs,
};

// Stop the browser from navigating when files are dropped outside a valid
// drop target (e.g. the editor canvas). Individual drop targets still
// handle their own drop events.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

async function loadAppVersion() {
  const badge = document.getElementById('brand-version');
  if (!badge) return;
  try {
    const version = await window.api.app.getVersion();
    badge.textContent = `v${version}`;
  } catch {
    badge.textContent = '';
  }
}

(async function init() {
  await refreshApiKeyStatus();
  await loadAppVersion();
  await showPage('models');
})();
