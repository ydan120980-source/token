'use strict';
/* global document, getComputedStyle */
// Browser plugin not available. Native Electron/preload/IPC, isolated synthetic
// home and app data; no client credentials, provider requests or CLI execution.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { showView, settle, until, keepVisible, isolatePointer, cleanup } = require('./ui-settle');
const q = require('./quota-ui-helpers');
const output = process.env.QUOTA_IDENTITY_EVIDENCE_DIR || path.join(os.tmpdir(), 'agent-usage-quota-identity-evidence-' + process.pid);
async function fixture(app) {
  await app.evaluate(electron => {
    const module = Object.values(process.mainModule.require('node:module')._cache).find(value => /[/\\]src[/\\]quota[/\\]provider-service\.js$/.test(value.filename));
    const parse = module.require('./provider-resources').fromProvider, vault = new Map();
    const data = electron.shell.identityFixture = { calls: 0, fail: null, complete: {}, copied: [] };
    electron.clipboard.writeText = value => data.copied.push(value);
    const original = module.exports.ProviderQuotaService.prototype.loginWebsite;
    module.exports.ProviderQuotaService.prototype.loginWebsite = function (request, ...args) {
      this.fixture = false; this.experimentalEnabled = () => true; this.prepare = null; data.service = this;
      this.secretStore = { available: () => true, get: id => vault.get(id), snapshot: id => vault.get(id) || null, restore: (id, value) => value ? vault.set(id, value) : vault.delete(id), put: (id, _adapter, credential, expiresAt, context) => vault.set(id, { credential, expiresAt, context }), remove: id => vault.delete(id) };
      this.clientLogin = async () => ({ credential: 'SYNTHETIC_' + (request.alias.startsWith('甲') ? 'A' : 'B') + (request.alias.endsWith('一') ? '1' : '2'), context: { desktop: { uid: request.alias.startsWith('甲') ? 'SYNTHETIC_ACCOUNT_A' : 'SYNTHETIC_ACCOUNT_B', domain: 'copilot.tencent.com' } } });
      this.run = async (adapter, credential) => {
        data.calls++; if (data.fail === credential) throw Error('PROVIDER_REQUEST_FAILED');
        const second = credential.startsWith('SYNTHETIC_B'), complete = data.complete[credential] ?? !second;
        if (adapter === 'workbuddy-web') return parse(adapter, { code: 0, data: { Packages: [1, 2].map(i => ({ CapacityUnit: 'credits', SubscriptionPackageName: '网站包 ' + i, CycleTotalCapacity: '100', CycleRemainCapacity: '5' })) } }, new Date().toISOString());
        return parse(adapter, { code: 0, data: { Response: { Data: { Accounts: [1, 2].map(i => ({ CapacityType: 1, PackageName: '合成积分包 ' + i, CapacitySize: '100', CapacityRemain: String((second ? 20 : 0) + i * 10), ExpiredTime: '2099-01-01 00:00:00' })) } } } }, new Date().toISOString(), { completePackages: complete });
      };
      return original.call(this, request, ...args);
    };
  });
}
async function login(page, alias, id = null) {
  const result = await page.evaluate(request => window.quotaBridge.providerClientLogin(request), { adapter: 'workbuddy-desktop', alias, id, consent: true });
  assert.equal(result.ok, true, result.error);
  // IPC completion precedes the renderer's coalesced quota:update read. Wait
  // for revalidated facts, not just IDs that already existed after restart.
  const fields=['id','alias','status','identityStatus','duplicateKnown','busy','errorCode'];
  await page.waitForFunction(expected => expected.every(value => window.quotaHost.get().providerState?.accounts.some(row => row.id===value.id&&Object.keys(value).every(key=>row[key]===value[key]))), result.state.accounts.map(row=>Object.fromEntries(fields.map(key=>[key,row[key]]))));
  const connected = result.state.accounts.find(row => id ? row.id === id : row.alias === alias).id;
  await page.locator('#quotaCards [data-connections~="' + connected + '"]').waitFor();
  await page.waitForFunction(id=>{const expected=window.quotaHost.model.gridView().shown.find(entry=>entry.item.members.some(row=>row.id===id))?.item.members.map(row=>row.id).sort().join(' ');const card=[...document.querySelectorAll('#quotaCards [data-connections]')].find(node=>node.dataset.connections.split(' ').includes(id));return expected&&card?.dataset.connections.split(' ').sort().join(' ')===expected;},connected);
  await settle(page); return connected;
}
// Connections known to be one account share a card (2026-10-22, UI-QUOTA-V4-CARDS-20261022.md); any member finds it.
const card = (page, id) => page.locator('#quotaCards [data-connections~="' + id + '"]');
// 2026-10-27 (UI-QUOTA-PAGE-20261027.md): the details sheet is a React sheet; each connection is a section
// with its own actions in the sheet's footer.
const sheetRow = (page, id) => q.details(page).locator('[data-quota-account="' + id + '"]');
const sheetAction = (page, id, hook) => q.details(page).locator('[' + hook + '="' + id + '"] button');
async function open(page, id) { await card(page, id).locator('[data-quota-details]').click(); await q.details(page).waitFor(); await settle(page); }
async function closeSheet(page) { await page.keyboard.press('Escape'); await q.details(page).waitFor({ state: 'detached' }); await settle(page); }
(async () => {
  const results = []; fs.mkdirSync(output, { recursive: true });
  for (const scale of [1, 1.5]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-identity-ui-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'), quota = path.join(root, 'quota'), evidence = path.join(output, String(scale));
    fs.mkdirSync(home); fs.mkdirSync(quota); fs.mkdirSync(evidence, { recursive: true }); new Store(usage, roots(home)).setEnabled(false); atomic(path.join(quota, 'quota-cache.json'), { accounts: [] });
    const ledger = fs.readFileSync(path.join(usage, 'statistics.json')), codex = fs.readFileSync(path.join(quota, 'quota-cache.json'));
    const executablePath = process.env.QUOTA_PACKAGED_EXE || require('electron'), args = [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', quota, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale, ...(process.env.QUOTA_IDENTITY_SRGB === '1' ? ['--force-color-profile=srgb'] : [])];
    let app, page;
    try {
      app = await electron.launch({ executablePath, args, timeout: 60000 }); page = await app.firstWindow(); await keepVisible(app); await isolatePointer(app); await showView(page, 'quota');
      const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      assert.match(page.url(), /^file:/); assert.match(await page.title(), /Agent Usage/); assert(await page.locator('[data-quota-idle]').first().innerText());
      await page.setViewportSize({ width: scale === 1 ? 1320 : 1000, height: 900 }); if (scale === 1.5) await page.evaluate(() => document.body.classList.add('dark'));
      await fixture(app);
      const a = await login(page, '甲一'), aa = await login(page, '甲二 <b>名称</b>'), b = await login(page, '乙一'), bb = await login(page, '乙二');
      assert.equal(await page.locator('#quotaCards [data-provider-row="workbuddy"]').count(), 2, 'each known account is one card; the two accounts stay apart');
      for (const id of [a, aa, b, bb]) { assert.match(await card(page, id).locator('.quota-status').innerText(), /同一账号 · 2 个连接/); assert.match(await card(page, id).locator('.quota-alias').innerText(), /2 个连接/); }
      assert.notEqual(await card(page, a).getAttribute('data-card-key'), await card(page, b).getAttribute('data-card-key'));
      assert.equal(await card(page, a).locator('.quota-wallet-total strong').innerText(), '30 积分'); assert.equal(await card(page, b).locator('.quota-wallet-total strong').innerText(), '70 积分');
      assert.doesNotMatch(await card(page, a).innerText(), /已返回/); assert.match(await card(page, b).innerText(), /已返回的 2 个积分包/);
      const backend = (await page.evaluate(() => window.quotaBridge.providers())).state; assert.equal(backend.accounts.find(row => row.id === a).quota.partial, true, 'unknown availability is independent of finished pagination');
      const colors = await page.evaluate(() => { const card = document.querySelector('#quotaCards .quota-card'), mark = card.querySelector('.quota-card-mark'); return { theme: document.body.className, card: getComputedStyle(card).backgroundColor, page: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(card).color, opacity: getComputedStyle(card).opacity, filter: getComputedStyle(card).filter, watermarkFilter: getComputedStyle(mark).filter }; });
      colors.colorProfileSwitch = await app.evaluate(({ app }) => app.commandLine.getSwitchValue('force-color-profile'));
      fs.writeFileSync(path.join(evidence, 'render-colors.json'), JSON.stringify(colors, null, 2));
      await page.screenshot({ path: path.join(evidence, 'duplicate-cards.png') });
      await open(page, a); assert.match(await sheetRow(page, a).locator('[data-duplicate-note]').innerText(), /甲二/); assert.doesNotMatch(await sheetRow(page, a).locator('[data-duplicate-note]').innerText(), /乙一|乙二/);
      assert.match(await sheetRow(page, a).locator('[data-quota-sheet-total]').innerText(), /分页已读完/); assert.match(await sheetRow(page, b).locator('[data-quota-sheet-total]').innerText(), /已返回/);
      assert.equal(await sheetRow(page, aa).locator('[data-quota-card-settings]').count(), 0, 'a shared card keeps one name, under its first connection');
      assert.match(await sheetRow(page, a).locator('[data-duplicate-note]').innerText(), /甲二 <b>名称<\/b>/); assert.equal(await sheetRow(page, a).locator('[data-duplicate-note] b').count(), 0, 'peer display names are text, not markup');
      await sheetRow(page, a).locator('[data-duplicate-note]').scrollIntoViewIfNeeded(); await settle(page);
      await page.screenshot({ path: path.join(evidence, 'duplicate-details.png') }); await closeSheet(page);
      await app.evaluate(electron => { electron.clipboard.writeText = text => { electron.shell.copiedSummary = text; }; electron.clipboard.readText = () => electron.shell.copiedSummary; }); await page.locator('[data-quota-copy] button').click();
      await until(page, () => /已复制/.test(document.querySelector('[data-provider-quota-message]')?.textContent || '')); const summary = await app.evaluate(electron => electron.shell.copiedSummary); assert.match(summary, /分页已读完/); assert.match(summary, /已返回的/); assert.match(summary, /同一账号的 2 个连接：甲一、甲二/); assert(!summary.includes('SYNTHETIC_ACCOUNT'));
      // A direct bridge connection is still sender-checked and invokes the real service.
      const website = await page.evaluate(() => window.quotaBridge.providerConnect({ adapter: 'workbuddy-web', alias: '网站连接', credential: 'session=SYNTHETIC_WEBSITE', userAgent: 'Synthetic/1' })); assert.equal(website.ok, true);
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.some(row => row.alias === '网站连接' && row.status === 'ready'));
      const webId = (await page.evaluate(() => window.quotaBridge.providers())).state.accounts.find(row => row.alias === '网站连接').id;
      assert.doesNotMatch(await card(page, webId).locator('.quota-status').innerText(), /重复连接/); assert.match(await card(page, webId).innerText(), /已返回/);
      const webCopy = await page.evaluate(() => window.quotaBridge.providerConnect({ adapter: 'workbuddy-web', alias: '网站副本', credential: 'session=SYNTHETIC_WEBSITE', userAgent: 'Synthetic/1' })); assert.equal(webCopy.ok, true);
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.some(row => row.alias === '网站副本' && row.duplicateKnown && !row.busy));
      await open(page, webId); assert.match(await sheetRow(page, webId).locator('[data-duplicate-note]').innerText(), /相同凭据及读取范围的重复连接：网站副本/); assert.doesNotMatch(await sheetRow(page, webId).locator('[data-duplicate-note]').innerText(), /甲一|乙一/); await closeSheet(page);
      const passive = await page.evaluate(() => window.quotaBridge.providerConnect({ adapter: 'claude-statusline', alias: '无身份观测', credential: null })); assert.equal(passive.ok, true); await settle(page);
      const unknownId = passive.state.accounts.find(row => row.alias === '无身份观测').id; assert.equal(passive.state.accounts.find(row => row.id === unknownId).identityStatus, 'unknown'); assert.doesNotMatch(await card(page, unknownId).locator('.quota-status').innerText(), /重复连接/);
      await app.evaluate(electron => { electron.shell.identityFixture.fail = 'SYNTHETIC_A1'; }); await open(page, a); await sheetAction(page, a, 'data-quota-sheet-refresh').click(); await closeSheet(page);
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.some(row => row.alias === '甲一' && row.errorCode === 'PROVIDER_REQUEST_FAILED' && !row.busy)); await settle(page);
      assert.equal(await card(page, a).locator('.quota-status').innerText(), '1 / 2 个连接需要处理'); assert.match(await card(page, a).locator('.quota-status').getAttribute('title'), /甲二 <b>名称<\/b>/);
      assert.equal(await card(page, a).locator('.quota-problem').count(), 0, 'the card keeps the reading of the connection that still works');
      assert.match(await q.attention(page).innerText(), /甲一/);
      assert.equal(await card(page, a).locator('.quota-wallet-total strong').innerText(), '30 积分');
      await open(page, a); assert.match(await sheetRow(page, a).locator('[data-duplicate-note]').innerText(), /甲二/);
      await sheetAction(page, aa, 'data-quota-remove').click(); await until(page, async () => !(await window.quotaBridge.providers()).state.accounts.some(row => row.alias === '甲二 <b>名称</b>')); await settle(page);
      assert.equal(await sheetRow(page, a).locator('[data-duplicate-note]').count(), 0); assert.match(await sheetRow(page, b).locator('[data-duplicate-note]').innerText(), /乙二/); await closeSheet(page);
      await app.evaluate(electron => { electron.shell.identityFixture.complete['SYNTHETIC_B1'] = true; }); await open(page, b); await sheetAction(page, b, 'data-quota-sheet-refresh').click();
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.some(row => row.alias === '乙一' && row.quota?.incomplete === false && !row.busy)); await settle(page);
      assert.match(await sheetRow(page, b).locator('[data-quota-sheet-total]').innerText(), /分页已读完/); assert.match(await sheetRow(page, bb).locator('[data-quota-sheet-total]').innerText(), /已返回/); await closeSheet(page);
      assert.doesNotMatch(await card(page, b).innerText(), /已返回/, 'the shared card reads the connection that read last');
      await open(page, b); await sheetRow(page, b).locator('[data-quota-card-settings] input').fill('乙一 保留名称'); await sheetRow(page, b).getByRole('button', { name: '保存名称', exact: true }).click(); await closeSheet(page);
      assert.deepEqual(errors, []); assert(await page.locator('#quotaCards').evaluate(element => element.scrollWidth <= element.clientWidth + 1));
      const prior = await app.evaluate(electron => electron.shell.identityFixture.calls); assert(prior > 0); await app.close(); app = null;
      app = await electron.launch({ executablePath, args, timeout: 60000 }); page = await app.firstWindow(); await keepVisible(app); await isolatePointer(app); await showView(page, 'quota');
      await until(page, async () => (await window.quotaBridge.providers()).state.accounts.length === 6);
      const restored = (await page.evaluate(() => window.quotaBridge.providers())).state.accounts; assert(restored.every(row => !row.duplicateKnown && row.identityStatus === 'unknown'));
      assert.doesNotMatch(await card(page, b).locator('.quota-status').innerText(), /重复连接/); assert.equal(await card(page, b).locator('h3').innerText(), '乙一 保留名称'); assert.doesNotMatch(await card(page, b).innerText(), /已返回/);
      assert.match(await card(page, bb).innerText(), /已返回/); assert.match(await card(page, webId).innerText(), /已返回/);
      assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.autoRefresh, 'off');
      await fixture(app); await login(page, '乙一', b); assert.doesNotMatch(await card(page, b).locator('.quota-status').innerText(), /重复连接/); await login(page, '乙二', bb); assert.match(await card(page, b).locator('.quota-status').innerText(), /同一账号/); assert.equal(await card(page, b).locator('h3').innerText(), '乙一 保留名称');
      assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger); assert.deepEqual(fs.readFileSync(path.join(quota, 'quota-cache.json')), codex);
      results.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), groupsKeptSeparate: true, sameAccountShareOneCard: true, duplicateNamesEscaped: true, errorsTakePriority: true, removalUpdatesPeers: true, paginationVersusPartial: true, websiteRemainsQualified: true, restartUnknownUntilRevalidated: true, preferencesRetained: true, realProviderRequests: 0, unchangedUsageAndCodexCache: true }); console.log('PASS quota identity UI ' + scale);
    } catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {}); throw error; }
    finally { if (app) await app.close(); await cleanup(root); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
