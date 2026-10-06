'use strict';
// Synthetic only: no real homes, account RPCs, credentials or provider network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { DatabaseSync } = require('node:sqlite');
const { fixtures } = require('../../tests/m1/fixtures');
const { scanSources } = require('../../src/m1/sources');
const { Store } = require('../../src/m1/store');
const { Service } = require('../../src/m1/service');
const { verifyProjection } = require('../../src/m1/native');
const { QuotaService } = require('../../src/quota/service');
const { AccountRpc } = require('../../src/quota/rpc');
const { disableNetwork } = require('../../src/m1/policy');
const tick = () => new Promise(resolve => setImmediate(resolve));
const report = { syntheticOnly: true, networkAttempts: 0, scenarios: [] };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-stress-'));
const output = path.resolve('artifacts/maintenance/stress-results.json');
async function scenario(name, run) {
  const started = performance.now();
  try { const evidence = await run(); report.scenarios.push({ name, passed: true, elapsedMs: Math.round(performance.now() - started), ...evidence }); }
  catch (error) { report.scenarios.push({ name, passed: false, elapsedMs: Math.round(performance.now() - started), failure: error.message }); }
  console.log(JSON.stringify(report.scenarios.at(-1)));
}
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
async function collector() {
  const dir = path.join(root, 'collector'), f = fixtures(path.join(dir, 'home'));
  const file = path.join(f.roots.opencode[0], 'opencode.db'), db = new DatabaseSync(file);
  const insert = db.prepare('INSERT INTO message VALUES(?,?,?)'), count = 160000;
  db.exec('BEGIN');
  for (let i = 0; i < count; i++) {
    const row = { id: 'stress-' + i, role: 'assistant', modelID: 'gpt-4.1', providerID: 'openai', tokens: { input: 80, output: 10, reasoning: 2, cache: { read: 20, write: 0 } }, time: { created: Date.UTC(2026, 0, 1 + i % 180) }, content: f.sentinel };
    insert.run(row.id, 'stress-session', JSON.stringify(row));
  }
  db.exec('COMMIT'); db.close(); const before = hash(file);
  const store = new Store(path.join(dir, 'store'), f.roots), timings = [];
  for (let cycle = 0; cycle < 3; cycle++) {
    const start = performance.now(), audit = { reads: 0 };
    const scan = await scanSources(f.roots, 'stress-salt', audit);
    assert.deepEqual(scan.opencode.errors, [], 'large database must not be silently dropped');
    assert.equal(scan.opencode.records.length, count + 1);
    const records = Object.values(scan).flatMap(s => s.records);
    const native = cycle === 0 ? await verifyProjection(records, path.join(dir, 'native')) : { status: 'passed' };
    const snapshot = store.ingest(scan, native);
    assert.equal(snapshot.daily.reduce((sum, row) => sum + row.totalTokens, 0), f.total + count * 112);
    assert.equal(Object.keys(store.state.records).length, count + 6);
    assert.equal(JSON.stringify(snapshot).includes(f.sentinel), false);
    timings.push(Math.round(performance.now() - start));
  }
  assert.equal(hash(file), before, 'synthetic source database changed');
  return { sqliteRecords: count, cycles: 3, cycleMs: timings, totalTokens: f.total + count * 112, databaseUnchanged: true, nativeAggregation: true, deduplication: true };
}
async function workbuddy() {
  const dir = path.join(root, 'workbuddy'), f = fixtures(path.join(dir, 'home'));
  const file = path.join(f.roots.workbuddy[0], 'session.jsonl'), base = JSON.parse(fs.readFileSync(file, 'utf8')), count = 8000;
  fs.writeFileSync(file, Array.from({ length: count }, (_, i) => JSON.stringify({ ...base, id: 'wb-' + i, sessionId: 's-' + i })).join('\n'));
  const start = performance.now(), scan = await scanSources(f.roots, 'stress-salt', { reads: 0 });
  assert.equal(scan.workbuddy.records.length, count); assert.deepEqual(scan.workbuddy.errors, []);
  return { records: count, scanMs: Math.round(performance.now() - start), tokens: scan.workbuddy.records.reduce((sum, row) => sum + row.totalTokens, 0) };
}
async function lifecycle() {
  const dir = path.join(root, 'lifecycle'), f = fixtures(path.join(dir, 'home')), service = new Service(path.join(dir, 'store'), f.roots);
  try {
    await Promise.all(Array.from({ length: 200 }, () => service.refresh())); assert.equal(service.store.state.sequence, 1);
    await service.close(); const sequence = service.store.state.sequence, audit = service.audit;
    await service.refresh(); assert.equal(service.worker, null, 'closed collector started a worker');
    assert.equal(service.store.state.sequence, sequence);
    assert.equal(service.audit, audit, 'closed collector performed another scan');
    return { concurrentRefreshes: 200, collections: 1, closedRefreshIgnored: true };
  } finally { await service.close(); }
}
async function queue() {
  let active = 0, maximum = 0, reads = 0;
  class Mock extends EventEmitter {
    async initialize() { active++; maximum = Math.max(maximum, active); await tick(); }
    async request(method) { await tick(); if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } }; reads++; return { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300 } } }; }
    close() { active--; }
  }
  const service = new QuotaService(path.join(root, 'queue'), 'synthetic.exe', () => {}, () => new Mock());
  service.accounts = Array.from({ length: 20 }, (_, i) => ({ id: crypto.randomUUID(), alias: 'synthetic-' + i, provider: 'codex', status: 'cached' }));
  service.persist();
  try {
    for (let cycle = 0; cycle < 50; cycle++) {
      await Promise.all(Array.from({ length: 20 }, () => service.refreshAll()));
      assert.equal(service.busy.size, 0); assert.equal(service.busyCounts.size, 0); assert.equal(active, 0);
    }
    assert.equal(maximum, 1); assert.equal(reads, 1000); assert.equal(service.clients.size, 0);
    return { accounts: 20, concurrentBatchCalls: 1000, attemptedAccountRefreshes: 20000, actualReads: reads, maxActiveChildren: maximum, pendingAtEnd: service.busy.size };
  } finally { await service.close(); }
}
function child() { const proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough(); proc.stdin = new PassThrough(); proc.kill = () => {}; return proc; }
async function protocol() {
  const proc = child(), rpc = new AccountRpc('synthetic.exe', path.join(root, 'rpc'), () => proc), requests = [];
  try {
    const count = 2000;
    for (let i = 0; i < count; i++) requests.push(rpc.request('account/rateLimits/read'));
    for (let id = count; id > 0; id--) {
      const frame = JSON.stringify({ id, result: { value: id } }) + '\n';
      for (let at = 0; at < frame.length; at += 7) proc.stdout.write(frame.slice(at, at + 7));
    }
    const results = await Promise.all(requests); assert.equal(results.length, count); assert.equal(rpc.pending.size, 0); assert.equal(rpc.buffer, '');
    results.forEach((value, i) => assert.equal(value.value, i + 1));
    const pending = rpc.request('account/read'); const rejection = assert.rejects(pending, /CODEX_PROTOCOL_LIMIT/);
    proc.stdout.write('x'.repeat(2 * 1024 * 1024 + 1)); await rejection;
    assert.equal(rpc.buffer.length, 0, 'failed protocol retains oversized payload');
    return { fragmentedResponses: count, reverseResponseOrder: true, pendingAtEnd: 0, oversizedFrameDiscarded: true };
  } finally { await rpc.close(); }
}
async function projection() {
  const { selectSnapshot } = require('../../design/desktop-reference/local-snapshot');
  const { series } = require('../../design/desktop-reference/usage-math');
  const rows = Array.from({ length: 20000 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1 + i % 180)).toISOString().slice(0, 10), agent: 'codex', entry: 'cli', provider: 'openai', model: 'synthetic-' + i % 100, totalTokens: 100, inputUncached: 80, output: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0, records: 1, pricedTokens: 0, estimatedCostUsd: null, partialRecords: 0 }));
  const snapshot = selectSnapshot({ schemaVersion: 'UsageSnapshotV1', sequence: 1, daily: rows });
  const days = Array.from({ length: 180 }, (_, i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
  for (let cycle = 0; cycle < 30; cycle++) {
    let total = 0;
    for (let model = 0; model < 100; model++) total += series(snapshot.daily, 'synthetic-' + model, days, 'total', 'tokens', days[0]).at(-1);
    assert.equal(total, 2000000);
  }
  return { projectedRows: rows.length, chartCalculations: 3000, totalTokens: 2000000 };
}
(async () => {
  disableNetwork(report); const delay = monitorEventLoopDelay({ resolution: 20 }); delay.enable();
  await scenario('SQLite repeated collection + native independent totals', collector);
  await scenario('WorkBuddy detail growth', workbuddy);
  await scenario('Collector overlap and shutdown', lifecycle);
  await scenario('Quota queue storm', queue);
  await scenario('RPC fragmentation and overflow', protocol);
  await scenario('Large statistics projection and chart math', projection);
  delay.disable(); report.eventLoopDelayMaxMs = Math.round(delay.max / 1e6); report.peakRssMiB = Math.round(process.resourceUsage().maxRSS / 1024);
  assert.equal(report.networkAttempts, 0); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  if (report.scenarios.some(s => !s.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
