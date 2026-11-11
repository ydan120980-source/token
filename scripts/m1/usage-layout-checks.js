'use strict';
/* global document, innerWidth, innerHeight, getComputedStyle */
// M7 mappings of the legacy layout checks; fixtures and privacy boundaries stay in layout-ui-test.
const assert = require('node:assert/strict');
const { settle } = require('./ui-settle');
const usage = require('./usage-ui-helpers');
async function usageLayoutChecks(page, app, { size, near, frames, paintClip, evidence }) {
  const failures = [];
  const check = async (name, run) => {
    try { await run(); } catch (error) {
      failures.push(name + ': ' + error.message.split('\n')[0]);
      await page.keyboard.press('Escape').catch(() => {}); await page.mouse.move(2, 2).catch(() => {});
    }
  };
  await check('noHorizontalScroll', async () => {
    for (const [width, height] of [[1024, 736], [1440, 900]]) {
      await size(app, page, width, height);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal scroll at ' + width);
    }
  });
  await check('activityFollowsOverview', async () => {
    await size(app, page, 1250, 1000);
    // M10 explicitly removes the overview's min-h-screen blank space. Check the actual
    // section gap and content containment instead of forcing activity below the viewport.
    const geometry = await page.locator('[data-usage-activity]').evaluate(element => {
      const previous = element.previousElementSibling, top = element.getBoundingClientRect().top;
      const children = [...previous.children].map(child => child.getBoundingClientRect().bottom);
      return { top, gap: top - previous.getBoundingClientRect().bottom, emptyTail: previous.getBoundingClientRect().bottom - Math.max(...children) };
    });
    evidence.activityLayout = geometry;
    assert(geometry.gap >= 0 && geometry.gap <= 24.5, 'activity follows overview without overlap or added blank space');
    assert(geometry.emptyTail <= 1, 'overview adds no viewport-height spacer after its content');
  });
  await check('revealKeepsLayout', async () => {
    await size(app, page, 1250, 1000);
    const where = () => page.evaluate(() => ({ strip: document.querySelector('[data-usage-strip]').getBoundingClientRect().top,
      facts: document.querySelector('[data-usage-total-tokens]').getBoundingClientRect().top }));
    const before = await where(), price = page.locator('[data-usage-total-cost] button');
    await usage.hover(page, price); await settle(page);
    assert.equal(await price.getAttribute('aria-expanded'), 'true');
    const after = await where(), popup = page.locator('[data-ui-portal] [role=tooltip]');
    const bounds = await popup.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    near(after.strip, before.strip, 1, 'strip moved'); near(after.facts, before.facts, 1, 'token row moved');
    assert(bounds.x >= 8 && bounds.x + bounds.width <= viewport.width - 8);
    assert(bounds.y >= 8 && bounds.y + bounds.height <= viewport.height - 8);
    await price.press('Escape'); await popup.waitFor({ state: 'detached' });
    assert.equal(await price.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(await where(), after, 'closing a range readout does not move the layout');
  });
  await check('tooltipAnnotation', async () => {
    const mark = page.locator('[data-usage-strip] [data-chart-key]').last();
    await usage.hover(page, mark); await page.locator(usage.hooks.tip).waitFor();
    await settle(page);
    const bar = await mark.boundingBox(), tip = await page.locator(usage.hooks.tip).boundingBox();
    const plot = await mark.evaluate(element => { const r = element.closest('svg').getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    assert(tip.x >= plot.left - 1 && tip.x + tip.width <= plot.right + 1, 'annotation stays inside the chart width');
    assert(tip.y + tip.height <= plot.top + 1 || tip.y >= plot.bottom - 1, 'annotation does not cover plotted data');
    await page.mouse.move(bar.x + bar.width * .6, bar.y + bar.height * .6); await frames(page);
    const moved = await page.locator(usage.hooks.tip).boundingBox();
    near(moved.x, tip.x, 1, 'same-mark pointer movement must not move the annotation');
    near(moved.y, tip.y, 1, 'same-mark pointer movement must not move the annotation');
    await page.mouse.move(2, 2);
  });
  await check('edgeHoverNotClipped', async () => {
    await size(app, page, 1024, 736);
    for (const [selector, index] of [
      ['[data-usage-strip] [data-chart-key]', 0], ['[data-usage-strip] [data-chart-key]', -1],
      ['[data-usage-calendar] [data-heat-key]:not([aria-disabled=true])', 0],
      ['[data-usage-calendar] [data-heat-key]:not([aria-disabled=true])', -1],
    ]) {
      const mark = index < 0 ? page.locator(selector).last() : page.locator(selector).nth(index);
      await usage.hover(page, mark); await settle(page);
      assert.equal(await page.evaluate(paintClip, [selector, index]), '', selector + ' edge clipped');
    }
    await page.mouse.move(2, 2);
  });
  await check('hourGridFits', async () => {
    await size(app, page, 1024, 736); await usage.readyChart(page, 'week-hour');
    const grid = await page.locator('[data-usage-week-hour] [data-chart]').evaluate(element => ({
      overflow: element.scrollWidth - element.clientWidth,
      sizes: [...element.querySelectorAll('[data-heat-key]')].map(cell => {
        const box = cell.getBoundingClientRect(); return [box.width, box.height];
      }),
    }));
    assert(grid.overflow <= 0); assert.equal(grid.sizes.length, 168);
    assert(grid.sizes.every(([width, height]) => width >= 8 && Math.abs(width - height) < 1), 'approved fit-square geometry, no cell under 8px');
  });
  await check('calendarEntryAndPalette', async () => {
    await size(app, page, 1250, 1000);
    const chart = await usage.readyChart(page, 'calendar'), before = Number(await chart.getAttribute('data-enter-count'));
    await usage.heatRange(page, '2026'); await usage.readyChart(page, 'calendar');
    assert.equal(Number(await chart.getAttribute('data-enter-count')), before + 1, 'new range enters once');
    await usage.heatRange(page, '365'); await usage.readyChart(page, 'calendar');
    const entered = await chart.getAttribute('data-enter-count');
    await usage.palette(page, 'blue');
    const blue = await chart.locator('[data-level="4"]').first().evaluate(cell => getComputedStyle(cell).fill);
    await usage.palette(page, 'green');
    const green = await chart.locator('[data-level="4"]').first().evaluate(cell => getComputedStyle(cell).fill);
    assert.notEqual(blue, green); assert.equal(await chart.getAttribute('data-enter-count'), entered, 'palette does not replay entry');
    await usage.palette(page, 'orange');
  });
  await check('filterHoldsTrend', async () => {
    await size(app, page, 1250, 1000); await usage.readyChart(page, 'trend');
    const trend = page.locator('[data-usage-trend]'), today = page.locator('[data-usage-today]');
    const before = await trend.boundingBox(), height = (await today.boundingBox()).height;
    await usage.agent(page, 'claude'); await frames(page);
    assert.notEqual((await today.boundingBox()).height, height, 'fixture changes content height');
    near((await trend.boundingBox()).y, before.y, 2, 'trend moved after filtering');
    await usage.agent(page, 'all');
  });
  await check('rangeCalendarFits', async () => {
    await page.locator('[data-usage-trend-range] button').click();
    const calendar = page.locator('[data-date-range-popover]'); await calendar.waitFor(); await settle(page);
    const shape = await calendar.evaluate(element => {
      const box = element.getBoundingClientRect(), cells = [...element.querySelectorAll('[role=gridcell]')].map(cell => cell.getBoundingClientRect());
      return { cells: cells.length, outside: cells.filter(cell => cell.left < box.left - .5 || cell.right > box.right + .5).length,
        firstRow: new Set(cells.slice(0, 7).map(cell => Math.round(cell.top))).size };
    });
    assert.equal(shape.cells, 42); assert.equal(shape.outside, 0); assert.equal(shape.firstRow, 1);
    await page.keyboard.press('Escape'); await calendar.waitFor({ state: 'detached' });
  });
  await check('legendTogglesWithoutShift', async () => {
    const chart = await usage.readyChart(page, 'trend');
    const right = (await chart.locator('svg').boundingBox()).x + (await chart.locator('svg').boundingBox()).width;
    for (const key of ['cost', 'cacheRead', 'cacheRead', 'cost']) {
      const control = page.locator('[data-usage-trend] [data-legend-key="' + key + '"]');
      const pressed = await control.getAttribute('aria-pressed'); await control.click(); await settle(page);
      assert.notEqual(await control.getAttribute('aria-pressed'), pressed);
      const paths = chart.locator('[data-line-series="' + key + '"] path');
      assert.equal(await paths.count() > 0, pressed === 'false', 'current standard legend visibility');
      const box = await chart.locator('svg').boundingBox(); near(box.x + box.width, right, 1, 'right plot edge moved');
    }
  });
  await check('costLineStaysOnChart', async () => {
    const control = page.locator('[data-usage-trend] [data-legend-key=cost]');
    if (await control.getAttribute('aria-pressed') !== 'true') await control.click();
    for (const gap of [150, 300, 500]) {
      await control.click(); await page.waitForTimeout(gap); await control.click(); await settle(page);
      const shapes = await page.locator('[data-usage-trend] [data-line-series=cost] path').evaluateAll(paths => paths.map(path => ({
        d: path.getAttribute('d'), box: { y: path.getBBox().y, height: path.getBBox().height }, height: path.ownerSVGElement.viewBox.baseVal.height,
      })));
      assert(shapes.length > 0); assert(shapes.every(shape => !/NaN|Infinity/.test(shape.d)));
      assert(shapes.every(shape => shape.box.y >= 0 && shape.box.y + shape.box.height <= shape.height), 'cost path leaves plot after retarget');
    }
  });
  await check('dayHoursFill', async () => {
    const day = await page.evaluate(() => window.usageHost.get().view.calendar.cells.filter(cell => cell.value > 0).at(-2).key);
    await usage.cell(page, day).click(); await settle(page); await usage.readyChart(page, 'hours');
    const bars = await page.locator('[data-usage-hours]').evaluate(element => {
      const width = element.getBoundingClientRect().width, svg = element.querySelector('svg').getBoundingClientRect();
      const shapes = [...element.querySelectorAll('[data-state=value] > rect:not([fill=transparent])')].map(mark => mark.getBoundingClientRect());
      return { share: svg.width / width, used: shapes.length, thin: shapes.filter(box => box.width < 6 || box.height < 8).length };
    });
    assert(bars.share > .5); assert(bars.used > 0); assert.equal(bars.thin, 0);
    await page.getByRole('button', { name: '回到星期 × 小时', exact: true }).click();
  });
  evidence.failures = failures; assert.deepEqual(failures, [], 'layout regressions:\n' + failures.join('\n'));
}
module.exports = { usageLayoutChecks };
