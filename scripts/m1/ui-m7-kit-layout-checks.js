'use strict';
/* global document, getComputedStyle, KeyboardEvent */
const assert = require('node:assert/strict');
const { settle } = require('./ui-settle');
async function sharedLayoutOptions(page, root) {
  const sample = root.locator('[data-mkb-case="layout-options"]');
  await sample.scrollIntoViewIfNeeded();
  const radios = sample.getByRole('radio');
  const colours = await radios.locator('[data-swatch-dot]').evaluateAll(dots => dots.map(dot => getComputedStyle(dot).fill));
  assert.deepEqual(colours, ['rgb(217, 130, 74)', 'rgb(95, 129, 189)', 'rgb(95, 150, 114)', 'rgb(138, 144, 153)']);
  assert(await radios.evaluateAll(buttons => buttons.every(button => {
    const rect = button.getBoundingClientRect(); return rect.width === 36 && rect.height === 36;
  })));
  for (const preference of ['full', 'reduced', 'off']) {
    await page.evaluate(value => window.uiMotion.setPreference(value), preference);
    await radios.first().click(); await radios.first().press('ArrowRight');
    assert.equal(await sample.locator('[data-swatch-value]').textContent(), 'blue');
    assert.equal(await radios.nth(1).evaluate(button => button === document.activeElement), true);
    await radios.nth(1).press('End');
    assert.equal(await radios.last().getAttribute('aria-checked'), 'true');
    await radios.last().evaluate(button => button.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Home', isComposing: true, bubbles: true,
    })));
    assert.equal(await radios.last().getAttribute('aria-checked'), 'true', 'IME key must not change palette');
    await radios.last().press('Home'); await settle(page);
    assert.equal(await radios.first().getAttribute('tabindex'), '0');
    assert.equal(await radios.first().locator('[data-swatch-ring]').evaluate(ring => Number(getComputedStyle(ring).opacity)), 1);
    assert.equal(await radios.first().locator('[data-swatch-dot]').getAttribute('r'), '8');
    assert.equal(await radios.first().locator('[data-swatch-ring]').getAttribute('r'), '12.5');
  }
  const chart = sample.getByRole('group', { name: '适宽方格', exact: true });
  const geometry = await chart.evaluate(element => {
    const cells = [...element.querySelectorAll('[data-heat-key]')].map(cell => cell.getBoundingClientRect());
    const labels = [...element.querySelectorAll('[data-heat-col-label]')].map(label => label.getBoundingClientRect());
    return { count: cells.length, square: cells.every(cell => cell.width > 0 && Math.abs(cell.width - cell.height) < .01),
      fits: element.scrollWidth <= element.clientWidth,
      bottom: labels.every(label => label.top > Math.max(...cells.map(cell => cell.bottom))) };
  });
  assert.deepEqual(geometry, { count: 168, square: true, fits: true, bottom: true });
  // Fluid's compact cell is 28px; the collapsed row includes its existing 1px separator.
  assert.equal(await sample.locator('tbody tr').evaluate(row => row.getBoundingClientRect().height), 29);
  assert.match(await sample.locator('tbody td').evaluate(cell => getComputedStyle(cell).fontVariationSettings), /550/);
  assert.equal(await sample.locator('[data-list-branch]').count(), 1);
  const gridCalendar = sample.getByRole('group', { name: '按格导航日历', exact: true });
  await gridCalendar.locator('[data-heat-key="8"]').focus();
  for (const [key, target] of [['ArrowLeft', '1'], ['ArrowUp', '0'], ['ArrowRight', '7'], ['End', '97'], ['Home', '0']]) {
    await page.keyboard.press(key);
    assert.equal(await gridCalendar.locator(':focus').getAttribute('data-heat-key'), target);
  }
  await page.keyboard.press('Escape');
  const original = root.locator('[data-mkb-case="heatmap"] [data-variant="weekHour"]');
  const originalCell = original.locator('[data-heat-key]').first();
  assert.deepEqual(await originalCell.evaluate(cell => [Number(cell.getAttribute('width')), Number(cell.getAttribute('height'))]), [24, 20]);
  assert.equal(await original.getAttribute('data-col-labels-position'), 'top');
  await page.evaluate(() => window.uiMotion.setPreference('full'));
}
module.exports = { sharedLayoutOptions };
