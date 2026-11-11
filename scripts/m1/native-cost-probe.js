'use strict';
// What the pinned native program costs on its own: startup with one record versus a full 40k-record
// projection, so the fixed process cost and the per-record cost are told apart.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const { verifyProjection } = require('../../src/m1/native');

const rows = count => Array.from({ length: count }, (_, index) => ({
  id: 'bench-' + index, totalTokens: 100 + (index % 7), timestamp: new Date(Date.UTC(2026, 10, 1, 0, 0, 0) + index * 1000).toISOString()
}));

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-bench-'));
  const out = {};
  try {
    for (const count of [1, 1000, 10000, 40000]) {
      const samples = [];
      for (let run = 0; run < 3; run += 1) {
        const began = performance.now();
        const value = await verifyProjection(rows(count), root);
        samples.push(+((performance.now() - began)).toFixed(1));
        out['records' + count] = { status: value.status, tokens: value.tokens };
      }
      out['median' + count] = samples.sort((a, b) => a - b)[1];
    }
    console.log(JSON.stringify(out));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
