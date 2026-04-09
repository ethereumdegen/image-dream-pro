// Simple modal prompt/confirm replacements. Electron/Chromium doesn't ship
// a working window.prompt() and window.confirm() varies by platform, so we
// render our own.

function ensureLayer() {
  let layer = document.getElementById('modal-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'modal-layer';
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0,0,0,0.5)',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '10000',
    });
    document.body.appendChild(layer);
  }
  return layer;
}

export function promptModal({ title = 'Input', label = '', defaultValue = '', placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const layer = ensureLayer();
    layer.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText =
      'background:#1a1f2a;border:1px solid #272d3b;border-radius:10px;padding:18px;min-width:360px;max-width:90vw;box-shadow:0 10px 30px rgba(0,0,0,0.4);color:#e8ecf4;font-family:inherit;';
    box.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(title)}</div>
      <div style="color:#8a93a6;font-size:12px;margin-bottom:10px;">${escapeHtml(label)}</div>
      <input type="text" class="modal-input" style="width:100%;background:#1d2230;color:#e8ecf4;border:1px solid #272d3b;border-radius:8px;padding:9px 10px;font-size:14px;outline:none;" />
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button class="btn cancel-btn" style="background:#1d2230;border:1px solid #272d3b;color:#e8ecf4;padding:8px 14px;border-radius:8px;cursor:pointer;">Cancel</button>
        <button class="btn ok-btn" style="background:linear-gradient(135deg,#7c5cff,#5b8cff);border:1px solid transparent;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600;">OK</button>
      </div>
    `;
    layer.appendChild(box);
    layer.style.display = 'flex';
    const input = box.querySelector('.modal-input');
    input.value = defaultValue;
    input.placeholder = placeholder;
    input.focus();
    input.select();
    const close = (val) => {
      layer.style.display = 'none';
      layer.innerHTML = '';
      resolve(val);
    };
    box.querySelector('.cancel-btn').addEventListener('click', () => close(null));
    box.querySelector('.ok-btn').addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value);
      if (e.key === 'Escape') close(null);
    });
  });
}

export function confirmModal({ title = 'Confirm', message = '', okLabel = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    const layer = ensureLayer();
    layer.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText =
      'background:#1a1f2a;border:1px solid #272d3b;border-radius:10px;padding:18px;min-width:360px;max-width:90vw;box-shadow:0 10px 30px rgba(0,0,0,0.4);color:#e8ecf4;font-family:inherit;';
    box.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(title)}</div>
      <div style="color:#8a93a6;font-size:13px;margin-bottom:14px;line-height:1.5;">${escapeHtml(message)}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn cancel-btn" style="background:#1d2230;border:1px solid #272d3b;color:#e8ecf4;padding:8px 14px;border-radius:8px;cursor:pointer;">Cancel</button>
        <button class="btn ok-btn" style="background:${
          danger ? '#ff5c7a' : 'linear-gradient(135deg,#7c5cff,#5b8cff)'
        };border:1px solid transparent;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font-weight:600;">${escapeHtml(okLabel)}</button>
      </div>
    `;
    layer.appendChild(box);
    layer.style.display = 'flex';
    const close = (val) => {
      layer.style.display = 'none';
      layer.innerHTML = '';
      resolve(val);
    };
    box.querySelector('.cancel-btn').addEventListener('click', () => close(false));
    box.querySelector('.ok-btn').addEventListener('click', () => close(true));
    box.querySelector('.ok-btn').focus();
  });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
