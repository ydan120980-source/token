'use strict';
/* global document, innerWidth */
// Browser plugin not available. Approved native Electron acceptance via Playwright.
// The flow is: cached quota -> login/refresh/error/cooldown/cancel -> restart cache.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { settle } = require('./ui-settle');
const { fixtures } = require('../../tests/m1/fixtures');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-quota-ui-'));
(async () => {
  const home = path.join(directory, 'home'); fixtures(home);
  const evidence = [];
  fs.mkdirSync('artifacts/quota', { recursive: true });
  for (const scale of [1, 1.5]) {
    const data = path.join(directory, String(scale)); fs.mkdirSync(data);
    const quota = { schemaVersion: 'AccountQuotaV1', fetchedAt: '2026-10-03T00:00:00Z', resetCredits: 2, windows: [{ bucket: 'codex', name: 'codex', kind: 'primary', usedPercent: 36, remainingPercent: 64, durationMins: 300, resetsAt: '2026-10-04T00:00:00Z' }, { bucket: 'codex', name: 'codex', kind: 'secondary', usedPercent: null, remainingPercent: null, durationMins: 10080, resetsAt: null }] };
    fs.writeFileSync(path.join(data, 'quota-cache.json'), JSON.stringify({ accounts: [{ id: '11111111-1111-4111-8111-111111111111', provider: 'codex', alias: '合成测试账号', plan: 'plus', quota }] }));
    const executablePath = process.env.QUOTA_PACKAGED_EXE || require('electron');
    const args = [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--quota-data-dir', data, '--usage-data-dir', path.join(directory, 'usage-' + scale), '--m1-fixture-root', home, '--force-device-scale-factor=' + scale];
    const app = await electron.launch({ executablePath, args, timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.locator('#quotaCards').getByText('剩余 64%', { exact: true }).waitFor();
      await app.evaluate(async ({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (!window.isVisible()) await new Promise(resolve => window.once('show', resolve)); });
      assert.equal(await page.title(), 'Agent Usage · Codex 额度');
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      assert.equal(await page.locator('#main').getAttribute('data-current-view'), 'quota');
      assert.equal(await page.locator('#usage').isVisible(), false);
      assert.equal(await page.locator('#quotaCards').getByText('剩余 未知', { exact: true }).count(), 1);
      assert.equal(await page.locator('#quotaExample').isVisible(), false);
      await settle(page); const before = await page.locator('#quotaCards .quota-card').boundingBox();
      await page.locator('#quotaCards [data-quota-details]').click();
      await page.locator('#quotaDetailDialog .quota-diagnostics summary').click();
      await page.getByText('缓存 · 待验证', { exact: true }).waitFor();
      assert.deepEqual(await page.locator('#quotaCards .quota-card').boundingBox(), before);
      await page.locator('#quotaDetailDialog').press('Escape');
      await page.locator('#quotaAdd').click(); await page.locator('#quotaAlias').fill('另一个测试账号'); await page.locator('#quotaAlias').press('Escape'); assert.equal(await page.locator('#quotaLoginDialog').evaluate(el => el.open), false);
      await page.locator('[data-view="usage"]').click(); await page.locator('[data-period="today"]').click(); await page.locator('[data-view="quota"]').click();
      await page.screenshot({ path: 'artifacts/quota/native-' + scale + '.png' });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok(['full', 'reduced'].includes(await page.locator('body').getAttribute('data-motion')));
      assert.deepEqual(errors, []);
      const state = await page.evaluate(() => window.quotaBridge.get()); assert.equal(state.state.accounts.length, 1); assert.equal(state.state.pendingLogin, null);
      assert.equal(fs.existsSync(path.join(data, 'codex-homes')), false); // Modal alone never spawns authentication.
      // Replace only the adapter in the disposable test process. Exercise real IPC,
      // notifications, renderer and persistence without opening a browser or authorizing.
      await app.evaluate(({ shell, dialog }) => {
        const nodeRequire = process.mainModule.require.bind(process.mainModule);
        const module = Object.values(nodeRequire('node:module')._cache).find(m => /[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename));
        const { EventEmitter } = nodeRequire('node:events');
        const fixture = module.exports.QuotaService.prototype.testFixture = { mode: 'ok', loginDelay: 0, active: 0 };
        shell.openExternal = async () => {};
        dialog.showMessageBox = async () => ({ response: 1 });
        module.exports.QuotaService.prototype.client = async function(id) {
          fixture.service = this;
          if (this.clients.has(id)) return this.clients.get(id);
          const rpc = new EventEmitter(); fixture.active++; let closed = false;
          rpc.close = () => { if (!closed) { closed = true; fixture.active--; } };
          rpc.request = async method => {
            if (method === 'account/login/start') { if (fixture.loginDelay) await new Promise(resolve => setTimeout(resolve, fixture.loginDelay)); if (!closed) setTimeout(() => rpc.emit('login', { loginId: 'native-synthetic', success: true }), 100); return { loginId: 'native-synthetic', authUrl: 'https://auth.openai.com/oauth/authorize?state=SYNTHETIC' }; }
            if (fixture.mode === 'error') throw new Error('SECRET_SENTINEL');
            if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus', email: 'SENTINEL@example.com' } };
            if (method === 'account/rateLimits/read') return { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null } }, accessToken: 'SECRET_SENTINEL' };
            return {};
          }; this.clients.set(id, rpc); return rpc;
        };
      });
      await page.locator('#quotaAdd').click(); await page.locator('#quotaAlias').fill('新连接 · 合成验收'); await page.locator('#quotaLoginStart').click();
      await page.locator('#quotaCards').getByText('剩余 75%', { exact: true }).waitFor(); await page.locator('#quotaClose').click();
      assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.accounts.length, 2);
      await page.locator('#quotaCards article').last().getByRole('button', { name: '刷新', exact: true }).click();
      await page.locator('#quotaCards article').last().getByText('已更新', { exact: true }).waitFor();
      await page.locator('#quotaInterval').selectOption('60000');
      await page.waitForFunction(async () => (await window.quotaBridge.get()).state.autoRefresh === '1min');
      await app.evaluate(() => { const req = process.mainModule.require.bind(process.mainModule); Object.values(req('node:module')._cache).find(m => /[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename)).exports.QuotaService.prototype.testFixture.mode = 'error'; });
      await page.locator('#quotaRefreshAll').click();
      await page.waitForFunction(() => document.getElementById('quotaSummary').textContent.includes('失败 2'));
      assert.equal(await page.locator('#quotaCards').getByText('剩余 75%', { exact: true }).count(), 1);
      assert.equal(await page.locator('#quotaCards').getByText('剩余 64%', { exact: true }).count(), 1);
      assert.equal(await page.locator('#quotaCards [data-quota-refresh]:disabled').count(), 2);
      assert.equal(await page.locator('#quotaCards').getByText(/服务读取失败 · 60 秒冷却/).count(), 2);
      await page.locator('#quotaRefreshAll').click(); await page.waitForFunction(() => document.getElementById('quotaSummary').textContent.includes('跳过 2'));
      await page.screenshot({ path: 'artifacts/quota/error-' + scale + '.png' });
      await app.evaluate(() => { const req = process.mainModule.require.bind(process.mainModule); const fixture = Object.values(req('node:module')._cache).find(m => /[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename)).exports.QuotaService.prototype.testFixture; fixture.mode = 'ok'; fixture.service.accounts.forEach(a => { a.nextRefreshAt = null; }); });
      await page.locator('#quotaRefreshAll').click(); await page.waitForFunction(() => document.getElementById('quotaSummary').textContent.includes('成功 2'));
      const persisted = fs.readFileSync(path.join(data, 'quota-cache.json'), 'utf8'); assert.equal(/SECRET_SENTINEL|SENTINEL@example|authUrl/.test(persisted), false);
      await page.locator('#quotaCards article').last().getByRole('button', { name: '账号详情', exact: true }).click();
      await page.locator('#quotaDetailDialog').getByRole('button', { name: '移除连接', exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll('#quotaCards article').length === 1);
      await app.evaluate(() => { const req = process.mainModule.require.bind(process.mainModule); Object.values(req('node:module')._cache).find(m => /[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename)).exports.QuotaService.prototype.testFixture.loginDelay = 500; });
      await page.locator('#quotaAdd').click(); await page.locator('#quotaLoginStart').click(); await page.locator('#quotaCancel').waitFor();
      assert.equal(await page.locator('#quotaLoginStart').getAttribute('aria-busy'), 'true');
      await page.locator('#quotaCancel').click();
      await page.waitForTimeout(650);
      assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.accounts.length, 1);
      assert.equal(await app.evaluate(() => { const req = process.mainModule.require.bind(process.mainModule); return Object.values(req('node:module')._cache).find(m => /[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename)).exports.QuotaService.prototype.testFixture.active; }), 0);
      assert.deepEqual(errors, []);
      evidence.push({ packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), scale, nativeRenderer: true, quotaCacheAndUnknown: true, routeAndModal: true, syntheticLoginRefreshLogoutThroughIpc: true, allRefreshErrorCooldownCancel: true, credentialProcessStarted: false, noPageErrors: true });
    } finally { await app.close(); }
    const restored = await electron.launch({ executablePath, args, timeout: 60000 });
    try { const page = await restored.firstWindow(); await page.locator('#quotaCards').getByText('剩余 75%', { exact: true }).waitFor(); const result = await page.evaluate(() => window.quotaBridge.get()); assert.equal(result.state.autoRefresh, 'off'); assert.equal(result.state.accounts[0].status, 'cached'); assert.equal(result.state.accounts[0].busy, false); evidence.at(-1).restartOffHistoricalCache = true; }
    finally { await restored.close(); }
  }
  fs.writeFileSync('artifacts/quota/native-results.json', JSON.stringify(evidence, null, 2)); process.stdout.write(JSON.stringify(evidence) + '\n');
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
