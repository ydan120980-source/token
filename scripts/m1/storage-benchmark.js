'use strict';
// Synthetic Store-only measurements, one process per size. No source collector,
// account, credential, real configuration or user ledger is opened.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict'), { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const { Store, atomic } = require('../../src/m1/store');
const { SOURCES, disableNetwork } = require('../../src/m1/policy');
const { readSavedModel } = require('../../src/m1/read-snapshot');
const { remove } = require('../../tests/m1/temp');

function record(index) {
  return { id: 'synthetic-' + index, sessionKey: 'session-' + index % 500, agent: 'claude', entry: 'cli', provider: 'synthetic', model: 'model-' + index % 100,
    timestamp: new Date(Date.UTC(2026, 0, 1 + index % 180, index % 24)).toISOString(), inputUncached: 80, output: 20, cacheRead: 20, cacheWrite: 0, reasoning: 0, totalTokens: 120, quality: 'measured' };
}
function memory() { const value = process.memoryUsage(); return { heapUsedMiB: value.heapUsed / 1048576, rssMiB: value.rss / 1048576 }; }
function summary(times) {
  const sorted = [...times].sort((a, b) => a - b);
  return { medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1), samplesMs: times };
}
function stageDelta(before, after) {
  return Object.fromEntries(Object.keys(after.stages).map(name => [name, { count: after.stages[name].count - before.stages[name].count, totalMs: after.stages[name].totalMs - before.stages[name].totalMs }]));
}
async function measure(count, repeats) {
  const audit = { networkAttempts: 0 }; disableNetwork(audit);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-synthetic-'));
  try {
    const store = new Store(root, {}), rows = Array.from({ length: count }, (_, index) => record(index));
    store.state.records = Object.fromEntries(rows.map(row => [row.id, row]));
    store.state.sequence = 1;
    atomic(path.join(root, 'statistics.json'), store.state);
    const scan = Object.fromEntries(SOURCES.map(agent => [agent, { detected: agent === 'claude', records: agent === 'claude' ? rows : [], sessions: [], errors: [], partial: false, fileCount: agent === 'claude' ? 1 : 0, skipped: 0, durationMs: 0 }]));
    store.ingestCollection(scan, { status: 'synthetic' }, {}); // Warm status/projection caches.
    const memorySamples = { afterWarm: memory() };
    const noChange = [], changed = [], cached = [], stages = { noChange: [], changed: [] };
    for (let repeat = 0; repeat < repeats; repeat++) {
      const before = fs.readFileSync(path.join(root, 'statistics.json')), sequence = store.state.sequence, diagnostics = store.diagnostics(), started = performance.now();
      store.ingestCollection(scan, { status: 'synthetic' }, {});
      noChange.push(performance.now() - started);
      stages.noChange.push(stageDelta(diagnostics, store.diagnostics()));
      assert.equal(store.state.sequence, sequence);
      assert.deepEqual(fs.readFileSync(path.join(root, 'statistics.json')), before);
      rows.push(record(count + repeat));
      const nextDiagnostics = store.diagnostics(), next = performance.now();
      store.ingestCollection(scan, { status: 'synthetic' }, {});
      changed.push(performance.now() - next);
      stages.changed.push(stageDelta(nextDiagnostics, store.diagnostics()));
      assert.equal(store.records().length, count + repeat + 1);
      const cachedStart = performance.now(); store.snapshot(); cached.push(performance.now() - cachedStart);
    }
    memorySamples.afterRefresh = memory();
    const filename = path.join(root, 'statistics.json'), bytes = fs.statSync(filename).size;
    const restartStart = performance.now(), restored = new Store(root, {}), restartReadMs = performance.now() - restartStart;
    const projectStart = performance.now(), snapshot = restored.snapshot(), restartProjectionMs = performance.now() - projectStart;
    assert.equal(snapshot.daily.reduce((total, row) => total + row.totalTokens, 0), (count + repeats) * 120);
    memorySamples.afterRestart = memory();
    const queryStart = performance.now(), saved = readSavedModel(filename), savedReadMs = performance.now() - queryStart;
    const savedProjectStart = performance.now(), savedSnapshot = saved.snapshot(), savedProjectionMs = performance.now() - savedProjectStart;
    assert.equal(savedSnapshot.daily.reduce((total, row) => total + row.totalTokens, 0), (count + repeats) * 120);
    memorySamples.afterSavedQuery = memory();
    assert.equal(audit.networkAttempts, 0);
    return { records: count, finalRecords: count + repeats, bytes, noChange: summary(noChange), changed: summary(changed), cached: summary(cached), stages,
      restartReadMs, restartProjectionMs, savedReadMs, savedProjectionMs, heapUsedMiB: process.memoryUsage().heapUsed / 1048576,
      peakRssMiB: process.resourceUsage().maxRSS / 1024, memorySamples, diagnostics: store.diagnostics(), unknownPricingPreserved: snapshot.daily.every(row => row.estimatedCostUsd === null),
      unchangedBytesVerified: true, restartTotalsVerified: true, savedQueryTotalsVerified: true, networkAttempts: audit.networkAttempts };
  } finally { await remove(root); }
}
async function main() {
  if (process.argv[2] === '--measure') { console.log(JSON.stringify(await measure(Number(process.argv[3]), Number(process.argv[4])))); return; }
  const option = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
  const sizes = option('--rows', '20000,100000,200000').split(',').map(Number), repeats = Number(option('--repeats', '3'));
  if (sizes.some(size => !Number.isInteger(size) || size < 0 || size > 250000) || !Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw Error('Invalid benchmark bounds');
  const output = option('--output', 'artifacts/backend-architecture-20261023/storage.json');
  const report = { schemaVersion: 'StorageBenchmarkV1', syntheticOnly: true, runtime: process.version, osCache: 'uncontrolled', memoryScope: 'benchmark process including seed rows, Store, restarted Store and saved query; not product steady memory', samples: [], measuredAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  for (const size of sizes) {
    const child = spawnSync(process.execPath, [__filename, '--measure', String(size), String(repeats)], { encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr);
    const value = JSON.parse(child.stdout); report.samples.push(value);
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ records: size, bytes: value.bytes, noChangeMs: value.noChange.medianMs, changedMs: value.changed.medianMs, peakRssMiB: value.peakRssMiB }));
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { record, summary, stageDelta, measure };
