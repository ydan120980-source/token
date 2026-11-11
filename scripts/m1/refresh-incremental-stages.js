'use strict';
// The worker half of one incremental refresh, stage by stage. The service-side probe measured the
// ingest that follows a scan; this one measures the scan itself with the parse cache already warm,
// which is the state a running collector is in when a session gains a turn.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.STAGES_ROWS || 2000);
const TURNS = Number(process.env.STAGES_TURNS || 20);
const ROUNDS = Number(process.env.STAGES_ROUNDS || 5);
const OUTPUT = process.env.STAGES_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'stages.json');
const round = value => +value.toFixed(1);
const median = values => { const sorted = [...values].sort((a, b) => a - b); return round(sorted[Math.floor(sorted.length / 2)]); };

function appended(turn) {
  const total = { input_tokens: 100 + turn, cached_input_tokens: 0, output_tokens: 20, total_tokens: 120 + turn };
  return JSON.stringify({ timestamp: new Date(build.START + 3600000 + turn * 1000).toISOString(), type: 'event_msg', payload: { type: 'token_count', info: { model: 'gpt-5-codex', total_token_usage: total, last_token_usage: total } } });
}

(async () => {
  const { survey, sourceStamp, refreshCache, scanSources } = require('../../src/m1/sources');
  const { verifyProjection } = require('../../src/m1/native');
  const { ParseCache } = require('../../src/m1/parse-cache');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-stages-'));
  const { roots, oneFile, files, usageRows } = build(root, ROWS, TURNS);
  const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
  const salt = 'stages', dir = path.join(root, 'usage');
  fs.mkdirSync(dir, { recursive: true });
  const cache = { salt, files: new ParseCache(), fingerprints: new Map(), seen: new Set(), listing: null };
  const report = { schemaVersion: 'RefreshStagesV1', rows: ROWS, turnsPerFile: TURNS, files, usageRows, rounds: ROUNDS, syntheticOnly: true, warmup: null, samples: [] };
  const timed = async action => { const began = performance.now(); const value = await action(); return { ms: round(performance.now() - began), value }; };
  const pass = async label => {
    const surveyRow = await timed(() => survey(roots, audit));
    const stampRow = await timed(() => sourceStamp(roots, salt, audit, surveyRow.value));
    const refreshRow = await timed(() => refreshCache(roots, salt, audit, cache, surveyRow.value));
    const report0 = { failures: 0 };
    const scanRow = await timed(() => scanSources(roots, salt, audit, { cache, report: report0, prepared: surveyRow.value }));
    const records = Object.values(scanRow.value).flatMap(entry => entry.records);
    const nativeRow = await timed(() => verifyProjection(records, dir, () => {}));
    return {
      label,
      surveyMs: surveyRow.ms, stampMs: stampRow.ms, refreshMs: refreshRow.ms, scanMs: scanRow.ms, nativeMs: nativeRow.ms,
      workerMs: round(surveyRow.ms + stampRow.ms + refreshRow.ms + scanRow.ms + nativeRow.ms),
      changed: refreshRow.value.changed, failures: refreshRow.value.failures,
      records: records.length, native: nativeRow.value.status, nativeRecords: nativeRow.value.records
    };
  };
  try {
    report.warmup = await pass('warm-up');
    for (let index = 0; index < ROUNDS; index += 1) {
      fs.appendFileSync(oneFile, appended(index) + '\n');
      report.samples.push(await pass('append ' + index));
    }
    const keys = ['surveyMs', 'stampMs', 'refreshMs', 'scanMs', 'nativeMs', 'workerMs'];
    report.medians = Object.fromEntries(keys.map(key => [key, median(report.samples.map(row => row[key]))]));
    report.medians.records = median(report.samples.map(row => row.records));
    report.sameOutput = report.samples.every(row => row.changed === true && row.failures === 0 && row.native === 'passed');
    report.valid = report.samples.every(row => row.native === 'passed' && row.records > 0);
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
