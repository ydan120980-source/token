'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { commandPlan, version, supportedVersion, MAX_OUTPUT_BYTES } = require('../../src/quota/antigravity-command');
const { fromAntigravity } = require('../../src/quota/antigravity-resources');
const { inspectAntigravity } = require('../../src/quota/antigravity-probe');
const { projectResources } = require('../../src/quota/resource-contract');
const { resourceView } = require('../../src/quota/resource-state');
const { response, NOW } = require('./fixtures/antigravity-quota');
const executable = 'C:/合成目录 with spaces/agy.exe', at = new Date(NOW).toISOString();
const decode = value => fromAntigravity(JSON.stringify(value), at, '1.2.11');
function transport(stdout, change = {}) { return { code: 0, signal: null, reaped: true, stdout, stderr: '', ...change }; }

test('Antigravity command is fixed, shell-free, immutable and refuses unreviewed Windows launch forms', () => {
  const plan = commandPlan(executable);
  assert.deepEqual(plan.usage.args, ['-p', '/usage', '--output-format', 'json', '--print-timeout', '20s']);
  assert.deepEqual(plan.version.args, ['--version']); assert.equal(plan.liveEnabled, false);
  assert.equal(plan.shell, false); assert.equal(plan.windowsHide, true);
  assert.throws(() => plan.usage.args.push('--disable-slash-commands'), TypeError);
  for (const value of ['agy', 'agy.exe', './agy.exe', 'C:agy.exe', 'C:/a/agy.cmd', 'C:/a/agy.ps1', 'C:/a/../agy.exe', '\\\\host\\share\\agy.exe', 'C:/a/agy.exe:other.exe', 'C:/a\n/agy.exe', 'C:/a./agy.exe', 'C:/a/agy.exe"']) assert.throws(() => commandPlan(value), /AGY_EXECUTABLE_REQUIRED/);
  assert.equal(version('Antigravity CLI v1.2.11\n'), '1.2.11');
  for (const value of ['1.1.11', '1.1.12', '1.2.9', '1.2.11', '1.2.12', '1.4.2']) assert(supportedVersion(value));
  for (const value of ['1.1.10', '1.4.3', '2.0.0', '1.2.11-beta', '1.02.11', 'secret\n1.2.11', '1.2.11 1.2.11', '10000.1.1']) assert.equal(supportedVersion(value), false);
});

test('structured groups keep disabled constraints and actual fractions without parsing prose or identity', () => {
  const raw = response(); raw.email = 'PRIVATE_EMAIL'; raw.command.data.groups[0].accountId = 'PRIVATE_ID'; raw.response = 'SECRET_ROUNDED_TEXT';
  const quota = decode(raw), projected = resourceView(quota, { status: 'ready' }, NOW);
  assert.equal(quota.provider, 'antigravity'); assert.equal(quota.pools.length, 2);
  assert.equal(quota.pools[1].windows.length, 2); assert.deepEqual(quota.pools[1].modelIds, []);
  assert.equal(projected.pools[1].windows[0].state, 'disabled'); assert.equal(projected.pools[1].windows[0].currentlyUsable, false);
  assert.equal(projected.pools[1].windows[1].state, 'exhausted'); assert.equal(projected.pools[0].windows[0].usedPercent, 75);
  assert.equal(quota.entitlement.plan, null); assert.equal(quota.entitlement.state, 'unknown'); assert.equal(quota.entitlement.validUntil, null);
  assert(!/PRIVATE_|SECRET_|A prose/.test(JSON.stringify(quota))); assert.equal(Object.hasOwn(quota, 'total'), false);
  assert.deepEqual(projectResources(JSON.parse(JSON.stringify(quota))), quota);
  const permuted = structuredClone(raw); permuted.command.data.groups.reverse(); permuted.command.data.groups[0].buckets.reverse();
  assert.deepEqual(decode(permuted).pools.map(p => p.id).sort(), quota.pools.map(p => p.id).sort());
  permuted.command.data.groups[0].name = 'Renamed models'; assert.equal(decode(permuted).pools[0].id, quota.pools[1].id);
  raw.command.data.groups[0].buckets[0].remaining_fraction = 0.98765;
  assert(Math.abs(decode(raw).pools[0].windows[0].remainingPercent - 98.765) < 1e-10);
});

test('unknown windows, malformed quantities and reset times never manufacture headroom', () => {
  const raw = response(), item = raw.command.data.groups[0].buckets[0];
  item.window = 'monthly'; item.reset_time = '2026-02-30T00:00:00Z'; item.remaining_fraction = 4;
  const quota = decode(raw), window = quota.pools[0].windows[0];
  assert.equal(window.durationMins, null); assert.equal(window.usedPercent, null); assert.equal(window.resetsAt, null);
  assert.deepEqual(window.issues, ['INVALID_PERCENT', 'INVALID_TIME']);
  assert.equal(resourceView(quota, { status: 'ready' }, NOW).pools[0].windows[0].currentlyUsable, null);
  for (const value of [undefined, null, '0.5', -0.1]) {
    item.remaining_fraction = value; const result = decode(raw); assert.equal(result.pools[0].windows[0].usedPercent, null);
  }
  item.remaining_fraction = 0.5; item.reset_time = new Date(NOW - 1000).toISOString();
  const old = resourceView(decode(raw), { status: 'ready' }, NOW).pools[0].windows[0];
  assert.equal(old.usedPercent, 50); assert.equal(old.freshness.reason, 'reset-passed'); assert.equal(old.currentlyUsable, null);
  raw.command.data.groups = [];
  const empty = resourceView(decode(raw), { status: 'ready' }, NOW); assert.equal(empty.hasMeasurements, false); assert.equal(empty.partial, true);
});

