'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { GUIDES, INSTALL_COMMAND, projectSetup, createAntigravitySetup, installAntigravitySetup } = require('../../src/quota/antigravity-setup');
const { installRuntimeDiscovery } = require('../../src/quota/runtime-discovery-ipc');
function found(status = 'not-found', selection = 'none', complete = true) {
  return { schemaVersion: 'AntigravityDiscoveryV1', provider: 'antigravity', checkedAt: '2026-10-19T00:00:00.000Z', status,
    candidates: [], selection: { state: selection, executable: selection === 'single-candidate' ? 'C:\\fixture\\agy.exe' : null, verificationRequired: true },
    coverage: { complete, issues: [] }, effects: { executedCli: false, requestedQuota: false, readCredentials: false, readConfiguration: false } };
}
function fixture() {
  let value = found(), error = null, scans = 0;
  const opened = [], copied = [];
  const setup = createAntigravitySetup({ discover: () => { scans++; if (error) throw error; return value; }, openExternal: async url => { opened.push(url); }, writeText: text => { copied.push(text); } });
  const action = actionId => setup.action({ actionId, revision: setup.state().revision });
  return { setup, opened, copied, action, set: next => { value = next; }, fail: () => { error = new Error('PRIVATE_AUTH_TOKEN'); }, scans: () => scans };
}

test('setup projection distinguishes missing, incomplete, desktop, shims, ambiguity and verification without claiming readiness', () => {
  const cases = [
    [null, 'scan-required'], [found(), 'cli-missing'], [found('desktop-only'), 'desktop-only'],
    [found('launcher-only'), 'launcher-only'], [found('candidate-rejected'), 'candidate-rejected'],
    [found('candidates-found', 'single-candidate'), 'verification-required'], [found('candidates-found', 'ambiguous'), 'multiple-candidates'],
    [found('partial', 'incomplete', false), 'scan-incomplete']
  ];
  for (const [discovery, reason] of cases) {
    const state = projectSetup({ discovery }); assert.equal(state.reason, reason);
    assert.equal(state.quota.ready, false); assert.equal(state.quota.liveEnabled, false);
    assert.equal(Boolean(state.installation.command), ['cli-missing', 'desktop-only'].includes(reason));
    assert.equal(state.actions.some(action => action.id === 'copy-install-command'), Boolean(state.installation.command));
  }
  const unsupported = found('partial', 'incomplete', false); unsupported.coverage.issues.push('PLATFORM_UNSUPPORTED');
  assert.equal(projectSetup({ discovery: unsupported }).reason, 'platform-unsupported');
  assert.equal(projectSetup({ discovery: found(), scanError: true }).reason, 'scan-failed');
});

test('version guidance separates update from adapter review and never recommends downgrade or reinstall for new versions', () => {
  for (const [cliVersion, reason] of [['1.0.0', 'version-too-old'], ['9.0.0', 'version-unreviewed'], [null, 'version-unrecognized'], ['1.2.11', 'version-unrecognized']]) {
    const f = fixture(); f.set(found('candidates-found', 'single-candidate'));
    // Projection receives only a backend observation, never renderer errors.
    const state = projectSetup({ discovery: found('candidates-found', 'single-candidate'), probe: { errorCode: 'AGY_VERSION_UNSUPPORTED', cliVersion } });
    assert.equal(state.reason, reason); assert.equal(state.installation.command, null);
    assert.equal(state.actions.some(a => a.id === 'installation-guide'), reason === 'version-too-old');
    assert.equal(state.actions.some(a => a.id === 'copy-install-command'), false);
  }
});

