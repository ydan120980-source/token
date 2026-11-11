'use strict';
/* global document, requestAnimationFrame, MutationObserver, MouseEvent */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');
const { settle, cleanup, keepVisible, isolatePointer } = require('./ui-settle');
const usageUi = require('./usage-ui-helpers');
const c = require('./cost-ui-helpers');
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
        const page = await app.firstWindow(), errors = []; await keepVisible(app); await isolatePointer(app);
        page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await page.waitForLoadState('load'); await page.locator('[data-view="usage"]').click(); await settle(page);
        assert.equal(await usageUi.value(page,'totalTokens'), '2,000,000');
        const chartHandle = await page.locator('[data-usage-trend] [data-chart]').elementHandle();
        const measurements = [];
        for (const mode of ['off', 'system']) {
          await page.evaluate(value => window.uiMotion.setPreference(value), mode);
          for (let i = 0; i < 8; i++) {
            const period = ['today', '7', '30', 'all'][i % 4];
            const sample = await page.evaluate(async value => {
              const frames = []; let running = true, previous;
              function frame(now) { if (previous !== undefined) frames.push(now - previous); previous = now; if (running) requestAnimationFrame(frame); }
              requestAnimationFrame(frame); await new Promise(resolve => requestAnimationFrame(resolve));
              const start=performance.now(),button=document.querySelector('[data-usage-periods] [data-fluid-hover-index="'+{today:3,'7':2,'30':1,all:0}[value]+'"]');
              button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));button.click();const syncMs=performance.now()-start;
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); running = false;
              return { syncMs, maxFrameMs: Math.max(0, ...frames) };
            }, period);
            await settle(page);
            assert.equal(await page.evaluate(()=>window.usageHost.filters().period),period,'every sampled range really changes');
            const expected = { today: '10,000', '7': '70,000', '30': '300,000', all: '2,000,000' }[period];
            assert.equal(await usageUi.value(page,'totalTokens'), expected);
            measurements.push({ mode, period, ...sample });
          }
        }
        // Explicit daily grain checks the independent 200-day ledger. The
        // The visible default is the token/cost composition. Independently
        // verify the total-mode calendar ledger as well as timing that default.
        await page.locator('[data-usage-trend-mode]').getByRole('tab',{name:'总量',exact:true}).click();
        await usageUi.grain(page,'按日');
        for (const display of ['daily', 'average', 'total']) {
          await usageUi.more(page); await page.locator('[data-usage-display] [data-fluid-hover-index="' + {daily:0,average:1,total:2}[display] + '"]').click(); await settle(page);
          const curve = await page.evaluate(() => { const trend=window.usageHost.get().view.trend;return {labels:trend.x.map(point=>point.label),values:trend.entries[0].values}; });
          // The 30-day average starts once 7 recorded days are in its window, so its axis is 6 days shorter.
          assert.equal(curve.labels.length, display === 'average' ? 194 : 200);
          if (display === 'daily') assert(curve.values.every(v => v === 10000));
          if (display === 'average') assert(curve.values.every(v => v === 10000), 'every recorded day is 10,000, so is their mean');
          if (display === 'total') assert.equal(curve.values.at(-1), 2000000);
        }
        await usageUi.select(page,'model','synthetic-99'); await settle(page); assert.equal(await usageUi.value(page,'totalTokens'), '20,000');
        await usageUi.select(page,'model','all'); await page.locator('#theme').click(); await settle(page);
        const activeChartRetained=await chartHandle.evaluate(element=>element===document.querySelector('[data-usage-trend] [data-chart]'));
        await page.locator('[data-view="cost"]').click();await settle(page);await c.openRange(page);
        const costMs=await page.locator('[data-cost-range-sheet]').getByRole('tab',{name:'30 天',exact:true}).evaluate(button=>{
          const start=performance.now();button.click();return performance.now()-start;
        });
        await page.keyboard.press('Escape');await settle(page);await c.choosePeriod(page,'all');await c.group(page,'model');
        const expand=c.table(page).getByRole('button',{name:/^展开全部，/});if(await expand.count())await expand.click();
        assert.equal(await c.table(page).locator('tr[data-row-key]').count(),100);
        assert(costMs<200,'cost page range change must stay below 200ms; actual '+costMs.toFixed(1));
        await c.choosePeriod(page,'all');await page.locator('[data-view="usage"]').click();await settle(page);
        const activeChartCount=await page.locator('[data-usage-trend] [data-chart]').count();
        assert.equal(activeChartCount,1,'one active React trend after route remount');await chartHandle.dispose();
        // Persist samples before acceptance assertions, so a failed performance
        // gate retains its exact timing rather than just an assertion stack.
        const maxSyncMs = Math.max(...measurements.map(r => r.syncMs));
        fs.writeFileSync(path.join(output, 'samples-' + scale + '.json'), JSON.stringify({ scale, measurements, maxSyncMs, activeChartRetained, activeChartCount }, null, 2));
        if (!process.env.DESKTOP_BASELINE) { assert.equal(activeChartRetained,true,'range/theme/filter updates retain the current active chart'); assert(maxSyncMs < 200, '20k-row range submission must remain below 200ms; actual ' + maxSyncMs.toFixed(1) + 'ms'); }
        await usageUi.readyChart(page,'trend');await settle(page);
        let statusOnlySkipsChart = null, sameSequenceReprices = null;
        if (!process.env.DESKTOP_BASELINE) {
          await page.evaluate(() => {
            window.desktopChartUpdates = 0;
            window.desktopHydrateStart = performance.getEntriesByName('usage:hydrate').at(-1)?.startTime ?? -1;
            window.desktopChartObserver=new MutationObserver(records=>{window.desktopChartUpdates+=records.length;});
            window.desktopChartObserver.observe(document.querySelector('[data-usage-trend] svg'),{
              subtree:true,attributes:true,childList:true,attributeFilter:['d','x','y','width','height'],
            });
          });
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('usage:update'));
          // An unchanged paused status need not mutate its text. Wait for the
          // real saved-state hydration to finish before asserting no chart work.
          await page.waitForFunction(() => (performance.getEntriesByName('usage:hydrate').at(-1)?.startTime ?? -1) > window.desktopHydrateStart);
          await settle(page);
          assert.equal(await page.evaluate(() => window.desktopChartUpdates), 0); statusOnlySkipsChart = true;
          const before = await page.evaluate(() => window.usageBridge.get()), item = before.snapshot.daily.find(row => row.model === 'synthetic-0');
          const price = { provider: item.provider, model: item.model, inputUncached: 1, output: 2, cacheRead: 0, cacheWrite: 0 };
          await page.evaluate(value => window.usageBridge.savePrice(value), price);
          await page.waitForFunction(() => Number(document.querySelector('[data-usage-total-cost] [data-usage-price-lower]').dataset.usagePriceLower) > 0);
          const after = await page.evaluate(() => window.usageBridge.get());
          assert.equal(after.snapshot.sequence, before.snapshot.sequence); assert(after.snapshotRevision > before.snapshotRevision); sameSequenceReprices = true;
          await page.evaluate(value => window.usageBridge.resetPrice(value), price);
          await page.waitForFunction(() => document.querySelector('[data-usage-total-cost] [data-usage-price-lower]').dataset.usagePriceLower === ''); await settle(page);
          await page.evaluate(() => window.desktopChartObserver.disconnect());
        }
        await page.emulateMedia({ reducedMotion: 'reduce' }); await usageUi.period(page,'today'); await settle(page);
        assert.equal(await page.evaluate(() => window.uiDetail.activeCount), 0);
        assert.deepEqual(errors, []); assert.match(await page.title(), /Agent Usage/); assert.match(page.url(), /desktop-reference.*index\.html/);
        await page.screenshot({ path: path.join(output, 'desktop-performance-' + scale + '.png') });
        results.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), baseline: Boolean(process.env.DESKTOP_BASELINE), rows: 20000, models: 100, days: 200, measurements, costMs,
          maxSyncMs: Math.max(...measurements.map(r => r.syncMs)), maxFrameMs: Math.max(...measurements.map(r => r.maxFrameMs)), chartReused: activeChartRetained, routeRemountHasOneChart: activeChartCount === 1, statusOnlySkipsChart, sameSequenceReprices, correctRangesAndCurves: true, noErrors: true, realAccountRequests: 0 });
      } finally { await app.close(); }
    }
    fs.writeFileSync(path.join(output, 'performance.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
  } finally { await cleanup(root); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
