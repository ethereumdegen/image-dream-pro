import { toast } from '../toast.js';

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

export async function renderSettingsPage(root) {
  const settings = await window.api.settings.get();
  const paths = await window.api.settings.paths();

  root.innerHTML = '';
  root.appendChild(
    el(`
    <div class="page-header">
      <div>
        <h1>Settings</h1>
        <div class="subtitle">Your fal.ai API key is stored only on this machine.</div>
      </div>
    </div>
  `)
  );

  const panel = el(`
    <div class="panel settings-form">
      <div class="panel-title">fal.ai credentials</div>
      <label class="field">
        <span class="label">fal.ai API key</span>
        <div class="row" style="gap:6px;">
          <input type="password" id="api-key" value="${esc(settings.falApiKey || '')}" placeholder="Paste your fal.ai API key" style="flex:3" />
          <button class="btn" id="toggle-visibility" style="flex:0 0 auto;">Show</button>
        </div>
      </label>
      <div class="fal-credits" id="fal-credits">
        <span class="credits-label">FAL credits:</span>
        <span class="credits-value" id="credits-value">—</span>
        <button class="btn btn-sm" id="refresh-credits">Refresh</button>
      </div>
      <div style="display:flex; gap:8px; align-items:center;">
        <button class="btn primary" id="save-api-key">Save API key</button>
        <a class="lime-link" href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">Get a key at fal.ai →</a>
      </div>
    </div>
  `);
  root.appendChild(panel);

  const libPanel = el(`
    <div class="panel settings-form">
      <div class="panel-title">Media library location</div>
      <div class="path-block" id="current-library">${esc(settings.libraryPath)}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn" id="choose-library">Choose new location…</button>
        <button class="btn" id="reset-library">Reset to default</button>
        <button class="btn" id="open-library">Open in file manager</button>
      </div>
      <div class="path-block" style="margin-top:10px;">
        <div><strong>User data dir:</strong> ${esc(paths.userData)}</div>
        <div><strong>Default library:</strong> ${esc(paths.defaultLibrary)}</div>
      </div>
    </div>
  `);
  root.appendChild(libPanel);

  const aboutPanel = el(`
    <div class="panel settings-form">
      <div class="panel-title">About</div>
      <div style="color:var(--muted); font-size:13px; line-height:1.6;">
        Image Dream Pro — run fal.ai models and manage a local media library.<br/>
        Models available in the app are defined in <code>src/main/models.json</code>. Edit that file to add or modify models.<br/>
        Output files are saved automatically to the selected folder inside your media library.
      </div>
    </div>
  `);
  root.appendChild(aboutPanel);

  const keyInput = panel.querySelector('#api-key');
  const creditsValue = panel.querySelector('#credits-value');
  const refreshCreditsBtn = panel.querySelector('#refresh-credits');

  async function loadCredits() {
    creditsValue.title = '';
    if (!keyInput.value.trim()) {
      creditsValue.textContent = 'No API key';
      creditsValue.classList.remove('ok', 'err');
      return;
    }
    creditsValue.textContent = 'Loading…';
    creditsValue.classList.remove('ok', 'err');
    try {
      const res = await window.api.fal.getBilling();
      if (res && res.ok) {
        const c = res.data && res.data.credits;
        if (c && typeof c.current_balance === 'number') {
          const amount = c.current_balance.toFixed(2);
          const currency = c.currency || 'USD';
          creditsValue.textContent = `${amount} ${currency}`;
          creditsValue.classList.add('ok');
        } else {
          creditsValue.textContent = 'Unavailable';
        }
        return;
      }
      if (res && res.code === 'ADMIN_KEY_REQUIRED') {
        creditsValue.textContent = 'Requires ADMIN key';
        creditsValue.title =
          'fal.ai only exposes billing to ADMIN-scoped keys. Create one at https://fal.ai/dashboard/keys to view credits here.';
        creditsValue.classList.add('err');
        return;
      }
      creditsValue.textContent = 'Error';
      creditsValue.title = (res && res.message) || 'Unknown error';
      creditsValue.classList.add('err');
    } catch (e) {
      creditsValue.textContent = 'Error';
      creditsValue.title = e.message || String(e);
      creditsValue.classList.add('err');
    }
  }

  panel.querySelector('#toggle-visibility').addEventListener('click', (ev) => {
    if (keyInput.type === 'password') {
      keyInput.type = 'text';
      ev.target.textContent = 'Hide';
    } else {
      keyInput.type = 'password';
      ev.target.textContent = 'Show';
    }
  });
  panel.querySelector('#save-api-key').addEventListener('click', async () => {
    await window.api.settings.set({ falApiKey: keyInput.value.trim() });
    await window.appState.refreshApiKeyStatus();
    toast('API key saved', 'ok');
    loadCredits();
  });
  refreshCreditsBtn.addEventListener('click', loadCredits);

  loadCredits();

  libPanel.querySelector('#choose-library').addEventListener('click', async () => {
    const dir = await window.api.dialog.pickDirectory();
    if (!dir) return;
    const updated = await window.api.settings.set({ libraryPath: dir });
    libPanel.querySelector('#current-library').textContent = updated.libraryPath;
    toast('Library location updated', 'ok');
  });
  libPanel.querySelector('#reset-library').addEventListener('click', async () => {
    const updated = await window.api.settings.set({ libraryPath: paths.defaultLibrary });
    libPanel.querySelector('#current-library').textContent = updated.libraryPath;
    toast('Library location reset to default', 'ok');
  });
  libPanel.querySelector('#open-library').addEventListener('click', () => {
    window.api.library.openFolder('');
  });
}
