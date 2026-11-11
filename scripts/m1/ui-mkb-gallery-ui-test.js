'use strict';
/* global document, requestAnimationFrame, innerHeight, innerWidth, getComputedStyle */
// MK-b review uses only ui-smoke's separate synthetic home/usage/quota stores.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch, setTheme, isolationViolations, semanticViolations } = require('./ui-smoke');
const { until, settle } = require('./ui-settle');
const { motionAndGestures } = require('./ui-mkb-gallery-motion');
const { sharedLayoutOptions } = require('./ui-m7-kit-layout-checks');
const output = process.env.UI_MKB_EVIDENCE_DIR || 'artifacts/ui-mig/MK-b/gallery';
fs.mkdirSync(output, { recursive: true });
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function liveHeatmapReadouts(page, root, shot) {
  for (const variant of ['calendar', 'weekHour']) for (const preference of ['full', 'reduced', 'off']) {
    await mode(page, preference);
    const sample = root.locator('[data-mkb-case="heatmap-live-' + variant + '"]');
    const reset = sample.getByRole('button', { name: '恢复格', exact: true });
    const chart = sample.getByRole('group', { name: '热力实时 ' + variant, exact: true });
    const cell = chart.locator('[data-heat-key="live"]'), tip = page.locator('#kit-window-chart-tooltip');
    for (const input of ['focus', 'pointer']) {
      await reset.evaluate(button => button.click()); await sample.scrollIntoViewIfNeeded();
      await reset.focus(); await page.mouse.move(1, 1);
      await chart.scrollIntoViewIfNeeded();
      // M11 adds a CSS cell sweep. The live-refresh invariant compares a stationary
      // anchor; finish its entry before opening the readout, preserving exact position checks.
      await settle(page);
      if (input === 'focus') await cell.focus(); else await cell.hover();
      await page.waitForFunction(() => document.getElementById('kit-window-chart-tooltip')?.textContent === '2 Token');
      await settle(page);
      const node = await tip.elementHandle(), focus = await page.locator(':focus').elementHandle();
      const position = await tip.evaluate(element => [element.style.left, element.style.top]);
      const entries = await chart.getAttribute('data-enter-count');
      // Fixture publication models an external data update without moving focus/pointer.
      await sample.getByRole('button', { name: '更新读数', exact: true }).evaluate(button => button.click());
      await page.waitForFunction(() => document.getElementById('kit-window-chart-tooltip')?.textContent === '6 Token');
      assert.equal(await cell.getAttribute('aria-label'), '6 Token');
      assert.equal(await node.evaluate(element => element === document.getElementById('kit-window-chart-tooltip')), true);
      assert.equal(await focus.evaluate(element => element === document.activeElement), true);
      assert.deepEqual(await tip.evaluate(element => [element.style.left, element.style.top]), position);
      assert.equal(await chart.getAttribute('data-enter-count'), entries, 'refresh does not replay entry');
      assert.equal(await tip.evaluate(element => getComputedStyle(element).opacity), '1', 'open capsule does not fade in again');
      await shot('heatmap-live-' + variant + '-' + preference + '-' + input);
      await sample.getByRole('button', { name: '移除当前格', exact: true }).evaluate(button => button.click());
      await tip.waitFor({ state: 'detached' }); assert.equal(await cell.count(), 0);
      await node.dispose(); await focus.dispose();
      await reset.evaluate(button => button.click()); await reset.focus(); await page.mouse.move(1, 1);
      await settle(page);
      if (input === 'focus') await cell.focus(); else await cell.hover();
      await tip.waitFor();
      await sample.getByRole('button', { name: '禁用当前格', exact: true }).evaluate(button => button.click());
      await tip.waitFor({ state: 'detached' }); assert.equal(await cell.getAttribute('aria-disabled'), 'true');
    }
  }
  await mode(page, 'full');
}
async function mode(page, value) { await page.evaluate(v => window.uiMotion.setPreference(v), value); await tick(page); }
async function tipCards(page, root, theme) {
  const tip = page.locator('#kit-window-chart-tooltip');
  for (const variant of ['trend', 'calendar', 'weekHour']) for (const preference of ['full', 'reduced', 'off']) {
    await mode(page, preference);
    const sample = root.locator('[data-mkb-case="tipcard-' + variant + '"]');
    const reset = sample.getByRole('button', { name: '恢复卡片数据', exact: true });
    const chart = sample.locator('[data-chart]');
    for (const input of ['focus', 'pointer']) {
      await reset.evaluate(button => button.click()); await sample.scrollIntoViewIfNeeded();
      await reset.focus(); await page.mouse.move(1, 1);
      await chart.scrollIntoViewIfNeeded();
      await until(page, new Function('return document.querySelector(\'[data-mkb-case="tipcard-' + variant + '"] [data-chart]\')?.dataset.ready === "true"'));
      await settle(page);
      const anchor = chart.locator(variant === 'trend' ? '[data-line-point="1"]' : '[data-heat-key="middle"]');
      if (input === 'focus') await anchor.focus(); else await anchor.hover();
      await tip.waitFor(); await until(page, () => getComputedStyle(document.getElementById('kit-window-chart-tooltip')).opacity === '1');
      assert.equal(await tip.count(), 1, 'one window card');
      assert.equal(await tip.locator('[data-tip-row]').count(), 3);
      assert(await tip.locator('[data-tip-row]').evaluateAll(rows => rows.every((row, index) => !index ||
        row.getBoundingClientRect().top > rows[index - 1].getBoundingClientRect().top)), 'card rows stack vertically');
      assert.match(await tip.innerText(), /未知值\s*未知/); assert.match(await tip.innerText(), /0 Token/);
      assert.equal(await tip.evaluate(element => getComputedStyle(element).borderRadius), '12px');
      const node = await tip.elementHandle(), focus = await page.locator(':focus').elementHandle();
      const position = await tip.evaluate(element => [element.style.left, element.style.top]);
      const entries = await chart.getAttribute('data-enter-count');
      await sample.getByRole('button', { name: '更新卡片读数', exact: true }).evaluate(button => button.click());
      await until(page, () => document.querySelector('#kit-window-chart-tooltip [data-tip-row]')?.textContent.includes('$6'));
      assert.equal(await node.evaluate(element => element === document.getElementById('kit-window-chart-tooltip')), true);
      assert.equal(await focus.evaluate(element => element === document.activeElement), true);
      assert.deepEqual(await tip.evaluate(element => [element.style.left, element.style.top]), position);
      assert.equal(await chart.getAttribute('data-enter-count'), entries);
      assert.equal(await tip.evaluate(element => getComputedStyle(element).opacity), '1');
      await page.screenshot({ path: path.join(output, theme + '-tipcard-' + variant + '-' + preference + '-' + input + '.png') });
      if (input === 'focus') {
        assert.equal(await page.evaluate(() => typeof window.uiMotion.cleanup), "undefined", "retired cleanup is absent");
        await page.evaluate(() => window.uiMotion.indicators()); await tick(page);
        assert.equal(await tip.isVisible(), true, 'shell indicator refresh must not mutate a React-owned card');
        await page.evaluate(() => window.scrollBy(0, -8)); await tick(page);
        assert.equal(await tip.isVisible(), true, 'keyboard card remains visible after scroll');
        assert.equal(await focus.evaluate(element => element === document.activeElement), true);
        assert.equal(await node.evaluate(element => element === document.getElementById('kit-window-chart-tooltip')), true);
      } else {
        await page.evaluate(() => window.scrollBy(0, -8)); await tip.waitFor({ state: 'detached' });
        await page.mouse.move(1, 1); await anchor.hover(); await tip.waitFor();
      }
      await sample.getByRole('button', { name: '移除卡片当前点', exact: true }).evaluate(button => button.click());
      await tip.waitFor({ state: 'detached' }); await node.dispose(); await focus.dispose();
    }
    await reset.evaluate(button => button.click()); await reset.focus(); await page.mouse.move(1, 1);
    for (const edge of ['left', 'right']) {
      const anchor = chart.locator(variant === 'trend' ? '[data-line-point="' + (edge === 'left' ? 0 : 2) + '"]' : '[data-heat-key="' + edge + '"]');
      await anchor.focus(); await tip.waitFor(); await tick(page);
      const box = await tip.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert(box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7 && box.y + box.height <= viewport.height - 7);
      if (variant === 'trend') {
        const plot = await chart.locator('svg').first().boundingBox();
        assert(box.x >= plot.x + 7 && box.x + box.width <= plot.x + plot.width - 7, 'trend card remains in plot horizontally');
        assert(box.y >= plot.y + 7 && box.y + box.height <= plot.y + plot.height - 7, 'trend card remains in plot vertically');
      }
      await page.keyboard.press('Escape'); await tip.waitFor({ state: 'detached' });
    }
  }
  const line = root.locator('[data-mkb-case="tipcard-trend"] [data-line-point="1"]');
  const heat = root.locator('[data-mkb-case="tipcard-calendar"] [data-heat-key="middle"]');
  await line.focus(); await tip.waitFor(); await heat.focus(); await tip.waitFor();
  assert.equal(await tip.count(), 1); assert.match(await tip.innerText(), /calendar middle/);
  await page.keyboard.press('Escape'); await tip.waitFor({ state: 'detached' });
  await mode(page, 'off');
}
async function mount(page) {
  await page.evaluate(() => {
    window.mkbObservers = new Set();
    for (const key of ['ResizeObserver', 'IntersectionObserver']) {
      const Native = window[key]; window['mkbNative' + key] = Native;
      window[key] = class extends Native {
        constructor(callback, options) { super(callback, options); this.mkbTargets = new Set(); }
        observe(target, options) { this.mkbTargets.add(target); window.mkbObservers.add(this); super.observe(target, options); }
        unobserve(target) { this.mkbTargets.delete(target); if (!this.mkbTargets.size) window.mkbObservers.delete(this); super.unobserve(target); }
        disconnect() { this.mkbTargets.clear(); window.mkbObservers.delete(this); super.disconnect(); }
      };
    }
    const host = document.createElement('div'); host.id = 'mkbGalleryHost'; Object.assign(host.style, { position: 'absolute', top: '0', left: '0', width: '100%', zIndex: '20' }); document.body.appendChild(host); window.mkbReview = window.agentUi.mount('kit-gallery', host);
  });
  await page.locator('[data-mkb-gallery]').waitFor(); await page.evaluate(() => document.fonts.ready); await settle(page);
}
async function unmount(page) {
  await page.evaluate(() => { window.mkbReview.unmount(); document.getElementById('mkbGalleryHost').remove(); for (const key of ['ResizeObserver', 'IntersectionObserver']) window[key] = window['mkbNative' + key]; });
  await tick(page); assert.equal(await page.evaluate(() => window.mkbObservers.size), 0, 'all gallery-owned IO/RO observers disconnected');
  assert.equal(await page.locator('#kit-window-chart-tooltip').count(), 0, 'shared tip releases its final owner');
}
async function checks(page, theme) {
  assert.deepEqual(await isolationViolations(page), [], theme + ': no legacy classes'); assert.deepEqual(await semanticViolations(page), [], theme + ': unknown is never zero or blank');
}
async function run(page, theme) {
  await setTheme(page, theme); await mode(page, 'off'); await mount(page);
  const root = page.locator('[data-mkb-gallery]'), sample = name => root.locator('[data-mkb-case="' + name + '"]');
  const shot = async name => { await page.mouse.move(1, 1); await tick(page); await page.screenshot({ path: path.join(output, theme + '-' + name + '.png') }); };
  console.log(theme + ': rings/gauge/legend');
  const ring = sample('rings').getByRole('group', { name: '圆环 dial', exact: true }); await ring.scrollIntoViewIfNeeded();
  assert.deepEqual(await ring.locator('[data-ring-key] > circle:first-child').evaluateAll(nodes => nodes.map(n => Number(n.getAttribute('r')))), [60,47,34]);
  await ring.press('ArrowRight'); assert.equal(await ring.getAttribute('data-active'), 'stale'); await ring.press('Escape'); assert.equal(await ring.getAttribute('data-active'), '');
  assert.equal(await sample('rings').getByRole('group', { name: '未知圆环', exact: true }).locator('path').count(), 0);
  for (const [name, expected] of [['单圈档位', [56]], ['双圈档位', [58,42]]]) assert.deepEqual(await sample('rings').getByRole('group', { name, exact: true }).locator('[data-ring-key] > circle:first-child').evaluateAll(nodes => nodes.map(node => Number(node.getAttribute('r')))), expected);
  const gauge = sample('gauge').getByRole('group', { name: '本月推算区间', exact: true }); await gauge.scrollIntoViewIfNeeded();
  const projection = await gauge.locator('[data-gauge="projection"]').getAttribute('d'); assert(Number(projection.match(/^M([\d.]+)/)[1]) > 120, 'projection begins at its reported lower bound, not zero');
  assert.equal(await sample('gauge').getByRole('group', { name: '未知推算', exact: true }).locator('[data-gauge]').count(), 0);
  const legend = sample('donut'); await legend.scrollIntoViewIfNeeded();
  const unpriced = legend.getByRole('button', { name: /未计入/ }); await unpriced.focus(); assert.equal(await unpriced.getAttribute('aria-disabled'), 'true'); await unpriced.press('Enter');
  const codex = legend.getByRole('button', { name: 'Codex，完整金额，切换显示', exact: true }); await codex.click(); assert.equal(await codex.getAttribute('aria-pressed'), 'false');
  const claude = legend.getByRole('button', { name: 'Claude Code', exact: true }); await claude.click(); assert.equal(await claude.getAttribute('aria-pressed'), 'true', 'last visible priced entry cannot hide'); await codex.click();
  const allowEmpty = legend.getByRole('button', { name: '可全隐藏图例', exact: true }); await allowEmpty.click(); assert.equal(await allowEmpty.getAttribute('aria-pressed'), 'false'); await allowEmpty.click();
  assert(await legend.locator('[data-donut-center]').evaluateAll(nodes => nodes.every(node => { const a = node.getBoundingClientRect(), b = node.parentElement.querySelector('svg').getBoundingClientRect(); return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 1; })), 'donut/half-donut readout remains centered inside its frame');
  await shot('donut');
  console.log(theme + ': bars/lines/shared hints');
  const strip = sample('bars').getByRole('group', { name: '柱 strip', exact: true }); await strip.scrollIntoViewIfNeeded(); await strip.locator('[data-chart-key="0"]').focus(); await strip.press('ArrowRight'); await page.keyboard.press('Enter'); assert.equal(await sample('bars').locator('[data-bar-selection]').textContent(), '1');
  assert.equal(await strip.locator('[data-state="zero"]').getAttribute('data-chart-value'), '0'); assert.equal(await strip.locator('[data-state="unobserved"]').getAttribute('data-chart-value'), 'unknown');
  assert.equal(await strip.locator('[data-state="future"] [data-chart-key]').count(), 0);
  assert.equal(await sample('bars').locator('[data-mkb-bar="days"] [data-state="unpriced"] [data-bar-shape]').getAttribute('fill'), 'none', 'unpriced daily use stays hollow');
  assert.deepEqual(await sample('bars').locator('[data-mkb-bar="hours"] [data-column-tick]').allTextContents(), ['00','06','12','18','23'], 'column tick strings remain the old UMD-provided time labels');
  assert(await sample('bars').locator('[data-mkb-bar="hours"]').evaluate(e => { const a = e.querySelector('[data-column-tick="0"]').getBoundingClientRect(), b = e.querySelector('[data-chart-key="0"]').getBoundingClientRect(); return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) < 1; }), 'hour labels use their column centres, not the quantity scale');
  await strip.locator('[data-chart-key="0"]').hover(); await until(page, () => Boolean(document.querySelector('#kit-window-chart-tooltip'))); assert.match(await page.locator('#kit-window-chart-tooltip').innerText(), /0\.000123456789/); await strip.press('Escape');
  await sample('months').getByRole('tab', { name: '分组', exact: true }).click(); assert.equal(await sample('months').locator('[data-month-projection]').count(), 0); await sample('months').getByRole('tab', { name: '堆叠', exact: true }).click(); assert.equal(await sample('months').locator('[data-month-projection]').count(), 1);
  const trend = sample('lines').getByRole('group', { name: '折线 trend', exact: true }); await trend.scrollIntoViewIfNeeded(); await trend.press('End'); await page.keyboard.press('Enter'); assert.equal(await sample('lines').locator('[data-line-applied]').textContent(), 'point:5'); assert.equal(await trend.locator('[data-missing-bridge]').count(), 1, 'only a missing date bridges; a reported unknown is a hard gap');
  const stack = sample('lines').getByRole('group', { name: '折线 stack', exact: true }); await stack.scrollIntoViewIfNeeded(); await stack.press('End'); await page.keyboard.press('Space'); assert.equal(await stack.getAttribute('data-pinned'), '5'); await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Enter'); assert.equal(await sample('lines').locator('[data-line-applied]').textContent(), '4:5'); await page.keyboard.press('Escape');
  const micro = sample('lines').getByRole('group', { name: '折线 spark', exact: true }); await micro.scrollIntoViewIfNeeded(); await micro.press('End'); assert.match(await page.locator('#kit-window-chart-tooltip').innerText(), /0\.000123456789/); await micro.press('Escape'); await shot('lines');
  assert.equal(await sample('lines').getByRole('group', { name: '全未知趋势', exact: true }).locator('[data-line-series] path').count(), 0, 'all unknown is a hard gap, never a zero line');
  console.log(theme + ': live heatmap readouts');
  await liveHeatmapReadouts(page, root, shot);
  console.log(theme + ': approved TipCard carriers and lifecycle');
  await tipCards(page, root, theme);
  await sharedLayoutOptions(page, root);
  const palette = sample('distinct-tones'); await palette.scrollIntoViewIfNeeded();
  assert.equal(await palette.locator('[data-legend-variant="inline"]').count(), 1);
  assert.deepEqual(await palette.locator('[data-legend-key] > span:first-child').evaluateAll(nodes =>
    nodes.map(node => getComputedStyle(node).backgroundColor)), [
    'rgb(89, 152, 224)', 'rgb(99, 173, 149)', 'rgb(149, 117, 223)', 'rgb(217, 171, 89)', 'rgb(221, 123, 132)',
    'rgb(93, 141, 204)', 'rgb(89, 153, 129)', 'rgb(193, 139, 83)', 'rgb(189, 121, 106)', 'rgb(145, 114, 178)',
    'rgb(87, 162, 180)', 'rgb(175, 142, 65)', 'rgb(136, 143, 172)', 'rgb(161, 119, 143)', 'rgb(114, 150, 74)',
  ], theme + ': shared discrete palette retains original colours');
  console.log(theme + ': heatmap/timeline/steps');
  const heat = sample('heatmap').getByRole('group', { name: '热力 calendar', exact: true }); await heat.scrollIntoViewIfNeeded(); await heat.locator('[data-heat-key="calendar0"]').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await heat.getAttribute('data-active'), 'calendar1'); await page.keyboard.press('ArrowDown'); assert.equal(await heat.getAttribute('data-active'), 'calendar8'); await page.keyboard.press('Space'); assert.equal(await sample('heatmap').locator('[data-heat-selection]').textContent(), 'calendar8'); assert.equal(await heat.locator('[data-heat-key="calendar2"]').getAttribute('data-level'), 'unknown'); assert.equal(await heat.locator('[data-heat-key="calendar0"]').getAttribute('data-level'), '0'); assert.equal(await page.locator('#kit-window-chart-tooltip').count(), 1); await heat.press('Escape');
  const week = sample('heatmap').getByRole('group', { name: '热力 weekHour', exact: true }); await week.locator('[data-heat-key="weekHour0"]').focus(); await page.keyboard.press('ArrowLeft'); assert.equal(await week.getAttribute('data-active'), 'weekHour23'); await page.keyboard.press('ArrowUp'); assert.equal(await week.getAttribute('data-active'), 'weekHour167'); await week.press('Escape');
  const slider = sample('timeline').getByRole('slider'); await slider.scrollIntoViewIfNeeded(); await slider.press('Home'); assert.equal(await slider.getAttribute('aria-valuenow'), '0'); await slider.press('ArrowRight'); assert.equal(await slider.getAttribute('aria-valuenow'), '3600000'); await slider.press('End'); assert.equal(await slider.getAttribute('aria-valuenow'), '86400000'); assert.match(await slider.getAttribute('aria-valuetext'), /1 个窗口已重置/); await slider.locator('[data-timeline-marker="reset6"]').press('Enter'); assert.equal(await slider.getAttribute('aria-valuenow'), '21600000'); assert.equal(await slider.locator('[data-timeline-marker="unreported"]').count(), 0);
  const steps = sample('steps').getByRole('group'); await steps.scrollIntoViewIfNeeded(); assert.equal(await steps.locator('[data-step-at]').count(), 2); assert.equal(await steps.locator('[data-packs="3"]').count(), 1); await steps.locator('[data-chart-key="soon"]').focus(); await page.keyboard.press('ArrowRight'); assert.equal(await steps.getAttribute('data-active'), 'later'); await steps.press('Escape'); await shot('timeline-steps');
  console.log(theme + ': carousel/sort/card/reveal/panes');
  const carousel = sample('carousel').getByRole('region', { name: '合成首屏', exact: true }); await carousel.scrollIntoViewIfNeeded(); await carousel.getByRole('button', { name: '下一页', exact: true }).click(); assert.equal(await carousel.getAttribute('data-index'), '1'); assert.equal(await carousel.locator('[data-carousel-slide="now"]').evaluate(e => e.inert), true); await carousel.getByRole('button', { name: '接下来', exact: true }).press('ArrowRight'); assert.equal(await carousel.getAttribute('data-index'), '2'); await carousel.getByRole('button', { name: '上一页', exact: true }).click();
  const sortable = sample('sortable'); await sortable.scrollIntoViewIfNeeded(); const a = sortable.getByRole('listitem', { name: '排序 a', exact: true }); await a.press('Alt+ArrowRight'); assert.equal(await sortable.locator('[data-sort-order]').textContent(), 'bacd'); assert.equal(await a.evaluate(e => e === document.activeElement), true); await sortable.getByText('项目 a', { exact: true }).click(); assert.equal(await sortable.locator('[data-card-count]').textContent(), '1'); await sortable.getByRole('button', { name: '独立动作 a', exact: true }).click(); assert.equal(await sortable.locator('[data-card-count]').textContent(), '1'); assert.equal(await sortable.locator('[data-card-button-count]').textContent(), '1');
  const reveal = sample('reveal-ticket').getByRole('button', { name: '完整费用上下界', exact: true }); await reveal.focus(); assert.equal(await reveal.getAttribute('aria-expanded'), 'true'); assert.match(await page.getByRole('tooltip').innerText(), /0\.000123456789/); await reveal.press('Escape'); assert.equal(await reveal.getAttribute('aria-expanded'), 'false');
  const panes = sample('panes'); await panes.scrollIntoViewIfNeeded(); await panes.getByRole('tab', { name: '订阅对照', exact: true }).click(); assert.match(await panes.innerText(), /订阅内容/); await panes.getByRole('button', { name: '把花在哪放大到整行', exact: true }).click(); assert.equal(await panes.locator('[data-pane="months"]').getAttribute('data-collapsed'), 'true'); await shot('panes');
  console.log(theme + ': calendars/side sheets');
  const calendar = sample('calendars').getByRole('grid', { name: '两次提交日历', exact: true }); await calendar.scrollIntoViewIfNeeded(); const oldDates = await sample('calendars').locator('[data-calendar-result]').textContent(); await calendar.getByRole('gridcell', { name: '2026-10-08', exact: true }).click(); assert.equal(await sample('calendars').locator('[data-calendar-result]').textContent(), oldDates); await calendar.getByRole('gridcell', { name: '2026-10-10', exact: true }).click(); assert.equal(await sample('calendars').locator('[data-calendar-result]').textContent(), '2026-10-08:2026-10-10');
  const dateButton = sample('calendars').getByRole('button', { name: '趋势时间范围：合成完整日期', exact: true }); assert.equal(await dateButton.innerText(), '累计'); await dateButton.click(); const popover = page.locator('[data-date-range-popover]'); await popover.waitFor(); assert.equal(await popover.locator('[data-calendar-day="2026-10-20"]').getAttribute('data-marked'), 'true'); await page.keyboard.press('PageUp'); assert.equal(await page.evaluate(() => document.activeElement.dataset.calendarDay), '2026-09-26'); await popover.getByRole('button', { name: '下个月', exact: true }).click(); await popover.getByRole('gridcell', { name: '2026-10-08', exact: true }).click(); await popover.getByRole('gridcell', { name: '2026-10-10', exact: true }).click(); await popover.getByRole('button', { name: '应用', exact: true }).click(); assert.equal(await sample('calendars').locator('[data-draft-result]').textContent(), '2026-10-08:2026-10-10:page'); assert.equal(await dateButton.evaluate(e => e === document.activeElement), true);
  for (const side of ['left', 'right']) { const opener = sample('sheet-tree-edge').getByRole('button', { name: '打开 ' + side + ' Sheet', exact: true }); await opener.click(); const sheet = page.getByRole('dialog', { name: '合成侧边 Sheet', exact: true }); await page.waitForFunction(value => { const e = document.querySelector('[data-sheet-placement="' + value + '"]'); const box = e?.getBoundingClientRect(); return e && e.dataset.state === "open" && getComputedStyle(e).opacity === "1" && box.height > 800 && Math.abs(value === "left" ? box.left : innerWidth - box.right) < 1; }, side, { timeout: 8000 }); const bounds = await sheet.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight })); assert(Math.abs(bounds.width - (side === 'left' ? 540 : 400)) < 1); assert(Math.abs((side === 'left' ? bounds.x : viewport.width - bounds.x - bounds.width)) < 1); assert(await sheet.locator('[data-sheet-footer]').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight)); await shot('sheet-' + side); await sheet.getByRole('button', { name: '完成', exact: true }).click(); assert.equal(await opener.evaluate(e => e === document.activeElement), true); }
  assert.equal(await sample('sheet-tree-edge').locator('[data-list-branch]').count(), 1);
  await motionAndGestures(page, root, theme, shot); await checks(page, theme); await unmount(page);
}
(async () => { const session = await launch(), { page, errors } = session; try { for (const theme of ['light', 'dark']) await run(page, theme); assert.deepEqual(errors, [], 'no page/console errors, including CSP'); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ themes: ['light','dark'], errors }, null, 2)); console.log('PASS: MK-b gallery, controlled charts, unknown/zero, keyboard, focus, tooltip ownership and side sheets.'); } catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, errors }, null, 2)); throw error; } finally { await session.close(); } })().catch(error => { console.error(error.stack); process.exitCode = 1; });
