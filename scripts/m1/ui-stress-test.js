'use strict';
/* global document, innerWidth */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { _electron: electron } = require('playwright');
const { settle } = require('./ui-settle');
const { Store } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-ui-stress-')), evidence = [];
  fs.mkdirSync('artifacts/maintenance', { recursive: true });
  try {
    const home = path.join(root, 'home'), f = fixtures(home), data = path.join(root, 'usage'), store = new Store(data, f.roots), today = Date.now();
    for (let i = 0; i < 20000; i++) {
      const record = normalize('codex', { input_tokens: 80, output_tokens: 20, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 100 }, { id: 'stress-' + i, time: today - Math.floor(i / 100) * 86400000, model: 'synthetic-' + i % 100, entry: 'cli' }, 'synthetic-salt');
      store.state.records[record.id] = record;
    }
    store.state.sequence = 1; const { atomic } = require('../../src/m1/store'); atomic(path.join(data, 'statistics.json'), store.state); store.setEnabled(false);
    for (const scale of [1, 1.5]) {
      const boot = performance.now(), app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--quota-data-dir', path.join(root, 'quota-' + scale), '--usage-data-dir', data, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
      try {
        const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        const processOutput = []; for (const stream of [app.process().stdout,app.process().stderr]) stream?.on('data',chunk=>{processOutput.push(chunk.toString()); if(processOutput.length>30) processOutput.shift();});
        await app.evaluate(({BrowserWindow})=>{globalThis.uiStressDiagnostics=[]; const w=BrowserWindow.getAllWindows()[0]; w.webContents.on('render-process-gone',(_event,details)=>globalThis.uiStressDiagnostics.push(details)); w.on('closed',()=>globalThis.uiStressDiagnostics.push({windowClosed:true}));});
        try {
        await page.waitForFunction(() => document.getElementById('main').dataset.currentView === 'quota' && document.getElementById('priceRows').childElementCount > 0);
        await page.locator('[data-view="usage"]').click(); await page.waitForFunction(() => document.getElementById('totalTokens').textContent === '2.0M');
        const startupMs = Math.round(performance.now() - boot), changes = [];
        for (let i = 0; i < 20; i++) { const at = performance.now(); await page.locator('[data-period="' + ['today', '7', '30', 'all'][i % 4] + '"]').click(); changes.push(Math.round(performance.now() - at)); }
        const at = performance.now(); await page.evaluate(async () => { const result = await Promise.all(Array.from({ length: 20 }, () => window.usageBridge.get())); if (result.some(r => r.snapshot.daily.length !== 20000)) throw Error('MISSING_STRESS_ROWS'); });
        const concurrentReadMs = Math.round(performance.now() - at);
        await page.locator('#modelFilter').selectOption('synthetic-99'); await settle(page); assert.equal(await page.locator('#totalTokens').textContent(), '20.0K');
        await page.locator('#modelFilter').selectOption('all'); await page.locator('#theme').click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
        assert.ok(startupMs < 60000); assert.ok(Math.max(...changes) < 10000); assert.ok(concurrentReadMs < 10000);
        await page.screenshot({ path: 'artifacts/maintenance/stress-ui-' + scale + '.png' });
        evidence.push({ packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), scale, rows: 20000, models: 100, days: 200, startupMs, rangeChanges: 20, maxRangeChangeMs: Math.max(...changes), concurrentReadCalls: 20, concurrentReadMs, noPageErrors: true, noHorizontalOverflow: true, accountRequests: 0 });
        } catch (error) {
          const diagnostics = await app.evaluate(()=>globalThis.uiStressDiagnostics).catch(()=>null);
          fs.writeFileSync('artifacts/maintenance/ui-stress-failure.json',JSON.stringify({scale,error:error.stack,pageErrors:errors,diagnostics,exitCode:app.process().exitCode,processOutput:processOutput.join('').slice(-12000)},null,2));
          throw error;
        }
      } finally { await app.close(); }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  fs.writeFileSync('artifacts/maintenance/ui-stress-results.json', JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
