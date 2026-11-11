'use strict';
/* global document, getComputedStyle */
// Every Agent's quota card, from invented readings, at the default display (125%): the shape its reference asks for, and no
// text cut off, in either theme, at any width the window can take. Readers for some of these do not exist yet; see
// docs/m2/UI-QUOTA-CARDS-BATCH-20261104.md. Nothing here reads an account.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch, setTheme } = require('./ui-smoke');
const { showView, settle } = require('./ui-settle');
const { clippedText } = require('./text-fit');
const { READINGS, LONG, CROWDED, quotaOf } = require('../../tests/m1/quota-card-fixtures');
const { atomic } = require('../../src/m1/store');
const output = process.env.QUOTA_CARDS_EVIDENCE_DIR || 'artifacts/quota-cards-20261104';

// Replaces what the provider service reports, at the IPC boundary, so routes that do not exist yet can still draw their card.
async function show(app, page, readings) {
  const rows = Object.entries(readings).filter(([provider]) => provider !== 'codex').map(([provider, reading]) => ({ provider, quota: quotaOf(provider, reading) }));
  await app.evaluate((electron, rows) => {
    const mod = Object.values(process.mainModule.require('node:module')._cache).find(value => /[/\\]src[/\\]quota[/\\]provider-service\.js$/.test(value.filename));
    const { resourceView } = mod.require('./resource-state'), proto = mod.exports.ProviderQuotaService.prototype;
    proto.realState ??= proto.state;
    proto.state = function () {
      const base = this.realState();
      return { ...base, accounts: rows.map((item, index) => {
        const id = String(index).padStart(8, '0') + '-0000-4000-8000-000000000000', row = { id, adapter: item.provider + '-demo', provider: item.provider, alias: item.provider, status: 'ready', lastAttempt: item.quota.fetchedAt, errorCode: null, nextRefreshAt: null };
        return { ...row, remembered: true, credentialExpiresAt: null, passive: false, errorMessage: null, quota: resourceView(item.quota, row, Date.now()), credentialReady: true, credentialRetryable: false, busy: false };
      }) };
    };
    electron.BrowserWindow.getAllWindows()[0].webContents.send('quota:providerUpdate');
  }, rows);
  await page.waitForFunction(count => document.querySelectorAll('#quotaCards .quota-card').length >= count, rows.length, { timeout: 15000 });
  await settle(page);
}
const card = (page, provider) => page.locator(`#quotaCards [data-provider-row="${provider}"]`).first();
// Every card is a square (owner 2026-11-05), so a row of them never stretches to its fullest one.
async function square(page, label) {
  const off = await page.evaluate(() => [...document.querySelectorAll('#quotaCards .quota-card')].flatMap(card => { const box = card.getBoundingClientRect(); return Math.abs(box.width - box.height) > 1 ? [card.dataset.providerRow + ' ' + Math.round(box.width) + '×' + Math.round(box.height)] : []; }));
  assert.deepEqual(off, [], label + ': a card that is not square');
}
async function fits(page, label) {
  const found = await page.evaluate(`(${clippedText.toString()})('#quotaCards .quota-card', { skip: '.quota-plan-slot' })`);
  assert.deepEqual(found, [], label + ': text that does not show in full');
  const heads = await page.evaluate(() => [...document.querySelectorAll('#quotaCards .quota-card-head')].filter(head => head.scrollWidth > head.clientWidth + 1).map(head => head.innerText));
  assert.deepEqual(heads, [], label + ': a card head runs out of room');
  const collisions = await page.evaluate(() => [...document.querySelectorAll('#quotaCards .quota-meter-head')].flatMap(head => {
    const figure = head.querySelector('.quota-figure'), name = head.querySelector('.quota-meter-name, b'); if (!figure || !name) return [];
    const a = figure.getBoundingClientRect(), b = name.getBoundingClientRect(); return b.right > a.left + 1 && b.left < a.right - 1 ? [head.innerText] : [];
  }));
  assert.deepEqual(collisions, [], label + ': a name runs into its figure');
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const resources = (reading, fetchedAt) => quotaOf('codex', reading, fetchedAt);
  const session = await launch({ scale: 1.25, size: [1480, 2300], prepare: home => {
    const quota = path.join(path.dirname(home), 'quota'); fs.mkdirSync(quota, { recursive: true });
    const row = (index, alias, reading) => ({ id: String(index).padStart(8, '0') + '-1111-4111-8111-111111111111', provider: 'codex', alias, plan: reading.plan, quota: null, resourceQuota: resources(reading), lastAttempt: null, errorCode: null, nextRefreshAt: null });
    atomic(path.join(quota, 'quota-cache.json'), { schemaVersion: 'QuotaCacheV2', accounts: [row(1, '常用账号', READINGS.codex), row(2, '只有一个窗口的账号', READINGS['codex-single'])] });
  } }), { app, page, errors } = session;
  try {
    await showView(page, 'quota');
    const { 'codex-single': _single, ...shown } = READINGS;
    await show(app, page, shown);
    await new Promise(resolve => setTimeout(resolve, 1200));
    await page.locator('#quotaCards').screenshot({ path: path.join(output, 'light.png'), animations: 'disabled' });

    // The shape each reference asks for.
    const codex = page.locator('#quotaCards [data-provider-row="codex"]');
    assert.equal(await codex.first().locator('.quota-meter').count(), 2);
    assert.match(await codex.first().locator('.quota-meter b').first().innerText(), /每周/, 'the longest window comes first');
    assert.equal(await codex.nth(1).locator('.quota-single .quota-split').count(), 1, 'one window: used and left'); assert.equal(await codex.nth(1).locator('.quota-tick').count(), 0);
    assert.match(await codex.nth(1).locator('.quota-facts').innerText(), /重置时间[\s\S]*重置次数[\s\S]*2x/);
    assert.match(await card(page, 'claude').locator('.quota-inside').innerText(), /Fable 剩余 60%/, 'a model limit is a line under its window');
    assert.equal(await card(page, 'claude').locator('.quota-meter').count(), 2);
    assert.equal(await card(page, 'zcode').locator('.quota-meters.is-thick .quota-segments.is-solid .quota-tick').count(), 2, 'thick bars with their time marker');
    assert.equal(await card(page, 'zcode').locator('.quota-card-head[data-mark-only]').count(), 1);
    assert.equal(await card(page, 'cursor').locator('.quota-subrow').count(), 2, 'one window and two rows');
    assert.equal(await card(page, 'opencode').locator('.quota-ring').count(), 2); assert.equal(await card(page, 'opencode').locator('.quota-thin').count(), 1);
    assert.match(await card(page, 'deepseek').locator('.quota-pocket strong').innerText(), /^\$42\.50$/); assert.equal(await card(page, 'deepseek').locator('.quota-ticket').count(), 2);
    assert.equal(await card(page, 'kimi').locator('.quota-meter').count(), 2);
    assert.match(await card(page, 'copilot').locator('.quota-meter b').innerText(), /高级请求/, 'a window with its own name says it');
    assert.equal(await card(page, 'qwen').locator('.quota-subrow').count(), 2);
    assert.equal(await card(page, 'kilo').locator('.quota-ticket').count(), 2);
    assert.match(await card(page, 'cline').locator('.quota-wallet-total strong').innerText(), /\$7\.25/);
    for (const provider of ['kimi', 'copilot', 'qwen', 'kilo', 'cline']) assert.notEqual(await card(page, provider).evaluate(element => getComputedStyle(element).getPropertyValue('--agent')), '', provider + ' has its own tone');
    assert.deepEqual(await page.locator('#quotaCards .quota-card:not([data-provider-row="codex"]) .quota-card-foot:not(.is-quiet)').allInnerTexts(), [], 'nothing to say, no footer line (a Codex card restored from cache still says so)');

    // Nothing cut off: every card, both readings, both themes, widest to narrowest window; and the longest values there can be.
    for (const [readings, name] of [[shown, 'reading'], [{ ...shown, ...CROWDED }, 'crowded'], [{ ...shown, ...LONG }, 'long values']]) {
      await show(app, page, readings);
      for (const measure of ['remaining', 'used']) {
        await page.evaluate(value => window.quotaHost.setPreference('measure', value), measure); await settle(page);
        for (const theme of ['light', 'dark']) {
          await setTheme(page, theme); await settle(page);
          for (const [width, height] of [[1480, 2300], [1180, 2300], [800, 2300]]) {
            await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]); await settle(page);
            await fits(page, [name, measure, theme, width].join(' / '));
            if (name !== 'long values') await square(page, [name, measure, theme, width].join(' / '));
          }
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 2300)); await settle(page);
        }
      }
      await page.evaluate(() => window.quotaHost.setPreference('measure', 'remaining')); await setTheme(page, 'light'); await settle(page);
      if (name === 'crowded') { assert((await card(page, 'workbuddy').locator('.quota-ticket').count()) >= 2, 'the slips show'); await setTheme(page, 'dark'); await settle(page); await new Promise(resolve => setTimeout(resolve, 800)); await page.locator('#quotaCards').screenshot({ path: path.join(output, 'crowded-dark.png'), animations: 'disabled' }); await setTheme(page, 'light'); await settle(page); }
    }
    await page.locator('#quotaCards').screenshot({ path: path.join(output, 'long.png'), animations: 'disabled' });
    await show(app, page, shown); await setTheme(page, 'dark'); await settle(page); await new Promise(resolve => setTimeout(resolve, 1200));
    await page.locator('#quotaCards').screenshot({ path: path.join(output, 'dark.png'), animations: 'disabled' });
    await setTheme(page, 'light');

    // Waiting Agents say so, and offer no connection that cannot work yet.
    const idle = await page.evaluate(() => window.quotaBridge.providers());
    const planned = idle.state.capabilities.filter(capability => capability.mode === 'planned').map(capability => capability.provider).sort();
    assert.deepEqual(planned, ['cline', 'copilot', 'kilo', 'kimi', 'qwen']);
    assert.deepEqual(errors, []);
    console.log('quota cards passed');
  } finally { await session.close(); }
})().catch(error => { console.error(error); process.exit(1); });
