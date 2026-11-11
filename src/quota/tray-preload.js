'use strict';
// The tray card's only bridge: the rows it shows, and opening the main window. No account, source or file capability.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trayBridge', Object.freeze({
  rows: () => ipcRenderer.invoke('tray:rows'),
  size: height => ipcRenderer.invoke('tray:size', height),
  open: command => ipcRenderer.invoke('tray:open', command),
  onUpdate: callback => { const listener = () => callback(); ipcRenderer.on('tray:update', listener); return () => ipcRenderer.removeListener('tray:update', listener); },
}));
