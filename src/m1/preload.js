'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agentUsage', Object.freeze({
  get: () => ipcRenderer.invoke('m1:get'), refresh: () => ipcRenderer.invoke('m1:refresh'),
  setEnabled: value => ipcRenderer.invoke('m1:enabled', value), exportStatistics: () => ipcRenderer.invoke('m1:export'),
  clearStatistics: () => ipcRenderer.invoke('m1:clear'), chooseSource: agent => ipcRenderer.invoke('m1:chooseSource', agent), quit: () => ipcRenderer.invoke('m1:quit'),
  onUpdate: callback => { const listener = () => callback(); ipcRenderer.on('m1:update', listener); return () => ipcRenderer.removeListener('m1:update', listener); }
}));
