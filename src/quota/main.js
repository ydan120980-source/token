'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session, shell, dialog, powerMonitor, clipboard, nativeTheme, safeStorage } = require('electron');
const { RefreshScheduler } = require('./refresh-scheduler');
const { QuotaService } = require('./service');
const { projectConnections } = require('./connection-state');
const { installResourceReads } = require('./resource-ipc');
const { installRuntimeDiscovery } = require('./runtime-discovery-ipc');
const { discoverAntigravity } = require('./antigravity-discovery');
const { createAntigravitySetup, installAntigravitySetup } = require('./antigravity-setup');
const { createAgentSetup, installAgentSetup } = require('./agent-setup');
const { AgentInstallService, installAgentInstaller } = require('./agent-install-service');
const { readActiveRuntime } = require('./agent-install-engine');
const { ProviderQuotaService, installProviderQuota, runWorker, readMessage } = require('./provider-service');
const { GithubService, secretFile, openable } = require('./github-service');
const { UpdateService } = require('./update-service');
const { createClientLogin } = require('./provider-client-login');
const { ProviderSecretStore } = require('./provider-secret-store');
const chromeBrowser = require('./chrome-browser');
const { passiveInstructions } = require('./passive-instructions');
const { safeCode, MESSAGES } = require('./errors');
const { disableNetwork, SOURCES, localPath, roots, allowedFile } = require('../m1/policy');
const { SessionLabels } = require('../m1/session-labels');
const { StatisticsService } = require('../m1/statistics-service');
const scope = require('../m1/source-scope');
const { installWindowShell, titleBarOverlay, GROUND } = require('./window-shell');
const { ConfigHealthService, installConfigHealth } = require('./config-health-service');
const { ConfigManager } = require('./config-manager');
const { AgentInventoryService, installAgentInventory } = require('./agent-inventory-service');
const { writeClipboard } = require('./clipboard-write');
const { QuotaWatch } = require('./quota-watch');
const { ReadHistory } = require('./read-history');
const { DesktopShell } = require('./desktop-shell');
disableNetwork({ networkAttempts: 0 }); // Dedicated quota, public-price and explicit installer children own their separate network scopes.
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function runtimeDiscoveryEnvironment() {
  const fixture = argument('--m1-fixture-root');
  if (fixture) return { platform: process.platform, home: fixture, appData: path.join(fixture, 'AppData/Roaming'), localAppData: path.join(fixture, 'AppData/Local'), path: '' };
  return { platform: process.platform, home: app.getPath('home'), appData: app.getPath('appData'), localAppData: process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData/Local'), programFiles: process.env.ProgramFiles, programFilesX86: process.env['ProgramFiles(x86)'], path: [process.env.Path || process.env.PATH || '', ...(installers?.searchDirectories() || [])].join(';') };
}
const dataDir = path.resolve(argument('--quota-data-dir') || path.join(app.getPath('appData'), 'AgentUsage-M1-Quota'));
app.setName('Agent Usage Quota'); app.setPath('userData', dataDir); app.setAppUserModelId('local.agentusage.quota');
app.commandLine.appendSwitch('disable-background-networking'); app.commandLine.appendSwitch('disable-component-update');
// Bound temporary allocation growth, not live-data capacity. In pinned V8 15,
// the growth percentage schedules ordinary collection sooner after a GC; it
// does not cap the old heap or force collection on a timer/navigation event.
// GPU/vsync and background throttling retain Chromium defaults.
let rendererFlags=app.commandLine.getSwitchValue('js-flags');
if(!rendererFlags.includes('--max-semi-space-size'))rendererFlags+=' --max-semi-space-size=4';
if(!rendererFlags.includes('--heap-growing-percent'))rendererFlags+=' --heap-growing-percent=10';
app.commandLine.appendSwitch('js-flags',rendererFlags.trim());
let window, service, usage, priceSync, installers, providerQuota, github, updates, configHealth, desktopShell, readHistory, quitting = false;
function discoverExecutable() {
  const managed = readActiveRuntime(path.join(dataDir, 'agent-tools'), 'codex');
  if (managed && managed.js === false && path.basename(managed.executable).toLowerCase() === 'codex.exe') return managed.executable;
  const base = path.join(app.getPath('home'), 'AppData/Local/OpenAI/Codex/bin');
  try { for (const entry of fs.readdirSync(base).sort().reverse()) { const candidate = path.join(base, entry, 'codex.exe'); if (fs.existsSync(candidate)) return candidate; } } catch { /* User can choose a standalone official codex.exe. */ }
  return null;
}
function selectedExecutable() { try { const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'runtime.json'), 'utf8')); if (path.isAbsolute(saved.executable) && path.basename(saved.executable).toLowerCase() === 'codex.exe' && fs.existsSync(saved.executable)) return saved.executable; } catch { /* No selected runtime yet. */ } return discoverExecutable(); }
// One controlled shutdown, used by both ways this process stops: the person closing the app, and the restart an update
// performs. An installer replaces files this process holds open, so the update waits for this to finish before it starts.
let stopping = null, stopped = false;
const stoppedServices = new Set();
function shutdown() {
  if (stopped) return Promise.resolve();
  if (stopping) return stopping;
  quitting = true;
  // Keep the update bridge and tray alive until the actual quit. A failed
  // preparation must still be able to show its error, retry, or exit normally.
  const services = { readHistory, github, service, usage, priceSync, installers, providerQuota, configHealth };
  stopping = Promise.allSettled(Object.entries(services).filter(([name]) => !stoppedServices.has(name)).map(async ([name, owned]) => {
    await owned?.close();
    stoppedServices.add(name);
  })).then(results => {
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'SHUTDOWN_FAILED');
    stopped = true;
  }).finally(() => { stopping = null; });
  return stopping;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (desktopShell) desktopShell.showWindow(null); else { window?.show(); window?.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('file:') && !details.url.startsWith('devtools:') }));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    // The window opens in the system appearance; the page then applies the remembered choice.
    const dark = nativeTheme.shouldUseDarkColors;
    // Wide enough for the reading page with its outline and right column (a 720px text column), within the screen.
    const area = require('electron').screen.getPrimaryDisplay().workAreaSize;
    window = new BrowserWindow({ show: false, width: Math.min(1480, area.width), height: Math.min(960, area.height), minWidth: 800, minHeight: 600, backgroundColor: GROUND[dark ? 'dark' : 'light'], title: 'Agent Usage · Codex 额度', titleBarStyle:'hidden', titleBarOverlay:titleBarOverlay(dark ? 'dark' : 'light'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    const valid = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    configHealth = new ConfigHealthService(async (agent, scope) => {
      const result = await dialog.showOpenDialog(window, { title: '选择 ' + (agent === 'codex' ? 'Codex' : 'Claude Code') + (scope === 'home' ? ' 用户根目录（包含 .codex / .claude）' : ' 项目根目录'), properties: ['openDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    }, undefined, new ConfigManager(path.join(dataDir, 'config-backups'), safeStorage), async kind => {
      const result = await dialog.showOpenDialog(window, { title: kind === 'skills' ? '选择包含 SKILL.md 的本地 Skill 目录' : '选择本地配置文件（仅合并当前类别）', properties: [kind === 'skills' ? 'openDirectory' : 'openFile'], ...(kind === 'skills' ? {} : { filters: [{ name: '本地 Agent 配置', extensions: ['json','toml'] }] }) });
      return result.canceled ? null : result.filePaths[0];
    });
    installConfigHealth(ipcMain, valid, configHealth);
    // Where the app keeps its own data and how much, by size alone; the runtimes it installed are not counted as data.
    const dataBytes = () => { let bytes = 0, seen = 0; const visit = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { if (++seen > 20000) return; if (entry.name === 'agent-tools') continue; const full = path.join(dir, entry.name); if (entry.isDirectory()) visit(full); else if (entry.isFile()) { try { bytes += fs.statSync(full).size; } catch { /* gone since listed */ } } } }; try { visit(dataDir); } catch { /* counted so far */ } return bytes; };
    ipcMain.handle('usage:dataInfo', event => { if (!valid(event)) throw Error('IPC_SENDER_REJECTED'); return { version: app.getVersion(), path: dataDir, bytes: dataBytes() }; });
    ipcMain.handle('usage:openData', async event => { if (!valid(event)) throw Error('IPC_SENDER_REJECTED'); await shell.openPath(dataDir); });
    const inventoryFixture = argument('--m1-fixture-root');
    installAgentInventory(ipcMain, valid, new AgentInventoryService({
      dataDir, home: inventoryFixture ? path.resolve(inventoryFixture) : app.getPath('home'), manager: configHealth.manager, health: configHealth,
      // Only the names of environment variables, and the search path a stdio server would be found on.
      environment: () => inventoryFixture ? { path: path.join(path.resolve(inventoryFixture), 'bin'), pathExt: process.env.PATHEXT, names: ['SYNTHETIC_SET'] } : { path: process.env.PATH, pathExt: process.env.PATHEXT, names: Object.keys(process.env) },
      choose: async () => { const result = await dialog.showOpenDialog(window, { title: '选择项目目录', properties: ['openDirectory'] }); return result.canceled ? null : result.filePaths[0]; },
      reveal: file => shell.showItemInFolder(file), open: file => shell.openPath(file), copy: file => writeClipboard(clipboard, file),
    }));
    installWindowShell(window,{app,ipcMain,Menu:require('electron').Menu,dialog},valid);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); window.webContents.on('will-navigate', event => event.preventDefault());
    const refreshScheduler = new RefreshScheduler();
    readHistory = new ReadHistory(dataDir);
    // Notices and the tray look at the readings the app already holds, a moment after any of them changes and once a minute for a reset coming up.
    let watch = null, watchSoon = null;
    const lookSoon = () => { if (!watch || watchSoon || quitting) return; watchSoon = setTimeout(() => { watchSoon = null; if (!quitting) watch.check(); }, 1500); watchSoon.unref?.(); };
    service = new QuotaService(dataDir, selectedExecutable(), () => { lookSoon(); if (!quitting && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('quota:update'); }, undefined, { scheduler: refreshScheduler });
    service.history = readHistory;
    const usageDir = localPath(argument('--usage-data-dir') || path.join(app.getPath('appData'), 'AgentUsage-M1'));
    const fixtureRoot = argument('--m1-fixture-root');
    const fixtureHome = fixtureRoot && localPath(fixtureRoot);
    const clientLogin = createClientLogin({ root: path.join(dataDir, 'provider-quotas', 'client-home'), toolsRoot: path.join(dataDir, 'agent-tools'), environment: runtimeDiscoveryEnvironment, fixture: Boolean(fixtureRoot), openBrowser: url => chromeBrowser.openChrome(url), renew: (adapter, token, signal, grant) => runWorker(adapter, token, signal, grant, 'renew') });
    const runProvider = (adapter, credential, signal, context) => adapter === 'antigravity-cli' ? clientLogin.report(signal, context) : runWorker(adapter, credential, signal, context);
    providerQuota = new ProviderQuotaService(path.join(dataDir, 'provider-quotas'), { history: readHistory, scheduler: refreshScheduler, fixture: Boolean(fixtureRoot), run: runProvider, clientLogin: clientLogin.login, forgetClient: clientLogin.forget, prepare: clientLogin.prepare, secretStore: new ProviderSecretStore(path.join(dataDir, 'provider-quotas', 'website-secrets'), safeStorage), changed: () => { if (!quitting && !window.isDestroyed()) window.webContents.send('quota:providerUpdate'); } });
    service.refreshProviders = () => providerQuota.refreshAll({ automatic: true });
    const quotaAccounts = () => [...service.stateV2().accounts, ...providerQuota.state().accounts];
    const fixtureShell = Boolean(fixtureRoot) && !process.argv.includes('--desktop-shell-test');
    watch = new QuotaWatch(dataDir, { accounts: quotaAccounts, show: notice => desktopShell.notify(notice), changed: rows => desktopShell.update(rows) });
    desktopShell = new DesktopShell(dataDir, {
      electron: require('electron'), window, valid, preload: path.join(__dirname, 'tray-preload.js'), cardFile: path.join(__dirname, '../../design/desktop-reference/tray/card.html'), iconFile: path.join(__dirname, '../../assets/icon-win.png'),
      packaged: app.isPackaged, hasAccounts: () => quotaAccounts().length > 0 || fixtureShell, exitPath: () => stopped, watch, enabled: !fixtureShell, quit: () => app.quit(),
    });
    desktopShell.install();
    const watching = setInterval(() => { if (!quitting) { lookSoon(); const ids = new Set(quotaAccounts().map(account => account.id)); for (const id of Object.keys(readHistory.lines)) if (!ids.has(id)) readHistory.forget(id); } }, 60000); watching.unref?.();
    ipcMain.handle('shell:readHistory', (event, id) => {
      if (!valid(event)) throw new Error('IPC_SENDER_REJECTED');
      if (typeof id !== 'string' || id.length > 64) throw new Error('ACCOUNT_NOT_FOUND');
      return readHistory.list(id).map(line => ({ ...line, message: line.code ? readMessage(line.code) ?? MESSAGES[line.code] ?? null : null }));
    });
    // GitHub identity and sync. The real transport is Codex's (github-transport.js); a synthetic run may hand in its own.
    const githubTransport = require('./github-transport').create();
    github = new GithubService(path.join(dataDir, 'github'), {
      transport: () => (fixtureRoot ? globalThis.githubFixtureTransport : githubTransport) ?? null,
      secrets: secretFile(path.join(dataDir, 'github', 'token.bin'), safeStorage),
      snapshot: async () => (await usage.get()).snapshot,
      onChange: () => { if (!quitting && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('github:update'); },
    });
    const githubHandle = (channel, action) => ipcMain.handle('github:' + channel, async (event, ...args) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); try { return { ok: true, state: await action(...args) }; } catch (error) { return { ok: false, error: /^GITHUB_[A-Z_]+$/.test(error?.message) ? error.message : 'GITHUB_REQUEST_FAILED' }; } });
    githubHandle('get', () => github.state());
    githubHandle('connect', () => github.connect());
    githubHandle('cancel', () => github.cancel());
    githubHandle('disconnect', () => github.disconnect());
    githubHandle('repositories', () => github.listRepositories());
    githubHandle('setSync', request => github.setSync(request));
    githubHandle('syncNow', () => github.syncNow());
    ipcMain.handle('github:copyCode', event => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); const code = github.state().connection.device?.userCode; if (!code) return false; clipboard.writeText(code); return true; });
    ipcMain.handle('github:open', async (event, url) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); if (!openable(url)) return false; await shell.openExternal(url); return true; });
    // The application's own updates travel over electron-updater's separate session partition, which is why they are not
    // one of the child-process transports above. Only a packaged NSIS build carries app-update.yml; anything else reports
    // that it is not configured and opens no connection (docs/m2/AUTO-UPDATE-20261108.md).
    updates = new UpdateService({
      // A synthetic run may hand in its own updater, as the GitHub fixture does, so the whole update path is testable
      // without a publisher, a network or an installation.
      autoUpdater: () => (fixtureRoot ? globalThis.updateFixtureUpdater : null) ?? (app.isPackaged ? require('electron-updater').autoUpdater : null),
      supported: () => (fixtureRoot && globalThis.updateFixtureUpdater ? true : undefined),
      app, configFile: path.join(process.resourcesPath, 'app-update.yml'),
      // The installer replaces files this process holds open, so this app stops its own work and waits for the children
      // before the installer starts, rather than leaving that to the quit that follows it.
      beforeInstall: () => shutdown(),
      onChange: () => { if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('update:state'); },
    });
    const updateHandle = (channel, action) => ipcMain.handle('update:' + channel, async (event, ...args) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); try { return { ok: true, state: await action(...args) }; } catch (error) { return { ok: false, error: /^UPDATE_[A-Z_]+$/.test(error?.message) ? error.message : 'UPDATE_REQUEST_FAILED', state: updates.stateNow() }; } });
    updateHandle('get', () => updates.stateNow());
    updateHandle('check', () => updates.check());
    updateHandle('cancel', () => updates.cancel());
    updateHandle('install', () => updates.install());
    ipcMain.handle('update:open', async (event, url) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); const latest = updates.stateNow().latest; if (!latest?.url || latest.url !== url) return false; await shell.openExternal(url); return true; });
    installProviderQuota(ipcMain, valid, providerQuota, url => chromeBrowser.openChrome(url), id => clipboard.writeText(passiveInstructions(providerQuota.root, process.execPath, __dirname, id)));
    usage = new StatisticsService(usageDir, fixtureHome ? roots(fixtureHome) : roots(), () => { if (!quitting && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('usage:update'); },
      fixtureHome ? { home: fixtureHome, appData: path.join(fixtureHome, 'AppData', 'Roaming'), localAppData: path.join(fixtureHome, 'AppData', 'Local') } : undefined,
      { protectedDirs:[dataDir], offline:Boolean(fixtureRoot) });
    priceSync = usage.priceSync;
    powerMonitor.on('suspend', () => service.suspend());
    powerMonitor.on('resume', () => { void service.resume(); });
    const usageState = known => usage.get(known);
    const usageHandle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); await usage.ensureReady(); return action(...args); });
    const connectionInput = () => {
      const facts = usage.facts();
      return { catalog: facts.catalog, collection: { enabled: facts.settings.enabled, checkedAt: facts.checkedAt },
        statuses: facts.statuses, disabled: facts.settings.sources.disabled,
        custom: Object.fromEntries(Object.entries(facts.customSources || {}).map(([id, source]) => [id, { enabled: source.enabled }])),
        discovered: (usage.discovery?.sources || []).map(source => ({ agent: source.agent, installed: source.installed })) };
    };
    const providerFacts = () => { const state = providerQuota.state(); return { providerAccounts: state.accounts, providerCapabilities: state.capabilities }; };
    usageHandle('usage:connections',()=>projectConnections({...connectionInput(),quota:{...service.stateV2(),...providerFacts()}}));
    installResourceReads(ipcMain, valid, { stateV2: () => { const state = service.stateV2(), extra = providerFacts(); return { ...state, ...extra, accounts: [...state.accounts, ...extra.providerAccounts] }; } }, connectionInput);
    const antigravitySetup = createAntigravitySetup({ discover: () => discoverAntigravity(runtimeDiscoveryEnvironment()), openExternal: url => shell.openExternal(url), writeText: text => clipboard.writeText(text) });
    installRuntimeDiscovery(ipcMain, valid, antigravitySetup.scan);
    installAntigravitySetup(ipcMain, valid, antigravitySetup);
    const agentSetup = createAgentSetup({ catalog: () => usage.catalog(), facts: agent => { const facts = usage.facts(); return { enabled: facts.settings.enabled !== false && !facts.settings.sources.disabled.includes(agent) && facts.customSources?.[agent]?.enabled !== false, status: facts.statuses[agent], quota: agent === 'codex' ? service.state() : null }; }, environment: runtimeDiscoveryEnvironment, antigravity: antigravitySetup, openExternal: url => shell.openExternal(url), writeText: text => clipboard.writeText(text) });
    installAgentSetup(ipcMain, valid, agentSetup);
    installers = new AgentInstallService(path.join(dataDir, 'agent-tools'), () => ({ ...runtimeDiscoveryEnvironment(), arch: process.arch, systemRoot: process.env.SystemRoot, temp: app.getPath('temp') }), { fixture: Boolean(fixtureRoot), openPath: file => shell.openPath(file), openExternal: url => shell.openExternal(url), writeText: text => clipboard.writeText(text), changed: () => { if (!quitting && !window.isDestroyed()) window.webContents.send('usage:installUpdate'); } });
    installAgentInstaller(ipcMain, valid, installers);
    usageHandle('usage:workbench',selection=>usage.workbench(selection));
    usageHandle('usage:attention',()=>usage.attention());
    usageHandle('usage:workbenchSave',async value=>{const result=await usage.saveWorkbench(value);window.webContents.send('usage:update');return result;});
    usageHandle('usage:reprice',async()=>{const result=await usage.reprice();window.webContents.send('usage:update');return result;});
    usageHandle('usage:exportProjects',async selection=>{
      const {csv,rows}=await usage.exportProjects(selection);
      const result=await dialog.showSaveDialog(window,{title:'导出项目用量',defaultPath:'AgentUsage-projects.csv',filters:[{name:'CSV',extensions:['csv']}]});
      if(result.canceled)return {canceled:true};await fs.promises.writeFile(result.filePath,csv,{mode:0o600});return {saved:true,rows};
    });
    usageHandle('usage:customDraft', id => usage.custom.draft(id));
    usageHandle('usage:customChoose', async token => {
      await usage.custom.get(token);
      const result=await dialog.showOpenDialog(window,{title:'选择自定义 Agent 用量目录',properties:['openDirectory','multiSelections']});
      return result.canceled ? {canceled:true} : usage.custom.choose(token,result.filePaths);
    });
    usageHandle('usage:customSample', token => usage.custom.sample(token));
    usageHandle('usage:customPreview', (token,config) => usage.custom.preview(token,config));
    usageHandle('usage:customApply', async id => {const result=await usage.custom.apply(id);return {...result,state:await usageState()};});
    usageHandle('usage:customChange', async (id,action,value) => {const result=await usage.custom.change(id,action,value);return {...result,state:await usageState()};});
    usageHandle('usage:customImport', async () => {
      const result=await dialog.showOpenDialog(window,{title:'导入 JSONL 解析配置',properties:['openFile'],filters:[{name:'解析配置',extensions:['json']}]});
      if(result.canceled)return {canceled:true};
      const file=localPath(result.filePaths[0]), stat=fs.lstatSync(file);
      if(!stat.isFile() || stat.isSymbolicLink() || stat.size>1024*1024 || /^(?:auth|credentials|config|settings|storage|tokens?)(?:[._-]|$)/i.test(path.basename(file)))throw new Error('CUSTOM_CONFIG_INVALID');
      return usage.custom.import(JSON.parse(fs.readFileSync(file,'utf8')));
    });
    usageHandle('usage:customExport', async id => {
      const config=await usage.custom.export(id), result=await dialog.showSaveDialog(window,{title:'导出解析配置',defaultPath:'AgentUsage-parser.json',filters:[{name:'JSON',extensions:['json']}]});
      if(result.canceled)return {canceled:true};
      fs.writeFileSync(result.filePath,JSON.stringify(config,null,2),{mode:0o600});return {saved:true};
    });
    usageHandle('usage:get', known => usageState(known));
    usageHandle('usage:getPacked', known => usage.getPacked(known));
    usageHandle('usage:performanceState',(...args)=>{if(args.length)throw Error('STATISTICS_COMMAND_REJECTED');return usage.performanceState();});
    ipcMain.handle('usage:statisticsDiagnostics', (event, ...args) => {
      if (!valid(event)) throw Error('IPC_SENDER_REJECTED');
      if (args.length) throw Error('STATISTICS_COMMAND_REJECTED');
      return usage.diagnostics();
    });
    usageHandle('usage:refreshPacked', async known => { await usage.refresh(); return usage.getPacked(known); });
    usageHandle('usage:refresh', async () => { await usage.refresh(); return usageState(); });
    usageHandle('usage:enabled', async value => { await usage.setEnabled(value); return usageState(); });
    usageHandle('usage:interval', async value => { await usage.setRefreshInterval(value); return usageState(); });
    usageHandle('usage:subscription', async (agent, fee) => { await usage.setSubscription(agent, fee); return usageState(); });
    // The session page's own channel; the statistics export never sees it.
    usageHandle('usage:sessions', (selection, packed = false) => { if (typeof packed !== 'boolean') throw Error('SESSION_SELECTION_INVALID'); return packed ? usage.sessionsPacked(selection) : usage.sessions(selection); });
    usageHandle('usage:sessionSummary', selection => usage.sessionSummary(selection));
    // Names and pins the person gives sessions: the app's own file, keyed by the hashed session key.
    const sessionLabels = new SessionLabels(usageDir);
    usageHandle('usage:sessionLabels', () => sessionLabels.all());
    usageHandle('usage:sessionLabel', (key, patch) => sessionLabels.set(key, patch));
    usageHandle('usage:copyResume', async key => {
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('SESSION_NOT_FOUND');
      const command = await usage.resume(key);
      if (!command) throw new Error('SESSION_NOT_RESUMABLE');
      await writeClipboard(clipboard,command); return { copied: true };
    });
    // The reading view: one session's conversation, read on request and returned to the window only.
    usageHandle('usage:transcript', async (key, request) => {
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('TRANSCRIPT_NOT_FOUND');
      if (request !== undefined) require('../m1/transcript-continuation').validate(request);
      return request === undefined ? usage.transcript(key) : usage.transcript(key, request);
    });
    // An open conversation's items in full and find over its full text, re-read from the record.
    for (const [channel, method, fields] of [['usage:transcriptPart', 'transcriptPart', ['stamp', 'index', 'field', 'offset']], ['usage:transcriptFind', 'transcriptFind', ['stamp', 'query']]]) {
      usageHandle(channel, async (key, request) => {
        if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('TRANSCRIPT_NOT_FOUND');
        if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('TRANSCRIPT_PART_INVALID');
        return usage[method](key, Object.fromEntries(fields.filter(field => request[field] !== undefined).map(field => [field, request[field]])));
      });
    }
    // Part of an open conversation as Markdown, in full: copied, or saved where the person chooses.
    usageHandle('usage:transcriptStamp', key => { if (typeof key !== 'string') throw new Error('TRANSCRIPT_NOT_FOUND'); return usage.transcriptStamp(key); });
    usageHandle('usage:transcriptFileHistory', request => { if (!request || typeof request !== 'object') throw new Error('TRANSCRIPT_SEARCH_INVALID'); return usage.transcriptFileHistory({ key: request.key, path: request.path, offset: request.offset ?? 0 }); });
    usageHandle('usage:transcriptFacts', key => { if (typeof key !== 'string') throw new Error('TRANSCRIPT_NOT_FOUND'); return usage.transcriptFacts(key); });
    const transcriptMarkdown = (key, request) => {
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('TRANSCRIPT_NOT_FOUND');
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('TRANSCRIPT_PART_INVALID');
      return usage.transcriptMarkdown(key, { stamp: request.stamp, from: request.from, to: request.to, plain: request.plain === true });
    };
    usageHandle('usage:transcriptCopy', async (key, request) => { const text = await transcriptMarkdown(key, request); await writeClipboard(clipboard,text); return { copied: true }; });
    usageHandle('usage:transcriptExport', async (key, request) => {
      const text = await transcriptMarkdown(key, request);
      const name = (typeof request.name === 'string' ? request.name : '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'AgentUsage-session';
      const result = await dialog.showSaveDialog(window, { title: '导出对话', defaultPath: name + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      await fs.promises.writeFile(result.filePath, text, { mode: 0o600 }); return { saved: true };
    });
    // A link in a conversation, opened in the default browser when the person clicks it: http and https only.
    usageHandle('usage:openLink', async url => {
      let parsed; try { parsed = new URL(url); } catch { throw new Error('LINK_REJECTED'); }
      if (typeof url !== 'string' || url.length > 2048 || !['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('LINK_REJECTED');
      await shell.openExternal(parsed.href); return { opened: true };
    });
    // Search across conversations: files scanned now, results returned to the window only.
    usageHandle('usage:searchTranscripts', async request => {
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('TRANSCRIPT_SEARCH_INVALID');
      return usage.searchTranscripts({ query: request.query, range: request.range, agent: request.agent, offset: request.offset });
    });
    usageHandle('usage:copyText', async text => {
      if (typeof text !== 'string') throw new Error('TEXT_INVALID');
      await writeClipboard(clipboard,text); return { copied: true };
    });
    // Only a location this app is already reading: the page cannot name any other path.
    usageHandle('usage:revealSourcePath', async file => {
      if (typeof file !== 'string' || !(usage.discovery?.sources || []).some(source => source.paths?.some(entry => entry.path === file))) throw new Error('SOURCE_PATH_UNKNOWN');
      if (!fs.existsSync(file)) throw new Error('DIRECTORY_MISSING');
      shell.showItemInFolder(file); return { shown: true };
    });
    usageHandle('usage:openFolder', async key => {
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('SESSION_NOT_FOUND');
      const dir = await usage.directory(key);
      if (!dir) throw new Error('DIRECTORY_NOT_FOUND');
      if (!fs.existsSync(dir)) throw new Error('DIRECTORY_MISSING');
      const error = await shell.openPath(dir);
      if (error) throw new Error(error);
      return { opened: true, path: dir };
    });
    usageHandle('usage:pricing', async () => ({...await usage.pricing(), sync:priceSync.state()}));
    usageHandle('usage:priceSync', () => priceSync.sync());
    usageHandle('usage:priceAuto', enabled => priceSync.setEnabled(enabled));
    usageHandle('usage:billingSave', async value => { const result = await usage.setBilling(value); await priceSync.start(); window.webContents.send('usage:update'); return result; });
    usageHandle('usage:priceSave', async entry => { await usage.setPrice(entry); window.webContents.send('usage:update'); return usage.pricing(); });
    usageHandle('usage:priceReset', async entry => { await usage.setPrice(entry, true); window.webContents.send('usage:update'); return usage.pricing(); });
    // Dry run for the editor: validates the entry and reports what a save would change, without writing.
    usageHandle('usage:priceProbe', entry => usage.probe(entry));
    usageHandle('usage:agentUse', request => usage.agentUse(request));
    usageHandle('usage:priceTry', request => usage.priceTry(request));
    usageHandle('usage:pricePlan', request => usage.pricePlan(request));
    usageHandle('usage:codexPreview', () => usage.refresh(true));
    usageHandle('usage:codexApply', async id => {
      const preview = usage.maintenancePreview();
      if (typeof id !== 'string' || !preview || preview.summary.id !== id) throw new Error('MAINTENANCE_STALE');
      const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '备份并重建'], defaultId: 0, cancelId: 0, message: '应用预览中的 Codex 用量重建？', detail: '只更新本应用统计。自动保存备份，保留无法重读的历史；原始日志与账号连接不变。' });
      if (result.response !== 1) return { canceled: true };
      await usage.applyMaintenance(id); return { applied: true, state: await usageState() };
    });
    usageHandle('usage:export', async payload => {
      // Re-project in the statistics owner: renderer edits never export secrets.
      const snapshot = await usage.serializeStatistics(payload);
      const result = await dialog.showSaveDialog(window, { title: '导出统计', defaultPath: 'AgentUsage-statistics.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (result.canceled) return { canceled: true };
      await fs.promises.writeFile(result.filePath, snapshot.json, { mode: 0o600 }); return { saved: true, rows: snapshot.rows };
    });
    // The cost page's CSV: the window names the grouping and dates; the rows come from this process's snapshot.
    usageHandle('usage:exportCost', async request => {
      const result = await usage.exportCost(request);
      const saved = await dialog.showSaveDialog(window, { title: '导出费用', defaultPath: result.fileName, filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (saved.canceled) return { canceled: true };
      await fs.promises.writeFile(saved.filePath, result.csv, { mode: 0o600 }); return { saved: true, rows: result.rows };
    });
    // Preference persistence and filesystem discovery are separate outcomes. A
    // failed discovery must never report a successfully saved selection as lost.
    const sourceSelection = () => {const facts = usage.facts();const builtins=SOURCES.map(agent => {
      const saved = facts.settings.sources, enabled = !saved.disabled.includes(agent), paths = [];
      for (const file of [...(facts.defaults[agent] || []), ...(saved.added[agent] || [])]) if (!paths.some(entry => scope.same(entry.path, file))) paths.push({ path: file, origin: scope.contains(saved.added[agent], file) ? 'added' : 'auto', state: scope.contains(saved.excluded[agent], file) ? 'excluded' : enabled ? 'included' : 'stopped' });
      return { agent, enabled, paths };
    });return builtins.concat(Object.values(facts.customSources || {}).map(source=>({agent:source.id,enabled:source.enabled&&!source.archived,paths:source.roots.map(root=>({path:root,origin:'custom',state:source.enabled&&!source.archived?'included':'stopped'}))})));};
    const saveSource = (name, ...args) => usage.changeSources(name, ...args);
    const sourceResult = async () => {
      const selection = sourceSelection();
      try {
        // A discovery already in flight was started with the previous scope.
        if (usage.discovering) try { await usage.discovering; } catch { /* Retry the new selection below. */ }
        return { saved: true, selection, discovery: await usage.discover(), discoveryError: null, state: await usageState() };
      }
      catch { return { saved: true, selection, discovery: null, discoveryError: 'DISCOVERY_FAILED', state: await usageState() }; }
    };
    usageHandle('usage:chooseSource', async agent => {
      if (!SOURCES.includes(agent)) throw new Error('SOURCE_REJECTED');
      const result = await dialog.showOpenDialog(window, agent === 'cursor' ? { title: '选择 Cursor SDK index.db、runs.ndjson 或用量 CSV', properties: ['openFile'], filters:[{name:'Cursor 用量记录',extensions:['db','csv','ndjson']}] } : { title: '选择本地用量目录', properties: ['openDirectory'] });
      if (result.canceled) return { ...await usageState(), sourceSaved: false };
      const selected = localPath(result.filePaths[0]), normalized = selected.toLowerCase();
      for (const protectedDir of [usageDir, dataDir]) { const own = protectedDir.toLowerCase(); if (normalized === own || normalized.startsWith(own + path.sep) || own.startsWith(normalized + path.sep)) throw new Error('SOURCE_PRODUCT_OVERLAP'); }
      if(Object.values(usage.facts().customSources || {}).some(source=>(source.reservedRoots || source.roots).some(root=>require('../m1/jsonl-adapter').overlaps(root,selected))))throw new Error('CUSTOM_SOURCE_OVERLAP');
      if (agent === 'cursor' && (!allowedFile(agent,selected) || !fs.lstatSync(selected).isFile())) throw new Error('SOURCE_FILE_REJECTED');
      await usage.setEnabled(false); await saveSource('add', agent, selected); return { ...await usageState(), sourceSaved: true, sourceSelection: sourceSelection() };
    });
    // Source scope changes other than adding: adding always goes through the dialog
    // above, so the renderer can only name a path the scope already knows.
    usageHandle('usage:sources', () => usage.discover());
    usageHandle('usage:sourceChange', async (name, agent, value) => {
      const known = file => typeof file === 'string' && [usage.facts().defaults[agent], usage.facts().settings.sources.added[agent], usage.facts().settings.sources.excluded[agent]].some(list => scope.contains(list, file));
      if (name === 'all') { if (typeof value !== 'boolean') throw new Error('INVALID_SETTING'); if(usage.busy())throw new Error('CUSTOM_BUSY');await saveSource('all', value);for(const source of Object.values(usage.facts().customSources || {}))if(!source.archived)await usage.custom.change(source.id,'enable',value); }
      else if (!SOURCES.includes(agent)) throw new Error('SOURCE_REJECTED');
      else if (name === 'enable') { if (typeof value !== 'boolean') throw new Error('INVALID_SETTING'); await saveSource('enable', agent, value); }
      else if (name === 'reset') await saveSource('reset', agent);
      else if (name === 'remove' || name === 'include') { if (!known(value)) throw new Error('SOURCE_REJECTED'); await saveSource(name, agent, value); }
      else throw new Error('INVALID_SETTING');
      if (usage.facts().settings.enabled) void usage.refresh();
      return sourceResult();
    });
    const handle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); try { return { ok: true, state: await action(...args) }; } catch (error) { const errorCode = safeCode(error); return { ok: false, errorCode, error: MESSAGES[errorCode], state: service.state() }; } });
    const connectionId = id => { if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('ACCOUNT_NOT_FOUND'); return id; };
    handle('quota:get', () => service.state());
    handle('quota:login', async alias => { if (typeof alias !== 'string' || alias.length > 48) throw new Error('ALIAS_INVALID'); if (!service.runtimeBusy()) service.executable = selectedExecutable(); const result = await service.begin(alias); try { await chromeBrowser.openChrome(result.authUrl); } catch (error) { await service.cancel(); throw error; } return service.state(); });
    handle('quota:cancel', async () => { await service.cancel(); return service.state(); });
    handle('quota:refresh', id => { if (!service.runtimeBusy()) service.executable = selectedExecutable(); return service.refresh(connectionId(id)); });
    handle('quota:refreshAll', () => { if (!service.runtimeBusy()) service.executable = selectedExecutable(); return service.refreshAll(); });
    handle('quota:setAutoRefresh', value => service.setAutoRefresh(value));
    handle('quota:remove', async id => { const account = service.account(connectionId(id)); const result = await dialog.showMessageBox(window, { type: 'question', buttons: ['取消', '退出此账号并移除'], defaultId: 0, cancelId: 0, message: '移除 ' + account.alias + '？', detail: '仅退出本应用的独立连接并移除额度缓存。其他客户端是否保持登录需在验收时确认。' }); if (result.response === 1) await service.remove(id); return service.state(); });
    handle('quota:chooseExecutable', async () => { if (service.runtimeBusy()) throw new Error('RUNTIME_BUSY'); const result = await dialog.showOpenDialog(window, { title: '选择官方 Codex CLI 的 codex.exe', properties: ['openFile'], filters: [{ name: 'Codex', extensions: ['exe'] }] }); if (!result.canceled && path.basename(result.filePaths[0]).toLowerCase() === 'codex.exe') { if (service.runtimeBusy()) throw new Error('RUNTIME_BUSY'); service.executable = result.filePaths[0]; fs.writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify({ executable: service.executable })); } return service.state(); });
    await window.loadFile(path.join(__dirname, '../../design/desktop-reference/index.html'));
    // Started by Windows at login: stays in the tray, with the window a click away.
    if (!quitting && !window.isDestroyed() && !(process.argv.includes('--hidden') && desktopShell.tray)) window.show();
    if (!quitting) { lookSoon(); void usage.start().catch(() => { if (!quitting && !window.isDestroyed()) window.webContents.send('usage:update'); }); }
    // Updates wait for the window: a check shortly after start-up, then every few hours. Only a packaged build does this.
    if (!quitting) updates.start();
  }).catch(() => { if (!quitting) { dialog.showErrorBox('Agent Usage Quota', '额度窗口初始化失败，请检查独立数据目录。'); app.exit(1); } });
  app.on('before-quit', event => {
    if (stopped) { desktopShell?.close(); updates?.close(); return; }
    event.preventDefault();
    void shutdown().then(() => app.quit()).catch(() => {
      try { dialog.showErrorBox('Agent Usage Quota', '子进程退出等待失败，请重试退出；若仍失败，请在任务管理器确认该应用的进程已结束。'); } catch { /* the window may already be gone */ }
    });
  });
}
