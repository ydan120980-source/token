'use strict';
// Real Electron, IPC, manual input and Windows encryption. Chrome dispatch and
// quota responses are synthetic; existing profiles and live accounts stay unused.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { showView, keepVisible, isolatePointer, settle, cleanup } = require('./ui-settle');
const q = require('./quota-ui-helpers');
const output = process.env.PROVIDER_LOGIN_EVIDENCE_DIR || 'artifacts/chrome-login-20261021/ui';
async function fixtures(app) {
  await app.evaluate(() => {
    const module = Object.values(process.mainModule.require('node:module')._cache).find(value => /[/\\]src[/\\]quota[/\\]provider-service\.js$/.test(value.filename));
    const prototype = module.exports.ProviderQuotaService.prototype, project = module.require('./resource-contract').projectResources;
    global.chromeFixture = { urls: [], calls: [], browserFails: false, failAuth: false };
    const run = async (adapter, _credential, _signal, context) => {
      global.chromeFixture.calls.push({ adapter, userAgent: context?.userAgent || null });
      if (global.chromeFixture.failAuth) throw Error('PROVIDER_AUTH_REQUIRED');
      if (adapter === 'workbuddy-web' && context?.userAgent !== 'Synthetic Chrome/150') throw Error('PROVIDER_ACTION_INVALID');
      return project({ schemaVersion: 'AccountQuotaV2', provider: module.require('./provider-catalog').routes[adapter].provider, fetchedAt: new Date().toISOString(), provenance: { kind: 'synthetic' }, entitlement: {}, pools: [{ id: 'synthetic', scope: 'account', windows: [{ id: 'five-hour', unit: 'percent', usedPercent: 25, durationMins: 300 }], balances: [] }] });
    };
    const open = prototype.openWebsite, login = prototype.loginWebsite, refresh = prototype.refresh;
    prototype.openWebsite = function (request) { this.fixture = false; this.experimentalEnabled = () => true; return open.call(this, request, async url => { if (global.chromeFixture.browserFails) throw Error('PROVIDER_BROWSER_FAILED'); global.chromeFixture.urls.push(url); }); };
    prototype.loginWebsite = function (...args) { this.fixture = false; this.experimentalEnabled = () => true; this.run = run; return login.apply(this, args); };
    prototype.refresh = function (...args) { this.fixture = false; this.run = run; return refresh.apply(this, args); };
  });
}
(async () => {
  const results = [];
  for (const scale of [1, 1.5]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-login-ui-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'), quota = path.join(root, 'quota'), directory = path.join(output, String(scale));
    fs.mkdirSync(home); fs.mkdirSync(quota); fs.mkdirSync(directory, { recursive: true }); new Store(usage, roots(home)).setEnabled(false); atomic(path.join(quota, 'quota-cache.json'), { accounts: [] });
    const ledger = fs.readFileSync(path.join(usage, 'statistics.json')), executablePath = process.env.QUOTA_PACKAGED_EXE || require('electron'), args = [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale];
    let app = await electron.launch({ executablePath, args, timeout: 60000 });
    try {
      let page = await app.firstWindow(); await keepVisible(app); await isolatePointer(app); const errors = []; page.on('pageerror', error => errors.push(error.message)); await showView(page, 'quota');
      const blocked = await page.evaluate(() => window.quotaBridge.providerWebsiteLogin({ adapter: 'cursor-web', id: null, alias: '合成', consent: true })); assert.equal(blocked.errorCode, 'PROVIDER_FIXTURE_BLOCKED'); await fixtures(app);
      const providers = ['cursor', 'mimo', 'claude', 'workbuddy', 'deepseek', 'gemini', 'opencode'];
      // 2026-10-27 (UI-QUOTA-PAGE-20261027.md): the connection form is a React sheet (quota-ui-helpers).
      const c = q.connection, form = () => q.providerForm(page), manualNow = () => page.locator('[data-provider-method][data-selection="manual"]').waitFor();
      for (const provider of providers) {
        const index = providers.indexOf(provider);
        await c.open(page, provider); await c.setAdapter(page, provider + '-web'); await c.setMethod(page, 'website'); assert.equal(await c.method(page), 'website');
        await c.submit(page); assert.equal(await app.evaluate(() => global.chromeFixture.urls.length), index);
        await c.check(page, 'consent');
        if (!index) {
          await app.evaluate(() => { global.chromeFixture.browserFails = true; }); await c.submit(page); await c.error(page).getByText(/Chrome 未能打开/).waitFor();
          assert.equal(app.windows().length, 1); assert.equal(await c.method(page), 'website'); await app.evaluate(() => { global.chromeFixture.browserFails = false; });
        }
        await c.submit(page); await manualNow();
        assert.equal(app.windows().length, 1); assert.equal(await form().isVisible(), true);
        const opened = (await page.evaluate(() => window.quotaBridge.providers())).state;
        assert.equal(opened.accounts.length, index); assert.equal(opened.pendingWebsiteLogin, null); assert.equal(await app.evaluate(() => global.chromeFixture.calls.length), index);
        const token = provider === 'cursor' ? 'WorkosCursorSessionToken=SYNTHETIC_LOGIN_SECRET' : provider === 'mimo' ? 'api-platform_serviceToken=SYNTHETIC_LOGIN_SECRET; userId=fixture' : provider === 'claude' ? 'sessionKey=SYNTHETIC_LOGIN_SECRET' : provider === 'opencode' ? '__Host-auth=SYNTHETIC_LOGIN_SECRET' : provider === 'deepseek' ? 'SYNTHETIC_LOGIN_SECRET' : 'own_session=SYNTHETIC_LOGIN_SECRET';
        await c.field(page, 'credential').fill(token);
        if (provider === 'workbuddy') { await c.submit(page); assert.equal(await app.evaluate(() => global.chromeFixture.calls.length), index); await c.field(page, 'user-agent').fill('Synthetic Chrome/150'); await settle(page); await page.screenshot({ path: path.join(directory, 'manual-workbuddy.png') }); }
        if (await c.box(page, 'consent').isVisible()) await c.check(page, 'consent');
        await c.submit(page); await form().waitFor({ state: 'detached' });
        const connected = (await page.evaluate(() => window.quotaBridge.providers())).state; assert.equal(connected.accounts.length, index + 1); assert(connected.accounts.every(row => row.remembered && row.status === 'ready'));
      }
      const state = (await page.evaluate(() => window.quotaBridge.providers())).state, secretDir = path.join(quota, 'provider-quotas', 'website-secrets');
      assert.equal(fs.readdirSync(secretDir).length, providers.length);
      for (const file of fs.readdirSync(secretDir)) assert(!fs.readFileSync(path.join(secretDir, file)).includes(Buffer.from('SYNTHETIC_LOGIN_SECRET')));
      assert(!JSON.stringify(state).includes('SYNTHETIC_LOGIN_SECRET')); assert(!fs.readFileSync(path.join(quota, 'provider-quotas', 'connections.json'), 'utf8').includes('SYNTHETIC_LOGIN_SECRET'));
      await settle(page); await page.screenshot({ path: path.join(directory, 'connected.png') });
      await app.close(); app = await electron.launch({ executablePath, args, timeout: 60000 }); page = await app.firstWindow(); await keepVisible(app); await isolatePointer(app); page.on('pageerror', error => errors.push(error.message)); await showView(page, 'quota');
      assert((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.every(row => row.remembered && row.credentialReady && !row.busy)); await fixtures(app); assert.equal(await app.evaluate(() => global.chromeFixture.calls.length), 0);
      const cursor = state.accounts.find(row => row.provider === 'cursor'), workbuddy = state.accounts.find(row => row.provider === 'workbuddy');
      await page.evaluate(id => window.quotaBridge.providerAction({ action: 'refresh', id }), workbuddy.id); assert.equal(await app.evaluate(() => global.chromeFixture.calls[0].userAgent), 'Synthetic Chrome/150');
      await q.detailAction(page, 'cursor', 'credential'); await c.setMethod(page, 'website'); await c.check(page, 'consent'); await c.submit(page); await manualNow();
      await c.field(page, 'credential').fill('WorkosCursorSessionToken=SYNTHETIC_DISCARDED'); await c.close(page);
      assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.length, providers.length);
      await q.detailAction(page, 'cursor', 'credential'); await c.setMethod(page, 'manual'); assert.equal(await c.field(page, 'credential').inputValue(), '', 'a closed form keeps no secret'); await c.close(page);
      await app.evaluate(() => { global.chromeFixture.failAuth = true; }); await page.evaluate(id => window.quotaBridge.providerAction({ action: 'refresh', id }), cursor.id);
      assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.find(row => row.id === cursor.id).status, 'login-required'); assert(!fs.existsSync(path.join(secretDir, cursor.id + '.bin')));
      await page.evaluate(id => window.quotaBridge.providerAction({ action: 'remove', id }), workbuddy.id); assert(!fs.existsSync(path.join(secretDir, workbuddy.id + '.bin')));
      assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger); assert.deepEqual(errors, []);
      results.push({ scale, pass: true, externalChromeDispatch: true, embeddedLoginWindows: 0, browserFailureRetry: true, manualConnections: providers.length, windowsEncryption: true, restoredWithoutNetwork: true, workbuddyUserAgentRestored: true, existingBrowserReads: 0, realProviderRequests: 0 });
    } catch (error) { const page = await app.firstWindow().catch(() => null); await page?.screenshot({ path: path.join(directory, 'failure.png') }).catch(() => {}); throw error; }
    finally { await app.close().catch(() => {}); await cleanup(root); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); console.log('PASS ordinary Chrome dispatch, no embedded login windows, manual quota validation/encryption, browser error retry, restart, expiry and removal. No live accounts.');
})().catch(error => { console.error(error); process.exitCode = 1; });
