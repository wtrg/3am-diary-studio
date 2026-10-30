'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
  quit: () => ipcRenderer.send('app:quit'),
  openDataFolder: () => ipcRenderer.invoke('app:open-data'),
});
