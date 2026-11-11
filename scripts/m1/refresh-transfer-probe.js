'use strict';
// What it costs to hand one full scan from the worker to the store: the structured clone of the scan
// result, its serialized size, and the message the worker posts back. A first refresh pays this once
// for every record, so it belongs in the account rather than in an unexplained remainder.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.TRANSFER_ROWS || 2000);
const TURNS = Number(process.env.TRANSFER_TURNS || 20);
const ROUNDS = Number(process.env.TRANSFER_ROUNDS || 3);
const OUTPUT = process.env.TRANSFER_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'transfer.json');
const round = value => +value.toFixed(1);
const median = values => { const sorted = [...values].sort((a, b) => a - b); return round(sorted[Math.floor(sorted.length / 2)]); };

(async () => {
  const { survey, refreshCache, scanSources } = require('../../src/m1/sources');
  const { ParseCache } = require('../../src/m1/parse-cache');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-transfer-'));
  const { roots, files, usageRows } = build(root, ROWS, TURNS);
  const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
  const salt = 'transfer';
  const cache = { salt, files: new ParseCache(), fingerprints: new Map(), seen: new Set(), listing: null };
  const report = { schemaVersion: 'RefreshTransferV1', rows: ROWS, turnsPerFile: TURNS, files, usageRows, rounds: ROUNDS, syntheticOnly: true, samples: [] };
  try {
    const walk = survey(roots, audit);
    await refreshCache(roots, salt, audit, cache, walk);
    for (let index = 0; index < ROUNDS; index += 1) {
      const began = performance.now();
      const scan = await scanSources(roots, salt, audit, { cache, report: { failures: 0 }, prepared: survey(roots, audit) });
      const scanMs = round(performance.now() - began);
      const records = Object.values(scan).flatMap(entry => entry.records);
      const cloneBegan = performance.now();
      const copy = structuredClone(scan);
      const cloneMs = round(performance.now() - cloneBegan);
      const text = JSON.stringify(scan);
      const bytes = Buffer.byteLength(text);
      report.samples.push({ scanMs, cloneMs, jsonMs: round(performance.now() - cloneBegan - cloneMs), records: records.length, scanBytes: bytes, cachedRecords: copy && Object.values(copy).flatMap(entry => entry.records).length });
    }
    report.medians = {
      scanMs: median(report.samples.map(row => row.scanMs)),
      cloneMs: median(report.samples.map(row => row.cloneMs)),
      records: median(report.samples.map(row => row.records)),
      scanBytes: median(report.samples.map(row => row.scanBytes))
    };
    report.valid = report.samples.every(row => row.records > 0 && row.cloneMs >= 0);
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUTPUT), JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ medians: report.medians, bytesMiB: round(report.medians.scanBytes / 1048576), valid: report.valid }));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) { try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
    process.exit(process.exitCode || 0);
  }
})();
