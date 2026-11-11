'use strict';
/* global document */
// Browser plugin not available: Electron Playwright, isolated synthetic homes.
// Sources/quota row -> guide -> scan -> fixed action feedback -> narrow dark UI.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const definitions = require('../../src/quota/agent-setup-catalog');
const { until, showView, keepVisible, cleanup, settle } = require('./ui-settle');
const output = path.resolve(process.env.AGENT_SETUP_EVIDENCE_DIR || 'artifacts/all-agent-recovery-20261019/setup-ui');
(async () => {
  const results = [];
  for (const scale of [1, 1.25, 1.5]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-setup-ui-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'), quota = path.join(root, 'quota'), dir = path.join(output, String(scale));
    fs.mkdirSync(home); fs.mkdirSync(quota); fs.mkdirSync(dir, { recursive: true });
    const store = new Store(usage, roots(home)); store.setEnabled(false); atomic(path.join(quota, 'quota-cache.json'), { schemaVersion: 'QuotaCacheV2', accounts: [] });
    const ledger = fs.readFileSync(path.join(usage, 'statistics.json')), quotaBytes = fs.readFileSync(path.join(quota, 'quota-cache.json'));
    const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = []; await keepVisible(app); page.on('pageerror', e => errors.push(e.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await app.evaluate(electron => { const fixture = electron.shell.setupTest = { opened: [], copied: [], fail: false }; electron.shell.openExternal = async url => { if (fixture.fail) throw Error('PRIVATE'); fixture.opened.push(url); }; electron.clipboard.writeText = text => { fixture.copied.push(text); }; });
      await showView(page, 'sources'); await until(page, () => document.querySelectorAll('[data-source-rows] [data-source-agent]').length === 17);
      for (const agent of Object.keys(definitions)) {
        await page.locator('[data-source-agent="' + agent + '"]').getByRole('button', {name:/^管理 /}).click();
        await until(page, () => document.querySelector('[data-ui-portal] [role="dialog"] [data-source-setup-action="rescan"] button') && !document.querySelector('[data-ui-portal] [role="dialog"] [data-source-setup-action="rescan"] button').disabled);
        const dialog = page.locator('[data-ui-portal] [role="dialog"]'); assert.match(await dialog.textContent(), /安装与故障恢复/); assert.match(await dialog.textContent(), /读取已停用/);
        await dialog.locator('[data-source-setup-action="rescan"] button').click(); await until(page, () => document.querySelector('[data-setup-message]').textContent.includes('扫描已完成'));
        await dialog.locator('[data-source-setup-action="installation-guide"] button').click(); await until(page, () => document.querySelector('[data-setup-message]').textContent.includes('系统浏览器'));
        if (agent === 'workbuddy') assert.match(await dialog.textContent(), /积分/);
        if (agent === 'cursor') assert.match(await dialog.textContent(), /普通聊天/);
        if (agent === 'antigravity') {
          await dialog.locator('[data-source-setup-action="copy-install-command"] button').click(); await until(page, () => document.querySelector('[data-setup-message]').textContent.includes('已复制'));
          const folder = path.join(home, 'AppData/Local/agy/bin'); fs.mkdirSync(folder, { recursive: true }); const file = path.join(folder, 'agy.exe'), bytes = Buffer.from('SYNTHETIC_NOT_EXECUTABLE'); fs.writeFileSync(file, bytes);
          await dialog.locator('[data-source-setup-action="copy-install-command"] button').click(); await until(page, () => !document.querySelector('[data-ui-portal] [role="dialog"] [data-source-setup-action="copy-install-command"] button'));
          assert.match(await dialog.textContent(), /仍需核验/); assert.deepEqual(fs.readFileSync(file), bytes);
        }
        await dialog.getByRole('button',{name:'关闭',exact:true}).click(); await until(page, () => !document.querySelector('[data-ui-portal] [role=dialog]'));
      }
      const effects = await app.evaluate(electron => electron.shell.setupTest); assert.deepEqual(effects.opened, Object.values(definitions).map(item => item.install)); assert.deepEqual(effects.copied, ['irm https://antigravity.google/cli/install.ps1 | iex']);
      await showView(page, 'sources'); await page.locator('[data-source-agent="gemini"]').getByRole('button',{name:/^管理 /}).click(); await until(page, () => document.querySelector('[data-ui-portal] [role="dialog"] [data-source-setup-action="rescan"] button'));
      await app.evaluate(electron => { electron.shell.setupTest.fail = true; }); await page.locator('[data-ui-portal] [role="dialog"] [data-source-setup-action="installation-guide"] button').click(); await until(page, () => document.querySelector('[data-setup-message]').textContent.includes('未能打开'));
      await page.setViewportSize({ width: 800, height: 650 }); await page.evaluate(() => document.body.classList.add('dark')); await settle(page);
      assert.equal(await page.evaluate(() => document.querySelector('[data-ui-portal] [role=dialog]').scrollWidth <= document.querySelector('[data-ui-portal] [role=dialog]').clientWidth + 1), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
      await page.screenshot({ path: path.join(dir, 'setup-dark-narrow.png') }); await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
      assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger); assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), quotaBytes); assert(!fs.existsSync(path.join(quota, 'codex-homes'))); assert.deepEqual(errors, []);
      results.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), allTenGuides: true, fixedActions: true, errorsAccurate: true, appearanceRevokesInstaller: true, quotaAndUsageSeparate: true, narrowDark: true, preservedLedgerAndQuota: true, realProviderRequests: 0 });
      console.log('PASS ' + scale + ': ten Agent setup guides, fixed actions, actual IPC, failure recovery and narrow dark layout.');
    } finally { await app.close(); await cleanup(root); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
