'use strict';
// One collection round measured the way the product runs it: a Service over a synthetic home, one
// refresh that walks, stamps, parses, de-duplicates, aggregates, persists statistics.json, verifies the
// projection with the pinned native program and returns the saved snapshot. Three loads are measured:
//
//   full      a first launch: nothing cached, every file parsed and ingested
//   incremental one file gains a turn; the rest is unchanged
//   unchanged every file is untouched, so the stored ledger is reproduced and nothing is written
//
// The synthetic rows carry the timestamps and message ids the normalizers require, so every row lands
// as a record. A run that produced no records is reported as a failure rather than as a fast pass.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.REFRESH_ROWS || 200);
const TURNS = Number(process.env.REFRESH_TURNS || 20);
const RUNS = Number(process.env.REFRESH_RUNS || 5);
const OUTPUT = process.env.REFRESH_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'pass.json');

const median = values => { const sorted = [...values].sort((a, b) => a - b); return +sorted[Math.floor(sorted.length / 2)].toFixed(1); };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-bench-'));
  const { roots, oneFile, files, usageRows } = build(root, ROWS, TURNS);
  const places = { home: path.join(root, 'home'), appData: null, localAppData: null };
  const { Service } = require('../../src/m1/service');
  const report = { schemaVersion: 'RefreshBenchmarkV1', rows: ROWS, turnsPerFile: TURNS, files, usageRows, runs: RUNS, syntheticOnly: true, mode: 'source-synthetic', full: [], incremental: [], unchanged: [], records: null, totalTokens: null, ledger: null };

  const measure = async (service, label) => {
    const began = performance.now();
    const result = await service.refresh();
    const ms = +(performance.now() - began).toFixed(1);
    const state = service.store.state;
    const records = Object.values(state.records);
    const totalTokens = records.reduce((sum, record) => sum + record.totalTokens, 0);
    const snapshot = result.snapshot;
    const sample = {
      ms, label,
      records: records.length, totalTokens,
      lastCollection: service.lastCollection, error: service.lastError,
      snapshotRows: snapshot?.daily?.length ?? 0,
      snapshotTotal: snapshot?.daily?.reduce((sum, row) => sum + row.totalTokens, 0) ?? 0
    };
    return sample;
  };

  // What was counted, independent of when it was counted: every record's owner, day, tokens and quality.
  // Two trees that agree on this hash produced the same ledger from the same files.
  const recordHash = service => crypto.createHash('sha256').update(Object.values(service.store.state.records)
    .map(record => [record.id, record.agent, record.day, record.totalTokens, record.quality, record.sessionKey].join('|'))
    .sort().join('\n')).digest('hex');

  try {
    let service = null;
    // full: a fresh store, a fresh worker, nothing cached in the process.
    for (let run = 0; run < RUNS; run += 1) {
      const dir = path.join(root, 'usage-' + run);
      service = new Service(dir, roots, () => {}, places);
      const sample = await measure(service, 'full');
      report.full.push(sample);
      if (run === 0) { report.records = sample.records; report.totalTokens = sample.totalTokens; report.recordHash = recordHash(service); }
      await service.close();
    }

    // incremental: the same store, warmed once, then one file gains a turn before each measured refresh.
    for (let run = 0; run < RUNS; run += 1) {
      const dir = path.join(root, 'usage-inc-' + run);
      service = new Service(dir, roots, () => {}, places);
      await service.refresh();
      fs.appendFileSync(oneFile, JSON.stringify({
        timestamp: new Date(Date.now() + run * 1000).toISOString(),
        type: 'event_msg',
        payload: { type: 'token_count', info: { model: 'gpt-5-codex', total_token_usage: { input_tokens: 9000 + run, output_tokens: 900 }, last_token_usage: { input_tokens: 90, output_tokens: 9, cached_input_tokens: 0 } } }
      }) + '\n');
      const before = Object.keys(service.store.state.records).length;
      const sample = await measure(service, 'incremental');
      report.incremental.push({ ...sample, recordsBefore: before });
      await service.close();
    }

    // unchanged: refresh, then refresh again with nothing touched.
    for (let run = 0; run < RUNS; run += 1) {
      const dir = path.join(root, 'usage-quiet-' + run);
      service = new Service(dir, roots, () => {}, places);
      await service.refresh();
      const sample = await measure(service, 'unchanged');
      report.unchanged.push(sample);
      await service.close();
    }

    const dir = path.join(root, 'usage-quiet-0');
    report.ledger = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'statistics.json'))).digest('hex');
    report.summary = {
      fullMedianMs: median(report.full.map(row => row.ms)),
      incrementalMedianMs: median(report.incremental.map(row => row.ms)),
      unchangedMedianMs: median(report.unchanged.map(row => row.ms))
    };
    const empty = report.full.some(row => row.records === 0);
    report.valid = !empty && !report.full.some(row => row.error);
    if (empty) report.invalid = 'a full refresh produced no records, so the load never reached aggregation';
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUTPUT), JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ summary: report.summary, valid: report.valid, invalid: report.invalid || null, records: report.records, totalTokens: report.totalTokens }));
    if (!report.valid) process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