test('known probe failures give bounded recovery and unknown auth, expiry, network and quota remain unknown', async () => {
  const f = fixture(); f.set(found('candidates-found', 'single-candidate')); await f.setup.scan();
  const cases = ['AGY_EXECUTABLE_REQUIRED', 'AGY_OUTPUT_LIMIT', 'AGY_PROTOCOL_INVALID', 'AGY_REQUEST_FAILED', 'AGY_MODEL_TURN_DETECTED', 'AGY_NO_TURN_UNVERIFIED', 'AGY_TIMEOUT', 'AGY_CANCELED', 'AGY_CLEANUP_FAILED', 'AGY_BINARY_CHANGED', 'AGY_HOST_UNAVAILABLE'];
  for (const errorCode of cases) {
    assert.equal(f.setup.recordProbeFailure({ ok: false, errorCode, cliVersion: '1.2.11', stderr: 'PRIVATE_AUTH_TOKEN', quota: { remaining: 0 } }, f.setup.state().revision), true);
    const state = f.setup.state(); assert.notEqual(state.reason, 'verification-required'); assert.equal(state.installation.command, null);
    assert(!JSON.stringify(state).includes('PRIVATE_AUTH_TOKEN')); assert(!JSON.stringify(state).includes('remaining'));
    assert(!state.actions.some(a => a.id === 'copy-install-command')); assert.equal(state.quota.ready, false);
    if (errorCode === 'AGY_REQUEST_FAILED') { assert.match(state.steps.join(''), /原因|通用失败/); assert(state.actions.some(a => a.id === 'authentication-guide')); }
  }
  assert.equal(f.setup.recordProbeFailure({ ok: false, errorCode: 'PRIVATE_AUTH_TOKEN' }, f.setup.state().revision), false);
  assert.equal(f.setup.recordProbeFailure({ ok: false, errorCode: 'AGY_TIMEOUT' }, -1), false);
  const oldRevision = f.setup.state().revision; await f.setup.scan();
  assert.equal(f.setup.state().reason, 'verification-required');
  assert.equal(f.setup.recordProbeFailure({ ok: false, errorCode: 'AGY_TIMEOUT' }, oldRevision), false);
});

test('guided installation performs fixed copy and browser actions only and rechecks presence before installation advice', async () => {
  const f = fixture(); assert.equal(f.scans(), 0); assert.equal(f.setup.state().reason, 'scan-required'); assert.equal(f.scans(), 0);
  await f.action('rescan'); const revision = f.setup.state().revision;
  const copied = await f.action('copy-install-command'); assert.equal(copied.outcome, 'command-copied'); assert.deepEqual(f.copied, [INSTALL_COMMAND]); assert.equal(copied.state.installation.executed, false);
  assert.equal((await f.setup.action({ actionId: 'installation-guide', revision })).errorCode, 'AGY_SETUP_STALE');
  const guide = await f.action('installation-guide'); assert.equal(guide.outcome, 'guide-opened'); assert.deepEqual(f.opened, [GUIDES.installation]);
  f.set(found('candidates-found', 'single-candidate'));
  const changed = await f.action('copy-install-command'); assert.equal(changed.errorCode, 'AGY_SETUP_ACTION_UNAVAILABLE'); assert.equal(changed.state.reason, 'verification-required'); assert.equal(f.copied.length, 1);
  const scans = f.scans(); await f.action('troubleshooting-guide'); assert.equal(f.scans(), scans); assert.deepEqual(f.opened, [GUIDES.installation, GUIDES.troubleshooting]);
  assert.equal((await f.action('copy-install-command')).errorCode, 'AGY_SETUP_ACTION_UNAVAILABLE');
});

test('old-version guide remains available; generic request failure only opens fixed authentication guide', async () => {
  const f = fixture(); f.set(found('candidates-found', 'single-candidate')); await f.setup.scan();
  f.setup.recordProbeFailure({ ok: false, errorCode: 'AGY_VERSION_UNSUPPORTED', cliVersion: '1.0.0' }, f.setup.state().revision);
  assert.equal((await f.action('installation-guide')).outcome, 'guide-opened');
  f.setup.recordProbeFailure({ ok: false, errorCode: 'AGY_REQUEST_FAILED' }, f.setup.state().revision);
  assert.equal((await f.action('authentication-guide')).outcome, 'guide-opened'); assert.equal(f.opened.at(-1), GUIDES.authentication);
});

test('failed scan retains last discovery without stale install actions, leaks or unhandled rejections', async () => {
  const f = fixture(); await f.setup.scan(); const before = f.setup.state(); f.fail();
  const failed = await f.action('copy-install-command'); assert.equal(failed.errorCode, 'AGY_SETUP_SCAN_FAILED'); assert.equal(failed.state.reason, 'scan-failed');
  assert.deepEqual(failed.state.lastDiscovery, before.lastDiscovery); assert.equal(failed.state.checkedAt, before.checkedAt);
  assert.equal(f.copied.length, 0); assert(!JSON.stringify(failed).includes('PRIVATE_AUTH_TOKEN'));
  assert.equal((await f.action('rescan')).errorCode, 'AGY_SETUP_SCAN_FAILED');
  const first = createAntigravitySetup({ discover: () => { throw new Error('PRIVATE'); } });
  await assert.rejects(first.scan(), /AGY_SETUP_SCAN_FAILED/); assert.equal(first.state().lastDiscovery, null);
});

