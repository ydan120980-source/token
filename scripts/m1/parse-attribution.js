'use strict';
// What one cold parse costs, split into read, decode, parse and normalize.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.COLLECT_ROWS || 2000);
const time = (name, fn, runs = 5) => {
  const samples = [];
  for (let at = 0; at < runs; at += 1) { const began = performance.now(); fn(); samples.push(performance.now() - began); }
  samples.sort((a, b) => a - b);
  return { name, medianMs: +samples[Math.floor(samples.length / 2)].toFixed(1) };
};

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parse-attrib-'));
  const { roots } = build(root, ROWS);
  const { filesUnder } = require('../../src/m1/policy');
  const files = [...filesUnder('codex', roots.codex[0], { reads: 0 }), ...filesUnder('claude', roots.claude[0], { reads: 0 })];
  const rows = [];
  rows.push(time('readFileSync every file', () => { for (const file of files) fs.readFileSync(file); }, 3));
  const texts = files.map(file => fs.readFileSync(file, 'utf8'));
  rows.push(time('split into lines', () => { for (const text of texts) text.split('\n'); }, 3));
  const lines = texts.map(text => text.split('\n').filter(line => line.trim()));
  rows.push(time('JSON.parse every line', () => { for (const list of lines) for (const line of list) JSON.parse(line); }, 3));
  const objects = lines.map(list => list.map(line => JSON.parse(line)));
  const { parseObjects } = require('../../src/m1/sources');
  rows.push(time('parseObjects (normalize + HMAC per record)', () => { for (let at = 0; at < files.length; at += 1) parseObjects(at % 2 ? 'codex' : 'claude', objects[at], 'bench', path.basename(files[at])); }, 3));
  const crypto = require('node:crypto');
  rows.push(time('HMAC-SHA256 x 40000', () => { for (let at = 0; at < 40000; at += 1) crypto.createHmac('sha256', 'bench').update('value-' + at).digest('hex'); }, 3));
  const report = { schemaVersion: 'ParseAttributionV1', files: files.length, rows };
  console.log(JSON.stringify(report, null, 2));
  const out = path.resolve(process.env.COLLECT_OUT || 'artifacts/perf-20261103/collection/parse.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => { console.error(error); process.exitCode = 1; });
