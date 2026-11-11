'use strict';
// Real Electron/preload/IPC and Windows safeStorage. All client and quota
// capabilities are replaced before the first action; no real credentials/CLI.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { showView, keepVisible, isolatePointer, until, settle, cleanup } = require('./ui-settle');
const q = require('./quota-ui-helpers');
const output = process.env.PROVIDER_CLIENT_EVIDENCE_DIR || 'artifacts/codexbar-login-parity-20261020/client-ui';
async function fixtures(app) {
  await app.evaluate(() => {
    const module = Object.values(process.mainModule.require('node:module')._cache).find(value => /[/\\]src[/\\]quota[/\\]provider-service\.js$/.test(value.filename));
    const prototype = module.exports.ProviderQuotaService.prototype, original = prototype.loginWebsite, project = module.require('./resource-contract').projectResources;
    const quotaPrototype = module.require('./service').QuotaService.prototype, setAuto = quotaPrototype.setAutoRefresh;
    quotaPrototype.setAutoRefresh = function (value) { global.clientFixture.quotaService = this; return setAuto.call(this, value); };
    global.clientFixture = { calls: [], quotaReads: 0, fail: false, hang: false };
    prototype.loginWebsite = function (request, client, supplied) {
      this.fixture = false; this.experimentalEnabled = () => true; global.clientFixture.service = this;
      this.clientLogin = async (adapter, signal, _id, _context, options) => {
        global.clientFixture.calls.push({ adapter, fresh: options.fresh });
        if (global.clientFixture.hang) await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('PROVIDER_CANCELED')), { once: true }));
        if (global.clientFixture.keyMissing && adapter === 'deepseek-api') throw Error('PROVIDER_CLIENT_CREDENTIAL_MISSING');
        const expiresAt = adapter === 'opencode-zen' ? new Date(Date.now() + 3600000).toISOString() : null;
        return { credential: adapter === 'cursor-web' ? 'WorkosCursorSessionToken=SYNTHETIC_CLIENT_SECRET' : 'SYNTHETIC_CLIENT_SECRET', expiresAt, context: adapter === 'opencode-zen' ? { console: { orgId: 'org_SYNTHETIC' }, deviceGrant: true, oauth: { clientId: 'opencode-cli', refreshToken: 'SYNTHETIC_OWN_REFRESH', expiresAt } } : adapter === 'gemini-code-assist' ? { discover: true } : null };
      };
      this.run = async adapter => { global.clientFixture.quotaReads++; if (global.clientFixture.hold) await new Promise(resolve => global.clientFixture.waiters.push(resolve)); if (global.clientFixture.fail) throw Error('PROVIDER_AUTH_REQUIRED'); if(adapter==='zcode-device')return module.require('./provider-resources').fromProvider(adapter,{code:0,data:{balances:[]}},new Date().toISOString()); return project({ schemaVersion: 'AccountQuotaV2', provider: module.require('./provider-catalog').routes[adapter].provider, fetchedAt: new Date().toISOString(), provenance: { kind: 'synthetic' }, entitlement: {}, pools: [{ id: 'synthetic', scope: 'account', windows: [{ id: 'five-hour', unit: 'percent', usedPercent: 25, durationMins: 300 }], balances: [] }] }); };
      return original.call(this, request, client, supplied);
    };
  });
}
(async () => {
  fs.mkdirSync(output, { recursive: true }); const results = [];
  for (const scale of [1, 1.5]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-login-ui-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'), quota = path.join(root, 'quota'); fs.mkdirSync(home); fs.mkdirSync(quota);
    new Store(usage, roots(home)).setEnabled(false); atomic(path.join(quota, 'quota-cache.json'), { accounts: [] });
    const originalLedger = fs.readFileSync(path.join(usage, 'statistics.json')), args = [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale];
    let app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args, timeout: 60000 });
    try {
      let page = await app.firstWindow(); await keepVisible(app); await isolatePointer(app); await showView(page, 'quota');
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      // 2026-10-27 (UI-QUOTA-PAGE-20261027.md): connection and details sheets are React sheets.
      const c = q.connection, form = () => q.providerForm(page);
      const blocked = await page.evaluate(() => window.quotaBridge.providerClientLogin({ adapter: 'claude-oauth', alias: 'fixture', id: null, consent: true })); assert.equal(blocked.errorCode, 'PROVIDER_FIXTURE_BLOCKED'); await fixtures(app);
      for (const [provider, adapter, fresh] of [['claude', 'claude-oauth', true], ['gemini', 'gemini-code-assist', false], ['antigravity', 'antigravity-cli', true], ['zcode', 'zcode-device', false], ['workbuddy', 'workbuddy-desktop', false], ['cursor', 'cursor-web', false], ['opencode', 'opencode-zen', false]]) {
        await c.open(page, provider); await c.setAdapter(page, adapter); await c.setMethod(page, fresh ? 'client-new' : 'client');
        assert.equal(await c.field(page, 'credential').isVisible(), false); assert.equal(await c.field(page, 'project').isVisible(), false);
        await c.check(page, 'consent'); await c.submit(page); await until(page, () => !window.quotaHost.get().connecting); await settle(page); assert.equal(await form().count(), 0, adapter + ': ' + (await form().count() ? await c.error(page).textContent() : ''));
      }
      const calls = await app.evaluate(() => global.clientFixture.calls); assert.deepEqual(calls.map(value => value.fresh), [true, false, true, false, false, false, false]);
      await c.open(page, 'deepseek'); await c.setAdapter(page, 'deepseek-api'); await c.setMethod(page, 'client'); assert.match(await page.getByRole('combobox', { name: '连接方式', exact: true }).innerText(), /API key/); await c.check(page, 'consent'); await app.evaluate(() => { global.clientFixture.keyMissing = true; }); await c.submit(page); await until(page, () => !window.quotaHost.get().connecting); await page.locator('[data-provider-method][data-selection="manual"]').waitFor(); assert.equal(await c.field(page, 'credential').isVisible(), true); assert.match(await c.error(page).innerText(), /PROVIDER_CLIENT_CREDENTIAL_MISSING/); assert.equal(await c.checked(page, 'remember'), true);
      await c.field(page, 'credential').fill('SYNTHETIC_MANUAL_SECRET'); await c.submit(page); await form().waitFor({ state: 'detached' });
      let state = (await page.evaluate(() => window.quotaBridge.providers())).state; assert.equal(state.accounts.length, 8); assert(state.accounts.every(row => row.remembered && row.status === 'ready')); assert(!JSON.stringify(state).includes('SECRET')); const emptyZcode=state.accounts.find(row=>row.adapter==='zcode-device'); assert.equal(emptyZcode.quota.hasMeasurements,false); assert.deepEqual(emptyZcode.quota.pools,[]); assert.equal(emptyZcode.quota.partial,true); assert.match(await page.locator('#quotaCards [data-provider-row="zcode"]').innerText(),/已连接，没有额度项/); assert.match(await page.locator('#quotaCards [data-provider-row="zcode"]').innerText(),/额度未知/);
      const secretDir = path.join(quota, 'provider-quotas/website-secrets'); for (const name of fs.readdirSync(secretDir)) assert(!fs.readFileSync(path.join(secretDir, name)).includes(Buffer.from('SYNTHETIC_')));
      assert(!fs.readFileSync(path.join(quota, 'provider-quotas/connections.json'), 'utf8').includes('SECRET'));
      await q.detailAction(page, 'claude', 'credential');
      await c.setMethod(page, 'client-new'); await c.check(page, 'consent'); await app.evaluate(() => { global.clientFixture.fail = true; }); await c.submit(page); await until(page, () => !window.quotaHost.get().connecting); assert.match(await c.error(page).innerText(), /失效/);
      state = (await page.evaluate(() => window.quotaBridge.providers())).state; assert.equal(state.accounts.length, 8); assert.equal(state.accounts.find(row => row.provider === 'claude').status, 'ready'); await c.close(page);
      await app.evaluate(() => { global.clientFixture.fail = false; global.clientFixture.hang = true; }); await c.open(page, 'claude'); await c.setAdapter(page, 'claude-oauth'); await c.check(page, 'consent'); await c.submit(page); await until(page, async () => Boolean((await window.quotaBridge.providers()).state.pendingWebsiteLogin)); await c.close(page); await until(page, async () => !(await window.quotaBridge.providers()).state.pendingWebsiteLogin); assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.length, 8);
      await app.evaluate(() => { global.clientFixture.hang = false; });
      await form().waitFor({ state: 'detached' }); await settle(page);
      // A transient startup vault failure must offer refresh and recover without another login.
      const retryId = await app.evaluate(() => { const service = global.clientFixture.service, row = service.rows.find(row => row.adapter === 'workbuddy-desktop'); service.secrets.delete(row.id); service.remembered.delete(row.id); row.errorCode = 'PROVIDER_SECRET_STORAGE_FAILED'; service.notify(); return row.id; });
      await q.card(page, 'workbuddy').locator('[data-quota-sheet]').first().click(); await q.details(page).waitFor(); await settle(page);
      const retry = q.details(page).locator('[data-quota-sheet-refresh="' + retryId + '"] button'); await retry.waitFor(); assert.equal(await retry.isEnabled(), true);
      const logins = await app.evaluate(() => global.clientFixture.calls.length); await retry.click();
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.find(row => row.adapter === 'workbuddy-desktop')?.credentialReady === true);
      assert.equal(await app.evaluate(() => global.clientFixture.calls.length), logins);
      await page.keyboard.press('Escape'); await q.details(page).waitFor({ state: 'detached' });
      // Fresh WorkBuddy reconnect must replace an unreadable old encrypted record.
      await app.evaluate(() => { const service = global.clientFixture.service, row = service.rows.find(row => row.adapter === 'workbuddy-desktop'); const fs = process.getBuiltinModule('fs'); fs.writeFileSync(service.secretStore.file(row.id), 'synthetic damaged encrypted record'); service.secrets.delete(row.id); service.remembered.delete(row.id); row.errorCode = 'PROVIDER_SECRET_STORAGE_FAILED'; service.notify(); });
      await q.detailAction(page, 'workbuddy', 'credential');
      await c.setMethod(page, 'client'); await c.check(page, 'consent'); await c.submit(page);
      await form().waitFor({ state: 'detached' });
      assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.filter(row => row.adapter === 'workbuddy-desktop' && row.remembered && row.credentialReady).length, 1);
      if (await q.details(page).isVisible()) { await page.keyboard.press('Escape'); await q.details(page).waitFor({ state: 'detached' }); }
      // The actual refresh button must enter all eight independent transports before any completes.
      await app.evaluate(() => { global.clientFixture.hold = true; global.clientFixture.waiters = []; });
      await q.refreshAll(page).click();
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.filter(row => row.status === 'refreshing').length === 8);
      assert.equal(await app.evaluate(() => global.clientFixture.waiters.length), 8);
      await app.evaluate(() => { global.clientFixture.hold = false; for (const release of global.clientFixture.waiters) release(); });
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.every(row => row.status === 'ready' && !row.busy));
      // Exercise the real shared timer dispatch with synthetic providers. No minute-long sleep.
      const beforeAuto = await app.evaluate(() => global.clientFixture.quotaReads);
      await q.choose(page, '额度自动刷新', '每分钟');
      await app.evaluate(async () => { const service = global.clientFixture.quotaService; service.suspend(); service.nextAutoAt = new Date(Date.now() - 1).toISOString(); await service.resume(); });
      const afterAuto = await app.evaluate(() => ({ reads: global.clientFixture.quotaReads, batch: global.clientFixture.quotaService.lastProviderBatch }));
      assert.equal(afterAuto.reads - beforeAuto, 7, 'the route that starts a program just read, so it waits its five minutes'); assert.deepEqual(afterAuto.batch, { success: 7, failed: 0, skipped: 1 });
      for (const width of [800, 1180]) {
        await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 850), width); await settle(page);
        // The cadence control (owner 2026-10-23: its caption must not clip): caption, then the select.
        const fit = await page.locator('[data-quota-cadence]').evaluate(label => {
          const caption = label.firstElementChild, button = label.querySelector('[role="combobox"]');
          return { gap: button.getBoundingClientRect().left - caption.getBoundingClientRect().right, captionFits: caption.scrollWidth <= caption.clientWidth + 1, textFits: button.scrollWidth <= button.clientWidth + 1, oneLine: caption.getBoundingClientRect().height < 24 };
        });
        assert(fit.gap >= 0 && fit.captionFits && fit.textFits && fit.oneLine, JSON.stringify(fit));
      }
      await page.screenshot({ path: path.join(output, 'connected-' + scale + '.png') }); await q.choose(page, '额度自动刷新', '关闭'); await app.close();
      app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args, timeout: 60000 }); page = await app.firstWindow(); await keepVisible(app); await isolatePointer(app); await showView(page, 'quota');
      const restored = (await page.evaluate(() => window.quotaBridge.providers())).state; assert.equal(restored.accounts.length, 8); assert(restored.accounts.every(row => row.remembered && row.credentialReady && !row.busy)); assert.equal(restored.accounts.find(row=>row.adapter==='zcode-device').quota.hasMeasurements,false);
      assert.deepEqual(errors, []); assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), originalLedger);
      results.push({ scale, pass: true, officialClientChoices: true, explicitAccountSwitch: true, manualKeyRemembered: true, failedSwitchRetainsOldAccount: true, cancelNoLateConnection: true, encryptedRestart: true, corruptVaultReconnect: true, concurrentBatch: true, allProviderMinuteRefresh: true, cadenceTextFits: true, emptyZcodeConnectedAsUnknown: true, realCredentialReads: 0, realProviderRequests: 0 });
      console.log('PASS provider client login UI ' + scale);
    } finally { await app.close().catch(() => {}); await cleanup(root); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
