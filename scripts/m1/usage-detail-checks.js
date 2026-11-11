'use strict';
/* global document, requestAnimationFrame, innerWidth, innerHeight, getComputedStyle, scrollY */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { settle } = require('./ui-settle');
const usage = require('./usage-ui-helpers');
async function usageDetailChecks(page, app, { scale, output, errors, openSettings, pickSelect }) {
  await settle(page);
  const price = page.locator('[data-usage-total-cost] button'), boundsNode = page.locator('[data-usage-total-cost] [data-usage-price-lower]');
  assert.equal(await page.locator('#costDialog').count(), 0);
  const lower = Number(await boundsNode.getAttribute('data-usage-price-lower'));
  const upper = Number(await boundsNode.getAttribute('data-usage-price-upper'));
  assert(upper > lower);
  const tooltip = page.locator('[data-ui-portal] [role=tooltip]');
  await usage.hover(page, price); await tooltip.waitFor(); await settle(page);
  const upperLabel = await page.evaluate(value => window.displayValues.usd(value), upper);
  assert((await tooltip.innerText()).includes(upperLabel), 'exact upper bound in shared Reveal');
  assert.equal(await price.getAttribute('aria-expanded'), 'true');
  await page.screenshot({ path: path.join(output, 'inline-price-' + scale + '.png') });
  await page.mouse.move(5, 5); await price.blur(); await tooltip.waitFor({ state: 'detached' });
  assert.equal(await price.getAttribute('aria-expanded'), 'false');
  await price.focus(); await tooltip.waitFor(); assert.equal(await price.getAttribute('aria-expanded'), 'true');
  await price.press('Escape');
  // M10 removes the fade when a new digit count re-keys Figure. Exercise rolling between
  // today's and seven days' equal-width readings, after today's digits have settled.
  await page.evaluate(() => { window.uiMotion.setPreference('full'); window.usageHost.set({ period: 'today' }); });
  await page.waitForTimeout(1100);
  const beforeRolling = await usage.value(page, 'totalTokens');
  const frames = await page.evaluate(async () => {
    const samples = [], start = performance.now();
    window.usageHost.set({ period: '7' });
    while (performance.now() - start < 1100) {
      const root = document.querySelector('[data-usage-total-tokens]');
      samples.push({ columns: [...root.querySelectorAll('span.absolute')].map(column => getComputedStyle(column).transform),
        opacity: getComputedStyle(root.querySelector('[aria-label]')).opacity });
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return samples;
  });
  const expected = await page.evaluate(() => window.usageHost.get().view.hero.tokens);
  assert.notEqual(beforeRolling, expected, 'the synthetic range change alters the reading');
  assert.equal(beforeRolling.replace(/\d/g, '#'), expected.replace(/\d/g, '#'), 'the rolling scenario keeps the same formatted digit places');
  assert.equal(await usage.value(page, 'totalTokens'), expected);
  assert(frames.length > 2 && frames.some(frame => frame.columns.length > 0), 'real Figure digit columns sampled');
  assert(frames.every(frame => frame.columns.every(transform => !/NaN|Infinity/.test(transform))), 'rolling geometry is finite');
  const variations = new Set(frames.map(frame => JSON.stringify(frame)));
  assert(variations.size > 1, 'full motion changes rendered digits');
  for (const range of ['7', '30', 'all', 'today', 'all']) await usage.period(page, range);
  assert.equal(await usage.value(page, 'totalTokens'), await page.evaluate(() => window.usageHost.get().view.hero.tokens));
  await usage.more(page);
  const trigger = usage.root(page).getByRole('button', { name: '用量模型筛选', exact: true });
  const menu = page.locator('[data-ui-portal] [role=menu]'), search = menu.locator('input');
  await trigger.click(); await settle(page); await search.fill('model-99'); await settle(page);
  assert.equal(await menu.getByRole('menuitemradio').count(), 1);
  await search.press('ArrowDown');
  const searchKeyTrace = await page.evaluate(() => ({ focus: document.activeElement?.outerHTML,
    model: window.usageHost.filters().model, choices: window.usageHost.get().view.models }));
  await page.keyboard.press('Enter'); await settle(page);
  if (await page.evaluate(() => window.usageHost.filters().model) !== 'model-99') {
    fs.writeFileSync(path.join(output, 'model-keyboard-failure-' + scale + '.json'), JSON.stringify({ before: searchKeyTrace,
      after: await page.evaluate(() => ({ focus: document.activeElement?.outerHTML, model: window.usageHost.filters().model,
        menu: document.querySelector('[data-ui-portal] [role=menu]')?.outerHTML })) }, null, 2));
    await page.screenshot({ path: path.join(output, 'model-keyboard-failure-' + scale + '.png') });
  }
  assert.equal(await page.evaluate(() => window.usageHost.filters().model), 'model-99');
  assert.equal(await trigger.evaluate(button => button === document.activeElement), true);
  await trigger.click(); await settle(page); await search.fill('不存在的模型'); await settle(page);
  assert.equal(await menu.getByRole('menuitemradio').count(), 0); await search.press('Escape');
  await menu.waitFor({ state: 'detached' });
  await usage.select(page, 'model', 'all');
  const palette = page.locator('[data-usage-palette] [aria-checked=true]');
  await palette.focus(); await palette.press('End');
  assert.equal(await page.locator('[data-swatch-key=mono]').evaluate(button => button === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.usageHost.get().state.palette), 'mono');
  await trigger.click(); await settle(page);
  const bounds = await menu.boundingBox(), viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  fs.writeFileSync(path.join(output, 'menu-geometry-' + scale + '.json'), JSON.stringify({ bounds, viewport }, null, 2));
  await page.screenshot({ path: path.join(output, 'model-menu-' + scale + '.png') });
  // Current fluid/Radix placement has zero collision padding. Keep its existing geometry;
  // allow half a CSS pixel for the measured fractional outer edge, never clipped content.
  assert(bounds.height <= 480.1 && bounds.y >= -.5, 'current shared dropdown maximum and viewport boundary');
  assert(bounds.y + bounds.height <= viewport.height + .5);
  await page.screenshot({ path: path.join(output, 'model-menu-' + scale + '.png') }); await search.press('Escape');
  await usage.calendarCells(page).last().press('Enter'); await settle(page);
  const day = page.locator('[data-usage-day]');
  const unknown = day.locator('[data-usage-clients] [data-usage-price-lower=""]').first();
  assert.equal((await usage.text(unknown)).trim(), '未定价');
  assert.equal((await usage.text(unknown)).includes('+'), false);
  const inset = await day.evaluate(card => {
    const outer = card.getBoundingClientRect(), table = card.querySelector('table').getBoundingClientRect();
    return { left: table.left - outer.left, right: outer.right - table.right };
  });
  assert(inset.left >= 18 && inset.right >= 18);
  await day.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, 'day-spacing-' + scale + '.png') });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const scrolling = await page.evaluate(async () => {
    const start = scrollY; window.usageUi.locate('day');
    const samples = [];
    for (let i = 0; i < 6; i++) { await new Promise(resolve => requestAnimationFrame(resolve)); samples.push(scrollY); }
    return { start, samples };
  });
  assert(scrolling.samples.some(value => value > scrolling.start), 'real smooth navigation starts');
  const wheelPosition = page.evaluate(() => new Promise(resolve =>
    window.addEventListener('wheel', () => resolve(scrollY), { once: true, capture: true })));
  await page.mouse.wheel(0, -20);
  const atWheel = await wheelPosition;
  const stopped = await page.evaluate(async () => {
    const samples = [];
    for (let index = 0; index < 20; index++) {
      await new Promise(resolve => requestAnimationFrame(resolve)); samples.push(scrollY);
    }
    return samples;
  });
  assert(stopped.at(-1) <= atWheel + 2, 'wheel interrupts forward smooth navigation');
  assert(Math.max(...stopped.slice(-4)) - Math.min(...stopped.slice(-4)) < 2, 'interrupted page reaches rest');
  await openSettings(page); await pickSelect(page.locator('[data-settings-page]'), page, '界面动效', '减少动态');
  await usage.openUsage(page); await usage.period(page, 'today');
  assert.equal(await usage.value(page, 'totalTokens'), await page.evaluate(() => window.usageHost.get().view.hero.tokens));
  assert.equal(await page.locator('[data-usage-total-tokens] span.absolute').count(), 0, 'reduced mode uses direct values');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.evaluate(() => window.uiMotion.setPreference('system'));
  assert.equal(await page.locator('body').getAttribute('data-motion'), 'reduced');
  await page.locator('#theme').click(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
  await settle(page); await usage.more(page); await trigger.click(); await settle(page);
  const narrow = await menu.boundingBox();
  assert(narrow.x >= -.5 && narrow.x + narrow.width <= await page.evaluate(() => innerWidth) + .5);
  assert(narrow.y >= -.5 && narrow.y + narrow.height <= await page.evaluate(() => innerHeight) + .5);
  await page.screenshot({ path: path.join(output, 'dark-narrow-menu-' + scale + '.png') }); await search.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  return { scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), inlineRange: { lower, upper }, numberFrames: frames.length,
    retarget: true, searchAndKeyboard: true, menuMaxHeight: bounds.height, detailInset: inset, scrollInterruption: true,
    reducedAndSystemPreference: true, darkNarrow: true, noErrors: true, realLogin: false };
}
module.exports = { usageDetailChecks };
