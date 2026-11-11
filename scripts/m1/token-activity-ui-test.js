'use strict';
/* global document, getComputedStyle, MutationObserver, DOMMatrixReadOnly */
// HANDOFF-20261029 step 1: each numbered M11 activity requirement has its own
// rendered assertion. Only fresh synthetic stores and explicit fixture scans.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');
const { settle, until, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const usage = require('./usage-ui-helpers');
const output = path.resolve(process.env.TOKEN_ACTIVITY_EVIDENCE_DIR || 'artifacts/token-activity');
const NOW = Date.parse('2026-10-29T04:30:00Z'), TODAY = '2026-10-29';
const calendar = '[data-usage-calendar]', week = '[data-usage-week-hour]', hours = '[data-usage-hours]';
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'token-activity-'));
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  try { for (const [scale, dark] of [[1, false], [1.5, true]]) {
    const home = path.join(root, 'home-' + scale), fixture = fixtures(home), data = path.join(root, 'usage-' + scale), quota = path.join(root, 'quota-' + scale);
    const store = new Store(data, fixture.roots);
    const records = [
      ['today-eight', '2026-10-29T00:00:00Z', 500], ['today-peak', '2026-10-29T02:00:00Z', 1500],
      ['wednesday-peak', '2026-10-27T19:00:00Z', 8000], ['last-wednesday', '2026-10-20T19:00:00Z', 4000],
      ['observed-zero', '2026-10-27T00:00:00Z', 0],
    ];
    for (const [id, time, tokens] of records) {
      const record = normalize('codex', { input_tokens: tokens, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: tokens }, { id, time, provider: 'openai', model: 'gpt-4.1', entry: 'desktop' }, store.state.salt);
      store.state.records[record.id] = record;
    }
    store.state.sequence = 1; atomic(path.join(data, 'statistics.json'), store.state); store.setEnabled(false);
    const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--quota-data-dir', quota, '--usage-data-dir', data, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
    const checks = [];
    try {
      const page = await app.firstWindow(), errors = [];
      await keepVisible(app); await isolatePointer(app);
      page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      // Freeze calendar facts only. Keep performance/rAF and the native WAAPI
      // document timeline on the same origin across reload and reduced/off tests.
      await page.addInitScript(ms=>{const RealDate=Date;window.Date=class extends RealDate{constructor(...args){if(args.length)super(...args);else super(ms);}static now(){return ms;}};},NOW);
      await page.waitForLoadState('load'); await page.reload();
      await page.locator('[data-view="usage"]').click(); await page.locator('[data-usage-activity]').waitFor();
      await page.evaluate(value => { window.settingsHost.theme.set(value ? 'dark' : 'light'); window.uiMotion.setPreference('system'); }, dark);
      await usage.heatRange(page, '2026');
      const today = () => usage.cell(page, TODAY);
      await page.keyboard.press('Tab'); await today().focus(); await today().press('Enter'); await settle(page);
      const selected = await page.evaluate(selector => {
        const cell = document.querySelector(selector + ' [aria-pressed="true"]'), ring = document.querySelector(selector + ' [data-heat-ring="mark"]');
        const c = cell.getBBox(), r = ring.getBBox();
        return { pressed: cell.getAttribute('aria-pressed'), gap: (r.width - c.width) / 2 - Number(ring.getAttribute('stroke-width')) / 2, focusStroke: getComputedStyle(cell).strokeWidth, ringFill: getComputedStyle(ring).fill };
      }, calendar);
      assert.equal(selected.pressed, 'true'); assert(selected.gap > 1); assert.equal(selected.ringFill, 'none'); assert.equal(selected.focusStroke, '2px'); checks.push(1);
      await page.getByRole('button', { name: '关闭当日明细', exact: true }).click(); await settle(page);
      await page.locator(week + ' [data-heat-key="2:3"]').click(); await settle(page);
      const slot = await page.evaluate(selector => {
        const root = document.querySelector(selector), marked = [...root.querySelectorAll('[data-highlighted]')], outside = [...root.querySelectorAll('[data-level]')].filter(c => Number(c.dataset.level) > 0 && !c.dataset.highlighted);
        return { marked: marked.map(c => c.dataset.heatKey), allRinged: marked.every(c => [...root.querySelectorAll('[data-heat-ring="mark"]')].some(r => Math.abs(r.getBBox().x - c.getBBox().x + 2.5) < .1)), outside: outside.map(c => c.classList.contains('fill-heat-0')), inside: marked.map(c => c.classList.contains('fill-heat-' + c.dataset.level)) };
      }, calendar);
      assert.deepEqual(slot.marked.sort(), ['2026-10-21', '2026-10-28']); assert(slot.allRinged && slot.outside.length && slot.outside.every(Boolean) && slot.inside.every(Boolean)); checks.push(2);
      await page.locator(week + ' [data-heat-key="2:3"]').click(); await settle(page);
      const fills = await page.evaluate(selector => ['2026-10-27', '2026-10-26', '2026-10-30'].map(day => {
        const c = document.querySelector(selector + ' [data-heat-key="' + day + '"]'); return { day, level: c.dataset.level, fill: getComputedStyle(c).fill, opacity: getComputedStyle(c).fillOpacity, disabled: c.getAttribute('aria-disabled') };
      }), calendar);
      assert.deepEqual(fills.map(f => f.level), ['0', 'unknown', 'unknown']); assert.deepEqual(fills.map(f => Number(f.opacity)), [1, .55, .28]); assert.equal(fills[2].disabled, 'true'); checks.push(3);
      await page.locator('[data-usage-calendar-range]').getByRole('tab', { name: '最近一年', exact: true }).click();
      await page.locator('[data-usage-calendar-range]').getByRole('tab', { name: '2026 年', exact: true }).click();
      const month = await page.locator(calendar + ' .kit-heat-label').first().evaluate(e => ({ name: getComputedStyle(e).animationName, duration: getComputedStyle(e).animationDuration, frames: e.getAnimations().flatMap(a => a.effect.getKeyframes()).map(f => f.opacity).filter(Boolean) }));
      assert.equal(month.name, 'kit-heat-fade'); assert.equal(month.duration, '0.32s'); assert(month.frames.includes('0')); checks.push(4); await settle(page);
      await today().focus(); const held = await today().elementHandle();
      await page.evaluate(() => window.usageHost.refresh()); await settle(page);
      assert.equal(await held.evaluate(e => e.isConnected && e === document.activeElement), true); assert.equal(await today().evaluate(e => e === document.activeElement), true); await held.dispose(); checks.push(5);
      await page.keyboard.press('Escape'); await page.locator('#kit-window-chart-tooltip').waitFor({ state: 'detached' });
      await page.evaluate(() => {
        window.tipEntrySamples = [];
        window.tipEntryObserver = new MutationObserver(() => {
          const e = document.getElementById('kit-window-chart-tooltip');
          if (!e) return;
          const style = getComputedStyle(e), matrix = new DOMMatrixReadOnly(style.transform);
          window.tipEntrySamples.push({ opacity: Number(style.opacity), scale: matrix.a, y: matrix.f });
        });
        window.tipEntryObserver.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
      });
      await usage.hover(page, today());
      const tip = page.locator('#kit-window-chart-tooltip'); await tip.waitFor();
      const appearance = await tip.evaluate(e => ({ radius: getComputedStyle(e).borderRadius, background: getComputedStyle(e).backgroundColor, font: parseFloat(getComputedStyle(e).fontSize), titleWeight: Number(getComputedStyle(e.querySelector('strong')).fontWeight), origin: getComputedStyle(e).transformOrigin, keyframes: e.getAnimations().flatMap(a => a.effect.getKeyframes()).map(f => ({ opacity: f.opacity, transform: f.transform })) }));
      assert.match(await tip.locator('strong').innerText(), /2026-10-29/); assert(appearance.titleWeight >= 600 && appearance.font <= 13); assert.equal(appearance.radius, '12px'); assert(appearance.origin.split(' ')[1] !== '0px');
      await settle(page);
      const entrySamples = await page.evaluate(() => { window.tipEntryObserver.disconnect(); return window.tipEntrySamples; });
      assert(entrySamples.some(f => f.scale < .999 || f.y > .1), 'full tooltip enters from a smaller/offset state');
      assert.equal(await tip.evaluate(e => Number(getComputedStyle(e).opacity)), 1);
      assert(Math.max(...appearance.background.match(/\d+/g).slice(0, 3).map(Number)) < 100, 'both themes keep the dark capsule');
      await page.screenshot({ path: path.join(output, 'tooltip-' + scale + '.png') });
      assert.equal(await page.locator(calendar + ' [aria-describedby="kit-window-chart-tooltip"]').count(), 1); checks.push(6);
      await page.keyboard.press('Escape');
      const active = page.locator(week + ' [data-heat-key="2:3"]'); await active.focus(); await settle(page);
      const labels = await page.locator(week + ' [data-chart]').evaluate(e => ({ row: [...e.querySelectorAll('text')].find(t => t.textContent === '三')?.getAttribute('class'), hour: e.querySelector('[data-heat-hover-label]')?.textContent, transition: getComputedStyle([...e.querySelectorAll('text')].find(t => t.textContent === '三')).transitionDuration }));
      assert.match(labels.row, /fill-foreground.*font-semibold/); assert.equal(labels.hour, '3'); assert.equal(labels.transition, '0.12s'); checks.push(7);
      await active.press('Enter'); await settle(page); assert.equal(await active.getAttribute('aria-pressed'), 'true'); assert(await page.locator(week + ' [data-heat-ring="mark"]').count());
      await active.press('Enter'); await settle(page); assert.equal(await active.getAttribute('aria-pressed'), 'false');
      await active.press('Enter'); await active.press('Escape'); await settle(page); assert.equal(await active.getAttribute('aria-pressed'), 'false'); checks.push(8);
      const fact = page.locator('[data-usage-aside-facts] > div').filter({ hasText: '最集中的时段' }).getByRole('button');
      await fact.hover(); const factHover = await fact.evaluate(e => getComputedStyle(e).backgroundColor); assert.notEqual(factHover, 'rgba(0, 0, 0, 0)', 'fact action has a light hover surface');
      assert.match(await fact.evaluate(e => getComputedStyle(e).textDecorationLine), /underline/);
      await page.screenshot({ path: path.join(output, 'fact-hover-' + scale + '.png') });
      await fact.click(); await settle(page); assert.equal(await active.getAttribute('aria-pressed'), 'true'); checks.push(9);
      await active.press('Escape'); await today().click(); await settle(page);
      const peak = page.locator(hours + ' [data-bar-key="10"]'), peakTarget = peak.locator('[data-chart-key]'), shape = peak.locator('[data-bar-shape]');
      await page.mouse.move(0, 0); const geometry = await shape.evaluate(e => { const r = e.getBBox(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      await usage.hover(page, peakTarget); await settle(page);
      assert.deepEqual(await shape.evaluate(e => { const r = e.getBBox(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }), geometry); assert.equal(await peak.locator('[data-bar-column]').getAttribute('opacity'), '0', 'no box around the pointed bar'); assert.equal(await peak.locator('[data-bar-rule]').getAttribute('opacity'), '0.6', 'a selection rule rises from the pointed bar');
      assert.match(await shape.evaluate(e => getComputedStyle(e).filter), /saturate/); assert.equal(await shape.evaluate(e => getComputedStyle(e).transform), 'none'); checks.push(10);
      const card = await page.locator('#kit-window-chart-tooltip').boundingBox(), plot = await page.locator(hours + ' [data-chart] svg').boundingBox();
      assert(card && card.y + card.height <= plot.y + 1 && card.x >= plot.x - 1 && card.x + card.width <= plot.x + plot.width + 1, 'the card sits above the plot, inside its width');
      await page.screenshot({ path: path.join(output, 'hour-hover-' + scale + '.png') });
      assert(await shape.evaluate(e => e.classList.contains('fill-heat-4'))); assert.equal(await page.locator(hours + ' [data-bar-key="0"] [data-bar-shape]').evaluate(e => e.getBBox().height), 0);
      const future = page.locator(hours + ' [data-bar-key="13"]'); assert.equal(await future.getAttribute('data-state'), 'future'); assert.equal(await future.locator('[data-bar-column]').getAttribute('opacity'), '1'); assert.equal(await future.locator('[data-bar-rule]').count(), 0); assert.equal(await future.locator('[data-chart-key]').count(), 0); checks.push(11);
      const ticks = await page.locator(hours + ' [data-column-tick]').evaluateAll(elements => elements.map(e => {
        const key = e.dataset.columnTick, bar = e.closest('[data-chart]').querySelector('[data-bar-key="' + key + '"] [data-bar-column]').getBoundingClientRect(), tick = e.getBoundingClientRect(); return Math.abs(tick.x + tick.width / 2 - bar.x - bar.width / 2);
      })); assert(ticks.length && ticks.every(delta => delta < 1)); checks.push(12);
      await page.evaluate(() => { window.paletteTransitions = []; document.addEventListener('transitionrun', e => { if (e.propertyName === 'fill' && e.target.matches('.kit-heat-cell')) window.paletteTransitions.push(e.target.closest('[data-usage-calendar]') ? 'calendar' : e.target.closest('[aria-label="活动强度色阶"]') ? 'legend' : 'other'); }); });
      await usage.palette(page, 'green');
      const transitions = await page.evaluate(() => [...new Set(window.paletteTransitions)]); assert(transitions.includes('calendar') && transitions.includes('legend'), JSON.stringify(transitions));
      await page.screenshot({ path: path.join(output, 'activity-selected-' + scale + '.png'), fullPage: false });
      await page.reload(); await page.locator('[data-view="usage"]').click(); await until(page, () => window.usageHost.get().state.palette === 'green');
      assert.equal(await page.locator('[data-usage-palette]').getByRole('radio', { name: '绿色', exact: true }).getAttribute('aria-checked'), 'true'); checks.push(13);
      for (const mode of ['reduced', 'off']) {
        await page.evaluate(value => window.uiMotion.setPreference(value), mode); await usage.heatRange(page, '365'); await usage.heatRange(page, '2026');
        const moving = await page.locator(calendar + ' .kit-heat-cell').evaluateAll(cells => cells.flatMap(c => c.getAnimations()).flatMap(a => a.effect.getKeyframes()).map(f => f.transform).filter(t => t && t !== 'none'));
        assert.deepEqual(moving, [], mode + ' has no scaling cell animation');
      }
      assert.deepEqual(errors, []); assert.deepEqual(checks, Array.from({ length: 13 }, (_, i) => i + 1));
      results.push({ scale, dark, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), checks, observedFills: fills, tooltip: appearance, noRealData: true, errors });
      console.log('PASS: activity assertions 1–13, including all repaired M11 visual requirements, at ' + scale);
    } catch (error) { const page = await app.firstWindow(); await page.screenshot({ path: path.join(output, 'failure-' + scale + '.png') }); throw error; }
    finally { await app.close(); }
  } fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(output, 'visual-review-required.json'), '[]'); }
  finally { await cleanup(root); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
