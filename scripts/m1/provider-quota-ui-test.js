'use strict';
/* global document */
// Browser plugin is unavailable. Real Electron UI/preload/IPC with synthetic
// provider responses; each run owns all data and never calls a real provider.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { until, showView, keepVisible, settle, cleanup } = require('./ui-settle');
const q = require('./quota-ui-helpers');
const output = process.env.PROVIDER_QUOTA_EVIDENCE_DIR || 'artifacts/account-quota-20261019/ui';
(async () => {
  const results = [];
  for (const scale of [1, 1.5]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-quota-ui-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'), quota = path.join(root, 'quota'), directory = path.join(output, String(scale));
    fs.mkdirSync(home); fs.mkdirSync(quota); fs.mkdirSync(directory, { recursive: true }); new Store(usage, roots(home)).setEnabled(false); atomic(path.join(quota, 'quota-cache.json'), { accounts: [] });
    const ledger = fs.readFileSync(path.join(usage, 'statistics.json')), codexBytes = fs.readFileSync(path.join(quota, 'quota-cache.json'));
    const executablePath = process.env.QUOTA_PACKAGED_EXE || require('electron'), args = [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale];
    let app = await electron.launch({ executablePath, args, timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = []; await keepVisible(app); page.on('pageerror', error => errors.push(error.stack));
      await app.evaluate(electron => {
        const module = Object.values(process.mainModule.require('node:module')._cache).find(value => /[/\\]src[/\\]quota[/\\]provider-service\.js$/.test(value.filename)); if (!module) throw Error('PROVIDER_MODULE_MISSING');
        const parse = module.require('./provider-resources').fromProvider, fixture = electron.shell.providerFixture = { calls: [], copied: [], fail: false, hang: false };
        if (module.require('./quota-json').quotaJSON('{"balance":9007199254740993.125}').balance !== '9007199254740993.125') throw Error('EXACT_JSON_RUNTIME_UNSUPPORTED');
        electron.clipboard.writeText = text => fixture.copied.push(text);
        const connect = module.exports.ProviderQuotaService.prototype.connect;
        module.exports.ProviderQuotaService.prototype.connect = function (request) {
          this.fixture = false; this.experimentalEnabled = () => true;
          this.run = async (adapter, credential, signal, project) => {
            fixture.calls.push(adapter); if (fixture.fail) throw Error('PROVIDER_REQUEST_FAILED'); if (fixture.hang) await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('PROVIDER_CANCELED')), { once: true }));
            if (adapter === 'gemini-code-assist' && project !== 'private-test-project') throw Error('SYNTHETIC_PROJECT_NOT_PASSED');
            if (['cursor-web', 'mimo-web'].includes(adapter) && credential.includes('FOREIGN')) throw Error('COOKIE_WHITELIST_NOT_APPLIED');
            const raw = adapter === 'gemini-code-assist' ? { buckets: [{ modelId: 'gemini-pro', tokenType: 'REQUESTS', remainingAmount: '19', remainingFraction: 0.5 }] } : adapter === 'cursor-web' ? { individualUsage: { plan: { totalPercentUsed: 23 } } } : adapter === 'mimo-web' ? { balance: { code: 0, data: { balance: '0.29', currency: 'CNY' } } } : adapter === 'deepseek-api' ? { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '9007199254740993.125', granted_balance: '0.125', topped_up_balance: '9007199254740993' }] } : { total_capacity_size: 100, total_capacity_used: 25 };
            return parse(adapter, raw, new Date().toISOString());
          }; return connect.call(this, request);
        };
      });
      // 2026-10-27 (UI-QUOTA-PAGE-20261027.md): the connection and details sheets are on the React
      // layer; Agents without a connection are listed below the cards or in the pinned summary.
      const c = q.connection, form = () => q.providerForm(page);
      await showView(page, 'quota'); await until(page, () => document.querySelectorAll('[data-quota-idle-agent]').length === 15);
      assert.match(await q.idleRow(page, 'mimo').innerText(), /网站接口可能变更/); assert.equal(await q.idleRow(page, 'mimo').locator('[data-provider-connect]').count(), 1);
      await c.open(page, 'mimo'); await c.setMethod(page, 'manual');
      assert.equal(await c.checked(page, 'consent'), false); assert.equal(await form().locator('[data-provider-consent]').getAttribute('data-required'), 'true');
      assert.match(await form().locator('[data-provider-field="credential"]').innerText(), /api-platform_serviceToken/);
      await c.field(page, 'credential').fill('api-platform_serviceToken=SYNTHETIC_ONLY; userId=test'); await c.submit(page); assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts.length, 0);
      assert.notEqual(await c.error(page).innerText(), '', 'submitting without consent explains why'); await c.close(page);
      await c.open(page, 'gemini'); await c.manual(page, 'gemini-code-assist'); assert.equal(await c.field(page, 'credential').inputValue(), '', 'a closed form keeps no secret'); assert(await c.field(page, 'project').isVisible()); assert.equal(await c.field(page, 'project').getAttribute('required'), '');
      await c.field(page, 'credential').fill('SYNTHETIC_GOOGLE_TOKEN'); await c.field(page, 'project').fill('private-test-project'); await c.submit(page);
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.some(row => row.provider === 'gemini' && row.status === 'ready'));
      assert(!JSON.stringify((await page.evaluate(() => window.quotaBridge.providers())).state).includes('private-test-project')); assert(!fs.readFileSync(path.join(quota, 'provider-quotas/connections.json'), 'utf8').includes('private-test-project'));
      await form().waitFor({ state: 'detached' }); await q.detailAction(page, 'gemini', 'remove');
      for (const [provider, cookie] of [['cursor', 'WorkosCursorSessionToken=SYNTHETIC_CURSOR; foreign=FOREIGN'], ['mimo', 'api-platform_serviceToken=SYNTHETIC_MIMO; userId=test; foreign=FOREIGN']]) {
        await c.open(page, provider); await c.manual(page, provider + '-web'); assert.equal(await c.checked(page, 'consent'), false); await c.check(page, 'consent'); await c.field(page, 'credential').fill(cookie); await c.submit(page);
        await until(page, async () => (await window.quotaBridge.providers()).state.accounts.some(row => ['cursor', 'mimo'].includes(row.provider) && row.status === 'ready'));
        await form().waitFor({ state: 'detached' }); await q.detailAction(page, provider, 'remove');
      }
      await c.open(page, 'deepseek'); await c.manual(page, 'deepseek-api'); await c.field(page, 'alias').fill('合成 API 余额'); await c.field(page, 'credential').fill('SYNTHETIC_SECRET_NOT_FOR_LOGS'); await c.submit(page);
      await until(page, async () => { const result = await window.quotaBridge.providers(); return result.state.accounts.length === 1 && !result.state.accounts[0].busy; }); await form().waitFor({ state: 'detached' });
      const row = q.card(page, 'deepseek'); assert.match(await row.innerText(), /¥9,007,199,254,740,993\.13/, 'the card groups digits and rounds on the decimal string, never through a float'); assert.equal(await row.locator('[title="9007199254740993.125 CNY"]').count() > 0, true, 'the card keeps the reported value in its tooltip');
      await row.locator('[data-quota-sheet]').first().click(); await settle(page); await page.evaluate(() => window.quotaHost.loadProviders()); await settle(page); const sheet = q.details(page); assert.equal(await sheet.isVisible(), true); assert.match(await sheet.innerText(), /9007199254740993\.125 CNY/); assert.match(await sheet.innerText(), /总额与组成不可相加/); await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' });
      const state = (await page.evaluate(() => window.quotaBridge.providers())).state; assert(!JSON.stringify(state).includes('SYNTHETIC_SECRET')); const first = state.accounts[0].quota.fetchedAt;
      assert(!fs.readFileSync(path.join(quota, 'provider-quotas/connections.json'), 'utf8').includes('SYNTHETIC_SECRET'));
      await app.evaluate(electron => { electron.shell.providerFixture.fail = true; }); await row.locator('[data-provider-action="refresh"]').first().click(); await until(page, async () => { const row = (await window.quotaBridge.providers()).state.accounts[0]; return !row.busy && row.errorCode === 'PROVIDER_REQUEST_FAILED'; });
      assert.equal((await page.evaluate(() => window.quotaBridge.providers())).state.accounts[0].quota.fetchedAt, first);
      await app.evaluate(electron => { electron.shell.providerFixture.fail = false; }); await q.detailAction(page, 'deepseek', 'credential'); if (await c.hasMethod(page)) await c.setMethod(page, 'manual'); await c.check(page, 'remember', false); await c.field(page, 'credential').fill('SYNTHETIC_REPLACEMENT_SECRET'); await c.submit(page); await until(page, async () => !(await window.quotaBridge.providers()).state.accounts[0].busy); await form().waitFor({ state: 'detached' });
      // 全部刷新 also reads each other connection once (2026-10-22, UI-QUOTA-V4-LAYOUT-20261022.md).
      const calls = await app.evaluate(electron => electron.shell.providerFixture.calls.length); await until(page, () => !document.querySelector('[data-quota-refresh-all] button').disabled);
      await q.refreshAll(page).click(); await until(page, () => document.querySelector('[data-quota-summary]')?.textContent === '上次全部刷新：成功 1 / 失败 0 / 跳过 0');
      assert.equal(await app.evaluate(electron => electron.shell.providerFixture.calls.length), calls + 1, 'the provider connection is read by 全部刷新');
      // A hanging read: closing the form leaves the busy connection, whose details offer 取消.
      await app.evaluate(electron => { electron.shell.providerFixture.hang = true; }); await c.open(page, 'workbuddy'); await c.manual(page, 'workbuddy-credit'); await c.field(page, 'credential').fill('SYNTHETIC_SHORT_ACCESS_TOKEN'); await c.submit(page);
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.some(row => row.provider === 'workbuddy' && row.busy)); await c.close(page);
      await q.detailAction(page, 'workbuddy', 'cancel'); await until(page, async () => !(await window.quotaBridge.providers()).state.accounts.find(row => row.provider === 'workbuddy').busy);
      await q.detailAction(page, 'workbuddy', 'remove'); await app.evaluate(electron => { electron.shell.providerFixture.hang = false; });
      for(const provider of ['claude','antigravity']) {
        await page.evaluate(name=>{window.passiveTestProvider=name;},provider);
        await c.open(page,provider);await c.setAdapter(page,provider+'-statusline');assert.equal(await c.field(page,'credential').isVisible(),false);await c.submit(page);
        await until(page,async ()=>(await window.quotaBridge.providers()).state.accounts.some(row=>row.provider===window.passiveTestProvider&&!row.busy));
        await form().waitFor({state:'detached'});await q.detailAction(page,provider,'passive-guide');
        const current=(await page.evaluate(()=>window.quotaBridge.providers())).state.accounts.find(row=>row.provider===provider);
        const exported=await app.evaluate((electron,value)=>{
          const module=Object.values(process.mainModule.require('node:module')._cache).find(value=>/[/\\]src[/\\]quota[/\\]claude-passive\.js$/.test(value.filename));
          const path=module.require('node:path'),directory=path.dirname(module.filename);
          const raw=value.provider==='antigravity'?{product:'antigravity',version:'1.2.11',email:'PRIVATE_EMAIL',cwd:'PRIVATE_SOURCE_PATH',conversation_id:'PRIVATE_SESSION',quota:{PRIVATE_BUCKET:{remaining_fraction:0.75,reset_time:new Date(Date.now()+3600000).toISOString()}}}:{version:'2.1.303',cwd:'PRIVATE_SOURCE_PATH',session_id:'PRIVATE_SESSION',rate_limits:{five_hour:{used_percentage:42,resets_at:Math.floor(Date.now()/1000)+3600}}};
          const result=module.require('node:child_process').spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(directory.replace(/app\.asar([\\/])/,'app.asar.unpacked$1'),'claude-statusline-export.ps1'),'-Executable',process.execPath,'-Script',path.join(directory,'provider-passive-export.js'),'-Connection',value.id,'-Directory',value.root],{input:JSON.stringify(raw),encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:8192});
          return {status:result.status,stdout:result.stdout,stderr:result.stderr};
        },{id:current.id,root:path.join(quota,'provider-quotas'),provider});
        assert.equal(exported.status,0,exported.stderr);assert(!JSON.stringify(exported).includes('PRIVATE_'));
        await page.locator('#quotaCards [data-provider-row="'+provider+'"] [data-provider-action="refresh"]').first().click();
        await until(page,async ()=>(await window.quotaBridge.providers()).state.accounts.find(row=>row.provider===window.passiveTestProvider).quota?.pools.length===1);
        await settle(page);assert.equal(await page.locator('#quotaCards [data-provider-row="'+provider+'"] .quota-figure').first().textContent(),provider==='antigravity'?'75%':'58%');
      }
      await app.evaluate(async()=>{
        const module=Object.values(process.mainModule.require('node:module')._cache).find(value=>/[/\\]src[/\\]quota[/\\]provider-service\.js$/.test(value.filename));
        try{await module.exports.runWorker('not-a-provider','SYNTHETIC_ONLY',new AbortController().signal);throw Error('INVALID_WORKER_ACCEPTED');}catch(error){if(error.message!=='PROVIDER_CREDENTIAL_REQUIRED')throw error;}
      });
      const copied = await app.evaluate(electron => electron.shell.providerFixture.copied); assert.equal(copied.length, 2); assert(copied[0].includes('claude-statusline-export.ps1')); assert(!copied[0].includes('PRIVATE_SOURCE_PATH'));
      const connections = await page.evaluate(() => window.usageBridge.connections()); assert.equal(connections.rows.find(row => row.agent === 'deepseek').quota.connections, 1); assert.equal(connections.rows.find(row => row.agent === 'claude').quota.connections, 1);assert.equal(connections.rows.find(row=>row.agent==='antigravity').quota.connections,1);
      await page.setViewportSize({ width: 800, height: 650 }); await page.evaluate(() => document.body.classList.add('dark')); await c.open(page, 'zcode'); await settle(page); assert(await form().evaluate(element => element.scrollWidth <= element.clientWidth + 1)); await page.screenshot({ path: path.join(directory, 'provider-connection-dark-narrow.png') }); await c.close(page);
      assert.deepEqual(errors, []); assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger); assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), codexBytes);
      await app.close(); app = null;
      const restored = await electron.launch({ executablePath, args, timeout: 60000 });
      try { const restoredPage = await restored.firstWindow(); await keepVisible(restored); await showView(restoredPage, 'quota'); await until(restoredPage, async () => (await window.quotaBridge.providers()).state.accounts.length === 3); const after = (await restoredPage.evaluate(() => window.quotaBridge.providers())).state.accounts; assert.equal(after.find(row => row.provider === 'deepseek').credentialReady, false); assert.equal(after.find(row => row.provider === 'deepseek').status, 'cached'); assert.equal(after.find(row => row.provider === 'deepseek').quota.fetchedAt !== null, true); } finally { await restored.close(); }
      results.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), exactBalances: true, memoryOnlyCredentials: true, retainedFailure: true, cancellation: true, passiveClaude: true, passiveAntigravity: true, manualConfigurationOnly: true, sourceStatusAligned: true, restartNoAutomaticAPIRead: true, sourceAndCodexBytesUnchanged: true, realProviderRequests: 0 }); console.log('PASS provider quota UI ' + scale);
    } finally { if (app) await app.close(); await cleanup(root); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
