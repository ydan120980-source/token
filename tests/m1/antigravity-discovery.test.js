'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { discoverAntigravity } = require('../../src/quota/antigravity-discovery');
const { installRuntimeDiscovery } = require('../../src/quota/runtime-discovery-ipc');
const { remove } = require('./temp');
const environment = { platform: 'win32', home: 'C:\\Users\\Synthetic', localAppData: 'C:\\Users\\Synthetic\\AppData\\Local', programFiles: 'C:\\Program Files', path: '' };
const defaultExe = 'C:\\Users\\Synthetic\\AppData\\Local\\agy\\bin\\agy.exe';
function fake(entries = {}) {
  const touched = [], key = value => path.win32.normalize(value).toLowerCase(), lookup = new Map(Object.entries(entries).map(([name, value]) => [key(name), value]));
  const link = value => typeof value === 'object' && value?.link;
  const stat = value => ({ isFile: () => value !== 'directory' && !link(value), isSymbolicLink: () => Boolean(link(value)) });
  return { touched, io: {
    lstat: async name => {
      touched.push(name); const value = lookup.get(key(name));
      if (!value) throw Object.assign(new Error('PRIVATE_PATH'), { code: 'ENOENT' });
      if (value.error) throw Object.assign(new Error('PRIVATE_PATH'), { code: value.error });
      return stat(value);
    },
    realpath: async name => link(lookup.get(key(name))) || name,
    readFile: () => { throw new Error('CONTENT_READ_FORBIDDEN'); }, readdir: () => { throw new Error('DIRECTORY_SCAN_FORBIDDEN'); }
  } };
}
test('automatic discovery checks official default and custom PATH without content reads or CLI execution', async () => {
  const f = fake({ [defaultExe]: 'file', 'E:\\CLI with spaces\\agy.exe': 'file' });
  const result = await discoverAntigravity({ ...environment, path: '"E:\\CLI with spaces";.;relative;\\\\network\\share;C:\\Users\\Synthetic\\AppData\\Local\\agy\\bin' }, f.io);
  assert.equal(result.status, 'candidates-found'); assert.equal(result.candidates.length, 2); assert.equal(result.selection.state, 'ambiguous'); assert.equal(result.selection.executable, null);
  assert(result.coverage.issues.includes('PATH_ENTRY_SKIPPED'));
  assert.deepEqual(result.effects, { executedCli: false, readCredentials: false, readConfiguration: false, requestedQuota: false });
  assert(f.touched.every(name => ['agy.exe', 'agy.cmd', 'agy.ps1', 'antigravity.exe'].includes(path.win32.basename(name).toLowerCase())));
  const single = await discoverAntigravity(environment, fake({ [defaultExe]: 'file' }).io);
  assert.equal(single.selection.executable, defaultExe); assert.equal(single.selection.verificationRequired, true); assert.equal(single.candidates[0].trust, 'unverified');
});
test('metadata aliases deduplicate by resolved executable; desktop and shims never become a quota CLI', async () => {
  const f = fake({ [defaultExe]: 'file', 'E:\\links\\agy.exe': { link: defaultExe }, 'E:\\links\\agy.cmd': 'file', 'C:\\Users\\Synthetic\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe': 'file' });
  const result = await discoverAntigravity({ ...environment, path: 'E:\\links' }, f.io);
  assert.equal(result.candidates.length, 1); assert.deepEqual(result.candidates[0].origins, ['official-default', 'path']); assert.equal(result.desktops.length, 1); assert.equal(result.launchers[0].status, 'unsupported-launcher');
  const desktop = await discoverAntigravity(environment, fake({ 'C:\\Users\\Synthetic\\AppData\\Local\\Programs\\Antigravity\\Antigravity.exe': 'file' }).io);
  assert.equal(desktop.status, 'desktop-only'); assert.equal(desktop.selection.executable, null);
  const shim = await discoverAntigravity({ ...environment, path: 'E:\\links' }, fake({ 'E:\\links\\agy.cmd': 'file' }).io);
  assert.equal(shim.status, 'launcher-only'); assert.equal(shim.selection.executable, null);
  const bad = await discoverAntigravity(environment, fake({ [defaultExe]: { link: 'C:\\private\\auth.json' } }).io);
  assert.equal(bad.status, 'candidate-rejected'); assert.equal(bad.selection.executable, null); assert(!JSON.stringify(bad).includes('auth.json'));
});
test('limits, unreadable metadata and deadline stay partial, never a false complete absence or auto-selection', async () => {
  const denied = await discoverAntigravity(environment, fake({ [defaultExe]: { error: 'EACCES' } }).io);
  assert.equal(denied.status, 'partial'); assert.equal(denied.selection.state, 'incomplete'); assert(!JSON.stringify(denied).includes('PRIVATE_'));
  const limited = await discoverAntigravity({ ...environment, path: Array.from({ length: 200 }, (_, n) => 'E:\\path' + n).join(';') }, fake({ [defaultExe]: 'file' }).io);
  assert.equal(limited.coverage.complete, false); assert(limited.coverage.checkedPaths <= 512); assert.equal(limited.selection.executable, null);
  const tooLong = await discoverAntigravity({ ...environment, path: 'x'.repeat(65537) }, fake().io); assert(tooLong.coverage.issues.includes('PATH_LIMIT'));
  const timeout = await discoverAntigravity(environment, { lstat: () => new Promise(() => {}) }, 5);
  assert.equal(timeout.status, 'partial'); assert(timeout.coverage.issues.includes('SCAN_TIMEOUT'));
  const roots = await discoverAntigravity({ ...environment, localAppData: null }, fake().io); assert(roots.coverage.issues.includes('ROOT_UNAVAILABLE'));
  const platform = await discoverAntigravity({ platform: 'linux' }, { lstat: () => { throw new Error('must not inspect'); } }); assert(platform.coverage.issues.includes('PLATFORM_UNSUPPORTED'));
});
test('known PATH variables expand without reading arbitrary environment values and results are independent copies', async () => {
  const f = fake({ [defaultExe]: 'file' });
  const result = await discoverAntigravity({ ...environment, path: '%LOCALAPPDATA%\\agy\\bin;%SECRET_TOKEN%\\bin' }, f.io);
  assert.equal(result.candidates.length, 1); assert(f.touched.every(file => !file.includes('%SECRET_TOKEN%')));
  result.candidates[0].executable = 'mutated'; assert.equal((await discoverAntigravity(environment, f.io)).candidates[0].executable, defaultExe);
});
test('real filesystem scanner uses only a disposable fixture installation and preserves its bytes', async t => {
  if (process.platform !== 'win32') { t.skip('Windows fixture paths'); return; }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), '自动发现 with spaces-')); t.after(() => remove(home));
  const local = path.join(home, 'AppData/Local'), dir = path.join(local, 'agy/bin'); fs.mkdirSync(dir, { recursive: true });
  const executable = path.join(dir, 'agy.exe'), bytes = Buffer.from('SYNTHETIC_NOT_EXECUTABLE'); fs.writeFileSync(executable, bytes);
  const result = await discoverAntigravity({ platform: 'win32', home, localAppData: local, path: '' });
  assert.equal(result.selection.executable.toLowerCase(), executable.toLowerCase()); assert.deepEqual(fs.readFileSync(executable), bytes);
  assert.deepEqual(fs.readdirSync(dir), ['agy.exe']);
});
test('discovery IPC is sender guarded, coalesces in-flight reads and uses the actual preload method', async () => {
  const handlers = new Map(), sender = {}, event = { sender }; let calls = 0, finish;
  installRuntimeDiscovery({ handle: (name, fn) => handlers.set(name, fn) }, e => e.sender === sender, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const exposed = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/quota/preload.js'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: { sendSync: () => ({}), invoke: (channel, ...args) => handlers.get(channel)(event, ...args) } }) });
  assert.equal(calls, 0); const one = exposed.quotaBridge.discoverAntigravity(), two = exposed.quotaBridge.discoverAntigravity();
  await Promise.resolve(); assert.equal(calls, 1); finish({ schemaVersion: 'AntigravityDiscoveryV1' }); assert.deepEqual(await one, await two);
  assert.throws(() => handlers.get('quota:discoverAntigravity')({ sender: {} }), /IPC_SENDER_REJECTED/);
  assert.equal(handlers.get('quota:discoverAntigravity')(event, 'C:/private').errorCode, 'RUNTIME_DISCOVERY_ARGUMENTS_REJECTED');
  const failure = new Map(); installRuntimeDiscovery({ handle: (name, fn) => failure.set(name, fn) }, () => true, () => { throw new Error('PRIVATE_AUTH_PATH'); });
  const failed = await failure.get('quota:discoverAntigravity')(event); assert.equal(failed.ok, false); assert.equal(failed.discovery, null); assert(!JSON.stringify(failed).includes('PRIVATE_'));
});
