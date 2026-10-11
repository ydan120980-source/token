'use strict';
/* global document, requestAnimationFrame, MutationObserver */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');
const { settle, cleanup } = require('./ui-settle');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-desktop-performance-'));
  const output = process.env.DESKTOP_EVIDENCE_DIR || 'artifacts/m2-desktop/source';
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  try {
    const home = path.join(root, 'home'), fixture = fixtures(home), usage = path.join(root, 'usage'), store = new Store(usage, fixture.roots);
    for (let i = 0; i < 20000; i++) {
      const record = normalize('codex', { input_tokens: 80, output_tokens: 20, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 100 },
        { id: 'desktop-stress-' + i, time: Date.now() - Math.floor(i / 100) * 86400000, model: 'synthetic-' + i % 100, entry: 'cli' }, 'synthetic-salt');
      store.state.records[record.id] = record;
    }
    store.state.sequence = 1; atomic(path.join(usage, 'statistics.json'), store.state); store.setEnabled(false);
    for (const scale of [1, 1.5]) {
      const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [
        ...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota-' + scale), '--m1-fixture-root', home, '--force-device-scale-factor=' + scale
      ], timeout: 60000 });
      try {
        const page = await app.firstWindow(), errors = [];
        page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.waitForLoadState('load'); await page.locator('[data-view="usage"]').click(); await settle(page);
        assert.equal(await page.locator('#totalTokens').textContent(), '2.0M');
        const firstChart = await page.evaluate(() => window.Chart.getChart(document.getElementById('trendCanvas')).id);
        const measurements = [];
        for (const mode of ['off', 'system']) {
          await page.evaluate(value => window.uiMotion.setPreference(value), mode);
          for (let i = 0; i < 8; i++) {
            const period = ['today', '7', '30', 'all'][i % 4];
            const sample = await page.evaluate(async value => {
              const frames = []; let running = true, previous;
              function frame(now) { if (previous !== undefined) frames.push(now - previous); previous = now; if (running) requestAnimationFrame(frame); }
              requestAnimationFrame(frame); await new Promise(resolve => requestAnimationFrame(resolve));
              const start = performance.now(); document.querySelector('[data-period="' + value + '"]').click(); const syncMs = performance.now() - start;
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); running = false;
              return { syncMs, maxFrameMs: Math.max(0, ...frames) };
            }, period);
            await settle(page);
            const expected = { today: '10.0K', '7': '70.0K', '30': '300.0K', all: '2.0M' }[period];
            assert.equal(await page.locator('#totalTokens').textContent(), expected);
            measurements.push({ mode, period, ...sample });
          }
        }
        // Explicit daily grain checks the independent 200-day ledger. The
        // The visible default is the token/cost composition. Independently
        // verify the total-mode calendar ledger as well as timing that default.
        await page.locator('[data-trend-mode="total"]').click();
        await page.locator('#trendOptionsButton').click(); await page.locator('#trendGrain').selectOption('day');
        for (const display of ['daily', 'average', 'total']) {
          await page.locator('#display').selectOption(display); await settle(page);
          const curve = await page.evaluate(() => { const chart = window.Chart.getChart(document.getElementById('trendCanvas')); return { labels: chart.data.labels, values: chart.data.datasets[0].data }; });
          assert.equal(curve.labels.length, 200);
          if (display === 'daily') assert(curve.values.every(v => v === 10000));
          if (display === 'average') { assert(curve.values.slice(0, 29).every(v => v === null)); assert(curve.values.slice(29).every(v => v === 10000)); }
          if (display === 'total') assert.equal(curve.values.at(-1), 2000000);
        }
        await page.locator('#newest').check(); await settle(page);
        assert.equal(await page.evaluate(() => window.Chart.getChart(document.getElementById('trendCanvas')).data.datasets[0].data[0]), 2000000);
        await page.locator('#trendOptions').evaluate(element=>element.hidePopover());
        await page.locator('#modelFilter').selectOption('synthetic-99'); await settle(page); assert.equal(await page.locator('#totalTokens').textContent(), '20.0K');
        await page.locator('#modelFilter').selectOption('all'); await page.locator('#theme').click(); await settle(page);
        assert.equal(await page.locator('#modelRows tr').count(), 100);
        const lastChart = await page.evaluate(() => window.Chart.getChart(document.getElementById('trendCanvas')).id);
        // Persist samples before acceptance assertions, so a failed performance
        // gate retains its exact timing rather than just an assertion stack.
        const maxSyncMs = Math.max(...measurements.map(r => r.syncMs));
        fs.writeFileSync(path.join(output, 'samples-' + scale + '.json'), JSON.stringify({ scale, measurements, maxSyncMs, firstChart, lastChart }, null, 2));
        if (!process.env.DESKTOP_BASELINE) { assert.equal(lastChart, firstChart, 'range/theme/filter updates retain one chart'); assert(maxSyncMs < 200, '20k-row range submission must remain below 200ms; actual ' + maxSyncMs.toFixed(1) + 'ms'); }
        let statusOnlySkipsChart = null, sameSequenceReprices = null;
        if (!process.env.DESKTOP_BASELINE) {
          await page.evaluate(() => {
            window.desktopChartUpdates = 0; window.desktopStatusUpdates = 0;
            const chart = window.Chart.getChart(document.getElementById('trendCanvas')), update = chart.update;
            chart.update = function (...args) { window.desktopChartUpdates++; return update.apply(this, args); };
            window.desktopStatusObserver = new MutationObserver(() => window.desktopStatusUpdates++);
            window.desktopStatusObserver.observe(document.getElementById('dataBadge'), { childList: true });
          });
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('usage:update'));
          await page.waitForFunction(() => window.desktopStatusUpdates > 0);
          assert.equal(await page.evaluate(() => window.desktopChartUpdates), 0); statusOnlySkipsChart = true;
          const before = await page.evaluate(() => window.usageBridge.get()), item = before.snapshot.daily.find(row => row.model === 'synthetic-0');
          const price = { provider: item.provider, model: item.model, inputUncached: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
          await page.evaluate(value => window.usageBridge.savePrice(value), price);
          await page.waitForFunction(() => window.desktopChartUpdates > 0 && Number(document.querySelector('#totalCost .cost-value').dataset.costLower) > 0);
          const after = await page.evaluate(() => window.usageBridge.get());
          assert.equal(after.snapshot.sequence, before.snapshot.sequence); assert(after.snapshotRevision > before.snapshotRevision); sameSequenceReprices = true;
          await page.evaluate(value => window.usageBridge.resetPrice(value), price);
          await page.waitForFunction(() => document.querySelector('#totalCost .cost-value').dataset.costLower === ''); await settle(page);
          await page.evaluate(() => window.desktopStatusObserver.disconnect());
        }
        await page.emulateMedia({ reducedMotion: 'reduce' }); await page.locator('[data-period="today"]').click(); await settle(page);
        assert.equal(await page.evaluate(() => window.uiDetail.activeCount), 0);
        assert.deepEqual(errors, []); assert.match(await page.title(), /Agent Usage/); assert.match(page.url(), /desktop-reference.*index\.html/);
        await page.screenshot({ path: path.join(output, 'desktop-performance-' + scale + '.png') });
        results.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), baseline: Boolean(process.env.DESKTOP_BASELINE), rows: 20000, models: 100, days: 200, measurements,
          maxSyncMs: Math.max(...measurements.map(r => r.syncMs)), maxFrameMs: Math.max(...measurements.map(r => r.maxFrameMs)), chartReused: lastChart === firstChart, statusOnlySkipsChart, sameSequenceReprices, correctRangesAndCurves: true, noErrors: true, realAccountRequests: 0 });
      } finally { await app.close(); }
    }
    fs.writeFileSync(path.join(output, 'performance.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } finally { await cleanup(root); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
