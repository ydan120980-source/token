'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, shell, dialog, powerMonitor } = require('electron');
const { QuotaService } = require('./service');
const { safeCode, MESSAGES } = require('./errors');
const { disableNetwork, SOURCES, localPath, roots, allowedFile } = require('../m1/policy');
const { Service } = require('../m1/service');
const { PriceSyncService } = require('../m1/price-sync-service');
const { selectSnapshot } = require('../../design/desktop-reference/local-snapshot');
const { installWindowShell } = require('./window-shell');
disableNetwork({ networkAttempts: 0 }); // Only dedicated Codex and fixed public-price children have network access.
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
const dataDir = path.resolve(argument('--quota-data-dir') || path.join(app.getPath('appData'), 'AgentUsage-M1-Quota'));
app.setName('Agent Usage Quota'); app.setPath('userData', dataDir); app.setAppUserModelId('local.agentusage.quota');
app.commandLine.appendSwitch('disable-background-networking'); app.commandLine.appendSwitch('disable-component-update');
let window, service, usage, priceSync, quitting = false;
function discoverExecutable() {
  const base = path.join(app.getPath('home'), 'AppData/Local/OpenAI/Codex/bin');
  try { for (const entry of fs.readdirSync(base).sort().reverse()) { const candidate = path.join(base, entry, 'codex.exe'); if (fs.existsSync(candidate)) return candidate; } } catch { /* User can choose a standalone official codex.exe. */ }
  return null;
}
function selectedExecutable() { try { const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime.json'), 'utf8')); if (path.isAbsolute(saved.executable) && path.basename(saved.executable).toLowerCase() === 'codex.exe' && fs.existsSync(saved.executable)) return saved.executable; } catch { /* No selected runtime yet. */ } return discoverExecutable(); }
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') }));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window = new BrowserWindow({ show: false, width: 1180, height: 850, minWidth: 800, minHeight: 600, backgroundColor: '#f5f5f5', title: 'Agent Usage · Codex 额度', titleBarStyle:'hidden', titleBarOverlay:{color:'#f6f6f6',symbolColor:'#242426',height:44}, autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const valid = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    installWindowShell(window,{app,ipcMain,Menu:require('electron').Menu,dialog},valid);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault());
    service = new QuotaService(dataDir, selectedExecutable(), () => { if (!quitting && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('quota:update'); });
    const usageDir = localPath(argument('--usage-data-dir') || path.join(app.getPath('appData'), 'AgentUsage-M1'));
    const fixtureRoot = argument('--m1-fixture-root');
    usage = new Service(usageDir, fixtureRoot ? roots(localPath(fixtureRoot)) : roots(), () => { if (!quitting && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('usage:update'); });
    priceSync = new PriceSyncService(usage.store, () => { if (!quitting && !window.isDestroyed()) window.webContents.send('usage:update'); }, Boolean(fixtureRoot));
    powerMonitor.on('suspend', () => service.suspend());
    powerMonitor.on('resume', () => { void service.resume(); });
    let projectedSource, projectedSnapshot, snapshotRevision = 0;
    const usageSnapshot = source => { if (source !== projectedSource) { const next = selectSnapshot(source); projectedSource = source; projectedSnapshot = next; snapshotRevision++; } return projectedSnapshot; };
    ipcMain.on('quota:usage', event => {
      if (!valid(event)) { event.returnValue = undefined; return; }
      try { event.returnValue = usageSnapshot(usage.get().snapshot); } catch { event.returnValue = { schemaVersion: 'LocalUsagePreviewV1', sequence: 0, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, daily: [], sources: [], previewReadError: true }; }
    });
    // Process-local projection revision also changes on repricing/timezone edits,
    // which do not necessarily advance the collector's persisted sequence.
    // A caller that already holds the current revision gets the status without the
    // snapshot body, so periodic checks do not re-send hundreds of kilobytes.
    const usageState = known => { const state = usage.get(), snapshot = usageSnapshot(state.snapshot); return { ...state, snapshot: Number.isSafeInteger(known) && known === snapshotRevision ? null : snapshot, snapshotRevision }; };
    const usageHandle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); return action(...args); });
    usageHandle('usage:get', known => usageState(known));
    usageHandle('usage:refresh', async () => { await usage.refresh(); return usageState(); });
    usageHandle('usage:enabled', async value => { await usage.setEnabled(value); return usageState(); });
    usageHandle('usage:interval', value => { usage.setRefreshInterval(value); return usageState(); });
    usageHandle('usage:pricing', () => ({...usage.store.pricing(), sync:priceSync.state()}));
    usageHandle('usage:priceSync', () => priceSync.sync());
    usageHandle('usage:priceAuto', enabled => priceSync.setEnabled(enabled));
    usageHandle('usage:billingSave', value => { const result = usage.store.setBilling(value); priceSync.start(); window.webContents.send('usage:update'); return result; });
    usageHandle('usage:priceSave', entry => { usage.store.setPrice(entry); window.webContents.send('usage:update'); return usage.store.pricing(); });
    usageHandle('usage:priceReset', entry => { usage.store.setPrice(entry, true); window.webContents.send('usage:update'); return usage.store.pricing(); });
    // Dry run for the editor: validates the entry and reports what a save would change, without writing.
    usageHandle('usage:priceProbe', entry => usage.store.probe(entry));
    usageHandle('usage:codexPreview', () => usage.refresh(true));
    usageHandle('usage:codexApply', async id => {
      if (typeof id !== 'string' || !usage.maintenance || usage.maintenance.summary.id !== id) throw new Error('MAINTENANCE_STALE');
      const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '备份并重建'], defaultId: 0, cancelId: 0, message: '应用预览中的 Codex 用量重建？', detail: '只更新本应用统计。自动保存备份，保留无法重读的历史；原始日志与账号连接不变。' });
      if (result.response !== 1) return { canceled: true };
      usage.applyMaintenance(id); return { applied: true, state: usageState() };
    });
    usageHandle('usage:export', async payload => {
      // Project again in the main process: renderer edits never export secrets.
      const snapshot = selectSnapshot(payload);
      const result = await dialog.showSaveDialog(window, { title: '导出统计', defaultPath: 'AgentUsage-statistics.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return { canceled: true };
      fs.writeFileSync(result.filePath, JSON.stringify(snapshot, null, 2), { mode: 0o600 }); return { saved: true, rows: snapshot.daily.length };
    });
    usageHandle('usage:chooseSource', async agent => {
      if (!SOURCES.includes(agent)) throw new Error('SOURCE_REJECTED');
      const result = await dialog.showOpenDialog(window, agent === 'cursor' ? { title: '选择 Cursor SDK index.db、runs.ndjson 或用量 CSV', properties: ['openFile'], filters:[{name:'Cursor 用量记录',extensions:['db','csv','ndjson']}] } : { title: '选择本地用量目录', properties: ['openDirectory'] });
      if (result.canceled) return usageState();
      const selected = localPath(result.filePaths[0]), normalized = selected.toLowerCase();
      for (const protectedDir of [usageDir, dataDir]) { const own = protectedDir.toLowerCase(); if (normalized === own || normalized.startsWith(own + path.sep) || own.startsWith(normalized + path.sep)) throw new Error('SOURCE_PRODUCT_OVERLAP'); }
      if (agent === 'cursor' && (!allowedFile(agent,selected) || !fs.lstatSync(selected).isFile())) throw new Error('SOURCE_FILE_REJECTED');
      await usage.setEnabled(false); usage.store.settings.roots[agent] = agent === 'cursor' ? [selected] : [...new Set([...usage.store.settings.roots[agent], selected])]; usage.store.setEnabled(false); return usageState();
    });
    const handle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); try { return { ok: true, state: await action(...args) }; } catch (error) { const errorCode = safeCode(error); return { ok: false, errorCode, error: MESSAGES[errorCode], state: service.state() }; } });
    const connectionId = id => { if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('ACCOUNT_NOT_FOUND'); return id; };
    handle('quota:get', () => service.state());
    handle('quota:login', async alias => { if (typeof alias !== 'string' || alias.length > 48) throw new Error('ALIAS_INVALID'); const result = await service.begin(alias); try { await shell.openExternal(result.authUrl); } catch (error) { await service.cancel(); throw error; } return service.state(); });
    handle('quota:cancel', async () => { await service.cancel(); return service.state(); });
    handle('quota:refresh', id => service.refresh(connectionId(id)));
    handle('quota:refreshAll', () => service.refreshAll());
    handle('quota:setAutoRefresh', value => service.setAutoRefresh(value));
    handle('quota:remove', async id => { const account = service.account(connectionId(id)); const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '退出此账号并移除'], defaultId: 0, cancelId: 0, message: '移除 ' + account.alias + '？', detail: '仅退出本应用的独立连接并移除额度缓存。其他客户端是否保持登录需在验收时确认。' }); if (result.response === 1) await service.remove(id); return service.state(); });
    handle('quota:chooseExecutable', async () => { if (service.runtimeBusy()) throw new Error('RUNTIME_BUSY'); const result = await dialog.showOpenDialog(window, { title: '选择官方 Codex CLI 的 codex.exe', properties: ['openFile'], filters: [{ name: 'Codex', extensions: ['exe'] }] }); if (!result.canceled && path.basename(result.filePaths[0]).toLowerCase() === 'codex.exe') { if (service.runtimeBusy()) throw new Error('RUNTIME_BUSY'); service.executable = result.filePaths[0]; fs.writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify({ executable: service.executable })); } return service.state(); });
    await window.loadFile(path.join(__dirname, '../../design/desktop-reference/index.html'));
    if (!quitting && !window.isDestroyed()) window.show();
    if (!quitting && usage.store.settings.enabled) void usage.refresh();
    if (!quitting) priceSync.start();
  }).catch(() => { if (!quitting) { dialog.showErrorBox('Agent Usage Quota', '额度窗口初始化失败，请检查独立数据目录。'); app.exit(1); } });
  app.on('before-quit', event => { if (!quitting) { event.preventDefault(); quitting = true; Promise.all([service?.close(), usage?.close(), priceSync?.close()]).catch(() => { dialog.showErrorBox('Agent Usage Quota', '子进程退出等待失败，请在任务管理器确认该应用的进程已结束。'); }).finally(() => app.quit()); } });
}
