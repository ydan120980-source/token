'use strict';
/* global document, getComputedStyle, innerWidth */
// Quota page v4 (UI-QUOTA-V4-CARDS-20261022.md, UI-QUOTA-V4-SHEET-20261022.md) and its first screen
// (UI-POLISH-M10-20261029.md): widget home, per-page summary, card
// shapes, shared same-account cards, filter, sheet groups and card moves. Real Electron UI with an
// isolated synthetic home; the three quota read handlers return a synthetic fixture shaped like an
// owner's connections. No credentials, provider requests, CLI runs or writes to the quota cache.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { showView, settle, until, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const { checkTextContrast } = require('./chart-hover-check');
const output = process.env.QUOTA_V4_EVIDENCE_DIR || path.join(os.tmpdir(), 'agent-usage-quota-v4-evidence-' + process.pid);

const { fixture } = require('../../tests/m1/quota-hero-fixture');
const q = require('./quota-ui-helpers');
const { assertQuotaCardsFit } = require('./quota-card-fit-check');

const order = page => page.locator('#quotaCards .quota-card').evaluateAll(cards => cards.map(card => card.dataset.providerRow));

(async () => {
  const results = []; fs.mkdirSync(output, { recursive: true });
  for (const [scale, theme] of [[1, 'dark'], [1.5, 'light']]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-v4-ui-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'), quota = path.join(root, 'quota'), evidence = path.join(output, String(scale));
    fs.mkdirSync(home); fs.mkdirSync(quota); fs.mkdirSync(evidence, { recursive: true }); new Store(usage, roots(home)).setEnabled(false); atomic(path.join(quota, 'quota-cache.json'), { accounts: [] });
    const ledger = fs.readFileSync(path.join(usage, 'statistics.json')), codexBytes = fs.readFileSync(path.join(quota, 'quota-cache.json'));
    const executablePath = process.env.QUOTA_PACKAGED_EXE || require('electron'), args = [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale];
    let app, page;
    try {
      app = await electron.launch({ executablePath, args, timeout: 60000 }); page = await app.firstWindow(); await keepVisible(app); await isolatePointer(app);
      const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.setViewportSize({ width: 1180, height: 850 }); await page.evaluate(dark => document.body.classList.toggle('dark', dark), theme === 'dark');
      const data = fixture(Date.now());
      await app.evaluate(({ ipcMain, BrowserWindow }, data) => {
        const handlers = ipcMain._invokeHandlers, wrap = (channel, edit) => { const original = handlers.get(channel); handlers.set(channel, async (...args) => { const result = await original(...args); if (result?.ok) edit(result.state); return result; }); };
        wrap('quota:providers', state => { state.accounts = data.providers; });
        wrap('quota:getV2', state => { state.accounts = [data.v2]; });
        wrap('quota:get', state => { state.accounts = [data.v1]; state.executableAvailable = true; });
        for (const win of BrowserWindow.getAllWindows()) { win.webContents.send('quota:update'); win.webContents.send('quota:providerUpdate'); }
      }, data);
      await showView(page, 'quota'); await until(page, () => document.querySelectorAll('#quotaCards .quota-card').length === 5); await settle(page);
      await assertQuotaCardsFit(page, 5);
      // Prove that distinguishing pocket paint still rejects actual clipped data.
      const walletBody = page.locator('#quotaCards [data-provider-row="workbuddy"] .quota-card-body');
      const originalStyle = await walletBody.getAttribute('style');
      try {
        await walletBody.evaluate(body => body.style.setProperty('max-height', '1px', 'important'));
        await assert.rejects(() => assertQuotaCardsFit(page, 5), /visible card content fits/);
      } finally {
        await walletBody.evaluate((body, style) => { if (style === null) body.removeAttribute('style'); else body.setAttribute('style', style); }, originalStyle);
      }
      await assertQuotaCardsFit(page, 5);
      // M10 replaces the home figures/activity/pace with a customizable widget board.
      const board = page.locator('#quota [data-widget-board]');
      assert.equal(await board.count(), 1);
      assert.deepEqual(await board.locator('[data-widget]').evaluateAll(nodes => nodes.map(node => node.dataset.widget)), ['quota.windows', 'usage.today', 'cost.daily', 'usage.week']);
      assert.equal(await page.locator('[data-home-figures], [data-pace-rings], [data-activity-summary]').count(), 0);
      assert.equal(await board.locator('[data-widget] h3').count(), 4);
      assert.equal(await board.locator('[data-widget="usage.today"] [data-widget-figure]').count(), 2);
      assert.deepEqual(await board.locator('[data-widget="usage.today"] [data-widget-figure]').allInnerTexts(), ['0', '—'], 'an empty synthetic ledger has no estimated cost');
      const contrast = await checkTextContrast(page, ['[data-widget-board] [data-widget-figure]', '[data-widget-board] [data-widget] h3', '#quotaCards .quota-card-head h3', '#quotaCards .quota-card-content.is-dim .quota-wallet-total > small', '#quotaCards .quota-card-content.is-dim .quota-figure', '#quotaCards .quota-card-content.is-dim .quota-reset']);
      fs.writeFileSync(path.join(evidence, 'contrast.json'), JSON.stringify(contrast, null, 2));
      assert.equal(await page.locator('#quota h1').innerText(), '概览');
      const windows = board.locator('[data-widget="quota.windows"]');
      const codexWindows = await windows.locator('[data-widget-account="codex"]').innerText();
      assert.match(codexWindows, /5 小时[\s\S]*剩余\s*0%/);
      assert.match(codexWindows, /每周[\s\S]*剩余\s*84%/);
      const stale = await windows.locator('[data-widget-account="antigravity"]').innerText();
      assert.equal((stale.match(/待刷新/g) || []).length, 2);
      assert.doesNotMatch(stale, /\d+%/, 'stale quota windows retain unknown readings');
      await page.screenshot({ path: path.join(evidence, 'home.png') });
      await page.locator('#windowSummary').click();
      const summary = page.locator('#summaryPanel [data-page-summary="quota"] [data-summary-card]');
      await summary.waitFor();
      assert.equal(await summary.count(), 1, 'the right column holds one dedicated summary card');
      assert.match(await summary.locator('[data-summary-lead]').innerText(), /下一次恢复 · Codex 5 小时 · .+后/);
      assert.equal(await summary.locator('[data-widget]').count(), 0);
      await page.screenshot({ path: path.join(evidence, 'summary.png') });
      await page.keyboard.press('Escape'); await settle(page);

      // 未连接: the filter shows the Agents without a connection instead of cards.
      await page.locator('#quotaFilter [data-filter="idle"]').click(); await settle(page);
      assert.equal(await page.locator('#quotaCards .quota-card').count(), 0);
      assert.equal(await page.locator('[data-quota-attention]').count(), 0);
      await page.locator('[data-quota-idle]').waitFor();
      await page.locator('#quotaFilter [data-filter="all"]').click(); await until(page, () => document.querySelectorAll('#quotaCards .quota-card').length === 5);
      await page.evaluate(() => window.quotaUi.locate('old'));
      await until(page, () => document.querySelectorAll('#quotaCards .quota-card[data-attention-flash] .quota-age.is-old').length === 1);

      // Attention line: each failing connection with its fix.
      const attention = q.attention(page);
      assert.match(await attention.innerText(), /需要处理\s*2/); assert.equal(await attention.locator('[data-provider-action="credential"]').count(), 2);

      // Shared card, wallet pocket, problem state, empty state.
      const workbuddy = page.locator('#quotaCards [data-provider-row="workbuddy"]');
      assert.equal(await workbuddy.count(), 1); assert.equal(await workbuddy.getAttribute('data-connections'), data.ids.desktop + ' ' + data.ids.web);
      assert.match(await workbuddy.locator('.quota-alias').innerText(), /2 个连接 · 同一账号/); assert.equal(await workbuddy.locator('.quota-status').innerText(), '1 / 2 个连接需要处理');
      assert.equal(await workbuddy.locator('.quota-ticket').count(), 2); assert.match(await workbuddy.locator('.quota-ticket').first().innerText(), /新人活动奖励/);
      assert.equal(await workbuddy.locator('.quota-wallet-total strong').innerText(), '3,114 积分'); assert.doesNotMatch(await workbuddy.innerText(), /7 天内到期|个积分包/, 'no small print on the card (owner 2026-10-27); the sheet lists what expires');
      assert.equal(await workbuddy.locator('.quota-problem').count(), 0, 'one working connection keeps the full reading');
      const opencode = page.locator('#quotaCards [data-provider-row="opencode"]');
      assert.match(await opencode.locator('.quota-problem').innerText(), /授权已过期/); assert.equal(await opencode.locator('.quota-status').innerText(), '需要处理');
      // An account without quota items reads as unknown, never as 0 (the explanation was removed 2026-10-27).
      const zcodeText = await page.locator('#quotaCards [data-provider-row="zcode"]').innerText();
      assert.match(zcodeText, /没有额度项/); assert.match(zcodeText, /额度未知/); assert.doesNotMatch(zcodeText, /(^|\D)0(\.0+)?\s*(%|积分|USD)/);
      const codex = page.locator('#quotaCards [data-provider-row="codex"]');
      assert.match(await codex.locator('.quota-meter').first().getAttribute('title'), /节奏/, 'pace is in the tooltip');
      assert.equal(await codex.locator('.quota-segments:not(.low):not(.is-stale) .quota-fill i').first().evaluate(i => { const hex = getComputedStyle(document.body).getPropertyValue('--agent-codex').trim(), [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)); return getComputedStyle(i).backgroundColor === 'rgb(' + r + ', ' + g + ', ' + b + ')'; }), true, 'Codex bars take the Codex tone');
      await page.screenshot({ path: path.join(evidence, 'page.png') });

      // Initial mount must measure after the parent ref exists, before any filter click.
      await until(page, () => {
        const root = document.getElementById('quotaFilter'), selected = root.querySelector('[aria-pressed="true"]'), marker = root.querySelector('.motion-indicator');
        if (!selected || !marker) return false;
        const a = selected.getBoundingClientRect(), b = marker.getBoundingClientRect();
        return a.width > 0 && Math.abs(a.x-b.x) < 1 && Math.abs(a.y-b.y) < 1 && Math.abs(a.width-b.width) < 1;
      });
      // Filter (persisted), and the attention line clears a filter that hides the cards it names.
      await page.locator('#quotaFilter [data-filter="action"]').click(); await settle(page);
      assert.deepEqual(await order(page), ['opencode', 'workbuddy']);
      await page.locator('#quotaFilter [data-filter="ready"]').click(); await settle(page); assert.deepEqual(await order(page), ['codex', 'zcode', 'antigravity']);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('agentusage.quotaCards.v1')).filter), 'ready');
      await page.locator('[data-attention-next] button').first().click(); await settle(page); assert.equal(await page.locator('#quotaCards .quota-card').count(), 5);

      // The whole card opens its sheet: three facts, packages grouped by when they run out.
      const box = await workbuddy.boundingBox(); await page.mouse.click(box.x + box.width - 10, box.y + box.height / 2); await settle(page);
      const sheet = q.details(page); await sheet.waitFor();
      assert.equal(await sheet.locator('nav[aria-label="连接"] button').count(), 2);
      const desktop = sheet.locator('[data-quota-account="' + data.ids.desktop + '"]');
      assert.equal(await desktop.locator('[data-quota-facts] > div').count(), 3); assert.match(await desktop.locator('[data-quota-facts]').innerText(), /新人活动奖励 到期/);
      assert.deepEqual(await desktop.locator('[data-quota-resource-group] > h4').allInnerTexts().then(list => list.map(text => text.replace(/\s+\d+ 个[\s\S]*$/, '').trim())), ['7 天内到期', '可用']);
      assert.match(await desktop.locator('[data-quota-resource-group] > h4').first().innerText(), /2 个 · 120 积分/);
      assert.equal(await desktop.locator('[data-quota-more]').count(), 2, 'the long list and the expired packages are folded');
      assert.match(await desktop.locator('[data-quota-resource]').first().innerText(), /新人活动奖励/);
      await page.screenshot({ path: path.join(evidence, 'sheet.png') });
      await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' }); await settle(page);

      // Long press moves a card (saved); Escape while dragging puts it back; Alt+arrow from the keyboard.
      // Keep a real history entry so a leaked Alt+Left cannot silently hide quota.
      await showView(page, 'usage');
      await assert.rejects(() => assertQuotaCardsFit(page, 5), /current quota view/);
      await showView(page, 'quota'); await assertQuotaCardsFit(page, 5);
      await page.locator('#quotaCards .quota-card').first().scrollIntoViewIfNeeded(); await settle(page);
      const before = await order(page), cards = page.locator('#quotaCards .quota-card'), first = await cards.nth(0).boundingBox(), third = await cards.nth(2).boundingBox();
      const pressAt = { x: first.x + first.width / 2, y: first.y + first.height - 30 };
      await page.mouse.move(pressAt.x, pressAt.y); await page.mouse.down(); await page.waitForTimeout(450);
      for (let i = 1; i <= 8; i++) await page.mouse.move(pressAt.x + (third.x - first.x) * i / 8, pressAt.y + (third.y - first.y) * i / 8);
      assert.equal(await page.locator('#quotaCards .quota-card.is-dragging').count(), 1);
      await page.mouse.up(); await settle(page);
      const moved = await order(page); assert.equal(moved[2], before[0]); assert.equal(await sheet.count(), 0, 'a drag is not a click');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('agentusage.quotaCards.v1')).order.length), 5);
      const again = await cards.nth(0).boundingBox(); await page.mouse.move(again.x + again.width / 2, again.y + again.height - 30); await page.mouse.down(); await page.waitForTimeout(450);
      await page.mouse.move(third.x + third.width / 2, third.y + third.height / 2); await page.keyboard.press('Escape'); await page.mouse.up(); await settle(page);
      assert.deepEqual(await order(page), moved, 'Escape cancels the drag');
      await cards.nth(2).locator('.quota-sheet-open').focus(); await page.keyboard.press('Alt+ArrowLeft'); await settle(page);
      assert.equal((await order(page))[1], moved[2]); assert.equal(await q.message(page).innerText(), '已移到第 2 位。');

      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal page overflow');
      const fit = await assertQuotaCardsFit(page, 5);
      fs.writeFileSync(path.join(evidence, 'card-fit.json'), JSON.stringify(fit, null, 2));
      // Ordinary window history still works when the key is outside the card grid.
      await page.locator('#windowBack').focus(); await page.keyboard.press('Alt+ArrowLeft');
      await until(page, () => document.getElementById('main').dataset.currentView === 'usage');
      await showView(page, 'quota'); await assertQuotaCardsFit(page, 5);
      assert.deepEqual(errors, []);
      assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger); assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), codexBytes);
      results.push({ scale, theme, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), pageHead: true, sharedCard: true, cardShapes: true, filter: true, sheetGroups: true, dragAndKeys: true, providerRequests: 0 }); console.log('PASS quota v4 UI ' + scale + ' ' + theme);
    } catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); throw error; }
    finally { if (app) await app.close(); await cleanup(root); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
