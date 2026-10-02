'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, Tray, Menu, dialog, net } = require('electron');
const { disableNetwork, SOURCES, localPath, roots } = require('./policy');
const { Service } = require('./service');
const audit = { networkAttempts: 0 };
disableNetwork(audit);
net.fetch = net.request = () => { audit.networkAttempts++; throw new Error('NETWORK_DISABLED_M1'); };
function argument(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const isolatedDir = argument('--m1-data-dir');
app.setName('Agent Usage M1');
app.setPath('userData', isolatedDir ? localPath(isolatedDir) : path.join(app.getPath('appData'), 'AgentUsage-M1'));
app.setAppUserModelId('local.agentusage.desktop.m1');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints,AutofillServerCommunication');
let window, tray, service, quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { window.show(); window.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith('file:') || details.url.startsWith('devtools:');
      if (!allowed) audit.networkAttempts++;
      callback({ cancel: !allowed });
    });
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    window = new BrowserWindow({ width: 1120, height: 800, minWidth: 780, minHeight: 600, backgroundColor: '#141b24', title: 'Agent Usage M1', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    const sourceRoots = argument('--m1-fixture-root') ? roots(localPath(argument('--m1-fixture-root'))) : roots();
    service = new Service(app.getPath('userData'), sourceRoots, () => { if (!window.isDestroyed()) window.webContents.send('m1:update'); });
    const allowedChannels = new Set(['m1:get', 'm1:refresh', 'm1:enabled', 'm1:export', 'm1:clear', 'm1:chooseSource', 'm1:quit']);
    function handler(channel, action) {
      if (!allowedChannels.has(channel)) throw new Error('IPC_NOT_ALLOWED');
      ipcMain.handle(channel, async (event, ...args) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('IPC_SENDER_REJECTED');
        return action(...args);
      });
    }
    handler('m1:get', () => ({ ...service.get(), runtimeNetworkAttempts: audit.networkAttempts }));
    handler('m1:refresh', () => service.refresh());
    handler('m1:enabled', enabled => service.setEnabled(enabled));
    handler('m1:export', async () => {
      const result = await dialog.showSaveDialog(window, { title: '导出统计（不包含会话正文）', defaultPath: 'AgentUsage-statistics.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return { canceled: true };
      fs.writeFileSync(result.filePath, JSON.stringify(service.store.snapshot(), null, 2), { mode: 0o600 }); return { saved: true };
    });
    handler('m1:clear', async () => {
      const result = await dialog.showMessageBox(window, { type: 'warning', buttons: ['取消', '清空并暂停'], defaultId: 0, cancelId: 0, message: '仅清空本应用统计，不删除 agent 原始数据。', detail: '采集将暂停；重新开启后，会从原始来源重建可读取的历史。' });
      if (result.response !== 1) return false;
      await service.setEnabled(false); service.store.clear(); window.webContents.send('m1:update'); return true;
    });
    handler('m1:chooseSource', async agent => {
      if (!SOURCES.includes(agent)) throw new Error('SOURCE_REJECTED');
      const result = await dialog.showOpenDialog(window, { title: '选择此来源的本地用量目录', properties: ['openDirectory'] });
      if (result.canceled) return false;
      const selected = localPath(result.filePaths[0]);
      const own = app.getPath('userData').toLowerCase(), normalized = selected.toLowerCase();
      if (normalized === own || normalized.startsWith(own + path.sep) || own.startsWith(normalized + path.sep)) throw new Error('SOURCE_PRODUCT_OVERLAP');
      await service.setEnabled(false);
      service.store.settings.roots[agent] = [...new Set([...service.store.settings.roots[agent], selected])];
      service.store.setEnabled(false); window.webContents.send('m1:update'); return true;
    });
    handler('m1:quit', () => app.quit());
    tray = new Tray(path.join(__dirname, '../../assets/icon-win.png'));
    tray.setToolTip('Agent Usage M1 · 本地统计');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开统计', click: () => window.show() }, { label: '退出并停止采集', click: () => app.quit() }]));
    tray.on('double-click', () => window.show());
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    await window.loadFile(path.join(__dirname, 'index.html'));
    if (service.store.settings.enabled) void service.refresh();
  }).catch(() => { dialog.showErrorBox('Agent Usage M1', '初始化失败。请检查独立数据目录或重新解压应用。'); app.exit(1); });
  app.on('before-quit', event => {
    if (!quitting) { event.preventDefault(); quitting = true; Promise.resolve(service?.close()).finally(() => { tray?.destroy(); app.quit(); }); }
  });
}
