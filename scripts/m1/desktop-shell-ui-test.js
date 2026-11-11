'use strict';
/* global document */
// The first-run guide, the settings beside it, quota notices, the tray card and the read history, on invented readings at the
// default display (125%). Notices are caught before the system shows them; nothing here reads an account.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch } = require('./ui-smoke');
const { showView, settle, until } = require('./ui-settle');
const { READINGS, quotaOf } = require('../../tests/m1/quota-card-fixtures');
const output = process.env.DESKTOP_SHELL_EVIDENCE_DIR || 'artifacts/desktop-shell-20261105';

const moduleOf = `Object.values(process.mainModule.require('node:module')._cache)`;
// A low Codex-shaped window and a normal one, at the IPC boundary, as other quota suites do it.
async function readings(app, rows, lines) {
  await app.evaluate((electron, { rows, lines, moduleOf }) => {
    const modules = eval(moduleOf), find = name => modules.find(value => new RegExp('[/\\\\]src[/\\\\]quota[/\\\\]' + name + '\\.js$').test(value.filename));
    const provider = find('provider-service'), { resourceView } = provider.require('./resource-state'), proto = provider.exports.ProviderQuotaService.prototype;
    proto.realState ??= proto.state;
    proto.state = function () {
      return { ...this.realState(), accounts: rows.map((item, index) => {
        const id = String(index).padStart(8, '0') + '-0000-4000-8000-000000000000', row = { id, adapter: item.provider + '-demo', provider: item.provider, alias: item.provider, status: 'ready', lastAttempt: new Date().toISOString() };
        return { ...row, remembered: true, credentialExpiresAt: null, passive: false, errorMessage: null, quota: resourceView(item.quota, row, Date.now()), credentialReady: true, credentialRetryable: false, busy: false };
      }) };
    };
    find('read-history').exports.ReadHistory.prototype.list = () => lines;
    const shell = find('desktop-shell').exports.DesktopShell.prototype;
    global.shellSeen = { notices: [] };
    shell.notify = function (notice) { global.shellSeen.instance = this; global.shellSeen.notices.push({ title: notice.title, body: notice.body }); };
    shell.realUpdate ??= shell.update;
    shell.update = function (list) { global.shellSeen.instance = this; global.shellSeen.rows = list.length; return this.realUpdate(list); };
    const win = electron.BrowserWindow.getAllWindows()[0];
    win.webContents.send('quota:providerUpdate');
  }, { rows, lines, moduleOf });
}
const low = reading => { const copy = JSON.parse(JSON.stringify(reading)); copy.pools[0].windows[0].usedPercent = 91; return copy; };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const { app, page, errors, close } = await launch({ scale: 1.25, size: [1480, 880], args: ['--desktop-shell-test'] });
  try {
    await page.locator('[data-guide]').waitFor({ timeout: 30000 });
    await until(page, () => document.querySelector('[data-guide-found], [data-guide-others]'));
    await settle(page);
    await page.screenshot({ path: path.join(output, 'guide.png') });
    // Every Agent with a card is reachable from this one page; the found ones first.
    const agents = await page.locator('[data-guide-agent]').evaluateAll(rows => rows.map(row => row.dataset.guideAgent));
    assert.ok(agents.length > 0, 'the machine\'s Agents are listed');
    const others = page.locator('[data-guide-others] button').first();
    if (await others.count()) { await others.click(); await settle(page); }
    assert.ok(await page.locator('[data-guide-agent]').count() >= 10, 'all Agents with quota are here');
    assert.equal(await page.locator('[data-guide-agent="codex"]').count(), 1);
    // Connecting steps aside for its own sheet and comes back.
    await page.locator('[data-guide-agent="opencode"] [data-guide-connect] button').click();
    await until(page, () => !document.querySelector('[data-guide]') && document.querySelector('[role="dialog"]'));
    await page.keyboard.press('Escape');
    await page.locator('[data-guide]').waitFor();
    await page.locator('[data-guide-finish] button').click();
    await until(page, () => !document.querySelector('[data-guide]'));
    assert.equal((await page.evaluate(() => window.shellBridge.get())).guided, true, 'finishing is remembered');

    // Settings.
    await page.evaluate(() => window.settingsUi.openSection('general')); await settle(page);
    const desktop = page.locator('[data-settings-desktop]');
    await desktop.scrollIntoViewIfNeeded();
    assert.match(await desktop.innerText(), /关闭窗口后留在托盘/);
    if (!process.env.QUOTA_PACKAGED_EXE) assert.match(await desktop.innerText(), /安装版才能设置/, 'a source run cannot register itself with Windows');
    await page.screenshot({ path: path.join(output, 'settings-general.png') });
    await page.locator('[data-settings-guide] button').click();
    await page.locator('[data-guide]').waitFor();
    await page.keyboard.press('Escape');
    await until(page, () => !document.querySelector('[data-guide]'));
    await page.evaluate(() => window.settingsUi.openSection('quota')); await settle(page);
    await page.locator('[data-quota-watch]').waitFor();
    await page.screenshot({ path: path.join(output, 'settings-quota.png') });
    const saved = await page.evaluate(() => window.shellBridge.set({ watch: { low: 30 } }));
    assert.equal(saved.watch.low, 30);
    assert.equal((await page.evaluate(() => window.shellBridge.set({ watch: { low: 7 } }))).watch.low, 30, 'only the offered values');
    await page.evaluate(() => window.shellBridge.set({ watch: { low: 20 } }));

    // Notices: a window that falls below the line says so once.
    const lines = [{ at: new Date().toISOString(), ok: true, automatic: true, count: 12, message: null }, { at: new Date(Date.now() - 900000).toISOString(), ok: false, code: 'PROVIDER_TIMEOUT', automatic: true, quiet: true, count: 2, message: '请求超时' }];
    await readings(app, [{ provider: 'claude', quota: quotaOf('claude', low(READINGS.claude)) }, { provider: 'zcode', quota: quotaOf('zcode', READINGS.zcode) }], lines);
    await page.evaluate(() => window.quotaBridge.setAutoRefresh('off'));
    const seen = () => app.evaluate(() => ({ notices: global.shellSeen.notices, rows: global.shellSeen.rows ?? 0 }));
    for (let at = 0; at < 40 && !(await seen()).rows; at++) await page.waitForTimeout(250);
    const first = await seen();
    assert.ok(first.notices.some(item => /Claude Code .* 只剩 9%/.test(item.title)), 'told: ' + JSON.stringify(first.notices));
    await page.evaluate(() => window.quotaBridge.setAutoRefresh('off')); await page.waitForTimeout(2200);
    assert.equal((await seen()).notices.length, first.notices.length, 'told once');

    // The read history: passing failures stay quiet on the card and are found here.
    await showView(page, 'quota'); await settle(page);
    await page.waitForFunction(() => document.querySelectorAll('#quotaCards .quota-card').length >= 2);
    await page.locator('#quotaCards [data-provider-row="claude"]').first().hover();
    await page.locator('#quotaCards [data-provider-row="claude"] .quota-sheet-open').first().click();
    const history = page.locator('[data-quota-read-history]').first();
    await history.waitFor();
    assert.match(await history.innerText(), /2 次失败/, 'the count shows without opening');
    await history.locator('button').first().click(); await settle(page);
    assert.match(await history.innerText(), /读取超时，保留上次成功观测 · 连续 2 次 · 会自动重试/);
    assert.match(await history.innerText(), /成功 · 连续 12 次/);
    await history.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'read-history.png') });
    await page.keyboard.press('Escape'); await settle(page);

    // The tray card: a small window of its own, gone when it closes.
    assert.equal((await page.evaluate(() => window.shellBridge.get())).tray, true);
    const opened = app.waitForEvent('window');
    await app.evaluate(() => { global.shellSeen.instance.toggleCard(); });
    const card = await opened;
    await card.waitForSelector('[data-tray-row]');
    await card.waitForTimeout(300);
    await card.screenshot({ path: path.join(output, 'tray-card.png') });
    const rows = await card.locator('[data-tray-row]').evaluateAll(list => list.map(row => row.dataset.trayRow));
    assert.equal(rows[0], 'claude', 'tightest first');
    assert.match(await card.locator('[data-tray-row]').first().innerText(), /9%/);
    const fit = await card.evaluate(() => document.getElementById('card').offsetHeight - window.innerHeight);
    assert.ok(Math.abs(fit) <= 2, 'the window is as tall as the card: ' + fit);
    await app.evaluate(() => { global.shellSeen.instance.closeCard(); });
    await until(page, () => true);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'the card window is gone');

    // Closing keeps it in the tray, with one word about where it went; the tray brings it back.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.waitForTimeout(300);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    assert.ok((await seen()).notices.some(item => /还在托盘里/.test(item.title)));
    await app.evaluate(() => { global.shellSeen.instance.showWindow('show-quota'); });
    await until(page, () => document.getElementById('main').dataset.currentView === 'quota');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
    assert.deepEqual(errors, []);
    console.log('desktop shell checks passed');
  } finally { await close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
