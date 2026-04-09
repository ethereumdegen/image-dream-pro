let timer = null;
export function toast(msg, kind = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast';
  if (kind) el.classList.add(kind);
  el.classList.remove('hidden');
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => el.classList.add('hidden'), 3500);
}