test('side-effect failures report the actual outcome; concurrent actions do not duplicate browser launch', async () => {
  let finish;
  const setup = createAntigravitySetup({ discover: () => found(), openExternal: () => new Promise(resolve => { finish = resolve; }), writeText: () => { throw new Error('PRIVATE_CLIPBOARD'); } });
  await setup.scan(); assert.equal((await setup.action({ actionId: 'copy-install-command', revision: setup.state().revision })).errorCode, 'AGY_SETUP_COPY_FAILED');
  const request = { actionId: 'troubleshooting-guide', revision: setup.state().revision }, one = setup.action(request);
  assert.equal((await setup.action(request)).errorCode, 'AGY_SETUP_BUSY'); finish(); assert.equal((await one).outcome, 'guide-opened');
  const failed = createAntigravitySetup({ openExternal: () => { throw new Error('PRIVATE_BROWSER'); } });
  const result = await failed.action({ actionId: 'troubleshooting-guide', revision: 0 });
  assert.equal(result.errorCode, 'AGY_SETUP_GUIDE_FAILED'); assert(!JSON.stringify(result).includes('PRIVATE_BROWSER'));
});

test('actual preload and guarded IPC share scanner state and reject caller paths, URLs, errors and extra arguments', async () => {
  const f = fixture(), handlers = new Map(), sender = {}, event = { sender }, exposed = {};
  const ipc = { handle: (name, fn) => handlers.set(name, fn) }, valid = e => e.sender === sender;
  installAntigravitySetup(ipc, valid, f.setup); installRuntimeDiscovery(ipc, valid, f.setup.scan);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/quota/preload.js'), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: { sendSync: () => ({}), invoke: (channel, ...args) => handlers.get(channel)(event, ...args) } }) });
  assert.equal((await exposed.quotaBridge.antigravitySetup()).state.reason, 'scan-required'); assert.equal(f.scans(), 0);
  await exposed.quotaBridge.discoverAntigravity(); let state = (await exposed.quotaBridge.antigravitySetup()).state;
  assert.equal(state.reason, 'cli-missing');
  state.steps.push('MUTATED'); state.lastDiscovery.status = 'MUTATED'; assert(!JSON.stringify(f.setup.state()).includes('MUTATED'));
  const result = await exposed.quotaBridge.antigravitySetupAction({ actionId: 'copy-install-command', revision: state.revision });
  assert.equal(result.outcome, 'command-copied'); assert.deepEqual(f.copied, [INSTALL_COMMAND]);
  for (const request of [null, [], 'url', { actionId: 'rescan' }, { actionId: 'copy-install-command', revision: f.setup.state().revision, url: 'https://evil.example' }, { actionId: 'https://evil.example', revision: f.setup.state().revision }, { actionId: '__proto__', revision: f.setup.state().revision }, { actionId: 'rescan', revision: NaN }]) assert.equal((await f.setup.action(request)).ok, false);
  for (const name of ['quota:antigravitySetup', 'quota:antigravitySetupAction']) assert.throws(() => handlers.get(name)({ sender: {} }), /IPC_SENDER_REJECTED/);
  assert.equal(handlers.get('quota:antigravitySetup')(event, { errorCode: 'AGY_AUTH_REQUIRED' }).errorCode, 'AGY_SETUP_ARGUMENTS_REJECTED');
  assert.equal(handlers.get('quota:antigravitySetupAction')(event, {}, {}).errorCode, 'AGY_SETUP_ARGUMENTS_REJECTED');
  assert.equal(f.opened.length, 0);
});

test('overlapping discovery and setup scans coalesce; a pending scan cannot accept an outdated probe', async () => {
  let resolve, calls = 0;
  const setup = createAntigravitySetup({ discover: () => { calls++; return new Promise(done => { resolve = done; }); } });
  const a = setup.scan(), b = setup.scan(); await Promise.resolve(); assert.equal(calls, 1);
  assert.equal(setup.recordProbeFailure({ ok: false, errorCode: 'AGY_TIMEOUT' }, 0), false);
  resolve(found()); assert.deepEqual(await a, await b); assert.equal(setup.state().revision, 1);
});
