'use strict';
// Where a cold parse spends its time, at the scale the refresh benchmark uses: reading the file, splitting
// lines, JSON.parse, and the per-Agent normalisation that turns rows into records.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.PARSE_ROWS || 2000);
const TURNS = Number(process.env.PARSE_TURNS || 20);
const OUTPUT = process.env.PARSE_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'parse.json');
const round = value => +value.toFixed(1);

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-parse-'));
  const { roots } = build(root, ROWS, TURNS);
  const { filesUnder } = require('../../src/m1/policy');
  const report = { rows: ROWS, turnsPerFile: TURNS, syntheticOnly: true };
  try {
    const files = filesUnder('codex', roots.codex[0], { reads: 0 }).concat(filesUnder('claude', roots.claude[0], { reads: 0 }));
    report.files = files.length;
    report.bytes = files.reduce((sum, file) => sum + fs.statSync(file).size, 0);

    let began = performance.now();
    const buffers = files.map(file => fs.readFileSync(file));
    report.readSyncMs = round(performance.now() - began);

    began = performance.now();
    const lines = buffers.map(buffer => buffer.toString('utf8').split('\n'));
    report.decodeSplitMs = round(performance.now() - began);

    began = performance.now();
    let parsed = 0;
    for (const list of lines) for (const line of list) { if (!line.trim()) continue; JSON.parse(line); parsed += 1; }
    report.jsonParseMs = round(performance.now() - began);
    report.lines = parsed;

    // The normalisation the product uses, over the same rows.
    const sources = require('../../src/m1/sources');
    const { ParseCache } = require('../../src/m1/parse-cache');
    const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
    began = performance.now();
    const walk = sources.survey(roots, audit);
    const cache = { salt: 'p', files: new ParseCache(), fingerprints: new Map(), seen: new Set(), listing: null };
    await sources.refreshCache(roots, 'p', audit, cache, walk);
    report.refreshCacheMs = round(performance.now() - began);
    report.cachedFiles = cache.files.size;
    report.fingerprints = cache.fingerprints.size;

    // How much of that is the fingerprint: serialise each outcome and hash it.
    began = performance.now();
    for (const outcome of cache.files.values()) JSON.stringify(outcome);
    report.fingerprintStringifyMs = round(performance.now() - began);

    began = performance.now();
    for (const outcome of cache.files.values()) JSON.stringify(outcome);
    const crypto = require('node:crypto');
    for (const text of [...cache.files.values()].map(outcome => JSON.stringify(outcome))) crypto.createHash('sha256').update(text).digest('hex');
    report.fingerprintHashMs = round(performance.now() - began);

    report.unexplainedMs = round(report.refreshCacheMs - report.readSyncMs - report.decodeSplitMs - report.jsonParseMs - report.fingerprintStringifyMs - report.fingerprintHashMs);
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUTPUT), JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report));
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) { try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
