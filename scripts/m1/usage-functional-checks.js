'use strict';
/* global document, requestAnimationFrame, getComputedStyle */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { settle, until } = require('./ui-settle');
const usage = require('./usage-ui-helpers');
async function usageFunctionalChecks(page, app, { scale, output, openSettings, pickSelect }) {
  assert.equal(await page.locator('#costHelp').count(), 0);
  const hero = page.locator('[data-usage-total-cost] button');
  const rest = await hero.locator('.text-figure-md').evaluate(element => ({ font: parseFloat(getComputedStyle(element).fontSize),
    width: element.getBoundingClientRect().width, top: element.getBoundingClientRect().top }));
  const lead = await page.locator('[data-usage-total-tokens] .text-figure-xl').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  assert.equal(lead, 52, 'current spec figure-xl leads'); assert(rest.font >= 28 && rest.font < lead, 'estimate is the second figure');
  await page.screenshot({ path: path.join(output, 'hero-rest-' + scale + '.png') });
  await usage.hover(page, hero); await hero.focus(); await settle(page);
  assert.equal(await hero.getAttribute('aria-expanded'), 'true');
  const upper = Number(await page.locator('[data-usage-total-cost] [data-usage-price-upper]').getAttribute('data-usage-price-upper'));
  assert((await page.getByRole('tooltip').innerText()).includes(await page.evaluate(value => window.displayValues.usd(value), upper)));
  await page.screenshot({ path: path.join(output, 'hero-hover-' + scale + '.png') });
  await hero.press('Escape'); await hero.blur(); await page.mouse.move(5, 80);
  const chart = await usage.readyChart(page, 'trend');let node = await chart.elementHandle();
  assert.equal(await chart.locator('[data-line-series]').count(), 4, 'the approved default hides the cost overlay');
  const costOverlay = page.locator('[data-usage-trend] [data-legend-key=cost]');
  assert.equal(await costOverlay.getAttribute('aria-pressed'), 'false');
  await costOverlay.click(); await settle(page);
  assert.equal(await costOverlay.getAttribute('aria-pressed'), 'true');
  assert.equal(await chart.locator('[data-line-series]').count(), 5, 'explicitly showing cost restores all five series');
  assert.equal(await chart.getAttribute('data-ready'), 'true', 'current data-tier entry reaches its final state');
  await page.screenshot({ path: path.join(output, 'trend-flow-' + scale + '.png') });
  let recording = null; const captured = [];
  if (process.env.FUNCTIONAL_CAPTURE && scale === 1) {
    const framesDir = path.join(output, 'motion-frames'); fs.mkdirSync(framesDir, { recursive: true });
    recording = await app.context().newCDPSession(page);
    recording.on('Page.screencastFrame', frame => {
      const file = String(captured.length).padStart(4, '0') + '.jpg'; fs.writeFileSync(path.join(framesDir, file), Buffer.from(frame.data, 'base64'));
      captured.push({ file, time: frame.metadata.timestamp }); void recording.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    });
    await recording.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1180, maxHeight: 850, everyNthFrame: 1 });
    for (let index = 0; index < 12; index++) await usage.hover(page, chart.locator('[data-line-point]').nth(index));
    await usage.period(page, '7'); await usage.period(page, 'all'); await recording.send('Page.stopScreencast');
    fs.writeFileSync(path.join(output, 'motion-frames/frames.json'), JSON.stringify(captured, null, 2)); assert(captured.length > 15); await recording.detach();
  }
  const metric = async label => { await usage.more(page); await page.locator('[data-usage-metric]').getByRole('tab', { name: label, exact: true }).click(); await settle(page); };
  const mode = label => page.locator('[data-usage-trend-mode]').getByRole('tab', { name: label, exact: true }).click();
  await metric('费用'); await settle(page);
  assert.equal(await page.locator('[data-usage-trend-mode]').getByRole('tab', { name: '构成', exact: true }).isVisible(), false);
  assert.equal(await chart.locator('[data-line-series]').count(), 1); await metric('Token'); await mode('构成');
  await usage.select(page, 'source', 'route-demo');
  assert.equal(await page.evaluate(() => window.usageHost.get().view.models.length), 2);
  const ledger = await page.evaluate(() => window.usageBridge.get());
  const sum = ledger.snapshot.daily.filter(row => row.provider === 'route-demo').reduce((value, row) => value + row.totalTokens, 0);
  assert.equal(await page.evaluate(() => window.usageHost.get().view.trend.total), (sum / 1e6).toFixed(1) + 'M');
  await usage.select(page, 'source', 'all'); await usage.agent(page, 'opencode');
  assert.equal(await page.evaluate(() => window.usageHost.get().view.sources.length), 2); await usage.agent(page, 'all');
  await openSettings(page, 'collection'); const settings = page.locator('[data-settings-page]');
  await pickSelect(settings, page, '用量自动刷新', '每 5 秒'); await until(page, async () => (await window.usageBridge.get()).refreshIntervalMs === 5000);
  await pickSelect(settings, page, '用量自动刷新', '只手动'); await until(page, async () => (await window.usageBridge.get()).refreshIntervalMs === 0);
  assert.equal((await page.evaluate(() => window.usageBridge.get())).enabled, false); await usage.openUsage(page);
  await node.dispose();node=await chart.elementHandle();
  await mode('模型'); await settle(page); const legends = page.locator('[data-usage-trend] [data-legend-key]');
  assert.equal(await legends.count(), 6); const legend = legends.first();
  await legend.click(); assert.equal(await legend.getAttribute('aria-pressed'), 'false');
  await legend.click(); assert.equal(await legend.getAttribute('aria-pressed'), 'true');
  for (const [key, label] of [['total', '累加'], ['daily', '每日']]) {
    await usage.more(page); await page.locator('[data-usage-display]').getByRole('tab', { name: label, exact: true }).click();
    assert.equal(await page.evaluate(() => window.usageHost.get().state.display), key);
  }
  await usage.grain(page, '按月'); await settle(page);
  assert(await chart.locator('[data-line-point]').count() <= 5);
  await usage.grain(page, '按日'); await page.locator('[data-usage-trend-range] button').click();
  const dates = await page.evaluate(() => ({ to: window.usageHost.get().today, from: window.usageMath.shift(window.usageHost.get().today, -6) }));
  const calendar = page.locator('[data-date-range-popover]');
  for (const day of [dates.from, dates.to]) await calendar.locator('[data-calendar-day="' + day + '"]').click();
  assert.equal(await calendar.locator('[data-calendar-day="' + dates.from + '"]').getAttribute('aria-selected'), 'true');
  assert.equal(await calendar.locator('[data-calendar-day="' + dates.to + '"]').getAttribute('aria-selected'), 'true');
  await calendar.getByRole('button', { name: '应用', exact: true }).click(); await settle(page);
  assert.equal(await chart.locator('[data-line-point]').count(), 7);
  await chart.focus(); await chart.press('ArrowRight');
  assert.equal(await page.locator(usage.hooks.tip).isVisible(), true); await chart.press('Escape');
  await page.locator(usage.hooks.tip).waitFor({ state: 'detached' });
  assert.equal(await page.locator(usage.hooks.tip).isVisible(), false);
  await page.screenshot({ path: path.join(output, 'trend-models-' + scale + '.png') });
  await page.locator('[data-usage-trend-range] button').click(); await calendar.getByRole('button', { name: '重置', exact: true }).click();
  await mode('总量'); await chart.scrollIntoViewIfNeeded(); await settle(page);
  const sample = async patch => page.evaluate(async patch => {
    window.usageHost.set(patch); const frames = [], start = performance.now();
    while (performance.now() - start < 1100) {
      const chart = document.querySelector('[data-usage-trend] [data-chart]');
      frames.push({ ms: performance.now() - start, paths: [...chart.querySelectorAll('[data-line-series] path')].map(path => path.getAttribute('d')),
        opacity: getComputedStyle(chart.querySelector('svg')).opacity,
        clipWidth: chart.querySelector('clipPath rect')?.width.baseVal.value,
        clipAttribute: chart.querySelector('clipPath rect')?.getAttribute('width') });
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return frames;
  }, patch);
  const motion = await sample({ period: '7' });
  fs.writeFileSync(path.join(output, 'range-sweep-' + scale + '.json'), JSON.stringify(motion, null, 2));
  assert(motion.length > 10);
  assert(motion.every(frame => frame.paths.every(path => !/NaN|Infinity/.test(path))), 'finite current geometry throughout transition');
  const sweep = (frames, label) => {
    const widths = frames.map(frame => frame.clipWidth), end = widths.at(-1);
    assert(widths.every(width => Number.isFinite(width) && width >= 0), label + ': finite reveal geometry');
    assert(end > 0 && Math.min(...widths) < end * .1, label + ': reveal starts at the left edge');
    assert(new Set(widths.map(width => width.toFixed(2))).size > 10, label + ': actual clip moves through rendered intermediate widths');
    assert(widths.some(width => width > end * .2 && width < end * .8), label + ': partial plot is visible before the reveal settles');
  };
  // Nov1's approved sweep holds the new path in place and reveals its actual
  // SVG clip. A curve/opacity-only assertion cannot observe that motion.
  sweep(motion, 'range change');
  await settle(page);
  assert.equal(await node.evaluate(element => element === document.querySelector('[data-usage-trend] [data-chart]')), true);
  await usage.period(page, 'all'); await usage.readyChart(page, 'trend');
  const points = await chart.locator('[data-line-point]').count(); assert(points > 31, 'needs a range longer than a month');
  const agentMotion = await sample({ agent: 'opencode' });
  sweep(agentMotion, 'Agent change');
  await usage.agent(page, 'all'); await settle(page); await node.dispose();
  await page.screenshot({ path: path.join(output, 'trend-total-' + scale + '.png') });
  fs.writeFileSync(path.join(output, 'animation-' + scale + '.json'), JSON.stringify(motion, null, 2));
  fs.writeFileSync(path.join(output, 'agent-animation-' + scale + '.json'), JSON.stringify(agentMotion, null, 2));
  return { rest, motion };
}
module.exports = { usageFunctionalChecks };
