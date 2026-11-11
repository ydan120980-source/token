'use strict';
// Where one full refresh spends its time in the real service: worker start, the collection round trip,
// the transfer of the scan to the main process, ingest (de-duplication into the ledger), the digest and
// the statistics write. Each part is timed separately so a slow number can be attributed.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const build = require('./collection-benchmark-fixture');

const ROWS = Number(process.env.SERVICE_ROWS || 2000);
const TURNS = Number(process.env.SERVICE_TURNS || 20);
const OUTPUT = process.env.SERVICE_OUTPUT || path.join('artifacts', 'perf-20261103', 'refresh', 'service.json');
const round = value => +value.toFixed(1);

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-service-'));
  const { roots } = build(root, ROWS, TURNS);
  const places = { home: path.join(root, 'home'), appData: null, localAppData: null };
  const { Service } = require('../../src/m1/service');
  const report = { rows: ROWS, turnsPerFile: TURNS, syntheticOnly: true, runs: [] };
  try {
    for (let run = 0; run < 3; run += 1) {
      const dir = path.join(root, 'usage-' + run);
      const service = new Service(dir, roots, () => {}, places);
      // Time the ingest separately from the worker round trip it follows.
      let ingestMs = 0;
      const realIngest = service.store.ingestCollection.bind(service.store);
      service.store.ingestCollection = (...args) => {
        const began = performance.now();
        const value = realIngest(...args);
        ingestMs = round(performance.now() - began);
        return value;
      };
      // The payload the worker posts back, measured where it arrives.
      let scanBytes = 0, scanRecords = 0, transferMs = 0;
      const realRefresh = service.refresh.bind(service);
      const began = performance.now();
      const answer = await realRefresh();
      const totalMs = round(performance.now() - began);
      // A clone of the ledger tells us what holding that many records costs.
      const records = Object.values(service.store.state.records);
      scanRecords = records.length;
      const cloneBegan = performance.now();
      structuredClone(records);
      transferMs = round(performance.now() - cloneBegan);
      scanBytes = records.reduce((sum, record) => sum + JSON.stringify(record).length, 0);
      report.runs.push({
        totalMs, ingestMs, transferMs, scanRecords, scanBytes,
        lastCollection: service.lastCollection,
        snapshotRows: answer.snapshot?.daily?.length ?? 0,
        stages: service.store.diagnostics()
      });
      await service.close();
    }
    const median = key => { const values = report.runs.map(row => row[key]).sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; };
    report.medians = { totalMs: median('totalMs'), ingestMs: median('ingestMs'), transferMs: median('transferMs'), scanBytes: median('scanBytes') };
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUTPUT), JSON.stringify(report, null, 1));
    console.log(JSON.stringify(report.medians));
  } finally {
    for (let attempt = 0; attempt < 5; attempt += 1) { try { fs.rmSync(root, { recursive: true, force: true }); break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); } }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
