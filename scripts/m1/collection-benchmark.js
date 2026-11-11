'use strict';
// Full and incremental collection over a synthetic home: same shapes Codex and Claude Code write.
// `full` measures what one refresh actually does — walk, stamp, refresh and (when something changed)
// scan — so the three stages are counted together the way the worker runs them.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.COLLECT_ROWS || 400);
const RUNS = Number(process.env.COLLECT_RUNS || 5);
const median = values => { const sorted = [...values].sort((a, b) => a - b); return +sorted[Math.floor(sorted.length / 2)].toFixed(1); };
const fresh = () => { const { ParseCache } = require('../../src/m1/parse-cache'); return { salt: 'bench', files: new ParseCache(), fingerprints: new Map(), seen: new Set(), listing: null }; };

// Older trees walk three times; the tree under test shares one walk.
async function pass(sources, roots, salt, audit, cache, { scan }) {
  const walk = sources.survey ? sources.survey(roots, audit) : null;
  const stamp = sources.sourceStamp(roots, salt, audit, walk || undefined);
  const refreshed = await sources.refreshCache(roots, salt, audit, cache, walk || undefined);
  if (!scan) return { stamp, refreshed };
  return { stamp, refreshed, scan: await sources.scanSources(roots, salt, audit, { cache, prepared: walk || undefined }) };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collect-bench-'));
  const report = { schemaVersion: 'CollectionBenchmarkV2', rows: ROWS, turnsPerFile: 20, runs: RUNS, mode: 'source-synthetic', osCache: 'warm', sharedWalk: true, full: [], incremental: [], unchanged: [], scanOnly: [] };
  const { roots, oneFile } = build(root, ROWS);
  const sources = require('../../src/m1/sources');
  report.sharedWalk = Boolean(sources.survey);

  // Cold: an empty cache, every file parsed — what a first launch does.
  for (let run = 0; run < RUNS; run += 1) {
    const cache = fresh(), audit = { reads: 0 };
    const began = performance.now();
    const done = await pass(sources, roots, 'bench', audit, cache, { scan: true });
    report.full.push({ ms: +(performance.now() - began).toFixed(1), records: Object.values(done.scan).reduce((sum, source) => sum + source.records.length, 0), reads: audit.reads });
  }
  // Incremental: one file gains a turn; the rest is unchanged.
  for (let run = 0; run < RUNS; run += 1) {
    const cache = fresh();
    await pass(sources, roots, 'bench', { reads: 0 }, cache, { scan: false });
    fs.appendFileSync(oneFile, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 900 + run, output_tokens: 90 }, last_token_usage: { input_tokens: 10, output_tokens: 1 } } } }) + '\n');
    const audit = { reads: 0 }, began = performance.now();
    const done = await pass(sources, roots, 'bench', audit, cache, { scan: true });
    report.incremental.push({ ms: +(performance.now() - began).toFixed(1), reads: audit.reads, changed: done.refreshed.changed });
  }
  // Unchanged refresh: the quiet case that must not regress.
  const quiet = fresh();
  await pass(sources, roots, 'bench', { reads: 0 }, quiet, { scan: false });
  for (let run = 0; run < RUNS; run += 1) {
    const audit = { reads: 0 }, began = performance.now();
    await pass(sources, roots, 'bench', audit, quiet, { scan: false });
    report.unchanged.push({ ms: +(performance.now() - began).toFixed(1), reads: audit.reads });
  }
  // The scan alone, kept so this run can be read next to the earlier single-stage numbers.
  for (let run = 0; run < RUNS; run += 1) {
    const audit = { reads: 0 }, began = performance.now();
    await sources.scanSources(roots, 'bench', audit, { cache: fresh() });
    report.scanOnly.push({ ms: +(performance.now() - began).toFixed(1), reads: audit.reads });
  }
  report.summary = { fullMedianMs: median(report.full.map(row => row.ms)), incrementalMedianMs: median(report.incremental.map(row => row.ms)), unchangedMedianMs: median(report.unchanged.map(row => row.ms)), scanOnlyMedianMs: median(report.scanOnly.map(row => row.ms)), sharedWalk: report.sharedWalk };
  console.log(JSON.stringify(report.summary));
  const out = path.resolve(process.env.COLLECT_OUT || 'artifacts/perf-20261103/collection/benchmark.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('wrote ' + out);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error); process.exitCode = 1; });
