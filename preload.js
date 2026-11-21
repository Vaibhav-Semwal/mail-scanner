const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  saveConfig: (data) => ipcRenderer.invoke('cfg:save', data),
  testConnection: (data) => ipcRenderer.invoke('cfg:test', data),
  scanNow: () => ipcRenderer.invoke('scan:now'),
  getState: () => ipcRenderer.invoke('state:get'),
  openMail: (uid) => ipcRenderer.invoke('mail:open', uid),
  markSeen: (uid) => ipcRenderer.invoke('mail:markSeen', uid),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s))
});