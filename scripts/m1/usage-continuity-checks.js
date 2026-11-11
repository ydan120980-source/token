'use strict';
/* global document, innerWidth */
const path = require('node:path'), assert = require('node:assert/strict');
const usage = require('./usage-ui-helpers');
const { settle } = require('./ui-settle');
async function usageContinuityChecks(page, app, { SOURCES, keys, output, scale, capture }) {
  await capture('trend-motion', async () => { await usage.openUsage(page); await usage.readyChart(page, 'trend'); });
  await page.locator('[data-usage-agents] [data-agent-more]').click(); assert.equal(await page.locator('[data-usage-agents] [role=radio]').count(), SOURCES.length + 1);
  assert.equal(await page.locator('#agentFilter-trigger').count(), 0);
  const chart = await usage.readyChart(page, 'trend');
  const continuity = await page.evaluate(() => window.usageHost.get().view.trend.entries.map(entry => ({
    key: entry.key, nulls: entry.values.filter(value => value === null).length,
  })));
  assert(continuity.some(entry => entry.nulls > 10));
  assert(await chart.locator('[data-missing-bridge]').count() > 0, 'real SVG draws missing-date bridges');
  const unknown = await page.evaluate(() => {
    const trend = window.usageHost.get().view.trend;
    return trend.entries.find(entry => entry.key === 'cost').values.map((value, index) => value === null && !trend.x[index].missing ? index : -1).filter(index => index >= 0);
  });
  assert(unknown.length > 0, 'recorded unknown costs retain their null values');
  const cost = page.locator('[data-legend-key=cost]');
  if (await cost.getAttribute('aria-pressed') === 'false') await cost.click();
  await settle(page);
  const runs = await chart.locator('[data-line-series=cost] [data-line-run]').evaluateAll(nodes => nodes.map(node => node.dataset.lineRun.split(':').map(Number)));
  assert(runs.every(run => unknown.every(index => !run.includes(index))), 'no cost run spans a recorded unknown');
  await page.mouse.move(5, 80); await page.screenshot({ path: path.join(output, 'trend-light-' + scale + '.png') });
  const index = await page.evaluate(() => window.usageHost.get().view.trend.x.findIndex(point => point.missing));
  const point = chart.locator('[data-line-point="' + index + '"]'); await usage.hover(page, point);
  const tip = page.locator(usage.hooks.tip); await tip.getByText('未记录', { exact: true }).waitFor();
  assert.equal(await chart.locator('[data-line-cursor] circle').count(), 0);
  await page.screenshot({ path: path.join(output, 'trend-gap-' + scale + '.png') });
  await page.mouse.move(5, 80); const node = await chart.elementHandle();
  for (const key of keys) {
    await usage.agent(page, key);
    assert.equal(await page.evaluate(() => window.usageHost.filters().agent), key);
    assert.equal(await page.locator('[data-usage-agents] [aria-checked=true]').count(), 1);
  }
  await page.locator('[data-usage-agents] [data-agent=mimo]').focus(); await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => window.usageHost.filters().agent), 'all');
  await page.keyboard.press('End');
  const last = await page.locator('[data-usage-agents] [role=radio]').last().getAttribute('data-agent');
  assert.equal(await page.evaluate(() => window.usageHost.filters().agent), last);
  await usage.agent(page, 'all');
  assert.equal(await node.evaluate(element => element === document.querySelector('[data-usage-trend] [data-chart]')), true);
  await node.dispose();
  await page.locator('#theme').click(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
  await chart.scrollIntoViewIfNeeded(); await settle(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'trend-dark-narrow-' + scale + '.png') });
  const logos = await page.locator('[data-usage-agents] img').evaluateAll(images => images.map(image => ({ src: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0 })));
  assert(logos.every(logo => logo.loaded));
  return { continuity, logos };
}
module.exports = { usageContinuityChecks };
