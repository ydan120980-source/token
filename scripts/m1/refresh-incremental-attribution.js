'use strict';
// Where one incremental refresh spends its time, after the collector is warm. A single appended
// usage line changes one file; everything else in the ledger is identical. Timing each stage
// separately shows whether the work is proportional to what changed or to the whole ledger.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.INCREMENTAL_ROWS || 2000);
const TURNS = Number(process.env.INCREMENTAL_TURNS || 20);
const ROUNDS = Number(process.env.INCREMENTAL_ROUNDS || 5);
const OUTPUT = process.env.INCREMENTAL_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'incremental.json');
const round = value => +value.toFixed(1);

// One usage line appended to a file the collector already read. The timestamp and the model are
// what the Codex normalizer needs for the row to become a record rather than be filtered out.
function appended(turn) {
  const total = { input_tokens: 100 + turn, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 + turn };
  return JSON.stringify({ timestamp: new Date(build.START + 3600000 + turn * 1000).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { model: 'gpt-5-codex', total_token_usage: total, last_token_usage: total } } });
}

const median = values => { const sorted = [...values].sort((a, b) => a - b); return round(sorted[Math.floor(sorted.length / 2)]); };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-incremental-'));
  const { roots, oneFile, files, usageRows } = build(root, ROWS, TURNS);
  const places = { home: path.join(root, 'home'), appData: null, localAppData: null };
  const { Service } = require('../../src/m1/service');
  const report = { schemaVersion: 'RefreshIncrementalV1', rows: ROWS, turnsPerFile: TURNS, files, usageRows, runs: ROUNDS, syntheticOnly: true, samples: [] };
  let service = null;
  const measure = async (label) => {
    const before = service.store.diagnostics();
    let ingestMs = 0;
    const real = service.store.ingestCollection.bind(service.store);
    service.store.ingestCollection = (...args) => { const began = performance.now(); const value = real(...args); ingestMs = round(performance.now() - began); return value; };
    const began = performance.now();
    const answer = await service.refresh();
    const totalMs = round(performance.now() - began);
    service.store.ingestCollection = real;
    const after = service.store.diagnostics();
    // A stage row is an aggregate, not a number: the delta is the time it spent on this refresh.
    const stages = {};
    for (const [stage, row] of Object.entries(after.stages)) {
      const earlier = before.stages[stage] || { count: 0, totalMs: 0, maxMs: 0 };
      stages[stage] = { ms: round(row.totalMs - earlier.totalMs), count: row.count - earlier.count, maxMs: round(row.maxMs) };
    }
    const counters = {};
    for (const [counter, value] of Object.entries(after.counters)) counters[counter] = value - (before.counters[counter] || 0);
    return { label, totalMs, ingestMs, workerMs: round(totalMs - ingestMs), stages, counters, lastCollection: service.lastCollection, records: Object.keys(service.store.state.records).length, snapshotRows: answer.snapshot?.daily?.length ?? 0 };
  };
  try {
    service = new Service(path.join(root, 'usage'), roots, () => {}, places);
    const warm = await measure('warm-up');
    report.warmup = { ...warm, expectedRecords: files * TURNS };
    for (let index = 0; index < ROUNDS; index += 1) {
      fs.appendFileSync(oneFile, appended(index) + '\n');
      report.samples.push(await measure('append ' + index));
    }
    report.samples.push(await measure('no change'));
    const appends = report.samples.filter(row => row.label.startsWith('append'));
    report.medians = { totalMs: median(appends.map(row => row.totalMs)), ingestMs: median(appends.map(row => row.ingestMs)), workerMs: median(appends.map(row => row.workerMs)) };
    const stageMedian = {}, counterMedian = {};
    for (const stage of Object.keys(appends[0].stages)) { stageMedian[stage] = median(appends.map(row => row.stages[stage].ms)); counterMedian[stage + '#count'] = median(appends.map(row => row.stages[stage].count)); }
    for (const counter of Object.keys(appends[0].counters)) counterMedian[counter] = median(appends.map(row => row.counters[counter]));
    report.medians.stages = stageMedian;
    report.medians.counters = counterMedian;
    report.valid = appends.every(row => row.lastCollection === 'ingested');
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUTPUT), JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ medians: report.medians, valid: report.valid }));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (service) await service.close().catch(() => {});
    for (let attempt = 0; attempt < 5; attempt += 1) { try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
    // The collector watches its roots; a settled run has nothing left to wait for.
    process.exit(process.exitCode || 0);
  }
})();
