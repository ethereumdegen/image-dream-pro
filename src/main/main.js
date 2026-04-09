const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fsp = require('fs').promises;
const settings = require('./settings');
const library = require('./library');
const fal = require('./fal');
const models = require('./models');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#141414',
    title: 'Image Dream Pro',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  await settings.init();
  await library.init(settings.get('libraryPath'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// -------- IPC: app --------
ipcMain.handle('app:getVersion', () => app.getVersion());

// -------- IPC: settings --------
ipcMain.handle('settings:get', () => settings.getAll());
ipcMain.handle('settings:set', async (_e, patch) => {
  const updated = await settings.update(patch);
  if (patch.libraryPath) {
    await library.init(updated.libraryPath);
  }
  return updated;
});
ipcMain.handle('settings:paths', () => ({
  userData: app.getPath('userData'),
  defaultLibrary: settings.defaultLibraryPath(),
  currentLibrary: settings.get('libraryPath'),
}));

// -------- IPC: dialog --------
ipcMain.handle('dialog:pickImage', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select an image',
    properties: ['openFile'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle('dialog:pickImages', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select images to add to library',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tiff'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (res.canceled || res.filePaths.length === 0) return [];
  return res.filePaths;
});

ipcMain.handle('dialog:pickDirectory', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  return res.filePaths[0];
});

ipcMain.handle('dialog:saveDataUrlAs', async (_e, { dataUrl, defaultName }) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    throw new Error('Invalid data URL');
  }
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) throw new Error('Invalid data URL');
  const header = dataUrl.slice(5, commaIdx);
  const payload = dataUrl.slice(commaIdx + 1);
  const isBase64 = /;base64/i.test(header);
  const mime = header.split(';')[0].toLowerCase();
  const buffer = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');

  const extByMime = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/svg+xml': 'svg',
  };
  const ext = extByMime[mime] || 'bin';

  let suggested = defaultName || `image.${ext}`;
  if (!path.extname(suggested)) suggested += `.${ext}`;

  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save image as',
    defaultPath: suggested,
    filters: [
      { name: 'Image', extensions: [ext] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePath) return null;
  await fsp.writeFile(res.filePath, buffer);
  return res.filePath;
});

// -------- IPC: library --------
ipcMain.handle('library:listFolders', () => library.listFolders());
ipcMain.handle('library:listFiles', (_e, folderRel) => library.listFiles(folderRel));
ipcMain.handle('library:createFolder', (_e, folderRel) => library.createFolder(folderRel));
ipcMain.handle('library:deleteFolder', (_e, folderRel) => library.deleteFolder(folderRel));
ipcMain.handle('library:deleteFile', (_e, folderRel, name) => library.deleteFile(folderRel, name));
ipcMain.handle('library:importFiles', (_e, folderRel, srcPaths) =>
  library.importFiles(folderRel, srcPaths)
);
ipcMain.handle('library:saveDataUrl', (_e, folderRel, name, dataUrl) =>
  library.saveDataUrl(folderRel, name, dataUrl)
);
ipcMain.handle('library:readAsDataUrl', (_e, folderRel, name) =>
  library.readAsDataUrl(folderRel, name)
);
ipcMain.handle('library:readPathAsDataUrl', (_e, absPath) => library.readPathAsDataUrl(absPath));
ipcMain.handle('library:revealInFolder', (_e, folderRel, name) => {
  const abs = library.absFilePath(folderRel, name);
  if (abs) shell.showItemInFolder(abs);
});
ipcMain.handle('library:openFolder', (_e, folderRel) => {
  const abs = library.absFolderPath(folderRel);
  if (abs) shell.openPath(abs);
});

// -------- IPC: models --------
ipcMain.handle('models:list', () => models.list());

// -------- IPC: fal.ai --------
ipcMain.handle('fal:run', async (_e, { modelId, input, saveFolder }) => {
  const apiKey = settings.get('falApiKey');
  if (!apiKey) {
    throw new Error('No fal.ai API key set. Add it in Settings.');
  }
  const result = await fal.run({ apiKey, modelId, input });
  const saved = await library.saveFalResult(result, saveFolder || '', modelId);
  return { result, saved };
});

ipcMain.handle('fal:getBilling', async () => {
  const apiKey = settings.get('falApiKey');
  if (!apiKey) {
    return { ok: false, code: 'NO_KEY', message: 'No fal.ai API key set.' };
  }
  try {
    const data = await fal.getBilling({ apiKey });
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      code: e.code || 'ERROR',
      status: e.status,
      message: e.message || String(e),
    };
  }
});
