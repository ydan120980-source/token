'use strict';
/* global document */
// Browser plugin not available. Real Electron/preload/IPC; every installer and
// OS browser/clipboard action is a synthetic implementation in a fixture home.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { until, showView, keepVisible, settle, cleanup } = require('./ui-settle');
const output = process.env.INSTALL_EVIDENCE_DIR || 'artifacts/direct-agent-install-20261019/ui';
(async () => {
  const results = [];
  for (const scale of [1, 1.25, 1.5]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-install-ui-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'), quota = path.join(root, 'quota'), directory = path.join(output, String(scale)); fs.mkdirSync(home); fs.mkdirSync(quota); fs.mkdirSync(directory, { recursive: true });
    new Store(usage, roots(home)).setEnabled(false); atomic(path.join(quota, 'quota-cache.json'), { schemaVersion: 'QuotaCacheV2', accounts: [] });
    const ledger = fs.readFileSync(path.join(usage, 'statistics.json')), quotaBytes = fs.readFileSync(path.join(quota, 'quota-cache.json'));
    const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = []; await keepVisible(app); page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await app.evaluate(electron => {
        const module = Object.values(process.mainModule.require('node:module')._cache).find(module => /[/\\]src[/\\]quota[/\\]agent-install-service\.js$/.test(module.filename)); if (!module) throw Error('INSTALL_MODULE_MISSING');
        const fixture = electron.shell.installFixture = { calls: [], opened: [], official: [], copied: [], versions: {}, latest: '2.0.0', fail: false, hang: false, desktopDone: false };
        electron.shell.openPath = async file => { fixture.opened.push(file); return ''; }; electron.shell.openExternal = async url => { fixture.official.push(url); }; electron.clipboard.writeText = text => { fixture.copied.push(text); };
        module.exports.AgentInstallService.prototype.run = async function(request, report, signal) {
          if (!this.fixture) throw Error('FIXTURE_ONLY'); fixture.calls.push({ ...request }); report({ stage: request.action === 'check' ? 'checking' : 'installing' });
          await new Promise((resolve, reject) => { const timer = setTimeout(resolve, fixture.hang && request.agent === 'opencode' ? 60000 : 120); signal.addEventListener('abort', () => { clearTimeout(timer); reject(Error('INSTALL_CANCELED')); }, { once: true }); });
          if (request.action === 'install') {
            if (fixture.fail && request.agent === 'mimo') throw Error('INSTALL_DOWNLOAD_FAILED');
            if (request.agent === 'cursor') { const fs = process.mainModule.require('node:fs'), path = process.mainModule.require('node:path'), crypto = process.mainModule.require('node:crypto'), file = path.join(this.root, 'cursor', 'synthetic', 'installer.exe'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'SYNTHETIC_NOT_EXECUTABLE'); return { awaitingInstaller: true, path: file, version: fixture.latest, sha256: crypto.createHash('sha256').update('SYNTHETIC_NOT_EXECUTABLE').digest('hex') }; }
            fixture.versions[request.agent] = fixture.latest; return { installed: true, version: fixture.latest };
          }
          if(request.agent==='claude'&&fixture.localMaintenance)return {state:'unverified',localMaintenanceRequired:true,checkError:'INSTALL_LOCAL_MAINTENANCE_REQUIRED'};
          const version = request.agent === 'cursor' ? fixture.desktopDone ? fixture.latest : '1.0.0' : request.agent === 'claude' ? fixture.versions.claude || '1.0.0' : fixture.versions[request.agent];
          return { state: version ? 'installed' : 'missing', version: version || null, latest: fixture.latest, canRollback: request.agent === 'claude' && Boolean(fixture.claudeBackup), managed: request.agent !== 'cursor' && Boolean(version), runnable: Boolean(version), launchCommand: version && request.agent !== 'cursor' ? "& 'C:\\synthetic\\mimo.exe'" : null };
        };
      });
      await showView(page, 'sources'); await page.locator('[data-sources-page] button:has-text("安装与更新")').click(); const dialog = page.locator('[data-ui-portal] [role="dialog"]'); await dialog.locator('[data-install-row]').nth(9).waitFor();
      await dialog.getByRole('button',{name:'检查版本与更新',exact:true}).click(); await until(page, async () => (await window.usageBridge.installers()).state.rows.every(row => !row.busy && row.state !== 'unchecked'));
      const row = agent => dialog.locator('[data-install-row="' + agent + '"]'); assert.match(await row('mimo').innerText(), /未安装/);
      await row('mimo').locator('[data-source-install-action="install"] button').click(); await row('mimo').getByText('正在安装', { exact: true }).waitFor();
      assert.equal(await row('mimo').locator('[data-source-install-action="install"] button').isDisabled(), true); await until(page, async () => { const row = (await window.usageBridge.installers()).state.rows.find(row => row.agent === 'mimo'); return !row.busy && row.version === '2.0.0'; });
      await row('mimo').locator('[data-source-install-action="copy-launch"] button').click();
      await app.evaluate(electron => { electron.shell.installFixture.latest = '2.1.0'; electron.shell.installFixture.fail = true; });
      await row('mimo').locator('[data-source-install-action="check"] button').click(); await until(page, async () => (await window.usageBridge.installers()).state.rows.find(row => row.agent === 'mimo').updateAvailable);
      await row('mimo').locator('[data-source-install-action="install"] button').click(); await until(page, async () => (await window.usageBridge.installers()).state.rows.find(row => row.agent === 'mimo').stage === 'failed'); assert.match(await row('mimo').innerText(), /2\.0\.0/);
      await app.evaluate(electron => { electron.shell.installFixture.fail = false; }); await row('mimo').locator('[data-source-install-action="install"] button').click(); await until(page, async () => { const row = (await window.usageBridge.installers()).state.rows.find(row => row.agent === 'mimo'); return !row.busy && row.version === '2.1.0'; });
      await app.evaluate(electron => { electron.shell.installFixture.hang = true; }); await row('opencode').locator('[data-source-install-action="install"] button').click(); await row('opencode').locator('[data-source-install-action="cancel"] button').click(); await until(page, async () => (await window.usageBridge.installers()).state.rows.find(row => row.agent === 'opencode').stage === 'canceled');
      await row('claude').locator('[data-source-install-action="install"] button').click(); await until(page, async () => { const row=(await window.usageBridge.installers()).state.rows.find(row=>row.agent==='claude');return !row.busy&&row.managed&&row.version==='2.1.0'; });
      assert.equal(await row('claude').locator('[data-source-install-action="rollback"] button').count(),0);
      await app.evaluate(electron=>{electron.shell.installFixture.localMaintenance=true;});
      await row('claude').locator('[data-source-install-action="check"] button').click();await until(page,async()=>{const row=(await window.usageBridge.installers()).state.rows.find(row=>row.agent==='claude');return !row.busy&&row.localMaintenanceRequired;});
      assert.equal(await row('claude').locator('[data-source-install-action="install"] button').isDisabled(),true);assert.match(await row('claude').innerText(),/本机工具/);
      await row('cursor').locator('[data-source-install-action="install"] button').click(); await until(page, async () => (await window.usageBridge.installers()).state.rows.find(row => row.agent === 'cursor').stage === 'awaiting-installer');
      assert.match(await row('cursor').innerText(), /尚未确认安装完成/); await row('cursor').locator('[data-source-install-action="check"] button').click(); await until(page, async () => { const row = (await window.usageBridge.installers()).state.rows.find(row => row.agent === 'cursor'); return !row.busy && row.stage === 'awaiting-installer'; });
      await app.evaluate(electron => { electron.shell.installFixture.desktopDone = true; }); await row('cursor').locator('[data-source-install-action="check"] button').click(); await until(page, async () => { const row = (await window.usageBridge.installers()).state.rows.find(row => row.agent === 'cursor'); return !row.busy && row.stage === 'complete'; });
      await row('cursor').locator('[data-source-install-action="official"] button').click();
      await page.setViewportSize({ width: 800, height: 650 }); await page.evaluate(() => document.body.classList.add('dark')); await settle(page); assert(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)); await page.screenshot({ path: path.join(directory, 'direct-installer-dark-narrow.png') });
      await dialog.getByRole('button',{name:'关闭',exact:true}).click(); await showView(page, 'sources'); await page.locator('[data-source-agent="mimo"]').getByRole('button',{name:/^管理 /}).click(); const sheet = page.locator('[data-ui-portal] [role="dialog"] [data-install-row="mimo"]'); await sheet.waitFor(); assert.match(await sheet.innerText(), /2.1.0/); await sheet.locator('[data-source-install-action="check"] button').click(); await until(page, async () => { const row = (await window.usageBridge.installers()).state.rows.find(row => row.agent === 'mimo'); return !row.busy; }); await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
      const effects = await app.evaluate(electron => electron.shell.installFixture); assert(!effects.calls.some(call=>Object.hasOwn(call,'allowGoverned')||call.action==='rollback')); assert.equal(effects.opened.length, 1); assert.deepEqual(effects.official, ['https://cursor.com/download']); assert.equal(effects.copied.length, 1); assert(!effects.calls.some(call => Object.keys(call).some(key => /url|command|path/i.test(key))));
      assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger); assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), quotaBytes); assert(!fs.existsSync(path.join(quota, 'codex-homes'))); assert.deepEqual(errors, []);
      results.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), tenInstallRows: true, directInstall: true, progress: true, upgradeRetainsOldOnFailure: true, retry: true, cancellation: true, desktopRequiresPostcheck: true, claudeAppOwnedAndLegacyBlocked: true, officialFallback: true, narrowDark: true, businessBytesUnchanged: true, realOSInstallerStarted: false }); console.log('PASS ' + scale + ': direct install/upgrade, progress, cancel/retry, desktop handoff/postcheck and official fallback.');
    } finally { await app.close(); await cleanup(root); }
  }
  fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
