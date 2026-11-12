'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('windowBridge',Object.freeze({
  menu:name=>ipcRenderer.invoke('window:menu',name), theme:value=>ipcRenderer.invoke('window:theme',value), state:()=>ipcRenderer.invoke('window:state'),
  onCommand:callback=>{const listener=(_event,command)=>callback(command);ipcRenderer.on('window:command',listener);return()=>ipcRenderer.removeListener('window:command',listener);},
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('window:state',listener);return()=>ipcRenderer.removeListener('window:state',listener);}
}));
// A small loading envelope avoids a synchronous cross-process ledger projection.
// Real facts arrive once through usageBridge.get; browser previews keep their own snapshot.
contextBridge.exposeInMainWorld('previewUsage', { schemaVersion:'LocalUsagePreviewV1', sequence:0, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone, daily:[], hourly:[], sources:[], loading:true });
contextBridge.exposeInMainWorld('usageTransport', Object.freeze({
  connections:()=>ipcRenderer.invoke('usage:connections'),
  dataInfo:()=>ipcRenderer.invoke('usage:dataInfo'), openData:()=>ipcRenderer.invoke('usage:openData'),
  agents:(action,...args)=>ipcRenderer.invoke('usage:agents:'+action,...args), agentUse:request=>ipcRenderer.invoke('usage:agentUse',request), revealSourcePath:file=>ipcRenderer.invoke('usage:revealSourcePath',file),
  configState:()=>ipcRenderer.invoke('usage:config:state'), configChoose:(agent,scope)=>ipcRenderer.invoke('usage:config:choose',agent,scope), configCheck:(agent,scope)=>ipcRenderer.invoke('usage:config:check',agent,scope), configForget:(agent,scope)=>ipcRenderer.invoke('usage:config:forget',agent,scope), configCancel:()=>ipcRenderer.invoke('usage:config:cancel'),
  configManage:(action,agent,scope,kind,request)=>ipcRenderer.invoke('usage:config:manage',action,agent,scope,kind,request),
  connectionsV2:()=>ipcRenderer.invoke('usage:connectionsV2'),
  agentSetup: agent => ipcRenderer.invoke('usage:agentSetup', agent),
  agentSetupAction: request => ipcRenderer.invoke('usage:agentSetupAction', request),
  installers: () => ipcRenderer.invoke('usage:installers'), installerAction: request => ipcRenderer.invoke('usage:installerAction', request),
  onInstallUpdate: callback => { const listener = () => callback(); ipcRenderer.on('usage:installUpdate', listener); return () => ipcRenderer.removeListener('usage:installUpdate', listener); },
  pricing: () => ipcRenderer.invoke('usage:pricing'), pricingCoverage: () => ipcRenderer.invoke('usage:pricing','coverage'), savePrice: entry => ipcRenderer.invoke('usage:priceSave', entry), resetPrice: entry => ipcRenderer.invoke('usage:priceReset', entry),
  syncPrices: () => ipcRenderer.invoke('usage:priceSync'), autoPrices: enabled => ipcRenderer.invoke('usage:priceAuto', enabled), saveBilling: value => ipcRenderer.invoke('usage:billingSave', value),
  previewCodex: () => ipcRenderer.invoke('usage:codexPreview'), applyCodex: id => ipcRenderer.invoke('usage:codexApply', id),
  get: revision => ipcRenderer.invoke('usage:getPacked', Number.isSafeInteger(revision) ? revision : null), refresh: revision => ipcRenderer.invoke('usage:refreshPacked', Number.isSafeInteger(revision) ? revision : null),
  performanceState:()=>ipcRenderer.invoke('usage:performanceState'),
  statisticsDiagnostics:()=>ipcRenderer.invoke('usage:statisticsDiagnostics'),
  setEnabled: value => ipcRenderer.invoke('usage:enabled', value), setRefreshInterval: value => ipcRenderer.invoke('usage:interval', value), setSubscription: (agent, fee) => ipcRenderer.invoke('usage:subscription', agent, fee), chooseSource: agent => ipcRenderer.invoke('usage:chooseSource', agent),
  customDraft:id=>ipcRenderer.invoke('usage:customDraft',id),customChoose:token=>ipcRenderer.invoke('usage:customChoose',token),customSample:token=>ipcRenderer.invoke('usage:customSample',token),customPreview:(token,config)=>ipcRenderer.invoke('usage:customPreview',token,config),customApply:id=>ipcRenderer.invoke('usage:customApply',id),customChange:(id,action,value)=>ipcRenderer.invoke('usage:customChange',id,action,value),customImport:()=>ipcRenderer.invoke('usage:customImport'),customExport:id=>ipcRenderer.invoke('usage:customExport',id),
  sources: () => ipcRenderer.invoke('usage:sources'), changeSource: (name, agent, value) => ipcRenderer.invoke('usage:sourceChange', name, agent, value),
  exportStatistics: snapshot => ipcRenderer.invoke('usage:export', snapshot), exportCost: request => ipcRenderer.invoke('usage:exportCost', request), probePrice: entry => ipcRenderer.invoke('usage:priceProbe', entry), tryPrice: request => ipcRenderer.invoke('usage:priceTry', request), pricePlan: request => ipcRenderer.invoke('usage:pricePlan', request),
  sessions: selection => ipcRenderer.invoke('usage:sessions',selection,true), sessionSummary: selection => ipcRenderer.invoke('usage:sessionSummary',selection), sessionLabels: () => ipcRenderer.invoke('usage:sessionLabels'), transcript: (key, request) => request === undefined ? ipcRenderer.invoke('usage:transcript', key) : ipcRenderer.invoke('usage:transcript', key, request), transcriptFacts: key => ipcRenderer.invoke('usage:transcriptFacts', key), transcriptFileHistory: request => ipcRenderer.invoke('usage:transcriptFileHistory', request), searchTranscripts: request => ipcRenderer.invoke('usage:searchTranscripts', request), transcriptPart: (key, request) => ipcRenderer.invoke('usage:transcriptPart', key, request), transcriptFind: (key, request) => ipcRenderer.invoke('usage:transcriptFind', key, request), transcriptStamp: key => ipcRenderer.invoke('usage:transcriptStamp', key), transcriptCopy: (key, request) => ipcRenderer.invoke('usage:transcriptCopy', key, request), transcriptExport: (key, request) => ipcRenderer.invoke('usage:transcriptExport', key, request), openLink: url => ipcRenderer.invoke('usage:openLink', url), setSessionLabel: (key, patch) => ipcRenderer.invoke('usage:sessionLabel', key, patch), attention: () => ipcRenderer.invoke('usage:attention'), copyResume: key => ipcRenderer.invoke('usage:copyResume', key), copyText: text => ipcRenderer.invoke('usage:copyText', text), openFolder: key => ipcRenderer.invoke('usage:openFolder', key),
  workbench:selection=>ipcRenderer.invoke('usage:workbench',selection),saveWorkbench:value=>ipcRenderer.invoke('usage:workbenchSave',value),reprice:()=>ipcRenderer.invoke('usage:reprice'),exportProjects:selection=>ipcRenderer.invoke('usage:exportProjects',selection),
  onUpdate: callback => { const listener = () => callback(); ipcRenderer.on('usage:update', listener); return () => ipcRenderer.removeListener('usage:update', listener); }
}));
contextBridge.exposeInMainWorld('shellBridge', Object.freeze({
  get: () => ipcRenderer.invoke('shell:get'), set: patch => ipcRenderer.invoke('shell:set', patch), readHistory: id => ipcRenderer.invoke('shell:readHistory', id),
}));
contextBridge.exposeInMainWorld('githubBridge', Object.freeze({
  get: () => ipcRenderer.invoke('github:get'), connect: () => ipcRenderer.invoke('github:connect'), cancel: () => ipcRenderer.invoke('github:cancel'), disconnect: () => ipcRenderer.invoke('github:disconnect'),
  repositories: () => ipcRenderer.invoke('github:repositories'), setSync: request => ipcRenderer.invoke('github:setSync', request), syncNow: () => ipcRenderer.invoke('github:syncNow'),
  copyCode: () => ipcRenderer.invoke('github:copyCode'), open: url => ipcRenderer.invoke('github:open', url),
  onUpdate: callback => { const listener = () => callback(); ipcRenderer.on('github:update', listener); return () => ipcRenderer.removeListener('github:update', listener); },
}));
contextBridge.exposeInMainWorld('updateBridge', Object.freeze({
  get: () => ipcRenderer.invoke('update:get'), check: () => ipcRenderer.invoke('update:check'), cancel: () => ipcRenderer.invoke('update:cancel'),
  install: () => ipcRenderer.invoke('update:install'), open: url => ipcRenderer.invoke('update:open', url),
  onUpdate: callback => { const listener = () => callback(); ipcRenderer.on('update:state', listener); return () => ipcRenderer.removeListener('update:state', listener); },
}));
contextBridge.exposeInMainWorld('quotaBridge', Object.freeze({
  providerExperimental: value => ipcRenderer.invoke('quota:providerExperimental', value),
  providers: () => ipcRenderer.invoke('quota:providers'), providerConnect: request => ipcRenderer.invoke('quota:providerConnect', request), providerAction: request => ipcRenderer.invoke('quota:providerAction', request), providerGuide: adapter => ipcRenderer.invoke('quota:providerGuide', adapter), providerPassiveGuide: id => ipcRenderer.invoke('quota:providerPassiveGuide', id),
  providerWebsiteLogin: request => ipcRenderer.invoke('quota:providerWebsiteLogin', request), providerWebsiteCancel: () => ipcRenderer.invoke('quota:providerWebsiteCancel'),
  providerClientLogin: request => ipcRenderer.invoke('quota:providerClientLogin', request),
  onProviderUpdate: callback => { const listener = () => callback(); ipcRenderer.on('quota:providerUpdate', listener); return () => ipcRenderer.removeListener('quota:providerUpdate', listener); },
  discoverAntigravity: () => ipcRenderer.invoke('quota:discoverAntigravity'),
  antigravitySetup: () => ipcRenderer.invoke('quota:antigravitySetup'),
  antigravitySetupAction: request => ipcRenderer.invoke('quota:antigravitySetupAction', request),
  getV2: () => ipcRenderer.invoke('quota:getV2'),
  get: () => ipcRenderer.invoke('quota:get'), login: alias => ipcRenderer.invoke('quota:login', alias),
  cancel: () => ipcRenderer.invoke('quota:cancel'), refresh: id => ipcRenderer.invoke('quota:refresh', id),
  refreshAll: () => ipcRenderer.invoke('quota:refreshAll'), setAutoRefresh: value => ipcRenderer.invoke('quota:setAutoRefresh', value),
  remove: id => ipcRenderer.invoke('quota:remove', id), chooseExecutable: () => ipcRenderer.invoke('quota:chooseExecutable'),
  onUpdate: callback => { const listener = () => callback(); ipcRenderer.on('quota:update', listener); return () => ipcRenderer.removeListener('quota:update', listener); }
}));
