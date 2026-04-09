const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    paths: () => ipcRenderer.invoke('settings:paths'),
  },
  dialog: {
    pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
    pickImages: () => ipcRenderer.invoke('dialog:pickImages'),
    pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  },
  library: {
    listFolders: () => ipcRenderer.invoke('library:listFolders'),
    listFiles: (folderRel) => ipcRenderer.invoke('library:listFiles', folderRel),
    createFolder: (folderRel) => ipcRenderer.invoke('library:createFolder', folderRel),
    deleteFolder: (folderRel) => ipcRenderer.invoke('library:deleteFolder', folderRel),
    deleteFile: (folderRel, name) => ipcRenderer.invoke('library:deleteFile', folderRel, name),
    importFiles: (folderRel, srcPaths) =>
      ipcRenderer.invoke('library:importFiles', folderRel, srcPaths),
    readAsDataUrl: (folderRel, name) =>
      ipcRenderer.invoke('library:readAsDataUrl', folderRel, name),
    readPathAsDataUrl: (absPath) => ipcRenderer.invoke('library:readPathAsDataUrl', absPath),
    revealInFolder: (folderRel, name) =>
      ipcRenderer.invoke('library:revealInFolder', folderRel, name),
    openFolder: (folderRel) => ipcRenderer.invoke('library:openFolder', folderRel),
  },
  models: {
    list: () => ipcRenderer.invoke('models:list'),
  },
  fal: {
    run: (args) => ipcRenderer.invoke('fal:run', args),
  },
});
