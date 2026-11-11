'use strict';
/* global document */
// 概览's widgets at their narrowest column with large values and long model names: nothing leaves its card, large
// figures do not touch, and the quota summary says whose window each row is. Synthetic fixture home and isolated stores.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch } = require('./ui-smoke');
const { showView, settle, until } = require('./ui-settle');
const { fixture } = require('../../tests/m1/quota-hero-fixture');
const output = process.env.WIDGETS_EVIDENCE_DIR || 'artifacts/ui-widget-fit';

const KEY = 'agentusage.widgets.v1', TYPES = ['quota.windows', 'quota.next', 'quota.upcoming', 'quota.status', 'cost.month', 'cost.daily', 'cost.where', 'usage.today', 'usage.heatmap', 'usage.week', 'usage.live', 'sessions.recent', 'sessions.window', 'agents.graph'];
const layout = size => ({ active: 'fit', layouts: [{ id: 'fit', name: '全部', widgets: TYPES.map((type, index) => ({ key: 'w' + index, type, size, color: 'agent', background: 'plain', agent: 'all', period: null, readout: false })) }] });

// Antigravity with a pool per model group, each with its own two windows, as a real account can report them.
function quota(now) {
  const data = fixture(now), at = mins => new Date(now + mins * 60000).toISOString();
  const win = (id, role, durationMins, remaining, resetsIn) => ({ id, label: null, role, durationMins, unit: 'percent', remainingPercent: remaining, usedPercent: 100 - remaining, resetsAt: at(resetsIn), state: 'available', freshness: { state: 'fresh' } });
  const pool = (id, label, five, week, offset) => ({ id, label, modelIds: [], balances: [], windows: [win(id + '-five', 'primary', 300, five, 80 + offset), win(id + '-week', 'secondary', 10080, week, 4000 + offset)] });
  const row = data.providers.find(item => item.provider === 'antigravity');
  row.quota = { ...row.quota, fetchedAt: at(-1), pools: [pool('gemini', 'Gemini Models', 92.2, 88.4, 0), pool('claude', 'Claude and GPT models', 100, 96.6, 200), pool('flash', 'Gemini Flash Image Generation Models', 100, 100, 400)] };
  return data;
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const session = await launch({ size: [1480, 960], seed: { scale: 4000 } }), { app, page, errors } = session;
  try {
    await app.evaluate(({ ipcMain, BrowserWindow }, data) => {
      for (const [channel, edit] of [['quota:providers', state => { state.accounts = data.providers; }], ['quota:getV2', state => { state.accounts = [data.v2]; }], ['quota:get', state => { state.accounts = [data.v1]; }]]) {
        const original = ipcMain._invokeHandlers.get(channel);
        ipcMain._invokeHandlers.set(channel, async (...args) => { const result = await original(...args); if (result?.ok) edit(result.state); return result; });
      }
      for (const win of BrowserWindow.getAllWindows()) { win.webContents.send('quota:update'); win.webContents.send('quota:providerUpdate'); }
    }, quota(Date.now()));

    for (const size of ['m', 'l', 's']) {
      await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [KEY, layout(size)]);
      await page.reload(); await page.waitForFunction(() => document.readyState === 'complete' && Boolean(window.agentUi));
      await showView(page, 'quota'); await until(page, () => document.querySelectorAll('[data-widget-board] [data-widget]').length === 14);
      // Two columns at the narrowest width the column rule allows.
      await page.evaluate(() => { document.querySelector('[data-widget-board]').style.width = 2 * 280 + 16 + 'px'; });
      await until(page, () => /M|B/.test(document.querySelector('[data-widget="usage.today"] [data-widget-figure]')?.textContent ?? ''));
      await settle(page); await page.waitForTimeout(700);
      const problems = await page.evaluate(() => {
        const found = [];
        for (const card of document.querySelectorAll('[data-widget-board] [data-widget]')) {
          const box = card.getBoundingClientRect(), name = card.dataset.widget;
          if (box.width > 300) found.push(name + ': column wider than the narrowest rule ' + box.width);
          for (const element of card.querySelectorAll('*')) {
            if (!(element instanceof window.HTMLElement) || element.closest('svg')) continue;
            const rect = element.getBoundingClientRect(), own = [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim());
            if (!own || !rect.width) continue;
            if (rect.right > box.right + 0.5 || rect.left < box.left - 0.5) found.push(name + ': leaves its card: ' + element.textContent.slice(0, 40));
            const clipped = window.getComputedStyle(element).textOverflow === 'ellipsis';
            if (!clipped && element.scrollWidth > element.clientWidth + 1 && window.getComputedStyle(element).display !== 'inline') found.push(name + ': overflows: ' + element.textContent.slice(0, 40));
          }
          const figures = [...card.querySelectorAll('[data-widget-figure]')].map(element => element.getBoundingClientRect());
          for (let a = 0; a < figures.length; a++) for (let b = a + 1; b < figures.length; b++) if (figures[a].left < figures[b].right && figures[b].left < figures[a].right && figures[a].top < figures[b].bottom && figures[b].top < figures[a].bottom) found.push(name + ': figures touch');
        }
        return found;
      });
      assert.deepEqual(problems, [], 'size ' + size);
      await page.screenshot({ path: path.join(output, 'board-' + size + '.png'), fullPage: true });
    }

    // 下一次恢复 says the day once, and the rows after it keep their time and whose window it is.
    await page.evaluate(([key, value]) => localStorage.setItem(key, JSON.stringify(value)), [KEY, layout('m')]);
    await page.reload(); await page.waitForFunction(() => document.readyState === 'complete' && Boolean(window.agentUi));
    await showView(page, 'quota'); await until(page, () => document.querySelectorAll('[data-widget-board] [data-widget]').length === 14); await settle(page);
    const next = page.locator('[data-widget="quota.next"]');
    assert.equal((await next.locator('[data-widget-figure]').locator('..').innerText()).match(/\d{1,2}:\d{2}/g).length, 1, 'the clock is not repeated beside the large time');
    const later = await next.locator('[data-widget-details] [data-widget-row]').allInnerTexts();
    assert(later.length > 0 && later.every(row => /\d{1,2}:\d{2}/.test(row)), 'each later reset keeps its time: ' + later);
    assert(later.some(row => /Gemini|Claude/.test(row)), 'and names the model: ' + later);

    // The quota summary: every account and model group, each window under its own name, and what the percent means.
    const quotaCard = page.locator('#summaryPanel [data-page-summary="quota"] [data-summary-card]');
    if (!await quotaCard.isVisible()) await page.locator('#windowSummary').click();
    await quotaCard.waitFor(); await settle(page);
    const groups = await quotaCard.locator('[data-summary-group]').evaluateAll(nodes => nodes.map(node => node.dataset.summaryGroup));
    for (const name of ['Antigravity · Gemini Models', 'Antigravity · Claude and GPT models', 'Antigravity · Gemini Flash Image Generation Models']) assert(groups.includes(name), name + ' in ' + groups);
    assert(groups.some(name => /^Codex/.test(name)), 'other accounts stay too: ' + groups);
    const gemini = quotaCard.locator('[data-summary-group="Antigravity · Gemini Models"]');
    assert.deepEqual(await gemini.locator('[data-summary-window]').count(), 2);
    assert.match(await gemini.innerText(), /5 小时[\s\S]*92\.2%[\s\S]*每周[\s\S]*88\.4%/);
    assert.equal(await quotaCard.locator('[data-summary-measure]').innerText(), '剩余');
    await page.screenshot({ path: path.join(output, 'quota-summary.png') });

    // The usage page's summary: the kinds of Token and the last 30 days under what was there.
    await showView(page, 'usage');
    const usageCard = page.locator('#summaryPanel [data-page-summary="usage"] [data-summary-card]'); await usageCard.waitFor(); await settle(page);
    const parts = await usageCard.locator('[data-summary-part]').evaluateAll(nodes => nodes.map(node => node.dataset.summaryPart));
    assert.equal(parts[0], '今天各 Agent'); assert(parts.includes('今天的 Token 类型'), parts.join()); assert(parts.includes('近 30 天'), parts.join());
    assert.match(await usageCard.locator('[data-summary-part="今天的 Token 类型"]').innerText(), /输入[\s\S]*输出[\s\S]*缓存读取[\s\S]*缓存写入/);
    assert.match(await usageCard.locator('[data-summary-hit]').innerText(), /缓存命中 \d+%/);
    assert.match(await usageCard.locator('[data-summary-part="近 30 天"]').innerText(), /最多的一天[\s\S]*有记录的日子平均/);
    await page.screenshot({ path: path.join(output, 'usage-summary.png') });
    assert.deepEqual(errors, []);
    console.log('PASS widget fit');
  } finally { await session.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
