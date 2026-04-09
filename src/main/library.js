const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Files considered "media" for listing in the library grid.
const MEDIA_EXTS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.svg',
  '.mp4',
  '.mov',
  '.webm',
  '.mkv',
]);

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

let libraryRoot = null;

async function init(root) {
  libraryRoot = root;
  await fsp.mkdir(libraryRoot, { recursive: true });
  return libraryRoot;
}

function getRoot() {
  return libraryRoot;
}

// Normalise a user-supplied folder path so it stays inside the library root.
function safeRel(folderRel) {
  const rel = (folderRel || '').replace(/^[\\/]+/, '').replace(/\\/g, '/');
  const joined = path.join(libraryRoot, rel);
  const resolved = path.resolve(joined);
  const rootResolved = path.resolve(libraryRoot);
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    throw new Error('Path escapes library root');
  }
  return { rel, abs: resolved };
}

function safeName(name) {
  // Strip path separators and NUL; keep it simple.
  return String(name || '').replace(/[\\/\0]+/g, '_');
}

async function listFolders() {
  const out = [''];
  async function walk(rel) {
    const { abs } = safeRel(rel);
    let entries = [];
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        const child = rel ? `${rel}/${e.name}` : e.name;
        out.push(child);
        await walk(child);
      }
    }
  }
  await walk('');
  return out.sort();
}

async function listFiles(folderRel) {
  const { abs } = safeRel(folderRel);
  let entries = [];
  try {
    entries = await fsp.readdir(abs, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!MEDIA_EXTS.has(ext)) continue;
    const full = path.join(abs, e.name);
    let stat;
    try {
      stat = await fsp.stat(full);
    } catch (_) {
      continue;
    }
    files.push({
      name: e.name,
      folder: folderRel || '',
      size: stat.size,
      mtime: stat.mtimeMs,
      ext,
      kind: ext === '.mp4' || ext === '.mov' || ext === '.webm' || ext === '.mkv' ? 'video' : 'image',
    });
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

async function createFolder(folderRel) {
  const { abs, rel } = safeRel(folderRel);
  await fsp.mkdir(abs, { recursive: true });
  return rel;
}

async function deleteFolder(folderRel) {
  if (!folderRel) throw new Error('Cannot delete library root');
  const { abs } = safeRel(folderRel);
  await fsp.rm(abs, { recursive: true, force: true });
}

async function deleteFile(folderRel, name) {
  const { abs } = safeRel(folderRel);
  const file = path.join(abs, safeName(name));
  await fsp.unlink(file);
}

function absFolderPath(folderRel) {
  try {
    return safeRel(folderRel).abs;
  } catch (_) {
    return null;
  }
}

function absFilePath(folderRel, name) {
  try {
    return path.join(safeRel(folderRel).abs, safeName(name));
  } catch (_) {
    return null;
  }
}

async function uniqueFilename(folderAbs, desiredName) {
  const ext = path.extname(desiredName);
  const base = path.basename(desiredName, ext);
  let candidate = `${base}${ext}`;
  let i = 1;
  while (true) {
    try {
      await fsp.access(path.join(folderAbs, candidate));
      candidate = `${base} (${i})${ext}`;
      i += 1;
    } catch (_) {
      return candidate;
    }
  }
}

async function importFiles(folderRel, srcPaths) {
  const { abs } = safeRel(folderRel);
  await fsp.mkdir(abs, { recursive: true });
  const results = [];
  for (const src of srcPaths || []) {
    try {
      const name = await uniqueFilename(abs, path.basename(src));
      const dest = path.join(abs, name);
      await fsp.copyFile(src, dest);
      results.push({ ok: true, name, folder: folderRel || '' });
    } catch (e) {
      results.push({ ok: false, src, error: e.message });
    }
  }
  return results;
}

async function readAsDataUrl(folderRel, name) {
  const abs = absFilePath(folderRel, name);
  if (!abs) return null;
  return fileToDataUrl(abs);
}

async function readPathAsDataUrl(absPath) {
  return fileToDataUrl(absPath);
}

async function fileToDataUrl(absPath) {
  const buf = await fsp.readFile(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// -------- Saving fal.ai results --------

function sanitizeSlug(s) {
  return String(s || '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'fal';
}

function guessExtFromUrlOrContentType(url, contentType) {
  const u = (url || '').split('?')[0];
  const ext = path.extname(u).toLowerCase();
  if (ext && ext.length <= 6) return ext;
  if (!contentType) return '.bin';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  if (contentType.includes('svg')) return '.svg';
  if (contentType.includes('mp4')) return '.mp4';
  if (contentType.includes('webm')) return '.webm';
  if (contentType.includes('quicktime')) return '.mov';
  return '.bin';
}

// Walk a fal.ai response and collect anything that looks like a downloadable media URL.
function collectMediaUrls(value) {
  const urls = [];
  const seen = new Set();
  function visit(v) {
    if (!v) return;
    if (typeof v === 'string') return;
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (typeof v === 'object') {
      if (typeof v.url === 'string' && /^https?:\/\//.test(v.url) && !seen.has(v.url)) {
        seen.add(v.url);
        urls.push({ url: v.url, contentType: v.content_type || v.contentType || '' });
      }
      for (const k of Object.keys(v)) visit(v[k]);
    }
  }
  visit(value);
  return urls;
}

async function downloadToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const contentType = res.headers.get('content-type') || '';
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

async function saveFalResult(result, folderRel, modelId) {
  const { abs } = safeRel(folderRel);
  await fsp.mkdir(abs, { recursive: true });

  // The actual payload is usually at result.data, but some endpoints return
  // the payload at the top level. Handle both.
  const payload = result && result.data ? result.data : result;
  const mediaUrls = collectMediaUrls(payload);
  const saved = [];
  const ts = new Date();
  const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(
    ts.getDate()
  ).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(
    2,
    '0'
  )}${String(ts.getSeconds()).padStart(2, '0')}`;
  const slug = sanitizeSlug(modelId);

  for (let i = 0; i < mediaUrls.length; i += 1) {
    const { url, contentType } = mediaUrls[i];
    try {
      const { buffer, contentType: ct } = await downloadToBuffer(url);
      const ext = guessExtFromUrlOrContentType(url, contentType || ct);
      const desired = `${stamp}_${slug}${mediaUrls.length > 1 ? `_${i + 1}` : ''}${ext}`;
      const name = await uniqueFilename(abs, desired);
      const dest = path.join(abs, name);
      await fsp.writeFile(dest, buffer);
      saved.push({ folder: folderRel || '', name, url });
    } catch (e) {
      saved.push({ url, error: e.message });
    }
  }
  return saved;
}

module.exports = {
  init,
  getRoot,
  listFolders,
  listFiles,
  createFolder,
  deleteFolder,
  deleteFile,
  importFiles,
  readAsDataUrl,
  readPathAsDataUrl,
  absFilePath,
  absFolderPath,
  saveFalResult,
};
