'use strict';
/* global document, requestAnimationFrame, PointerEvent, getComputedStyle */
const assert = require('node:assert/strict');
const { until } = require('./ui-settle');
const geometrySelector = '[data-ring-key="short"] > path,[data-gauge],[data-month-series],[data-line-series] path';
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function mode(page, value) { await page.evaluate(v => window.uiMotion.setPreference(v), value); await tick(page); }
async function geometry(root) { return root.locator(geometrySelector).evaluateAll(nodes => nodes.map(node => node.getAttribute('d'))); }
async function motionAndGestures(page, root, theme, shot) {
  console.log(theme + ': reduced/off, retarget and pointer gestures');
  const sample = name => root.locator('[data-mkb-case="' + name + '"]'), update = sample('update').getByRole('button', { name: '更新图表数值', exact: true });
  await mode(page, 'off'); await update.scrollIntoViewIfNeeded(); await tick(page);
  assert.equal(await sample('update').locator('[data-mkb-value]').textContent(), '30'); const at30 = await geometry(root);
  await update.click(); await tick(page); const at75 = await geometry(root); assert.notDeepEqual(at75, at30, 'same chart changes its reported geometry');
  await update.click(); await tick(page); assert.deepEqual(await geometry(root), at30);
  for (const value of ['reduced', 'off']) {
    await mode(page, value); await update.click(); await tick(page); assert.deepEqual(await geometry(root), at75, value + ': geometry is already the final 75 target');
    await update.click(); await tick(page); assert.deepEqual(await geometry(root), at30, value + ': geometry is already the final 30 target');
    const carousel = sample('carousel').getByRole('region', { name: '合成首屏', exact: true }); await carousel.scrollIntoViewIfNeeded(); await carousel.getByRole('button', { name: '下一页', exact: true }).click(); await tick(page);
    assert.equal(await carousel.getAttribute('data-index'), '2'); assert(await carousel.evaluate(e => { const viewport = e.firstElementChild, current = e.querySelector('[data-carousel-slide="wallet"]'); return Math.abs(viewport.getBoundingClientRect().height - current.getBoundingClientRect().height) < 1 && Math.abs(current.getBoundingClientRect().left - viewport.getBoundingClientRect().left) < 1; }), value + ': carousel position and height final');
    await carousel.getByRole('button', { name: '上一页', exact: true }).click();
    const opener = sample('sheet-tree-edge').getByRole('button', { name: '打开 left Sheet', exact: true }); await opener.click(); const sheet = page.getByRole('dialog', { name: '合成侧边 Sheet', exact: true });
    await page.waitForFunction(() => { const e = document.querySelector('[data-sheet-placement="left"][data-state="open"]'); return e && getComputedStyle(e).opacity === '1' && Math.abs(e.getBoundingClientRect().left) < 1; });
    const header = await sheet.locator('[data-sheet-drag]').boundingBox(), point = { x: header.x + header.width / 2, y: header.y + header.height / 2 };
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x - 60, point.y, { steps: 5 });
    await sheet.evaluate(e => e.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))); await page.mouse.up(); await tick(page);
    assert.equal(await sheet.getAttribute('data-state'), 'open'); assert(Math.abs((await sheet.boundingBox()).x) < 1, value + ': cancelled sheet drag restores position immediately');
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.move(point.x - 230, point.y, { steps: 8 }); await page.mouse.up();
    await until(page, () => !document.querySelector('[data-sheet-placement="left"][data-state="open"]'));
    await page.waitForFunction(() => document.activeElement?.textContent.includes('打开 left Sheet')); await shot('gestures-' + value);
  }
  // Long press: moving before pickup cancels it; Escape after pickup restores
  // the original order and suppresses the eventual mouseup click.
  await mode(page, 'off'); const sorting = sample('sortable'); await sorting.scrollIntoViewIfNeeded();
  const a = sorting.getByRole('listitem', { name: '排序 a', exact: true }), c = sorting.getByRole('listitem', { name: '排序 c', exact: true });
  const before = await sorting.locator('[data-sort-order]').textContent(), count = await sorting.locator('[data-card-count]').textContent();
  let box = await a.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 10, box.y + 20); await page.waitForTimeout(380); assert.equal(await sorting.locator('[data-sortable]').getAttribute('data-picked'), ''); await page.mouse.up();
  // Restore the click counter baseline after a normal, non-picked press.
  const afterPlainPress = await sorting.locator('[data-card-count]').textContent(); assert(Number(afterPlainPress) >= Number(count));
  box = await a.boundingBox(); const target = await c.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down(); await until(page, () => document.querySelector('[data-sortable]')?.dataset.picked === 'a'); await page.mouse.move(target.x + target.width / 2, target.y + 20, { steps: 10 }); await page.keyboard.press('Escape'); await page.mouse.up(); await tick(page);
  assert.equal(await sorting.locator('[data-sort-order]').textContent(), before); assert.equal(await sorting.locator('[data-card-count]').textContent(), afterPlainPress, 'Escape pickup cancellation suppresses following click');
  box = await a.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down(); await until(page, () => document.querySelector('[data-sortable]')?.dataset.picked === 'a'); await page.mouse.move(target.x + target.width / 2, target.y + 20, { steps: 10 }); await page.mouse.up(); await tick(page);
  assert.notEqual(await sorting.locator('[data-sort-order]').textContent(), before, 'drop commits real grid order'); assert.equal(await sorting.locator('[data-card-count]').textContent(), afterPlainPress, 'drop does not open card');
  const afterDrop = await sorting.locator('[data-sort-order]').textContent(); box = await a.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down(); await until(page, () => document.querySelector('[data-sortable]')?.dataset.picked === 'a'); await page.mouse.move(box.x + box.width / 2 + 30, box.y + 40); await sorting.locator('[data-sortable]').evaluate(e => e.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))); await page.mouse.up(); await tick(page); assert.equal(await sorting.locator('[data-sort-order]').textContent(), afterDrop); assert.equal(await sorting.locator('[data-card-count]').textContent(), afterPlainPress, 'pointercancel restores without card action');
  const carousel = sample('carousel').getByRole('region', { name: '合成首屏', exact: true }); await carousel.scrollIntoViewIfNeeded(); await carousel.getByRole('button', { name: '上一页', exact: true }).click(); assert.equal(await carousel.getAttribute('data-index'), '0');
  const ignore = await carousel.locator('[data-carousel-ignore]').boundingBox(); await page.mouse.move(ignore.x + ignore.width / 2, ignore.y + ignore.height / 2); await page.mouse.down(); await page.mouse.move(ignore.x + ignore.width / 2 - 180, ignore.y + ignore.height / 2, { steps: 8 }); await page.mouse.up(); assert.equal(await carousel.getAttribute('data-index'), '0', 'ignored chart gesture never flips page');
  const viewport = await carousel.locator('[data-carousel-slide="now"]').boundingBox(); await page.mouse.move(viewport.x + viewport.width * .75, viewport.y + 8); await page.mouse.down(); await page.mouse.move(viewport.x + viewport.width * .45, viewport.y + 8, { steps: 8 }); await page.mouse.up(); await tick(page); assert.equal(await carousel.getAttribute('data-index'), '1', 'plain horizontal drag flips page'); await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + 8); await page.mouse.wheel(60, 0); await tick(page); assert.equal(await carousel.getAttribute('data-index'), '2', 'horizontal wheel flips once');
  // The common data.update tier must retarget the drawn curve rather than
  // replay its first entry. An explicit dataKey alone starts a new entry.
  await mode(page, 'full'); await update.scrollIntoViewIfNeeded(); await tick(page); const ring = sample('rings').getByRole('group', { name: '圆环 dial', exact: true }); const entered = Number(await ring.getAttribute('data-enter-count'));
  await update.click(); await page.waitForTimeout(80); const middle = await geometry(root); assert.notDeepEqual(middle, at30); assert.notDeepEqual(middle, at75);
  await update.click(); await page.evaluate(([selector, target]) => { window.mkbGeometrySelector = selector; window.mkbGeometryTarget = target; }, [geometrySelector, at30]);
  await until(page, () => JSON.stringify([...document.querySelectorAll('[data-mkb-gallery] ' + window.mkbGeometrySelector.split(',').join(',[data-mkb-gallery] '))].map(e => e.getAttribute('d'))) === JSON.stringify(window.mkbGeometryTarget));
  assert.equal(Number(await ring.getAttribute('data-enter-count')), entered, 'refresh does not replay entry');
  await sample('update').getByRole('button', { name: '切换图表数据键', exact: true }).click(); await until(page, () => { const e = document.querySelector('[aria-label="圆环 dial"]'); return e.dataset.ready === 'true'; }); assert.equal(Number(await ring.getAttribute('data-enter-count')), entered + 1);
  await page.setViewportSize({ width: 720, height: 900 }); await tick(page); assert.equal(Number(await ring.getAttribute('data-enter-count')), entered + 1, 'resize does not replay entry');
  await sample('panes').scrollIntoViewIfNeeded(); assert.equal(await sample('panes').locator('[data-pane-group]').getAttribute('data-narrow'), 'true'); assert.equal(await sample('panes').locator('[data-pane][data-collapsed]').count(), 0, 'narrow panes show both contents'); await shot('narrow');
  await page.setViewportSize({ width: 1280, height: 900 }); await update.scrollIntoViewIfNeeded(); await tick(page);
  await shot('full-retarget'); await mode(page, 'off');
}
module.exports = { motionAndGestures };