test('no-turn proof is mandatory; all records are checked before publishing a quota', () => {
  const raw = response(), valid = JSON.stringify(raw);
  assert.equal(fromAntigravity('startup log\n' + valid + '\nBye', at, '1.2.11').pools.length, 2);
  assert.equal(fromAntigravity(JSON.stringify(raw, null, 2), at, '1.2.11').pools.length, 2);
  for (const mutate of [v => { delete v.num_turns; }, v => { delete v.conversation_id; }, v => { delete v.usage; }, v => { delete v.usage.total_tokens; }, v => { v.usage.total_tokens = '0'; }]) {
    const value = response(); mutate(value); assert.throws(() => decode(value), /AGY_NO_TURN_UNVERIFIED/);
  }
  for (const extra of [{ num_turns: 1 }, { conversation_id: 'PRIVATE_CONVERSATION' }, { usage: { output_tokens: 1 } }]) assert.throws(() => fromAntigravity(valid + '\n' + JSON.stringify(extra), at, '1.2.11'), /AGY_MODEL_TURN_DETECTED/);
  for (const extra of ['[{}]', '{invalid', valid]) assert.throws(() => fromAntigravity(valid + '\n' + extra, at, '1.2.11'), /AGY_PROTOCOL_INVALID/);
  assert.throws(() => fromAntigravity(valid + '\n' + JSON.stringify({ status: 'ERROR', error: 'PRIVATE_ERROR' }), at, '1.2.11'), /AGY_REQUEST_FAILED/);
  assert.throws(() => fromAntigravity('x'.repeat(MAX_OUTPUT_BYTES + 1), at, '1.2.11'), /AGY_OUTPUT_LIMIT/);
});

test('malformed, partial and ambiguous protocol replies are rejected rather than skipped', () => {
  for (const mutate of [v => { v.command.name = 'model'; }, v => { v.command.data.groups = null; }, v => { v.command.data.has_more = true; }, v => { v.command.data.next_page_token = 'secret-page'; }, v => { v.command.data.groups[0].partial = true; }, v => { v.command.data.groups[0].buckets = []; }, v => { v.command.data.groups[0].buckets[0].disabled = 'false'; }, v => { v.command.data.groups[1].buckets[0].id = 'gemini-weekly'; }, v => { v.command.data.groups = Array(101).fill(v.command.data.groups[0]); }]) {
    const value = response(); mutate(value); assert.throws(() => decode(value), /AGY_PROTOCOL_INVALID/);
  }
});

test('probe gates version before usage, strips errors and cannot bind a Google account', async () => {
  const calls = [], run = async (exe, stage, options) => { calls.push([exe, stage.args, options]); return transport(stage.args[0] === '--version' ? '1.2.11' : JSON.stringify(response())); };
  const result = await inspectAntigravity({ executable, run, now: () => NOW });
  assert.equal(result.ok, true); assert.equal(calls.length, 2); assert.equal(result.evidence.identityScope, 'cli-current-account-unverified'); assert.equal(result.evidence.liveEnabled, false);
  const snapshot = JSON.stringify(result.quota);
  for (const version of ['1.1.10', '1.4.3', 'PRIVATE_PATH']) {
    let calls = 0; const denied = await inspectAntigravity({ executable, run: async () => { calls++; return transport(version); } });
    assert.equal(calls, 1); assert.equal(denied.errorCode, 'AGY_VERSION_UNSUPPORTED'); assert.equal(denied.quota, null);
  }
  const failed = await inspectAntigravity({ executable, run: () => { throw new Error('PRIVATE_TOKEN'); } });
  assert.equal(failed.errorCode, 'AGY_REQUEST_FAILED'); assert(!JSON.stringify(failed).includes('PRIVATE_')); assert.equal(JSON.stringify(result.quota), snapshot);
  const inference = await inspectAntigravity({ executable, run: async (_exe, stage) => stage.args[0] === '--version' ? transport('1.2.11') : transport(JSON.stringify({ num_turns: 1 }), { code: 1 }) });
  assert.equal(inference.errorCode, 'AGY_MODEL_TURN_DETECTED');
});

test('probe rejects unbounded or unreaped transports and cancellation prevents the usage stage', async () => {
  for (const [change, expected] of [[{ reaped: false }, 'AGY_CLEANUP_FAILED'], [{ timedOut: true }, 'AGY_TIMEOUT'], [{ overflow: true }, 'AGY_OUTPUT_LIMIT'], [{ code: 1 }, 'AGY_REQUEST_FAILED'], [{ stdout: 'x'.repeat(MAX_OUTPUT_BYTES + 1) }, 'AGY_OUTPUT_LIMIT']]) {
    const result = await inspectAntigravity({ executable, run: async () => transport('1.2.11', change) }); assert.equal(result.errorCode, expected);
  }
  const controller = new AbortController(); let calls = 0;
  const canceled = await inspectAntigravity({ executable, signal: controller.signal, run: async () => { calls++; controller.abort(); return transport('1.2.11'); } });
  assert.equal(canceled.errorCode, 'AGY_CANCELED'); assert.equal(calls, 1);
  const preCanceled = await inspectAntigravity({ executable, signal: controller.signal, run: async () => { throw new Error('must not run'); } }); assert.equal(preCanceled.errorCode, 'AGY_CANCELED');
});
