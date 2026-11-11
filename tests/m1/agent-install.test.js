'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { remove } = require('./temp');
const { makeEngine, own } = require('../../src/quota/agent-install-engine');
const { plans, version, newer } = require('../../src/quota/agent-install-plans');
const { AgentInstallService, installAgentInstaller } = require('../../src/quota/agent-install-service');
const { allowed } = require('../../src/quota/agent-install-http');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const success = stdout => ({ code: 0, signal: null, reaped: true, stdout, stderr: '', errorCode: null });
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
async function idle(service) { for (let n = 0; n < 400; n++) { if (!service.active && !service.queue.length) return; await pause(); } throw Error('SERVICE_NOT_IDLE'); }
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '安装 with spaces-')); t.after(() => remove(root));
  const home = path.join(root, 'home'), systemRoot = path.join(root, 'Windows'), powershell = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'); fs.mkdirSync(path.dirname(powershell), { recursive: true }); fs.writeFileSync(powershell, 'SYNTHETIC'); fs.mkdirSync(home);
  const environment = { home, localAppData: path.join(home, 'AppData/Local'), appData: path.join(home, 'AppData/Roaming'), temp: root, systemRoot, arch: 'x64', platform: 'win32', path: '' };
  const events = [], calls = [], payload = Buffer.from('SYNTHETIC_PAYLOAD'), manager = path.join(root, 'owned');
  let currentVersion = '1.2.3', failProbe = false, validSignature = true, corrupt = false;
  const http = async (url, options) => {
    if (options.file) { fs.writeFileSync(options.file, payload, { flag: 'wx' }); options.progress?.({ downloadedBytes: payload.length, totalBytes: payload.length }); return { hash: corrupt ? '0'.repeat(128) : crypto.createHash(options.hash || 'sha256').update(payload).digest('hex'), bytes: payload.length }; }
    if (url.endsWith('SHASUMS256.txt')) return { text: hash(payload) + '  node-v24.22.0-win-x64.zip\n' };
    if (url.startsWith('https://registry.npmjs.org/')) return { text: JSON.stringify({ name: decodeURIComponent(url.slice('https://registry.npmjs.org/'.length, -'/latest'.length)), version: currentVersion }) };
    if (url.includes('workbuddy.cn')) return { text: JSON.stringify({ version: currentVersion, url: 'https://download.codebuddy.cn/workbuddy/installer.exe', sha256hash: hash(payload) }) };
    if (url.includes('api2.cursor')) return { text: JSON.stringify({ version: currentVersion, url: 'https://downloads.cursor.com/installer.exe' }) };
    if (url.includes('run.app')) return { text: JSON.stringify({ version: currentVersion, url: 'https://storage.googleapis.com/agy.exe', sha512: crypto.createHash('sha512').update(payload).digest('hex') }) };
    return { text: 'https://cdn-zcode.z.ai/zcode/electron/releases/' + currentVersion + '/windows-x64/ZCode-' + currentVersion + '-win-x64.exe' };
  };
  const job = async (pin, args, options) => {
    calls.push({ executable: pin.executable, args, options });
    if (pin.executable === powershell) {
      const mode = args[args.indexOf('-Mode') + 1], request = JSON.parse(fs.readFileSync(args[args.indexOf('-InputFile') + 1], 'utf8'));
      if (mode === 'expand') { const directory = path.join(request.destination, 'node-v24.22.0-win-x64'); fs.mkdirSync(path.join(directory, 'node_modules/npm/bin'), { recursive: true }); fs.writeFileSync(path.join(directory, 'node.exe'), 'SYNTHETIC_NODE'); fs.writeFileSync(path.join(directory, 'node_modules/npm/bin/npm-cli.js'), 'SYNTHETIC_NPM'); return success('{"expanded":true}'); }
      if (mode === 'signature') return success(JSON.stringify({ valid: validSignature, version: currentVersion }));
      return success('{"entries":[]}');
    }
    if (args.includes('install')) {
      const prefix = args[args.indexOf('--prefix') + 1], spec = args.at(-1), split = spec.lastIndexOf('@'), name = spec.slice(0, split), directory = path.join(prefix, 'node_modules', ...name.split('/'));
      fs.mkdirSync(path.join(directory, 'bin'), { recursive: true }); fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: currentVersion }));
      for (const file of ['mimo.exe', 'claude.exe', 'opencode.exe', 'codex.js']) fs.writeFileSync(path.join(directory, 'bin', file), 'SYNTHETIC_' + currentVersion);
      return success('private log deliberately never forwarded');
    }
    if (args.length === 1 && args[0] === '--version' && path.basename(pin.executable) === 'node.exe') return success('v24.22.0\n');
    return failProbe ? { ...success(''), code: 1 } : success('tool ' + currentVersion + '\n');
  };
  const engine = makeEngine({ root: manager, environment, http, job, installJob: job, report: event => events.push(event) });
  return { root, manager, environment, events, calls, engine, payload, setVersion: value => { currentVersion = value; }, failProbe: () => { failProbe = true; }, invalidSignature: () => { validSignature = false; }, corruptDownloads: () => { corrupt = true; } };
}
test('fixed plans cover ten Agents; versions, source scopes, local path and null limits stay explicit', () => {
  assert.equal(Object.keys(plans).length, 10); assert.equal(version('1.2.3-rc.2'), '1.2.3-rc.2'); assert.equal(version('1.2.3; evil'), null);
  assert.equal(newer('1.2.3', '1.2.3-rc.2'), true); assert.equal(newer('1.2.3-rc.10', '1.2.3-rc.2'), true); assert.equal(newer('1.2.3.0', '1.2.3'), false); assert.equal(newer(null, '1.2.3'), null);
  for (const url of ['http://nodejs.org/x', 'https://nodejs.org.evil/x', 'https://name:secret@nodejs.org/x', 'https://127.0.0.1/x', 'https://nodejs.org:444/x']) assert.equal(allowed(url, 'node'), false);
  assert.equal(allowed('https://nodejs.org/dist/file.zip', 'node'), true); assert.equal(allowed('https://registry.npmjs.org/pkg', 'node'), false);
  assert.throws(() => own('C:\\owned', 'C:\\outside'), /INSTALL_PATH_REJECTED/);
});
test('native npm installation prepares verified private Node, suppresses lifecycle/configs, verifies version then atomically activates', async t => {
  const f = fixture(t), marker = path.join(f.root, 'business.json'); fs.writeFileSync(marker, 'UNCHANGED');
  const result = await f.engine.install('mimo'); assert.equal(result.installed, true);
  const state = await f.engine.inspect('mimo', true); assert.equal(state.runnable, true); assert.equal(state.version, '1.2.3'); assert.match(state.launchCommand, /^& '/);
  const npm = f.calls.find(call => call.args.includes('install')); assert(npm.args.includes('--ignore-scripts')); assert(npm.args.includes('--include=optional')); assert(npm.args.includes('--registry=https://registry.npmjs.org'));
  assert.notEqual(npm.args.find(arg => arg.startsWith('--userconfig=')), npm.args.find(arg => arg.startsWith('--globalconfig=')));
  assert(!Object.hasOwn(npm.options.env, 'OPENAI_API_KEY')); assert(!Object.hasOwn(npm.options.env, 'NODE_OPTIONS')); assert.equal(npm.options.env.HOME, path.join(f.manager, 'runtime-home')); assert.notEqual(npm.options.env.HOME, f.environment.home); assert.equal(npm.options.timeoutMs, 600000);
  assert(f.events.some(row => row.stage === 'dependency')); assert(f.events.some(row => row.stage === 'postcheck')); assert.equal(fs.readFileSync(marker, 'utf8'), 'UNCHANGED');
  const active = path.join(f.manager, 'mimo/active.json'), original = fs.readFileSync(active); f.setVersion('1.2.4'); f.failProbe();
  await assert.rejects(f.engine.install('mimo'), /INSTALL_PROCESS_FAILED/); assert.deepEqual(fs.readFileSync(active), original);
});
test('official binaries require exact checksums and postcheck; desktop handoff requires publisher signature and never claims completion', async t => {
  const f = fixture(t); const binary = await f.engine.install('antigravity'); assert.equal(binary.installed, true);
  const desktop = await f.engine.install('workbuddy'); assert.equal(desktop.awaitingInstaller, true); assert.equal(desktop.sha256, hash(f.payload)); assert.equal(fs.existsSync(path.join(f.manager, 'workbuddy/active.json')), false);
  f.invalidSignature(); await assert.rejects(f.engine.install('zcode'), /INSTALL_SIGNATURE_FAILED/);
  const active = JSON.parse(fs.readFileSync(path.join(f.manager, 'antigravity/active.json'), 'utf8')); fs.writeFileSync(active.executable, 'CHANGED');
  assert.equal((await f.engine.inspect('antigravity', false)).state, 'broken');
  const bad = fixture(t); bad.corruptDownloads(); await assert.rejects(bad.engine.install('antigravity'), /INSTALL_CHECKSUM_FAILED/);
  assert.equal(bad.calls.length, 0); assert.equal(fs.existsSync(path.join(bad.manager, 'antigravity/active.json')), false);
});
test('service is memory-only on get, rejects injected IPC/action fields and serializes checks/install with progress', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-service-')); t.after(() => remove(root));
  const service = new AgentInstallService(root, () => ({}), { fixture: true, writeText: () => {}, openExternal: () => {} });
  assert.equal(fs.existsSync(path.join(root, 'install-status.json')), false); assert.equal(service.state().rows.length, 10);
  let active = 0, maxActive = 0, installs = 0;
  service.run = async (request, progress) => { active++; maxActive = Math.max(maxActive, active); progress({ stage: 'downloading', downloadedBytes: 1, totalBytes: 2, stderr: 'SECRET' }); await pause(); active--; if (request.action === 'install') { installs++; return { installed: true, version: '1.2.3' }; } return { state: 'installed', managed: true, runnable: true, version: '1.2.3', latest: '1.2.4' }; };
  const act = (agent, action) => service.action({ agent, action, revision: service.state().revision });
  assert.equal(act('all', 'check-all').ok, true); await idle(service); assert.equal(maxActive, 1); assert.equal(service.state().rows.every(row => row.updateAvailable), true);
  assert.equal(act('mimo', 'install').ok, true); await idle(service); assert.equal(installs, 1); assert.equal(service.state().rows.find(row => row.agent === 'mimo').version, '1.2.3'); assert(!JSON.stringify(service.state()).includes('SECRET'));
  for (const request of [null, [], { agent: 'mimo', action: 'install', revision: service.state().revision, url: 'https://evil' }, { agent: '__proto__', action: 'install', revision: service.state().revision }, { agent: 'mimo', action: 'arbitrary command', revision: service.state().revision }]) assert.equal(service.action(request).ok, false);
  const handlers = new Map(), sender = {}; installAgentInstaller({ handle: (name, handler) => handlers.set(name, handler) }, event => event.sender === sender, service);
  for (const name of handlers.keys()) assert.throws(() => handlers.get(name)({ sender: {} }), /IPC_SENDER_REJECTED/);
  assert.equal(handlers.get('usage:installers')({ sender }, 'extra').ok, false); assert.equal(handlers.get('usage:installerAction')({ sender }, {}, {}).ok, false);
  await service.close();
});
test('desktop install remains pending until target version is observed; canceled queued work and unconfirmed cleanup do not continue', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-desktop-')); t.after(() => remove(root)); const file = path.join(root, 'installer.exe'); fs.writeFileSync(file, 'SYNTHETIC'); let opened = 0, seenVersion = '1.0.0';
  const service = new AgentInstallService(root, () => ({}), { openPath: () => { opened++; return ''; } });
  service.run = async request => request.action === 'install' ? { awaitingInstaller: true, path: file, sha256: hash(Buffer.from('SYNTHETIC')), version: '2.0.0' } : { state: 'installed', managed: false, version: seenVersion };
  const act = (agent, action) => service.action({ agent, action, revision: service.state().revision });
  act('cursor', 'install'); await idle(service); assert.equal(opened, 1); assert.equal(service.rows.cursor.stage, 'awaiting-installer');
  const restored = new AgentInstallService(root, () => ({})); assert.equal(restored.rows.cursor.expectedVersion, '2.0.0'); assert.equal(restored.rows.cursor.stage, 'awaiting-installer');
  assert.equal(restored.action({ agent: 'cursor', action: 'dismiss-installer', revision: restored.revision }).ok, true); assert.equal(restored.rows.cursor.expectedVersion, null); await restored.close();
  act('cursor', 'check'); await idle(service); assert.equal(service.rows.cursor.stage, 'awaiting-installer'); seenVersion = '2.0.0'; act('cursor', 'check'); await idle(service); assert.equal(service.rows.cursor.stage, 'complete');
  service.run = async () => { throw Error('INSTALL_CLEANUP_UNCONFIRMED'); }; act('mimo', 'install'); await idle(service); assert.equal(service.state().blocked, true); assert.equal(act('codex', 'install').ok, false); await service.close();
});
test('unexpected installer worker exit without cleanup acknowledgement blocks subsequent queued work', async t => {
  const { EventEmitter } = require('node:events'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-worker-crash-')); t.after(() => remove(root)); let created = 0;
  const service = new AgentInstallService(root, () => ({}), { forkWorker: () => {
    created++; const child = new EventEmitter(); child.pid = 4242; child.connected = true; child.kill = () => {}; child.send = () => { setImmediate(() => child.emit('exit', 1)); }; return child;
  } });
  service.action({ agent: 'mimo', action: 'install', revision: service.revision }); service.action({ agent: 'codex', action: 'install', revision: service.revision });
  await idle(service); assert.equal(created, 1); assert.equal(service.blocked, true); assert.equal(service.rows.mimo.errorCode, 'INSTALL_CLEANUP_UNCONFIRMED'); assert.equal(service.rows.codex.busy, false); assert.equal(service.rows.codex.stage, 'canceled'); await service.close();
});
test('cancel after installer IPC disconnect also requires confirmed cleanup before another task', async t => {
  const { EventEmitter } = require('node:events'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'install-worker-disconnect-')); t.after(() => remove(root));
  const service = new AgentInstallService(root, () => ({}), { forkWorker: () => { const child = new EventEmitter(); child.pid = 4242; child.connected = false; child.kill = () => {}; child.send = () => {}; return child; } });
  service.action({ agent: 'mimo', action: 'install', revision: service.revision }); service.action({ agent: 'mimo', action: 'cancel', revision: service.revision });
  await idle(service); assert.equal(service.blocked, true); assert.equal(service.rows.mimo.errorCode, 'INSTALL_CLEANUP_UNCONFIRMED'); await service.close();
});
