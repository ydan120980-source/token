'use strict';
// The reads that run by themselves (owner 2026-11-04): a passing failure stays quiet, programs start rarely, and nothing reaches the desktop.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const childProcess = require('node:child_process');
const realFork = childProcess.fork; let forks = 0;
childProcess.fork = (...args) => { forks++; return realFork(...args); };
const { ProviderQuotaService, runWorker } = require('../../src/quota/provider-service');
const { QuotaService } = require('../../src/quota/service');
const { pinnedAntigravityRun } = require('../../src/quota/antigravity-windows-run');
const { remove } = require('./temp');
const { EventEmitter } = require('node:events');
const ID = '00000000-0000-4000-8000-000000000001', ID2 = '00000000-0000-4000-8000-000000000002';
const now = () => new Date().toISOString();
const { quotaOf } = require('./quota-card-fixtures');
const reading = () => ({ resources: quotaOf('deepseek', undefined, now()) });
function provider(t, run, rows = [{ id: ID, adapter: 'deepseek-api' }]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-reads-')); t.after(() => remove(root));
  fs.writeFileSync(path.join(root, 'connections.json'), JSON.stringify({ schemaVersion: 'ProviderQuotaCacheV1', connections: rows.map(row => ({ ...row, alias: 'demo', quota: row.adapter === 'deepseek-api' ? reading().resources : null })) }));
  const service = new ProviderQuotaService(root, { run, retryDelay: 1 });
  for (const row of rows) service.secrets.set(row.id, 'demo'); t.after(() => service.close());
  return service;
}

test('a passing failure in an automatic read is tried again and stays quiet until the third tick', async t => {
  let calls = 0; const service = provider(t, async () => { calls++; throw new Error('PROVIDER_TIMEOUT'); }), row = service.rows[0], shown = row.quota;
  row.status = 'ready';
  await service.refreshAll({ automatic: true });
  assert.equal(calls, 2, 'tried again once'); assert.equal(row.errorCode, null); assert.equal(row.status, 'ready'); assert.equal(row.quota, shown, 'the last reading stays');
  await service.refreshAll({ automatic: true }); assert.equal(row.errorCode, null);
  await service.refreshAll({ automatic: true }); assert.equal(row.errorCode, 'PROVIDER_TIMEOUT', 'the third tick says so'); assert.equal(row.status, 'error');
});

test('a success ends the count; an explicit refresh and real problems are never quiet', async t => {
  let fail = true; const service = provider(t, async () => { if (fail) throw new Error('PROVIDER_REQUEST_FAILED'); return reading(); }), row = service.rows[0];
  row.status = 'ready';
  await service.refreshAll({ automatic: true }); assert.equal(row.quietTicks, 1);
  fail = false; await service.refreshAll({ automatic: true }); assert.equal(row.quietTicks, 0); assert.equal(row.status, 'ready');
  fail = true; await service.refresh(ID); assert.equal(row.errorCode, 'PROVIDER_REQUEST_FAILED', 'asked for by a person: shown at once');
  const denied = provider(t, async () => { throw new Error('PROVIDER_ACCESS_DENIED'); }); denied.rows[0].status = 'ready';
  await denied.refreshAll({ automatic: true }); assert.equal(denied.rows[0].errorCode, 'PROVIDER_ACCESS_DENIED', 'not a passing failure');
  const limited = provider(t, async () => { throw new Error('PROVIDER_RATE_LIMITED'); }); limited.rows[0].status = 'ready';
  await limited.refreshAll({ automatic: true }); assert.equal(limited.rows[0].errorCode, 'PROVIDER_RATE_LIMITED');
});

test('a connection with nothing to show says what is wrong at once', async t => {
  const service = provider(t, async () => { throw new Error('PROVIDER_TIMEOUT'); }), row = service.rows[0]; row.quota = null;
  await service.refreshAll({ automatic: true }); assert.equal(row.errorCode, 'PROVIDER_TIMEOUT');
});

test('a route that starts a program reads at most every five minutes by itself, and whenever a person asks', async t => {
  let calls = 0, clock = Date.now();
  const service = provider(t, async () => { calls++; throw new Error('PROVIDER_ACCESS_DENIED'); }, [{ id: ID2, adapter: 'antigravity-cli' }]), row = service.rows[0];
  service.now = () => clock; service.fixture = false;
  await service.refreshAll({ automatic: true }); assert.equal(calls, 1, 'the first tick reads');
  row.nextRefreshAt = null; clock += 60000; const skipped = await service.refreshAll({ automatic: true }); assert.equal(calls, 1); assert.equal(skipped.skipped, 1);
  row.nextRefreshAt = null; clock += 5 * 60000; await service.refreshAll({ automatic: true }); assert.equal(calls, 2);
  row.nextRefreshAt = null; await service.refresh(ID2); assert.equal(calls, 3, 'a person asking is not paced');
});

