'use strict';
// Explicit local acceptance only. Builds isolated NSIS identities and installs
// them under --root; no production install, credentials, GitHub write or tag.
// node scripts/local/auto-update-acceptance.js prepare|build|test --root <new absolute directory>
// resume-diff is only for a retained run whose first installed upgrade passed.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const repo = path.resolve(__dirname, '../..'), versions = ['0.1.0', '0.1.1', '0.1.2'];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
function inside(root, file) {
  const relative = path.relative(root, path.resolve(file));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'test path must be inside its owned root');
}
function config(root) {
  const value = JSON.parse(fs.readFileSync(path.join(root, 'acceptance.json'), 'utf8'));
  assert.equal(value.root, root); assert.match(value.appId, /^local\.agentusage\.updateacceptance\.\d+$/);
  assert.match(value.productName, /^Agent Usage Update Test \d+$/);
  assert(Number.isInteger(value.feedPort) && value.feedPort > 1024 && value.feedPort < 65536);
  for (const name of ['source', 'home', 'usage', 'data', 'localData', 'profile', 'install', 'packages']) inside(root, value[name]);
  return value;
}
async function availablePort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function cleanBuildEnvironment() {
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  for (const key of Object.keys(env)) if (/^(GH_TOKEN|GITHUB_TOKEN|CSC_|WIN_CSC_|AZURE_|AWS_|APPLE_)/.test(key)) delete env[key];
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'; return env;
}
async function command(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { acceptCodes = [0], ...spawnOptions } = options;
    const child = spawn(executable, args, { windowsHide: true, ...spawnOptions });
    child.once('error', reject); child.once('exit', code => acceptCodes.includes(code) ? resolve() : reject(new Error('COMMAND_EXIT_' + code)));
  });
}
// This bootstrap is test-only. Product files are unchanged; every restart uses
// synthetic state and the updater partition is restricted to the loopback feed.
function bootstrap() {
  const fs = require('node:fs'), path = require('node:path');
  const { app, safeStorage, session, BrowserWindow } = require('electron');
  const c = require('../../acceptance-runtime.json');
  const rendererErrors = [];
  app.on('web-contents-created', (_event, contents) => contents.on('console-message', (event, level, message) => {
    const severity = typeof level === 'number' ? level : event.level;
    if (severity >= 3 || severity === 'error') rendererErrors.push(typeof message === 'string' ? message : event.message);
  }));
  for (const [name, value] of Object.entries({ APPDATA: c.profile, LOCALAPPDATA: c.localData, USERPROFILE: c.home })) process.env[name] = value;
  app.setPath('home', c.home); app.setPath('appData', c.profile);
  process.argv.push('--quota-data-dir', c.data, '--usage-data-dir', c.usage, '--m1-fixture-root', c.home);
  app.whenReady().then(() => {
    session.fromPartition('electron-updater', { cache: false }).webRequest.onBeforeRequest((details, done) => {
      let allowed = false;
      try { const url = new URL(details.url); allowed = url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === String(c.feedPort); } catch { /* deny */ }
      done({ cancel: !allowed });
    });
    const file = path.join(c.data, 'github', 'token.bin'), secret = 'synthetic-update-acceptance-token';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify({ token: secret })));
    let encryptedRecordReadable = false;
    try { encryptedRecordReadable = JSON.parse(safeStorage.decryptString(fs.readFileSync(file))).token === secret; } catch { /* record false */ }
    const receipt = { version: app.getVersion(), pid: process.pid, executable: process.execPath, updated: process.argv.includes('--updated'), encryptedRecordReadable };
    let lastId = 0, handling = false;
    try { lastId = JSON.parse(fs.readFileSync(path.join(c.root, 'control.json'), 'utf8')).id || 0; } catch { /* first boot */ }
    fs.writeFileSync(path.join(c.root, 'running.json'), JSON.stringify(receipt, null, 2));
    fs.appendFileSync(path.join(c.root, 'starts.jsonl'), JSON.stringify(receipt) + '\n');
    const timer = setInterval(async () => {
      let command;
      try { command = JSON.parse(fs.readFileSync(path.join(c.root, 'control.json'), 'utf8')); } catch { return; }
      if (command.quit === true) { app.quit(); return; }
      if (handling || !Number.isSafeInteger(command.id) || command.id <= lastId) return;
      handling = true; lastId = command.id;
      try {
        const win = BrowserWindow.getAllWindows().find(value => !value.isDestroyed());
        if (!win) throw Error('window not ready');
        let value;
        // Fixed actions, on this test app only: no arbitrary evaluation or paths.
        if (command.action === 'status') {
          value = await win.webContents.executeJavaScript('(async()=>({state:(await window.updateBridge.get()).state,marker:localStorage.getItem("update-acceptance-marker"),dark:document.body.classList.contains("dark"),title:document.title,content:document.getElementById("app")?.textContent.length||0}))()');
          value.errors = rendererErrors.slice();
        }
        else if (command.action === 'about') {
          win.webContents.send('window:command', 'settings');
          await new Promise(resolve => setTimeout(resolve, 200));
          value = await win.webContents.executeJavaScript('window.settingsUi.openSection("about");true');
        }
        else if (command.action === 'check') value = await win.webContents.executeJavaScript('window.updateBridge.check()');
        else if (command.action === 'cancel') value = await win.webContents.executeJavaScript('window.updateBridge.cancel()');
        else if (command.action === 'marker') value = await win.webContents.executeJavaScript('localStorage.setItem("update-acceptance-marker","synthetic-retained");window.settingsHost.theme.set("dark");true');
        else if (command.action === 'install') value = await win.webContents.executeJavaScript('(()=>{const b=document.querySelector("[data-about-update] button");if(!b||b.textContent.trim()!=="重启并更新")throw Error("restart button not ready");b.click();return true})()');
        else if (command.action === 'capture') { fs.writeFileSync(path.join(c.root, 'window-' + app.getVersion() + '.png'), (await win.webContents.capturePage()).toPNG()); value = true; }
        else throw Error('unknown test action');
        fs.writeFileSync(path.join(c.root, 'response.json'), JSON.stringify({ id: command.id, ok: true, value }));
      } catch (error) { fs.writeFileSync(path.join(c.root, 'response.json'), JSON.stringify({ id: command.id, ok: false, error: error.message })); }
      finally { handling = false; }
    }, 200); timer.unref();
  });
  require('./main');
}
async function prepare(root) {
  assert(path.isAbsolute(root), '--root must be absolute'); assert(!fs.existsSync(root), 'prepare requires a new directory');
  fs.mkdirSync(root, { recursive: true });
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
  const c = { root, appId: 'local.agentusage.updateacceptance.' + stamp, name: 'agent-usage-update-acceptance-' + stamp,
    productName: 'Agent Usage Update Test ' + stamp, source: path.join(root, 'source'), home: path.join(root, 'synthetic-home'),
    usage: path.join(root, 'usage'), data: path.join(root, 'app-state'), localData: path.join(root, 'synthetic-home', 'AppData', 'Local'),
    profile: path.join(root, 'profile'), install: path.join(root, '安装 目录'), packages: path.join(root, 'packages'),
    feedPort: await availablePort(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim() };
  write(path.join(root, 'acceptance.json'), c);
  for (const key of ['source', 'home', 'usage', 'data', 'localData', 'profile', 'packages']) fs.mkdirSync(c[key], { recursive: true });
  const archive = path.join(root, 'source.tar');
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, c.head], { cwd: repo });
  await require('tar').x({ file: archive, cwd: c.source });
  await finishPrepare(c);
}
async function finishPrepare(c) {
  const root = c.root;
  assert(!fs.existsSync(path.join(c.source, 'acceptance-runtime.json')), 'already prepared');
  console.log('COPYING_LOCAL_DEPENDENCIES');
  await command('robocopy', [path.join(repo, 'node_modules'), path.join(c.source, 'node_modules'), '/E', '/COPY:DAT', '/R:1', '/W:1', '/XJ', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
    { acceptCodes: [0, 1, 2, 3, 4, 5, 6, 7], stdio: 'ignore' });
  const pkg = JSON.parse(fs.readFileSync(path.join(c.source, 'package.json'), 'utf8'));
  pkg.name = c.name; pkg.productName = c.productName; pkg.main = 'src/quota/acceptance-bootstrap.js';
  pkg.build.appId = c.appId; pkg.build.productName = c.productName;
  pkg.build.files.push('acceptance-runtime.json');
  pkg.build.electronDist = path.join(repo, 'node_modules/electron/dist');
  pkg.build.publish = [{ provider: 'github', owner: 'ydan120980-source', repo: 'token', host: '127.0.0.1:' + c.feedPort, protocol: 'http' }];
  Object.assign(pkg.build.nsis, { artifactName: 'Acceptance-' + '$' + '{version}.' + '$' + '{ext}', createDesktopShortcut: false, createStartMenuShortcut: false });
  write(path.join(c.source, 'package.json'), pkg); write(path.join(c.source, 'acceptance-runtime.json'), c);
  fs.writeFileSync(path.join(c.source, 'src/quota/acceptance-bootstrap.js'), '(' + bootstrap.toString() + ')();\n');
  require('../../tests/m1/ui-style-fixture').seed(c.home, c.usage);
  new (require('../../src/m1/session-labels').SessionLabels)(c.usage).set('a'.repeat(64), { alias: 'Synthetic acceptance reading', pinned: true, turn: 17, group: 'Synthetic group' });
  console.log(JSON.stringify({ prepared: true, head: c.head, root, identity: c.appId, loopbackPort: c.feedPort }));
}
async function build(root) {
  const c = config(root), file = path.join(c.source, 'package.json'), pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(path.join(c.source, 'src/quota/acceptance-bootstrap.js'), '(' + bootstrap.toString() + ')();\n');
  for (const version of versions) {
    const output = path.join(c.packages, version); assert(!fs.existsSync(output), 'build output must be new: ' + version);
    pkg.version = version; pkg.build.directories.output = output; write(file, pkg);
    const log = fs.openSync(path.join(root, 'build-' + version + '.log'), 'wx'); console.log('BUILDING ' + version);
    try {
      await command(process.execPath, [path.join(repo, 'node_modules/electron-builder/out/cli/cli.js'), '--projectDir', c.source, '--win', 'nsis', '--x64', '--publish', 'never'], { env: cleanBuildEnvironment(), stdio: ['ignore', log, log] });
      await command(process.execPath, [path.join(c.source, 'scripts/m1/audit-package.js'), path.join(output, 'win-unpacked')], { env: cleanBuildEnvironment(), stdio: ['ignore', log, log] });
    } finally { fs.closeSync(log); }
    const feed = require('js-yaml').load(fs.readFileSync(path.join(output, 'win-unpacked/resources/app-update.yml'), 'utf8'));
    assert.equal(feed.provider, 'github'); assert.equal(feed.host, '127.0.0.1:' + c.feedPort); assert.equal(feed.protocol, 'http');
    console.log('BUILT_AND_AUDITED ' + version);
  }
}
async function serve(c) {
  const state = { head: 0, offline: false, corrupt: false, slow: false, requests: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const row = { path: url.pathname, range: req.headers.range || null, bytes: 0, at: Date.now() }; state.requests.push(row);
    const send = (status, body, type = 'text/plain') => { res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) }); res.end(body); };
    if (state.offline) return send(503, 'synthetic unavailable');
    if (url.pathname.endsWith('/releases.atom')) {
      const entries = versions.slice(0, state.head + 1).reverse().map(version => '<entry><id>v' + version + '</id><title>Acceptance ' + version + '</title><updated>2026-11-08T00:00:00Z</updated><link href="http://127.0.0.1:' + c.feedPort + '/ydan120980-source/token/releases/tag/v' + version + '"/><content>Synthetic release</content></entry>').join('');
      return send(200, '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>acceptance</id><title>Acceptance</title>' + entries + '</feed>', 'application/atom+xml');
    }
    const match = /^\/ydan120980-source\/token\/releases\/download\/v(0\.1\.[012])\/([^/]+)$/.exec(url.pathname);
    if (!match || !['latest.yml', 'Acceptance-' + match[1] + '.exe', 'Acceptance-' + match[1] + '.exe.blockmap'].includes(match[2])) return send(404, 'not found');
    if (versions.indexOf(match[1]) > state.head) return send(404, 'draft invisible');
    const file = path.join(c.packages, match[1], match[2]);
    if (match[2] === 'latest.yml') {
      let body = fs.readFileSync(file, 'utf8');
      if (state.corrupt) body = body.replace(/sha512: .+/g, 'sha512: ' + Buffer.alloc(64, 7).toString('base64'));
      return send(200, body, 'text/yaml');
    }
    const size = fs.statSync(file).size, range = req.headers.range && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    const start = range ? Number(range[1]) : 0, end = range && range[2] ? Number(range[2]) : size - 1;
    if (start > end || end >= size) return send(416, 'bad range');
    const headers = { 'Content-Length': end - start + 1, 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    if (range) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
    res.writeHead(range ? 206 : 200, headers);
    const stream = fs.createReadStream(file, { start, end, highWaterMark: state.slow ? 64 * 1024 : 512 * 1024 });
    stream.on('data', chunk => { row.bytes += chunk.length; });
    if (state.slow) stream.on('data', () => { stream.pause(); setTimeout(() => stream.resume(), 20); });
    stream.pipe(res); res.on('close', () => stream.destroy());
  });
  await new Promise(resolve => server.listen(c.feedPort, '127.0.0.1', resolve));
  return { state, server };
}
async function until(test, description, timeout = 120000) {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) {
    try { const value = await test(); if (value) return value; } catch (error) { last = error.message; }
    await sleep(200);
  }
  throw new Error('TIMEOUT: ' + description + (last ? ' (' + last + ')' : ''));
}
let commandId = Date.now();
async function rpc(c, action) {
  const id = ++commandId; write(path.join(c.root, 'control.json'), { id, action });
  const reply = await until(() => {
    const value = JSON.parse(fs.readFileSync(path.join(c.root, 'response.json'), 'utf8'));
    return value.id === id && value;
  }, 'owned app action ' + action, 15000);
  assert.equal(reply.ok, true, reply.error); return reply.value;
}
async function attach(c, expected) {
  return until(async () => {
    const receipt = JSON.parse(fs.readFileSync(path.join(c.root, 'running.json'), 'utf8'));
    if (receipt.version !== expected) return false;
    inside(c.root, receipt.executable);
    const value = await rpc(c, 'status');
    return value.state.current === expected && value.content > 100 && { c };
  }, 'attach installed version ' + expected);
}
async function about(connected) { await rpc(connected.c, 'about'); await sleep(300); }
async function update(connected) { return (await rpc(connected.c, 'status')).state; }
async function check(connected) { const reply = await rpc(connected.c, 'check'); assert.equal(reply.ok, true, JSON.stringify(reply)); }
function snapshot(c) {
  const stat = JSON.parse(fs.readFileSync(path.join(c.usage, 'statistics.json'), 'utf8'));
  return { records: hash(JSON.stringify(stat.records)), recordCount: Object.keys(stat.records).length,
    labels: hash(fs.readFileSync(path.join(c.usage, 'session-labels.json'))),
    connection: hash(fs.readFileSync(path.join(c.data, 'github/token.bin'))) };
}
async function stop(c) {
  const receipt = JSON.parse(fs.readFileSync(path.join(c.root, 'running.json'), 'utf8'));
  inside(c.root, receipt.executable);
  write(path.join(c.root, 'control.json'), { quit: true });
  await until(() => { try { process.kill(receipt.pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }, 'owned application exit', 30000);
  write(path.join(c.root, 'control.json'), { quit: false });
}
async function run(root) {
  const c = config(root), result = { head: c.head, isolatedIdentity: c.appId, tests: [] };
  const { state, server } = await serve(c); let connected = null;
  const record = (name, details = {}) => { result.tests.push({ name, ...details }); write(path.join(root, 'results.json'), result); console.log('PASS ' + name); };
  try {
    inside(root, c.install); assert(!fs.existsSync(c.install), 'never overwrite a prior install');
    console.log('INSTALLING_ISOLATED_BASELINE');
    await command(path.join(c.packages, versions[0], 'Acceptance-' + versions[0] + '.exe'), ['/S', '--current-user', '/D=' + c.install],
      { windowsVerbatimArguments: true, stdio: 'ignore', env: { ...process.env, USERPROFILE: c.home, LOCALAPPDATA: c.localData, APPDATA: c.profile } });
    const exe = path.join(c.install, c.productName + '.exe');
    assert(fs.existsSync(exe), 'installer used the chosen non-ASCII directory');
    write(path.join(root, 'control.json'), { quit: false });
    spawn(exe, [], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    connected = await attach(c, versions[0]); await about(connected);
    await until(async () => (await update(connected)).status === 'latest', 'automatic startup check', 45000);
    assert(state.requests.some(row => row.path.endsWith('/releases.atom')));
    assert(!state.requests.some(row => row.path.includes('/v0.1.1/')), 'unpublished candidate is invisible');
    record('installed-startup-check-and-draft-isolation');
    state.offline = true; await check(connected);
    assert.equal((await update(connected)).status, 'error');
    record('unavailable-feed-keeps-installed-version');
    state.offline = false; state.head = 1; state.corrupt = true; await check(connected);
    await until(async () => (await update(connected)).error === 'UPDATE_VERIFY_FAILED', 'checksum rejection');
    record('checksum-mismatch-rejected');
    await sleep(300); state.corrupt = false; state.slow = true;
    const requestAt = state.requests.length; await check(connected);
    await until(() => state.requests.slice(requestAt).some(row => row.path.endsWith('.exe') && row.bytes > 128 * 1024), 'real transfer before cancel');
    const cancelled = await rpc(c, 'cancel');
    assert.equal(cancelled.ok, true); assert.equal(cancelled.state.status, 'available');
    state.slow = false; await check(connected);
    await until(async () => (await update(connected)).status === 'downloaded', 'retry download');
    record('real-download-cancel-and-immediate-retry');
    await rpc(c, 'marker');
    const before = snapshot(c), runningBefore = JSON.parse(fs.readFileSync(path.join(root, 'running.json'), 'utf8'));
    assert.equal(runningBefore.encryptedRecordReadable, true);
    write(path.join(root, 'before-data.json'), before); await rpc(c, 'capture');
    await stop(c, connected); connected = null;
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'running.json'), 'utf8')).version, '0.1.0');
    record('ordinary-quit-does-not-install');
    spawn(exe, [], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    connected = await attach(c, versions[0]); await about(connected); await check(connected);
    await until(async () => (await update(connected)).status === 'downloaded', 'cached update after restart');
    await rpc(c, 'install');
    connected = await attach(c, versions[1]);
    const first = JSON.parse(fs.readFileSync(path.join(root, 'running.json'), 'utf8'));
    assert.equal(first.updated, true); assert.equal(first.encryptedRecordReadable, true); assert.equal(first.executable, exe);
    assert.deepEqual(snapshot(c), before);
    const restored = await rpc(c, 'status');
    assert.equal(restored.marker, 'synthetic-retained'); assert.equal(restored.dark, true);
    assert.equal(hash(fs.readFileSync(path.join(c.install, 'resources/app.asar'))), hash(fs.readFileSync(path.join(c.packages, versions[1], 'win-unpacked/resources/app.asar'))));
    record('silent-upgrade-restart-and-data-retention', { version: first.version, sameInstallDirectory: true, syntheticEncryptedRecordReadable: true });
    state.head = 2; const diffAt = state.requests.length; await check(connected);
    await until(async () => (await update(connected)).status === 'downloaded', 'second update differential download');
    const downloads = state.requests.slice(diffAt).filter(row => row.path.endsWith('/Acceptance-0.1.2.exe'));
    const total = downloads.reduce((sum, row) => sum + row.bytes, 0), full = fs.statSync(path.join(c.packages, versions[2], 'Acceptance-0.1.2.exe')).size;
    assert(downloads.some(row => row.range), 'the real updater issued byte-range requests');
    assert(total < full, 'differential transfer uses fewer bytes than a full installer');
    record('differential-download', { transferredBytes: total, installerBytes: full, rangeRequests: downloads.filter(row => row.range).length });
    await about(connected);
    await rpc(c, 'install');
    connected = await attach(c, versions[2]);
    assert.deepEqual(snapshot(c), before);
    const second = JSON.parse(fs.readFileSync(path.join(root, 'running.json'), 'utf8'));
    assert.equal(second.updated, true); assert.equal(second.encryptedRecordReadable, true); assert.equal(second.executable, exe);
    assert.equal(hash(fs.readFileSync(path.join(c.install, 'resources/app.asar'))), hash(fs.readFileSync(path.join(c.packages, versions[2], 'win-unpacked/resources/app.asar'))));
    record('second-installed-upgrade-and-data-retention', { version: second.version, sameInstallDirectory: true, syntheticEncryptedRecordReadable: true });
    await about(connected); await rpc(c, 'capture');
    const finalUi = await rpc(c, 'status');
    assert(finalUi.content > 100); assert.equal(finalUi.dark, true);
    assert.equal(finalUi.marker, 'synthetic-retained'); assert.deepEqual(finalUi.errors, []); result.passed = true;
  } catch (error) { result.passed = false; result.error = error.stack; throw error; }
  finally {
    if (connected) await stop(c).catch(error => { result.cleanupError = error.message; result.passed = false; process.exitCode = 1; });
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    write(path.join(root, 'http-requests.json'), state.requests); write(path.join(root, 'results.json'), result);
  }
}
// Earlier isolated runs used an extra LOCALAPPDATA override, while NSIS expands
// its known-folder path through USERPROFILE. Align only these two owned cache
// leaves; never map or inspect the person's real LocalAppData.
function alignOwnedCache(c) {
  const target = path.join(c.home, 'AppData', 'Local', c.name + '-updater');
  const original = path.join(c.localData, c.name + '-updater'), backup = path.join(c.root, 'cache-before-alignment');
  for (const file of [target, original, backup]) inside(c.root, file);
  assert.equal(hash(fs.readFileSync(path.join(target, 'installer.exe'))), hash(fs.readFileSync(path.join(c.packages, '0.1.1/Acceptance-0.1.1.exe'))));
  if (path.resolve(target) !== path.resolve(original)) {
    assert(!fs.existsSync(backup), 'preserve the original cache once, never overwrite it');
    inside(fs.realpathSync(c.root), fs.realpathSync(original));
    inside(fs.realpathSync(c.root), fs.realpathSync(target));
    fs.renameSync(original, backup);
    fs.symlinkSync(target, original, 'junction');
  }
  write(path.join(c.root, 'cache-alignment.json'), { oldInstallerMatches: true, source: path.relative(c.root, original), target: path.relative(c.root, target), preserved: path.relative(c.root, backup) });
}
async function resumeDifferential(root) {
  const c = config(root), previous = JSON.parse(fs.readFileSync(path.join(root, 'results.json'), 'utf8'));
  assert.equal(previous.head, c.head);
  assert(previous.tests.some(value => value.name === 'silent-upgrade-restart-and-data-retention'), 'the first installed upgrade must already have passed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'running.json'), 'utf8')).version, '0.1.1');
  alignOwnedCache(c);
  assert(!fs.existsSync(path.join(root, 'results-differential-fallback.json')));
  fs.copyFileSync(path.join(root, 'results.json'), path.join(root, 'results-differential-fallback.json'));
  const result = { head: c.head, isolatedIdentity: c.appId, tests: previous.tests, cacheFixtureAligned: true };
  const { state, server } = await serve(c); state.head = 2;
  let connected;
  try {
    write(path.join(root, 'control.json'), { quit: false });
    const exe = path.join(c.install, c.productName + '.exe');
    spawn(exe, [], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    connected = await attach(c, '0.1.1'); await about(connected); await check(connected);
    await until(async () => (await update(connected)).status === 'downloaded', 'aligned differential download');
    const downloads = state.requests.filter(row => row.path.endsWith('/Acceptance-0.1.2.exe'));
    const total = downloads.reduce((sum, row) => sum + row.bytes, 0), full = fs.statSync(path.join(c.packages, '0.1.2/Acceptance-0.1.2.exe')).size;
    assert(downloads.some(row => row.range), 'byte-range requests must actually occur');
    assert(total < full, 'a full fallback cannot be labelled differential success');
    result.tests.push({ name: 'differential-download', transferredBytes: total, installerBytes: full, rangeRequests: downloads.filter(row => row.range).length });
    console.log('PASS differential-download ' + total + '/' + full);
    await rpc(c, 'install'); connected = await attach(c, '0.1.2');
    assert.deepEqual(snapshot(c), JSON.parse(fs.readFileSync(path.join(root, 'before-data.json'), 'utf8')));
    const running = JSON.parse(fs.readFileSync(path.join(root, 'running.json'), 'utf8'));
    assert.equal(running.updated, true); assert.equal(running.encryptedRecordReadable, true); assert.equal(running.executable, exe);
    assert.equal(hash(fs.readFileSync(path.join(c.install, 'resources/app.asar'))), hash(fs.readFileSync(path.join(c.packages, '0.1.2/win-unpacked/resources/app.asar'))));
    await about(connected); await rpc(c, 'capture');
    const ui = await rpc(c, 'status');
    assert.equal(ui.marker, 'synthetic-retained'); assert.equal(ui.dark, true); assert(ui.content > 100); assert.deepEqual(ui.errors, []);
    result.tests.push({ name: 'second-installed-upgrade-and-data-retention', version: '0.1.2', sameInstallDirectory: true, syntheticEncryptedRecordReadable: true });
    result.passed = true; console.log('PASS second-installed-upgrade-and-data-retention');
  } catch (error) { result.passed = false; result.error = error.stack; throw error; }
  finally {
    if (connected) await stop(c).catch(error => { result.cleanupError = error.message; result.passed = false; process.exitCode = 1; });
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    write(path.join(root, 'http-requests-differential.json'), state.requests); write(path.join(root, 'results.json'), result);
  }
}
async function main() {
  assert.equal(process.platform, 'win32', 'Windows-only installed-app test');
  const mode = process.argv[2], index = process.argv.indexOf('--root'); assert(index > 2 && process.argv[index + 1], 'explicit --root required');
  const root = path.resolve(process.argv[index + 1]); assert(['prepare', 'build', 'test', 'resume-diff'].includes(mode), 'choose prepare, build, test or resume-diff');
  if (mode === 'prepare') {
    if (process.argv.includes('--resume')) await finishPrepare(config(root)); else await prepare(root);
  } else if (mode === 'build') await build(root); else if (mode === 'resume-diff') await resumeDifferential(root); else await run(root);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
