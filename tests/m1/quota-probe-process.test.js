'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runProbeProcess } = require('../../scripts/m1/quota-probe-process');
const { inspectAntigravity } = require('../../src/quota/antigravity-probe');
const { remove } = require('./temp');
const { NOW } = require('./fixtures/antigravity-quota');
const childFile = path.join(__dirname, 'fixtures/quota-probe-child.js');
function environment(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), '额度协议 with spaces-'));
  t.after(() => remove(directory));
  // Deliberately no API keys, user profile, provider configuration or PATH.
  const env = Object.fromEntries(['SystemRoot', 'SystemDrive', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  return { cwd: directory, env, timeoutMs: 5000, maxOutputBytes: 512 * 1024 };
}
test('Windows synthetic process runs exact protocol stages without a shell or credential environment', async t => {
  const options = environment(t), calls = [];
  const run = (exe, stage, { signal }) => {
    calls.push([exe, [...stage.args]]);
    return runProbeProcess(process.execPath, [childFile, stage.args[0] === '--version' ? 'version' : 'usage'], { ...options, timeoutMs: stage.timeoutMs, maxOutputBytes: stage.maxOutputBytes, signal });
  };
  const result = await inspectAntigravity({ executable: 'C:/synthetic/agy.exe', run, now: () => NOW });
  assert.equal(result.ok, true); assert.equal(calls.length, 2); assert.equal(result.quota.pools.length, 2);
  const args = ['a b', '中文', '$(echo SECRET)', '&', '"quoted"'];
  const echo = await runProbeProcess(process.execPath, [childFile, 'args', ...args], options);
  assert.equal(echo.reaped, true); assert.deepEqual(JSON.parse(echo.stdout), args);
  assert.deepEqual(fs.readdirSync(options.cwd), []);
});
test('synthetic timeout, cancellation, spawn failure and stderr flood all settle with bounded output', async t => {
  const options = environment(t);
  const timeout = await runProbeProcess(process.execPath, [childFile, 'hang'], { ...options, timeoutMs: 200 });
  assert.equal(timeout.timedOut, true); assert.equal(timeout.reaped, true);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 200);
  const canceled = await runProbeProcess(process.execPath, [childFile, 'hang'], { ...options, signal: controller.signal }); clearTimeout(timer);
  assert.equal(canceled.canceled, true); assert.equal(canceled.reaped, true);
  const missing = await runProbeProcess(path.join(options.cwd, 'absent.exe'), [], options); assert.equal(missing.reaped, true); assert.notEqual(missing.code, 0);
  const flood = await runProbeProcess(process.execPath, [childFile, 'flood'], { ...options, maxOutputBytes: 1024 });
  assert.equal(flood.overflow, true); assert.equal(flood.reaped, true); assert(Buffer.byteLength(flood.stderr) <= 1024);
});
test('Windows timeout kills the owned synthetic child tree; POSIX transport claims direct-child coverage only', async t => {
  if (process.platform !== 'win32') { t.skip('Windows taskkill /T acceptance'); return; }
  const options = environment(t);
  const tree = await runProbeProcess(process.execPath, [childFile, 'tree'], { ...options, timeoutMs: 2000 });
  const pid = Number(tree.stdout.trim()); assert(Number.isSafeInteger(pid) && pid > 0, 'synthetic descendant must have started');
  t.after(() => { try { process.kill(pid); } catch { /* Already reaped. */ } });
  assert.equal(tree.timedOut, true); assert.equal(tree.reaped, true);
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
});
