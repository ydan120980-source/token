'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('windowBridge',Object.freeze({
  menu:name=>ipcRenderer.invoke('window:menu',name), theme:value=>ipcRenderer.invoke('window:theme',value), state:()=>ipcRenderer.invoke('window:state'),
  onCommand:callback=>{const listener=(_event,command)=>callback(command);ipcRenderer.on('window:command',listener);return()=>ipcRenderer.removeListener('window:command',listener);},
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('window:state',listener);return()=>ipcRenderer.removeListener('window:state',listener);}
}));
contextBridge.exposeInMainWorld('previewUsage', ipcRenderer.sendSync('quota:usage'));
contextBridge.exposeInMainWorld('usageBridge', Object.freeze({
  pricing: () => ipcRenderer.invoke('usage:pricing'), savePrice: entry => ipcRenderer.invoke('usage:priceSave', entry), resetPrice: entry => ipcRenderer.invoke('usage:priceReset', entry),
  syncPrices: () => ipcRenderer.invoke('usage:priceSync'), autoPrices: enabled => ipcRenderer.invoke('usage:priceAuto', enabled), saveBilling: value => ipcRenderer.invoke('usage:billingSave', value),
  previewCodex: () => ipcRenderer.invoke('usage:codexPreview'), applyCodex: id => ipcRenderer.invoke('usage:codexApply', id),
  get: revision => ipcRenderer.invoke('usage:get', Number.isSafeInteger(revision) ? revision : null), refresh: () => ipcRenderer.invoke('usage:refresh'),
  setEnabled: value => ipcRenderer.invoke('usage:enabled', value), setRefreshInterval: value => ipcRenderer.invoke('usage:interval', value), chooseSource: agent => ipcRenderer.invoke('usage:chooseSource', agent),
  exportStatistics: snapshot => ipcRenderer.invoke('usage:export', snapshot), probePrice: entry => ipcRenderer.invoke('usage:priceProbe', entry),
  onUpdate: callback => { const listener = () => callback(); ipcRenderer.on('usage:update', listener); return () => ipcRenderer.removeListener('usage:update', listener); }
}));
contextBridge.exposeInMainWorld('quotaBridge', Object.freeze({
  get: () => ipcRenderer.invoke('quota:get'), login: alias => ipcRenderer.invoke('quota:login', alias),
  cancel: () => ipcRenderer.invoke('quota:cancel'), refresh: id => ipcRenderer.invoke('quota:refresh', id),
  refreshAll: () => ipcRenderer.invoke('quota:refreshAll'), setAutoRefresh: value => ipcRenderer.invoke('quota:setAutoRefresh', value),
  remove: id => ipcRenderer.invoke('quota:remove', id), chooseExecutable: () => ipcRenderer.invoke('quota:chooseExecutable'),
  onUpdate: callback => { const listener = () => callback(); ipcRenderer.on('quota:update', listener); return () => ipcRenderer.removeListener('quota:update', listener); }
}));
