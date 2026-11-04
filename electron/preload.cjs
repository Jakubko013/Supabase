const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
});
