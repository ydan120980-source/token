'use strict';
// Where one cold collection spends its time, stage by stage, with records that actually land in the
// ledger. The first refresh of a fresh install pays all of this once, so a fast traversal alone does
// not make it fast: the parse, the native check and the ingest have to be measured too.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.FULL_ROWS || 2000);
const TURNS = Number(process.env.FULL_TURNS || 20);
const ROUNDS = Number(process.env.FULL_ROUNDS || 3);
const OUTPUT = process.env.FULL_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'full-stages.json');
const round = value => +value.toFixed(1);
const median = values => { const sorted = [...values].sort((a, b) => a - b); return round(sorted[Math.floor(sorted.length / 2)]); };

(async () => {
  const { survey, sourceStamp, refreshCache, scanSources } = require('../../src/m1/sources');
  const { verifyProjection } = require('../../src/m1/native');
  const { ParseCache } = require('../../src/m1/parse-cache');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-full-'));
  const { roots, files, usageRows } = build(root, ROWS, TURNS);
  const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
  const report = { schemaVersion: 'RefreshFullStagesV1', rows: ROWS, turnsPerFile: TURNS, files, usageRows, rounds: ROUNDS, syntheticOnly: true, samples: [] };
  const timed = async action => { const began = performance.now(); const value = await action(); return { ms: round(performance.now() - began), value }; };
  try {
    for (let index = 0; index < ROUNDS; index += 1) {
      // A cold cache each round: this is the state a first launch is in.
      const salt = 'full-' + index;
      const cache = { salt, files: new ParseCache(), fingerprints: new Map(), seen: new Set(), listing: null };
      const dir = path.join(root, 'usage-' + index); fs.mkdirSync(dir, { recursive: true });
      const surveyRow = await timed(() => survey(roots, audit));
      const stampRow = await timed(() => sourceStamp(roots, salt, audit, surveyRow.value));
      const refreshRow = await timed(() => refreshCache(roots, salt, audit, cache, surveyRow.value));
      const scanRow = await timed(() => scanSources(roots, salt, audit, { cache, report: { failures: 0 }, prepared: surveyRow.value }));
      const records = Object.values(scanRow.value).flatMap(entry => entry.records);
      const nativeRow = await timed(() => verifyProjection(records, dir, () => {}));
      // The jsonl the native check writes is part of the check's own cost; measuring it separately
      // shows how much of the check is this process and how much is the pinned program.
      const writeBegan = performance.now();
      const lines = records.map(record => JSON.stringify({ type: 'assistant', uuid: record.id, sessionId: 'm1-projection', timestamp: record.timestamp, message: { id: record.id, role: 'assistant', model: 'm1-statistical-projection', usage: { input_tokens: record.totalTokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }));
      const text = lines.join('\n') + '\n';
      const writeMs = round(performance.now() - writeBegan);
      report.samples.push({
        label: 'cold ' + index,
        surveyMs: surveyRow.ms, stampMs: stampRow.ms, refreshMs: refreshRow.ms, scanMs: scanRow.ms, nativeMs: nativeRow.ms,
        nativeWriteMs: writeMs, nativeSpawnMs: round(nativeRow.ms - writeMs),
        workerMs: round(surveyRow.ms + stampRow.ms + refreshRow.ms + scanRow.ms + nativeRow.ms),
        records: records.length, native: nativeRow.value.status, jsonlBytes: Buffer.byteLength(text), scanBytes: Buffer.byteLength(JSON.stringify(scanRow.value))
      });
    }
    const keys = ['surveyMs', 'stampMs', 'refreshMs', 'scanMs', 'nativeMs', 'nativeWriteMs', 'nativeSpawnMs', 'workerMs', 'records', 'jsonlBytes'];
    report.medians = Object.fromEntries(keys.map(key => [key, median(report.samples.map(row => row[key]))]));
    report.valid = report.samples.every(row => row.records === files * TURNS && row.native === 'passed');
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUTPUT), JSON.stringify(report, null, 1));
    console.log(JSON.stringify({ medians: report.medians, valid: report.valid }));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) { try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
    process.exit(process.exitCode || 0);
  }
})();
