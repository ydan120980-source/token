'use strict';
/* global document, innerWidth, innerHeight, getComputedStyle, requestAnimationFrame, Chart */
// Geometry and interaction regressions the DOM-state suites cannot see: overflow,
// layout shift, controls moving away from the pointer, chart transitions.
// Only disposable homes and synthetic statistics.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { settle, isolatePointer, cleanup } = require('./ui-settle');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');

const NOW = Date.parse('2026-10-11T06:00:00Z');
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, label + ' by ' + Math.round(actual - expected) + ' px');
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
// How far a clipping ancestor cuts into a mark's painted box: its border box after
// transforms, grown by the outer box-shadows (offset, blur and spread) of the mark and of
// its ::before layer, which covers the same box.
const paintClip = ([selector, index]) => {
  const all = document.querySelectorAll(selector), el = all[index < 0 ? all.length + index : index], box = el.getBoundingClientRect();
  const paint = { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  for (const shadow of [getComputedStyle(el), getComputedStyle(el, '::before')].flatMap(style => style.boxShadow.split(/,(?![^(]*\))/))) {
    if (shadow.includes('inset') || !shadow.includes('px')) continue;
    const [x, y, blur = 0, spread = 0] = shadow.match(/-?[\d.]+px/g).map(parseFloat);
    paint.left = Math.min(paint.left, box.left + x - blur - spread); paint.right = Math.max(paint.right, box.right + x + blur + spread);
    paint.top = Math.min(paint.top, box.top + y - blur - spread); paint.bottom = Math.max(paint.bottom, box.bottom + y + blur + spread);
  }
  for (let a = el.parentElement; a; a = a.parentElement) {
    const style = getComputedStyle(a), clip = a.getBoundingClientRect(), x = style.overflowX !== 'visible', y = style.overflowY !== 'visible';
    const cut = Math.max(x ? clip.left - paint.left : 0, x ? paint.right - clip.right : 0, y ? clip.top - paint.top : 0, y ? paint.bottom - clip.bottom : 0);
    if (cut > 1) return (a.id ? '#' + a.id : '.' + a.classList[0]) + ' cuts ' + Math.round(cut) + ' px';
  }
  return '';
};

// Several agents over five months, and three agents today, so filtering by one agent
// changes the height of the sections above the trend card.
function seed(store) {
  // Two models from the embedded price catalog and one without a price, so the estimate is a
  // partly priced range and hovering expands it.
  const agents = [['codex', 'openai', 'gpt-6.1-sol'], ['claude', 'anthropic', 'claude-sonnet-5-5'], ['opencode', 'synthetic', 'layout-unpriced-model']];
  let n = 0;
  // Inclusive usage: input_tokens contains the cached part and the total is input + output.
  const add = (agent, provider, model, time, tokens) => {
    const r = normalize(agent, { input_tokens: Math.round(tokens * .9), output_tokens: tokens - Math.round(tokens * .9), cached_input_tokens: Math.round(tokens * .6), cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: tokens }, { id: 'layout-' + n++, time, provider, model, entry: 'desktop' }, 'synthetic-salt');
    store.state.records[r.id] = r;
  };
  for (let d = 1; d < 150; d++) for (const [i, [agent, provider, model]] of agents.entries()) if ((d + i) % 4 !== 0) add(agent, provider, model, NOW - d * 86400000, 3000000 + Math.round(Math.abs(Math.sin(d * .3 + i)) * 60000000));
  for (const [i, [agent, provider, model]] of agents.entries()) add(agent, provider, model, NOW - (i + 1) * 3600000, 8000000 + i * 4000000);
}

async function size(app, page, width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h); win.show(); }, [width, height]);
  await page.waitForFunction(([w, h]) => Math.abs(innerWidth - w) <= 2 && Math.abs(innerHeight - h) <= 2, [width, height]);
  await page.evaluate(() => window.scrollTo(0, 0)); await settle(page); await frames(page);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-layout-'));
  const output = process.env.LAYOUT_EVIDENCE_DIR || 'artifacts/layout', evidence = {};
  fs.mkdirSync(output, { recursive: true });
  try {
    const home = path.join(dir, 'home'), f = fixtures(home), data = path.join(dir, 'usage'), store = new Store(data, f.roots);
    seed(store); store.state.sequence = 1; atomic(path.join(data, 'statistics.json'), store.state); store.setEnabled(false);
    const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--quota-data-dir', path.join(dir, 'quota'), '--usage-data-dir', data, '--m1-fixture-root', home], timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.locator('#quotaCards').waitFor({ state: 'attached' }); await page.waitForLoadState('load');
      await page.clock.install({ time: new Date(NOW) }); await page.reload();
      await isolatePointer(app);
      await page.locator('[data-view="usage"]').click();
      await page.waitForFunction(() => document.querySelectorAll('#overviewWeek button').length === 30 && document.querySelectorAll('#usage .card.today .client-row').length >= 3);
      assert.equal(await page.evaluate(() => window.uiMotion.mode), 'full');

      // Each check runs on its own and failures are collected, so one run reports every
      // regression; each check resets what it changed (pointer, popovers, filters).
      const failures = [];
      const check = async (name, run) => { try { await run(); } catch (error) { failures.push(name + ': ' + error.message.split('\n')[0]); await page.keyboard.press('Escape').catch(() => {}); await page.mouse.move(2, 2).catch(() => {}); } };

      await check('noHorizontalScroll', async () => {
        for (const [w, h] of [[1024, 736], [1440, 900]]) { await size(app, page, w, h); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'horizontal scroll at ' + w); }
      });
      await check('coverBelowFold', async () => {
        await size(app, page, 1250, 1000);
        const top = await page.evaluate(() => document.getElementById('activityBlock').getBoundingClientRect().top);
        evidence.activityTop = Math.round(top); assert.ok(top >= 1000, 'activity block on the first screen at ' + Math.round(top));
      });
      await check('expandKeepsLayout', async () => {
        await size(app, page, 1250, 1000);
        const where = () => page.evaluate(() => ({ strip: document.getElementById('overviewWeek').getBoundingClientRect().top, facts: document.querySelector('.overview-facts').getBoundingClientRect().top }));
        const before = await where();
        await page.locator('#totalCost button').hover(); await settle(page);
        assert.equal(await page.locator('#totalCost button').evaluate(b => b.classList.contains('cost-expanded')), true, 'not expanded');
        const after = await where();
        await page.mouse.move(2, 2); await settle(page);
        near(after.strip, before.strip, 1, 'strip moved'); near(after.facts, before.facts, 1, 'facts wrapped');
      });
      await check('tooltipAtPointer', async () => {
        const bar = await page.locator('#overviewWeek button').last().boundingBox(), pointer = { x: bar.x + bar.width / 2, y: bar.y + bar.height - 4 };
        await page.mouse.move(pointer.x, pointer.y); await page.waitForFunction(() => document.getElementById('heatTooltip').classList.contains('visible'));
        const tip = await page.locator('#heatTooltip').boundingBox();
        await page.mouse.move(2, 2);
        assert.ok(Math.min(Math.abs(tip.y + tip.height - pointer.y), Math.abs(tip.y - pointer.y)) < 60, 'tooltip ' + Math.round(pointer.y - tip.y - tip.height) + ' px above the pointer');
      });
      // The first and last marks of a row keep their whole hover ring and shadow.
      await check('edgeHoverNotClipped', async () => {
        await size(app, page, 1024, 736);
        for (const [selector, index] of [['#overviewWeek button', 0], ['#overviewWeek button', -1], ['#heatmap button[data-date]', 0], ['#heatmap button[data-date]', -1]]) {
          const mark = index < 0 ? page.locator(selector).last() : page.locator(selector).nth(index);
          await mark.scrollIntoViewIfNeeded(); await mark.hover(); await settle(page);
          const cut = await page.evaluate(paintClip, [selector, index]);
          assert.equal(cut, '', selector + (index < 0 ? ' last' : ' first') + ': ' + cut);
        }
        await page.mouse.move(2, 2); await page.evaluate(() => window.scrollTo(0, 0));
      });
      await check('punchCardFits', async () => {
        await size(app, page, 1024, 736);
        await page.locator('#hourCard').scrollIntoViewIfNeeded(); await settle(page);
        const punch = await page.evaluate(() => { const grid = document.querySelector('#hourCard .hour-grid'), scroll = grid.parentElement, dots = [...grid.querySelectorAll('button')]; return { overflow: scroll.scrollWidth - scroll.clientWidth, widest: Math.max(...dots.map(b => b.querySelector('i').getBoundingClientRect().width - b.getBoundingClientRect().width)), empty: dots.filter(b => b.querySelector('i').getBoundingClientRect().width === 0).length }; });
        assert.ok(punch.overflow <= 0, 'scrolls horizontally by ' + punch.overflow);
        assert.ok(punch.widest <= 0, 'a dot is ' + punch.widest + ' px wider than its column');
        assert.equal(punch.empty, 0, 'dots collapsed to zero width');
      });
      await check('calendarSweepAndPalette', async () => {
        await size(app, page, 1250, 1000);
        await page.locator('#activityBlock').scrollIntoViewIfNeeded(); await settle(page);
        await page.locator('#activityBlock .heat-range [data-value="2026"]').click();
        const swept = await page.evaluate(() => 'sweep' in document.getElementById('heatmap').dataset);
        await settle(page); await page.locator('#activityBlock .heat-range [data-value="365"]').click(); await settle(page);
        assert.equal(swept, true, 'no sweep on a range change');
        await page.waitForFunction(() => !('sweep' in document.getElementById('heatmap').dataset), null, { timeout: 3000 });
        assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('#heatmap button')).transitionProperty), /background-color/, 'cells do not cross-fade');
      });
      const hold = async (control, sectionSelector) => {
        const section = page.locator(sectionSelector);
        const top = await section.evaluate(element => element.getBoundingClientRect().top), today = await page.evaluate(() => document.querySelector('#usage .card.today').offsetHeight);
        await page.locator(control).click(); await settle(page); await frames(page);
        const moved = await section.evaluate(element => element.getBoundingClientRect().top), todayAfter = await page.evaluate(() => document.querySelector('#usage .card.today').offsetHeight);
        assert.notEqual(todayAfter, today, 'fixture no longer changes the height above ' + sectionSelector);
        near(moved, top, 2, sectionSelector + ' moved after ' + control);
      };
      await check('filterHoldsTrend', async () => {
        await size(app, page, 1250, 1000);
        await page.locator('#trend').scrollIntoViewIfNeeded(); await settle(page);
        try { await hold('#agentPicker [data-agent="claude"]', '#trend'); } finally { await page.locator('#agentPicker [data-agent="all"]').click(); await settle(page); }
      });
      await check('filterHoldsShareCard', async () => {
        await page.locator('#shareCard').scrollIntoViewIfNeeded(); await settle(page);
        try { await hold('#shareCard [data-share-agent="opencode"]', 'section.insights'); } finally { await page.locator('#agentPicker [data-agent="all"]').click(); await settle(page); }
      });
      await check('rangeCalendarFits', async () => {
        await page.locator('#trend').scrollIntoViewIfNeeded(); await settle(page);
        await page.locator('#trendRangeButton').click(); await page.waitForFunction(() => document.getElementById('trendRangePopover').matches(':popover-open')); await settle(page);
        const calendar = await page.evaluate(() => { const pop = document.getElementById('trendRangePopover').getBoundingClientRect(), cells = [...document.querySelectorAll('#trendRangePopover .cal-grid > button')].map(c => c.getBoundingClientRect()); return { outside: cells.filter(c => c.left < pop.left - .5 || c.right > pop.right + .5).length, firstRow: new Set(cells.slice(0, 7).map(c => Math.round(c.top))).size, cells: cells.length }; });
        await page.keyboard.press('Escape'); await settle(page);
        assert.equal(calendar.cells, 42); assert.equal(calendar.outside, 0, calendar.outside + ' days outside the popover'); assert.equal(calendar.firstRow, 1, 'first week wraps');
      });
      await check('legendFadesWithoutShift', async () => {
        const area = () => page.evaluate(() => { const c = Chart.getChart(document.getElementById('trendCanvas')); return [Math.round(c.chartArea.left), Math.round(c.chartArea.right)]; });
        const base = await area();
        for (const key of ['cost', 'cacheRead', 'cacheRead', 'cost']) {
          const log = await page.evaluate(key => new Promise(resolve => {
            const chart = Chart.getChart(document.getElementById('trendCanvas')), index = chart.data.datasets.findIndex(d => d.usageKey === key), dataset = chart.data.datasets[index], log = [], start = performance.now();
            document.querySelector('#chartLegend [data-trend-series="' + key + '"]').click();
            const tick = () => { log.push({ alpha: dataset.$alpha ?? 1, visible: chart.isDatasetVisible(index) }); if (performance.now() - start < 900) requestAnimationFrame(tick); else resolve(log); };
            requestAnimationFrame(tick);
          }), key);
          await settle(page);
          assert.ok(log.some(frame => frame.visible && frame.alpha > 0 && frame.alpha < 1), key + ' toggled without a fade');
          // The left axis may narrow with its labels when the scale changes; the cost axis on the right keeps its width.
          assert.equal((await area())[1], base[1], key + ' moved the right edge of the plot');
        }
      });
      evidence.failures = failures;
      assert.deepEqual(failures, [], 'layout regressions:\n  ' + failures.join('\n  '));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, 'layout-final.png') });
    } finally { await app.close(); }
  } finally { await cleanup(dir); }
  fs.writeFileSync(path.join(output, 'layout-ui-results.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS: layout geometry and interaction regressions (overflow, cover, expand, tooltip, edge hover, punch card, calendar, filter hold, range calendar, legend).');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
