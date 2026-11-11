'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const definitions = require('../../src/quota/agent-setup-catalog');
const { agents } = require('../../src/m1/agent-catalog');
const { discoverAgentRuntime } = require('../../src/quota/agent-runtime-discovery');
const { createAgentSetup, installAgentSetup } = require('../../src/quota/agent-setup');
const { createAntigravitySetup } = require('../../src/quota/antigravity-setup');
const environment = { platform: 'win32', home: 'C:\\fixture', localAppData: 'C:\\fixture\\AppData\\Local', appData: 'C:\\fixture\\AppData\\Roaming', path: '' };
const missing = () => ({ schemaVersion: 'AgentRuntimeDiscoveryV1', entries: [], coverage: { complete: true }, checkedAt: '2026-10-19T00:00:00Z' });
function fixture() {
  let observation = { enabled: true, status: { status: 'not-detected', observedRecords: 0 } }, runtime = missing(), failScan = false, scans = 0;
  const opened = [], copied = [], custom = 'custom-11111111-1111-4111-8111-111111111111';
  const antigravity = createAntigravitySetup({ discover: () => ({ schemaVersion: 'AntigravityDiscoveryV1', status: 'not-found', checkedAt: '2026-10-19T00:00:00Z', coverage: { complete: true }, selection: { state: 'none' } }), openExternal: url => opened.push(url), writeText: text => copied.push(text) });
  const service = createAgentSetup({ catalog: () => ({ ...agents, [custom]: { name: '个人来源', custom: true } }), facts: () => observation, environment: () => environment, antigravity, discover: async () => { scans++; if (failScan) throw new Error('PRIVATE_TOKEN'); return runtime; }, openExternal: url => opened.push(url), writeText: text => copied.push(text) });
  const action = (agent, actionId) => service.action({ agent, actionId, revision: service.state(agent).revision });
  return { service, antigravity, opened, copied, custom, action, scans: () => scans, setFacts: next => { observation = next; }, setRuntime: next => { runtime = next; }, fail: () => { failScan = true; } };
}
test('setup-enabled built-ins have guided recovery; usage-only and custom sources never acquire a brand installer or quota', async () => {
  const f = fixture(); assert.deepEqual(Object.keys(definitions).sort(), Object.keys(agents).filter(id => !id.startsWith('custom-') && !agents[id].usageOnly).sort());
  for (const agent of Object.keys(definitions)) {
    const state = f.service.state(agent); assert.equal(state.schemaVersion, 'AgentSetupV1'); assert.equal(state.agent, agent);
    assert(state.actions.some(action => action.id === 'troubleshooting-guide')); await f.action(agent, 'rescan');
    await f.action(agent, 'installation-guide'); assert.equal(f.opened.at(-1), definitions[agent].install);
    if (definitions[agent].command) { assert.equal((await f.action(agent, 'copy-install-command')).outcome, 'command-copied'); assert.equal(f.copied.at(-1), definitions[agent].command); }
  }
  const custom = f.service.state(f.custom); assert.equal(custom.reason, 'custom-source'); assert.deepEqual(custom.actions, []); assert.equal(custom.installation.command, null); assert.match(custom.usage.steps.join(''), /JSONL/);
  assert.equal((await f.action(f.custom, 'rescan')).ok, false);
});
test('saved source diagnostics and Codex quota errors stay separate, sanitized and memory-only', () => {
  const f = fixture(); f.setFacts({ enabled: true, status: { status: 'partial', errors: ['SOURCE_USAGE_CONFLICT', 'PRIVATE_ERROR'], body: 'PRIVATE_BODY' }, quota: { accounts: [{ errorCode: 'LOGIN_REQUIRED', alias: 'PRIVATE_ALIAS' }, { errorCode: 'PRIVATE_TOKEN' }] } });
  const result = f.service.state('codex'); assert.match(result.quotaDescription, /重新完成官方登录/); assert.equal(result.usage.state, 'partial'); assert.match(result.usage.steps.join(''), /不补零/); assert(!JSON.stringify(result).includes('PRIVATE_')); assert.equal(f.scans(), 0);
  const cursor = f.service.state('cursor'); assert.match(cursor.providerNote, /普通聊天/); assert(!cursor.quotaDescription.includes('重新完成官方登录'));
  f.setFacts({ enabled: false }); assert.equal(f.service.state('gemini').usage.state, 'paused');
  f.setFacts({ enabled: true, status: { observedRecords: 2 } }); assert.equal(f.service.state('opencode').usage.state, 'available');
});
test('freshness, failed scans, file appearance and paused/already-observed sources revoke obsolete install copy actions', async () => {
  const f = fixture(); await f.action('claude', 'rescan'); const before = f.service.state('claude');
  f.setRuntime({ ...missing(), entries: [{ path: 'C:\\fixture\\claude.exe', trust: 'unverified' }] });
  const result = await f.service.action({ agent: 'claude', actionId: 'copy-install-command', revision: before.revision });
  assert.equal(result.errorCode, 'SETUP_ACTION_UNAVAILABLE'); assert.equal(result.state.reason, 'entry-found'); assert.deepEqual(f.copied, []);
  f.setFacts({ enabled: false }); assert.equal((await f.service.action({ agent: 'claude', actionId: 'rescan', revision: before.revision })).errorCode, 'SETUP_STALE');
  f.fail(); const failed = await f.action('claude', 'rescan'); assert.equal(failed.errorCode, 'SETUP_SCAN_FAILED'); assert.equal(failed.state.reason, 'scan-failed'); assert.equal(failed.state.runtime.entries.length, 1); assert(!JSON.stringify(failed).includes('PRIVATE_'));
  const snapshot = f.service.state('claude'); snapshot.runtime.entries.length = 0; assert.equal(f.service.state('claude').runtime.entries.length, 1);
});
test('actual preload shares guarded APIs; arbitrary agent, URL, path, command, error or extra IPC args are rejected', async () => {
  const f = fixture(), handlers = new Map(), sender = {}, event = { sender }, exposed = {};
  installAgentSetup({ handle: (name, handler) => handlers.set(name, handler) }, e => e.sender === sender, f.service);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/quota/preload.js'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: { sendSync: () => ({}), invoke: (name, ...args) => handlers.get(name)(event, ...args) } }) });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../design/desktop-reference/usage-data.js'), 'utf8'), { window:exposed });
  assert.equal((await exposed.usageBridge.agentSetup('gemini')).ok, true); assert.equal(f.scans(), 0);
  const request = { agent: 'gemini', actionId: 'rescan', revision: f.service.state('gemini').revision };
  assert.equal((await exposed.usageBridge.agentSetupAction(request)).ok, true);
  for (const input of [null, [], { ...request, url: 'https://evil.example' }, { ...request, command: 'evil' }, { ...request, errorCode: 'LOGIN_REQUIRED' }, { ...request, agent: '__proto__' }, { ...request, agent: 'unknown' }, { ...request, actionId: 'https://evil.example' }, { ...request, revision: NaN }]) assert.equal((await f.service.action(input)).ok, false);
  for (const name of handlers.keys()) assert.throws(() => handlers.get(name)({ sender: {} }), /IPC_SENDER_REJECTED/);
  assert.equal(handlers.get('usage:agentSetup')(event, 'claude', '/private').ok, false); assert.equal(handlers.get('usage:agentSetup')(event, '__proto__').ok, false);
});
test('pending scans coalesce, concurrent actions are busy, and OS failures never claim successful installation', async () => {
  let finish, calls = 0;
  const service = createAgentSetup({ catalog: () => agents, facts: () => ({}), environment: () => environment, discover: () => { calls++; return new Promise(resolve => { finish = resolve; }); }, openExternal: () => { throw new Error('PRIVATE_BROWSER'); } });
  const input = { agent: 'gemini', actionId: 'rescan', revision: service.state('gemini').revision }, first = service.action(input);
  await Promise.resolve(); assert.equal((await service.action(input)).errorCode, 'SETUP_BUSY'); assert.equal(calls, 1); finish(missing()); await first;
  const failed = await service.action({ agent: 'gemini', actionId: 'installation-guide', revision: service.state('gemini').revision }); assert.equal(failed.errorCode, 'SETUP_GUIDE_FAILED'); assert(!JSON.stringify(failed).includes('PRIVATE_BROWSER')); assert.equal(failed.state.installation.executed, false);
});
test('all generic runtime scans probe bounded fixed metadata only; launchers and links remain unverified', async () => {
  const touched = [], io = { lstat: async file => { touched.push(file); if (/\\npm\\gemini.cmd$/i.test(file)) return { isFile: () => true, isSymbolicLink: () => false }; if (/\\scoop\\shims\\gemini.exe$/i.test(file)) return { isFile: () => false, isSymbolicLink: () => true }; throw Object.assign(new Error('PRIVATE'), { code: 'ENOENT' }); }, readFile: () => { throw Error('NO_CONTENT'); }, readdir: () => { throw Error('NO_ENUMERATION'); } };
  const result = await discoverAgentRuntime('gemini', { ...environment, path: '"E:\\with space";.;relative;\\\\server\\share;%SECRET_TOKEN%\\bin' }, io);
  assert.equal(result.entries.length, 2); assert(result.entries.every(entry => entry.trust === 'unverified')); assert.equal(result.effects.executedCli, false); assert(touched.every(file => /gemini\.(exe|cmd|ps1)$/i.test(file))); assert(touched.every(file => /^[a-z]:\\/i.test(file) && !file.includes('%')));
  for (const agent of Object.keys(definitions).filter(id => id !== 'antigravity')) { const scan = await discoverAgentRuntime(agent, environment, io); assert.equal(scan.coverage.complete, true); assert(scan.coverage.checkedPaths <= 1024); }
  const denied = await discoverAgentRuntime('claude', environment, { lstat: async () => { throw Error('PRIVATE_DENIED'); } }); assert.equal(denied.coverage.complete, false); assert(!JSON.stringify(denied).includes('PRIVATE_'));
  const timed = await discoverAgentRuntime('claude', environment, { lstat: () => new Promise(() => {}) }, 5); assert.equal(timed.coverage.complete, false);
  const limited = await discoverAgentRuntime('claude', { ...environment, path: 'x'.repeat(65537) }, io); assert(limited.coverage.issues.includes('PATH_LIMIT'));
  assert.equal((await discoverAgentRuntime('claude', { platform: 'linux' }, io)).coverage.complete, false);
  await assert.rejects(discoverAgentRuntime('__proto__', environment, io), /SETUP_AGENT_REJECTED/);
});
