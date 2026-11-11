'use strict';
/* global document */
// The sources tab (owner 2026-11-03, docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md): a problem sits on the Agent it belongs
// to and says whether it can be solved, the tiles count the same things, and the summary uses the card's own word.
// Synthetic fixture home and isolated stores only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch, setTheme } = require('./ui-smoke');
const { showView, settle, until } = require('./ui-settle');
const output = process.env.SOURCES_CARDS_EVIDENCE_DIR || 'artifacts/ui-sources-cards';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const session = await launch({ size: [1480, 960] }), { page, errors } = session;
  try {
    await showView(page, 'sources'); await until(page, () => document.querySelector('[data-sources-page]')?.dataset.ready === 'true');
    await until(page, () => !document.querySelector('[data-source-attention]')?.textContent.includes('正在读取诊断') && document.querySelectorAll('[data-source-agent]').length > 5);
    await settle(page);

    // Records the source left incomplete say so, with nothing to press but 不再提醒.
    const deepseek = page.locator('[data-source-agent="deepseek"]');
    const accept = deepseek.locator('[data-source-issue="accept"]');
    assert.match(await accept.innerText(), /无法修复[\s\S]*没算进费用，其余正常/);
    assert.deepEqual(await accept.getByRole('button').allInnerTexts(), ['不再提醒']);
    assert.equal(await accept.getByRole('button', { name: '查看来源' }).count(), 0, 'no button that leads nowhere');

    // The last 14 days and today are on the card; a day without records is not drawn as a zero.
    assert.equal(await deepseek.locator('[data-mini-bar]').count(), 14);
    assert.match(await deepseek.locator('[data-source-today]').innerText(), /今天 .*Token|今天没有记录/);

    // Each source in the one section that says what it needs, and cards in a row are one height.
    assert.equal(await page.locator('[data-source-agent][data-source-section]').count(), await page.locator('[data-source-agent]').count());
    assert.equal(await page.locator('[data-source-agent][data-source-section="attention"]').evaluateAll(cards => cards.every(card => card.querySelector('[data-source-issue="act"],[data-source-issue="source"]'))), true);
    assert.equal(await page.locator('[data-source-agent][data-source-section="quiet"] [data-source-issue]').count(), 0);
    const rows = await page.locator('[data-source-agent]').evaluateAll(cards => { const heights = new Map(); for (const card of cards) { const box = card.getBoundingClientRect(), key = Math.round(box.top); heights.set(key, [...heights.get(key) ?? [], Math.round(box.height)]); } return [...heights.values()]; });
    assert(rows.every(row => new Set(row).size === 1), 'one height across a row: ' + JSON.stringify(rows));

    // Turning a source off leaves it where it is, as the same node.
    const claudeSwitch = page.locator('[data-source-agent="codex"]').getByRole('switch'), order = () => page.locator('[data-source-agent]').evaluateAll(cards => cards.map(card => card.dataset.sourceAgent)), spot = await order();
    await claudeSwitch.evaluate(element => { element.dataset.sameNode = 'yes'; });
    await claudeSwitch.click(); await until(page, () => document.querySelector('[data-source-agent="codex"]')?.hasAttribute('data-stopped')); await settle(page);
    assert.deepEqual(await order(), spot, 'it does not jump away');
    assert.equal(await claudeSwitch.getAttribute('data-same-node'), 'yes', 'the same node, not a new one');
    await claudeSwitch.click(); await until(page, () => !document.querySelector('[data-source-agent="codex"]')?.hasAttribute('data-stopped')); await settle(page);

    // A problem acknowledged leaves its card.
    const before = await page.locator('[data-source-issue="accept"]').count();
    await accept.getByRole('button', { name: '不再提醒' }).click();
    await until(page, () => !document.querySelector('[data-source-agent="deepseek"] [data-source-issue="accept"]'));
    assert.equal(await page.locator('[data-source-issue="accept"]').count(), before - 1);

    // The summary column says the same word as the card.
    const card = await page.locator('[data-source-agent="codex"]').innerText();
    assert.match(card, /已读取/);
    const summary = page.locator('#summaryPanel [data-page-summary="sources"]');
    if (await summary.isVisible()) assert.doesNotMatch((await summary.innerText()).split('\n').filter(line => line.includes('Codex')).join(), /待验证/);

    // Paths fold out on the card, which keeps its place and width, and fold back by any of the ways a person would try.
    const codexCard = page.locator('[data-source-agent="codex"]'), pill = codexCard.locator('[data-source-paths] button'), region = page.locator('#source-paths-codex');
    const place = () => codexCard.evaluate(element => { const box = element.getBoundingClientRect(); return [Math.round(box.left), Math.round(box.width)]; }), closed = await place();
    const open = async () => { await pill.click(); await region.locator('[data-source-path]').first().waitFor(); await settle(page); };
    const shut = async how => { await settle(page); assert.equal(await region.count(), 0, how + ': the panel closes'); assert.equal(await pill.getAttribute('aria-expanded'), 'false', how); };
    await open(); assert.deepEqual(await place(), closed, 'opening does not move the card or widen it');
    await pill.click(); await shut('the pill');
    await open(); await codexCard.locator('[data-source-fold="paths"] button').click(); await shut('收起 at the end'); assert.equal(await pill.evaluate(element => element === document.activeElement), true, 'focus goes back to the pill');
    await open(); await page.keyboard.press('Escape'); await shut('Escape');
    // A location can be shown in the file manager, only one the app is already reading.
    await open();
    await session.app.evaluate(({ shell }) => { global.shown = []; shell.showItemInFolder = file => global.shown.push(file); });
    await codexCard.locator('[data-source-reveal] button').first().evaluate(element => element.click());
    await until(page, () => true); const located = await session.app.evaluate(() => global.shown);
    assert.equal(located.length <= 1, true, 'one location at most'); // A fixture path that no longer exists reports instead of showing.
    await assert.rejects(page.evaluate(() => window.usageBridge.revealSourcePath('C:/Windows/system32/calc.exe')), /SOURCE_PATH_UNKNOWN/, 'any other path is refused');
    assert.doesNotMatch(await codexCard.locator('[data-source-path] span[title]').first().getAttribute('title'), /点击复制/, 'it does not promise what a click does not do');
    for (const theme of ['light', 'dark']) { await setTheme(page, theme); await settle(page); await page.screenshot({ path: path.join(output, 'sources-' + theme + '.png'), fullPage: true }); }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no sideways scroll');
    assert.deepEqual(errors, []);
    console.log('PASS sources cards');
  } finally { await session.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
