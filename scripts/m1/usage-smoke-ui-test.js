'use strict';
/* global document, getComputedStyle */
const assert = require('node:assert/strict');
const { runPageSmoke } = require('./ui-page-smoke-template');
const { until, settle } = require('./ui-settle');
const usage = require('./usage-ui-helpers');
(async () => {
  await runPageSmoke({ view: 'usage', ready: '[data-usage-page]',
    output: process.env.USAGE_SMOKE_EVIDENCE_DIR || 'artifacts/ui-mig/M7/smoke',
    dialogs: [
      { trigger: '[data-usage-export] button', dialog: '[data-ui-portal] [role="dialog"]' },
      { trigger: '[data-usage-trend-range] button', dialog: '[data-date-range-popover]' },
    ],
    prepare: async page => {
      await page.evaluate(() => window.usageHost.set({ agent: 'all', source: 'all', model: 'all', period: 'all',
        metric: 'tokens', mode: 'flow', display: 'daily', grain: 'auto', hidden: [], selectedDay: null, slot: null }));
    },
    assertPage: async page => {
      assert.equal(await usage.root(page).getByRole('heading', { name: '用量', exact: true }).count(), 1);
      assert.equal(await page.locator('[data-usage-periods] [role=tab]').count(), 4);
      assert.equal(await page.locator('[data-usage-strip] [data-chart-key]').count(), 30);
      assert.equal(await page.locator('[data-usage-page] [data-cost-reference]').count(), 0);
      assert.equal(await page.locator('[data-island-host=usage-summary]').count(), 0);
      assert.equal(await page.locator('#trendCanvas,#agentPicker,#modelFilter,#heatmap').count(), 0);
      const contract = await page.evaluate(() => ({ host: typeof window.usageHost.get, filters: window.usageUi.filters(),
        rows: window.usageData.rows().length, hourly: window.usageData.hourly().length,
        tokens: window.usageHost.get().view.hero.tokens, entries: window.usageHost.get().view.trend.entries.length }));
      assert.equal(contract.host, 'function'); assert.equal(contract.filters.agent, 'all'); assert(contract.rows > 0);
      assert(contract.hourly > 0); assert.equal(await usage.value(page, 'totalTokens'), contract.tokens);
      const chart = await usage.readyChart(page, 'trend');
      assert.equal(await chart.locator('[data-line-series]').count(), contract.entries);
      const legends = page.locator('[data-usage-trend] [data-legend-key]');
      assert.equal(await legends.count(), contract.entries);
      assert.equal(await page.locator('[data-usage-trend] [data-chart-legend]').getAttribute('data-legend-variant'), 'inline');
      for (let index = 0; index < contract.entries; index++) await legends.nth(index).click();
      await settle(page);
      assert.equal(await chart.locator('[data-line-series] path').count(), 0, 'all entries may hide without inventing zero');
      for (let index = 0; index < contract.entries; index++) await legends.nth(index).click();
      await settle(page); await page.mouse.move(1, 1); await chart.focus(); await chart.press('End');
      const tip = page.locator('#kit-window-chart-tooltip'); await tip.waitFor();
      await settle(page);
      assert(await tip.locator('[data-tip-row]').count() > 0); assert.match(await tip.innerText(), /合计/);
      assert(await tip.evaluate(element => getComputedStyle(element).opacity === '1'));
      await page.keyboard.press('Escape'); await tip.waitFor({ state: 'detached' });
      await until(page, () => !document.querySelector('[data-ui-portal] [role=tooltip]'));
    },
  });
  console.log('PASS: M7 usage smoke from template; both themes, scoped kit, Host contract, filters, unknown/zero, legend and popup focus.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
