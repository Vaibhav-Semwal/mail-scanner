const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('cfg:get'),
  saveConfig: (data) => ipcRenderer.invoke('cfg:save', data),
  testConnection: (data) => ipcRenderer.invoke('cfg:test', data),
  scanNow: () => ipcRenderer.invoke('scan:now'),
  getState: () => ipcRenderer.invoke('state:get'),
  openMail: (uid) => ipcRenderer.invoke('mail:open', uid),
  markSeen: (uid) => ipcRenderer.invoke('mail:markSeen', uid),
  getMail: (uid) => ipcRenderer.invoke('mail:get', uid),
  starMail: (uid, starred) => ipcRenderer.invoke('mail:star', uid, starred),
  archiveMail: (uid) => ipcRenderer.invoke('mail:archive', uid),
  trashMail: (uid) => ipcRenderer.invoke('mail:trash', uid),
  setTheme: (theme) => ipcRenderer.invoke('ui:theme', theme),
  getAi: () => ipcRenderer.invoke('ai:get'),
  saveAi: (data) => ipcRenderer.invoke('ai:save', data),
  downloadModel: () => ipcRenderer.invoke('ai:download'),
  retryAi: () => ipcRenderer.invoke('ai:retry'),
  reclassify: () => ipcRenderer.invoke('ai:reclassify'),
  newClassifierId: () => ipcRenderer.invoke('ai:newId'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onShowMail: (cb) => ipcRenderer.on('mail:show', (_e, uid) => cb(uid))
});