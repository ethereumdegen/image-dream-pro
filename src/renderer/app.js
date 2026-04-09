import { renderModelsPage } from './pages/models.js';
import { renderLibraryPage } from './pages/library.js';
import { renderSettingsPage } from './pages/settings.js';
import { toast } from './toast.js';

const pages = {
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
  // Re-render library each visit so file list is fresh.
  if (name === 'library' || !pages[name].rendered) {
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

(async function init() {
  await refreshApiKeyStatus();
  await showPage('models');
})();
