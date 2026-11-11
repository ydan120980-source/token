'use strict';
// Where a full refresh spends its time, measured stage by stage inside the same worker the product runs.
// Each stage is timed separately so a slow overall number can be attributed rather than guessed at:
// walk, stamp, parse (refreshCache), scan (scanSources), native verification, ingest (de-duplication and
// aggregation into the ledger) and the digest/write that ends it.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.ATTR_ROWS || 2000);
const TURNS = Number(process.env.ATTR_TURNS || 20);
const OUTPUT = process.env.ATTR_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'attribution.json');
const round = value => +value.toFixed(1);

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-attr-'));
  const { roots } = build(root, ROWS, TURNS);
  const sources = require('../../src/m1/sources');
  const { ParseCache } = require('../../src/m1/parse-cache');
  const { verifyProjection } = require('../../src/m1/native');
  const { Store } = require('../../src/m1/store');
  const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
  const report = { rows: ROWS, turnsPerFile: TURNS, syntheticOnly: true };

  try {
    // Walk and stamp are pure: one survey, one stamp.
    let began = performance.now();
    const walk = sources.survey(roots, audit);
    report.surveyMs = round(performance.now() - began);

    began = performance.now();
    sources.sourceStamp(roots, 'attr', audit, walk);
    report.stampMs = round(performance.now() - began);

    // Cold parse: every file read, parsed and fingerprinted.
    const cache = { salt: 'attr', files: new ParseCache(), fingerprints: new Map(), seen: new Set(), listing: null };
    began = performance.now();
    await sources.refreshCache(roots, 'attr', audit, cache, walk);
    report.refreshCacheColdMs = round(performance.now() - began);

    // Warm parse: same files, same stamps — the fingerprint comparison decides there is nothing to do.
    began = performance.now();
    await sources.refreshCache(roots, 'attr', audit, cache, sources.survey(roots, audit));
    report.refreshCacheWarmMs = round(performance.now() - began);

    // Scan: collects the parsed outcomes into per-source results.
    began = performance.now();
    const scan = await sources.scanSources(roots, 'attr', audit, { cache, prepared: walk });
    report.scanSourcesMs = round(performance.now() - began);
    const records = Object.values(scan).flatMap(source => source.records);
    report.records = records.length;
    report.totalTokens = records.reduce((sum, record) => sum + record.totalTokens, 0);

    // Native verification spawns tokscale and compares its totals to ours.
    began = performance.now();
    const native = await verifyProjection(records, path.join(root, 'usage'), () => {});
    report.nativeMs = round(performance.now() - began);
    report.nativeStatus = native.status;

    // Ingest into a fresh ledger, then the digest and write that end a collection.
    const store = new Store(path.join(root, 'usage'), {});
    began = performance.now();
    store.ingestCollection(scan, native, {});
    report.ingestMs = round(performance.now() - began);
    began = performance.now();
    const digest = store.digest();
    report.digestMs = round(performance.now() - began);
    report.digest = crypto.createHash('sha256').update(digest).digest('hex').slice(0, 16);
    report.recordsInLedger = Object.keys(store.state.records).length;

    // The snapshot the renderer asks for after a refresh.
    began = performance.now();
    const snapshot = store.snapshot();
    report.snapshotMs = round(performance.now() - began);
    report.snapshotRows = snapshot.daily.length;

    // What the whole thing adds up to when run through the worker the product uses.
    const { createExecutor } = require('../../src/m1/worker');
    const executor = createExecutor();
    began = performance.now();
    const answer = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker timeout')), 600000);
      executor.execute({ id: 1, roots, salt: 'attr', dir: path.join(root, 'usage-worker'), maintenance: false, customSources: {}, customReservedRoots: [], customProtectedDirs: [path.join(root, 'usage-worker')], previousStamp: null }, value => { clearTimeout(timer); resolve(value); });
    });
    report.workerTotalMs = round(performance.now() - began);
    report.workerRecords = Object.values(answer.scan || {}).flatMap(source => source.records).length;
    report.workerNative = answer.native?.status ?? null;
    executor.dispose();
    const stageSum = report.surveyMs + report.stampMs + report.refreshCacheColdMs + report.scanSourcesMs + report.nativeMs;
    report.workerUnaccountedMs = round(report.workerTotalMs - stageSum);
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUTPUT), JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report));
  } finally {
    // A native child may still hold its temporary directory for a moment after it exits; the numbers
    // are already written, so a cleanup that has to wait is retried instead of failing the run.
    for (let attempt = 0; attempt < 5; attempt += 1) { try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
