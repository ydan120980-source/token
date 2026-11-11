'use strict';
// Whether a one-record append takes the incremental projection or falls back to the full one, and
// what each costs. The store destructures `projectIncremental` when it loads, so the wrapper goes
// into the module cache first and reports from inside the real call.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.PROJECTION_ROWS || 2000);
const TURNS = Number(process.env.PROJECTION_TURNS || 20);
const ROUNDS = Number(process.env.PROJECTION_ROUNDS || 3);
const OUTPUT = process.env.PROJECTION_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'projection.json');
const round = value => +value.toFixed(1);

const incrementalPath = require.resolve('../../src/m1/usage-projection-incremental');
const usagePath = require.resolve('../../src/m1/usage-projection');
const calls = [];
const incremental = require(incrementalPath);
const originalIncremental = incremental.projectIncremental;
incremental.projectIncremental = (options, prior) => {
  const began = performance.now();
  const value = originalIncremental(options, prior);
  calls.push({ kind: 'incremental', ms: round(performance.now() - began), accepted: value !== null, records: options.records?.length ?? 0 });
  return value;
};
const usage = require(usagePath);
const originalUsage = usage.projectUsage;
usage.projectUsage = (options) => {
  const began = performance.now();
  const value = originalUsage(options);
  calls.push({ kind: 'full', ms: round(performance.now() - began), accepted: true, records: options.records?.length ?? 0 });
  return value;
};

function appended(turn) {
  const total = { input_tokens: 100 + turn, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 + turn };
  return JSON.stringify({ timestamp: new Date(build.START + 3600000 + turn * 1000).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { model: 'gpt-5-codex', total_token_usage: total, last_token_usage: total } } });
}

(async () => {
  const { Service } = require('../../src/m1/service');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-projection-'));
  const { roots, oneFile, files, usageRows } = build(root, ROWS, TURNS);
  const places = { home: path.join(root, 'home'), appData: null, localAppData: null };
  const report = { schemaVersion: 'RefreshProjectionV1', rows: ROWS, turnsPerFile: TURNS, files, usageRows, rounds: ROUNDS, syntheticOnly: true, samples: [] };
  let service = null;
  try {
    service = new Service(path.join(root, 'usage'), roots, () => {}, places);
    await service.refresh();
    report.warmup = calls.splice(0, calls.length);
    for (let index = 0; index < ROUNDS; index += 1) {
      fs.appendFileSync(oneFile, appended(index) + '\n');
      const began = performance.now();
      await service.refresh();
      report.samples.push({ label: 'append ' + index, refreshMs: round(performance.now() - began), calls: calls.splice(0, calls.length), records: Object.keys(service.store.state.records).length });
    }
    const appends = report.samples.flatMap(row => row.calls);
    report.summary = {
      incrementalCalls: appends.filter(row => row.kind === 'incremental').length,
      incrementalAccepted: appends.filter(row => row.kind === 'incremental' && row.accepted).length,
      fullCalls: appends.filter(row => row.kind === 'full').length,
      incrementalMs: appends.filter(row => row.kind === 'incremental').map(row => row.ms),
      fullMs: appends.filter(row => row.kind === 'full').map(row => row.ms)
    };
    report.valid = appends.length > 0;
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUTPUT), JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report.summary));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (service) await service.close().catch(() => {});
    for (let attempt = 0; attempt < 5; attempt += 1) { try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
    process.exit(process.exitCode || 0);
  }
})();