test('the reads of a batch share one worker, which then leaves', async () => {
  const before = forks, abort = new AbortController();
  const results = await Promise.allSettled([runWorker('not-a-provider', 'demo', abort.signal), runWorker('not-a-provider', 'demo', abort.signal), runWorker('not-a-provider', 'demo', abort.signal)]);
  assert.equal(forks - before, 1, 'one process for three reads');
  for (const result of results) assert.equal(result.status, 'rejected');
  await new Promise(resolve => setTimeout(resolve, 2200));
  const after = forks; await assert.rejects(runWorker('not-a-provider', 'demo', abort.signal)); assert.equal(forks - after, 1, 'a later batch starts its own');
  await new Promise(resolve => setTimeout(resolve, 2200));
});

class Rpc extends EventEmitter {
  constructor(fail) { super(); this.fail = fail; }
  async initialize() {} close() { return Promise.resolve(); }
  async request(method) { if (this.fail()) throw new Error('CODEX_REQUEST_TIMEOUT'); return method === 'account/read' ? { account: { type: 'chatgpt', planType: 'plus' } } : { rateLimits: { primary: { usedPercent: 1, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 } } }; }
}
test('Codex: the same quiet for automatic reads, and an explicit refresh still shows the failure', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quiet-codex-')); t.after(() => remove(directory));
  let failing = false, built = 0;
  const service = new QuotaService(directory, 'codex.exe', () => {}, () => { built++; return new Rpc(() => failing); }, { retryDelay: 1 });
  t.after(() => service.close());
  service.accounts.push({ id: ID, provider: 'codex', alias: 'demo', plan: null, status: 'cached', quota: null, lastAttempt: null, errorCode: null, nextRefreshAt: null });
  await service.refreshOne(ID); const account = service.account(ID); assert.equal(account.status, 'ready'); const read = account.quota;
  failing = true; built = 0;
  await service.refreshAll({ automatic: true });
  assert.equal(built, 2, 'tried again once'); assert.equal(account.errorCode, null); assert.equal(account.status, 'ready'); assert.equal(account.quota, read);
  await service.refreshAll({ automatic: true }); assert.equal(account.errorCode, null);
  await service.refreshAll({ automatic: true }); assert.equal(account.errorCode, 'CODEX_REQUEST_TIMEOUT', 'the third tick says so');
  account.nextRefreshAt = null; account.errorCode = null; account.status = 'ready';
  await service.refreshOne(ID); assert.equal(account.errorCode, 'CODEX_REQUEST_TIMEOUT', 'asked for by a person: shown at once');
});

test('reading Antigravity turns its self-update off, on every path that starts agy', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/quota/provider-client-login.js'), 'utf8');
  assert.match(source, /if \(agent === 'antigravity'\) env\.AGY_CLI_DISABLE_AUTO_UPDATE = 'true';/);
  assert.equal((source.match(/isolated\('antigravity'|isolated\(agent/g) ?? []).length >= 3, true);
  assert.equal(typeof pinnedAntigravityRun, 'function');
});

test('the job host is compiled once, and a broken copy costs a compile rather than the read', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'job-host-')); t.after(() => remove(root));
  const script = `
    const { runWindowsJob } = require(${JSON.stringify(path.join(__dirname, '../../src/quota/windows-job'))});
    const { fingerprint } = require(${JSON.stringify(path.join(__dirname, '../../src/quota/executable-pin'))});
    const fs = require('node:fs'), path = require('node:path'), dir = path.join(process.env.LOCALAPPDATA, 'AgentUsage', 'job-host');
    const run = () => runWindowsJob(fingerprint(process.execPath), ['-e', 'console.log(1)'], { cwd: process.env.LOCALAPPDATA, env: { SystemRoot: process.env.SystemRoot }, timeoutMs: 20000, maxOutputBytes: 4096 });
    (async () => {
      const first = await run(), [dll] = fs.readdirSync(dir).filter(file => file.endsWith('.dll')), stamp = fs.statSync(path.join(dir, dll)).mtimeMs;
      const second = await run(), kept = fs.statSync(path.join(dir, dll)).mtimeMs === stamp;
      fs.writeFileSync(path.join(dir, dll), 'not an assembly');
      const third = await run();
      console.log(JSON.stringify({ outputs: [first, second, third].map(result => result.stdout.trim()), errors: [first, second, third].map(result => result.errorCode), kept, files: fs.readdirSync(dir).filter(file => file.endsWith('.tmp')).length }));
    })();`;
  const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, LOCALAPPDATA: root }, encoding: 'utf8', timeout: 90000 });
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.deepEqual(report.outputs, ['1', '1', '1']); assert.deepEqual(report.errors, [null, null, null]);
  assert.equal(report.kept, true, 'the second read did not compile'); assert.equal(report.files, 0, 'no temporary file left');
});
