'use strict';
// Synthetic child workers only. No provider endpoint, home or credential is read.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { fork } = require('node:child_process'), { randomUUID } = require('node:crypto'), { performance } = require('node:perf_hooks');
const { RefreshScheduler } = require('../../src/quota/refresh-scheduler');
const { ProviderQuotaService } = require('../../src/quota/provider-service');
const { routes } = require('../../src/quota/provider-catalog');
const { remove } = require('../../tests/m1/temp');
async function benchmark() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-throughput-synthetic-')), results = [];
  const entry = path.join(root, 'worker.cjs');
  fs.writeFileSync(entry, "process.once('message', m => setTimeout(() => { process.send({ schemaVersion:'AccountQuotaV2',provider:m.provider,fetchedAt:new Date().toISOString(),provenance:{kind:'synthetic'},entitlement:{},pools:[{id:'synthetic',scope:'account',windows:[{id:'limit',unit:'percent',usedPercent:25}],balances:[]}] },()=>process.disconnect()); },250));");
  try {
    for (const limit of [1, 4, 8, 16]) {
      let active = 0, peak = 0, reads = 0;
      const service = new ProviderQuotaService(path.join(root, 'run-' + limit), { scheduler: new RefreshScheduler({ limit }), run: adapter => new Promise((resolve, reject) => {
        reads++; active++; peak = Math.max(peak, active);
        const child = fork(entry, [], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); let result, failure;
        child.once('message', value => { result = value; }); child.once('error', error => { failure = error; });
        child.once('close', code => { active--; if (failure || code !== 0 || !result) reject(Error('SYNTHETIC_WORKER_FAILED')); else resolve(result); });
        child.send({ provider: routes[adapter].provider });
      }) });
      try {
        const adapters = ['deepseek-api', 'workbuddy-desktop', 'opencode-go', 'cursor-web', 'zai-cn'];
        service.rows = Array.from({ length: 20 }, (_, i) => { const adapter = adapters[i % adapters.length]; return { id: randomUUID(), adapter, provider: routes[adapter].provider, alias: 'synthetic', quota: null, status: 'cached' }; });
        for (const row of service.rows) service.secrets.set(row.id, 'SYNTHETIC_BENCHMARK');
        const start = performance.now(), batch = await service.refreshAll(), elapsedMs = Math.round(performance.now() - start);
        assert.deepEqual(batch, { success: 20, failed: 0, skipped: 0 }); assert.equal(reads, 20); assert.equal(active, 0); assert(peak <= limit); assert.equal(JSON.parse(fs.readFileSync(service.file)).connections.filter(row => row.quota).length, 20);
        results.push({ limit, elapsedMs, peakChildren: peak, reads, cacheRows: 20, realProviderRequests: 0 });
      } finally { await service.close(); }
    }
    for (const row of results) row.speedupVersusSerial = Number((results[0].elapsedMs / row.elapsedMs).toFixed(2));
    const output = process.env.QUOTA_BENCHMARK_OUTPUT || path.join(root, 'results.json'); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify({ workload: '20 fresh Node children, 250ms synthetic response per child, five providers', results }, null, 2));
    console.log(JSON.stringify(results));
  } finally { await remove(root); }
}
if (require.main === module) benchmark().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { benchmark };
