const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studioLicense', {
  activate: (licenseKey) => ipcRenderer.invoke('studio-license:activate', licenseKey),
  deactivate: () => ipcRenderer.invoke('studio-license:deactivate'),
  getStatus: () => ipcRenderer.invoke('studio-license:get-status'),
  isDesktop: true,
});
