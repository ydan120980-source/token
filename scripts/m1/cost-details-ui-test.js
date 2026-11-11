'use strict';
/* global document, getComputedStyle */
// The owner's three cost page details (2026-11-04): the calendar is a small popover from its button, only the Agents
// scroll under the ring, and the cache card has no empty space below its list. Synthetic seeded home only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch, setTheme } = require('./ui-smoke');
const { settle, until } = require('./ui-settle');
const c = require('./cost-ui-helpers');
const output = process.env.COST_DETAILS_EVIDENCE_DIR || 'artifacts/ui-cost-details';
const box = locator => locator.evaluate(element => { const rect = element.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; });

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const agents = ['codex', 'claude', 'deepseek', 'antigravity', 'gemini', 'opencode', 'workbuddy', 'mimo', 'zcode', 'cursor', 'kimi', 'qwen'];
  const session = await launch({ size: [1480, 960], seed: { agents } }), { page, errors } = session;
  try {
    await c.openCost(page); await settle(page);

    // A small panel under its button, not a sheet across the window.
    const trigger = c.root(page).getByRole('button', { name: '用日历选择范围', exact: true });
    await trigger.click(); const panel = page.locator('[data-cost-range-sheet]'); await panel.waitFor(); await settle(page);
    const anchored = await box(panel), from = await box(trigger);
    assert(anchored.width <= 320, 'small: ' + anchored.width);
    assert(anchored.height < 620, 'short: ' + anchored.height);
    assert(anchored.top >= from.bottom && anchored.top - from.bottom <= 12, 'right under its button');
    assert.equal(await page.locator('[data-sheet-body]').count(), 0, 'no sheet');
    assert.equal(await page.locator('[data-edge-trigger]').count(), 0, 'no edge trigger left over');
    assert.equal(await panel.locator('[data-calendar-day][tabindex="0"]').evaluate(element => element === document.activeElement), true, 'the keyboard starts on a day');
    // Round end caps and today in its colour, and the band is continuous across the row.
    const end = panel.locator('[data-calendar-day][aria-selected="true"] > span.rounded-full').first();
    assert.equal(await end.evaluate(element => getComputedStyle(element).borderRadius !== '0px'), true);
    for (const theme of ['light', 'dark']) { await setTheme(page, theme); await settle(page); await page.screenshot({ path: path.join(output, 'calendar-' + theme + '.png') }); }
    await setTheme(page, 'light');
    // Pressing outside closes it and the page behind took no dialog scrim.
    await page.mouse.click(600, 880); await until(page, () => !document.querySelector('[data-cost-range-sheet]'));
    // Its own button toggles it, rather than closing and reopening.
    await trigger.click(); await panel.waitFor(); await trigger.click(); await until(page, () => !document.querySelector('[data-cost-range-sheet]'));

    // Only the Agents scroll: wheel over the list, and the ring stays where it was.
    const composition = page.locator('[data-cost-composition]'); await composition.scrollIntoViewIfNeeded(); await settle(page);
    const ring = composition.locator('[data-chart="ring"]'), scroller = composition.locator('[data-cost-composition-agents] [data-radix-scroll-area-viewport], [data-cost-composition-agents] .ff-scroll-fade').first();
    const list = await scroller.evaluate(element => ({ can: element.scrollHeight > element.clientHeight + 1, overflow: getComputedStyle(element).overflowY }));
    assert(list.can, 'twelve Agents overflow the fixed pane');
    const before = await box(ring), page0 = await page.evaluate(() => document.querySelector('[data-pane="where"] [data-pane-body]').parentElement.scrollTop);
    const at = await box(scroller); await page.mouse.move(at.left + at.width / 2, at.top + at.height / 2); await page.mouse.wheel(0, 160); await settle(page);
    assert((await scroller.evaluate(element => element.scrollTop)) > 0, 'the list moved');
    const after = await box(ring);
    assert.equal(Math.round(after.top), Math.round(before.top), 'the ring did not move');
    assert.equal(await page.evaluate(() => document.querySelector('[data-pane="where"] [data-pane-body]').parentElement.scrollTop), page0);
    await page.screenshot({ path: path.join(output, 'composition.png') });

    // The cache list reaches the bottom of its card, level with the coverage card, and holds every model.
    const cacheCard = page.locator('[data-cost-cache]'); await cacheCard.scrollIntoViewIfNeeded(); await settle(page);
    const cacheBox = await box(cacheCard), coverageBox = await box(page.locator('[data-cost-coverage]')), listBox = await box(page.locator('[data-cost-cache-list]'));
    assert.equal(Math.round(cacheBox.bottom), Math.round(coverageBox.bottom), 'the two cards are one height');
    assert(cacheBox.bottom - listBox.bottom <= 32, 'no empty space below the list: ' + (cacheBox.bottom - listBox.bottom));
    assert.equal(await page.locator('[data-cost-cache]').getByRole('button', { name: /^查看全部/ }).count(), 0);
    assert.equal(await page.locator('[data-cost-cache-row]').count(), await page.evaluate(() => window.costHost.get().view.cache.models.length));
    await page.screenshot({ path: path.join(output, 'cache.png') });

    // A cost detail shows each day's cost, with its Token in the readout, and can turn to Token.
    await page.locator('[data-cost-table] tr[data-row-key]:first-child button').first().click();
    const trend = page.locator('[data-cost-detail-trend]'); await trend.waitFor(); await settle(page);
    assert.match(await trend.innerText(), /每日费用/);
    const plot = await box(trend.locator('svg').first()); await page.mouse.move(plot.left + plot.width * 0.6, plot.top + plot.height / 2); await settle(page);
    assert.match(await trend.innerText(), /[0-9]{4}-[0-9]{2}-[0-9]{2} · [$][0-9.,]+.* · .* Token/, 'the day reads both');
    await page.screenshot({ path: path.join(output, 'detail-cost.png') });
    await page.mouse.move(5, 5); await trend.locator('[data-cost-detail-metric]').getByRole('tab', { name: 'Token', exact: true }).click(); await settle(page);
    assert.match(await trend.innerText(), /每日 Token/);
    await page.keyboard.press('Escape'); await settle(page);

    assert.deepEqual(errors, [], 'no console or page errors');
    console.log('PASS cost details');
  } finally { await session.close(); }
})().catch(error => { console.error(error); process.exit(1); });
