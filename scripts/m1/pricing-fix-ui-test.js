'use strict';
/* global document, getComputedStyle */
// Pricing a gap in plain steps (owner 2026-11-03, docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md): each candidate says
// whether it will count before saving, records no price can close say so, and one click shows what it will do; the
// fallback is labelled apart and the lower bound is red and off until asked. Synthetic fixture home and isolated stores.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { keepVisible, showView, settle, until, cleanup } = require('./ui-settle');
const { openPrice, dialog, waitClosed, pickCombobox } = require('./settings-ui-helpers');
const output = process.env.PRICING_FIX_EVIDENCE_DIR || 'artifacts/ui-pricing-fix';

const base = { agent: 'claude', provider: 'router', quality: 'measured', inputUncached: 1000, output: 500, cacheRead: 200, cacheWrite: 0, reasoning: null, totalTokens: 1700, timestamp: new Date().toISOString(), entry: 'cli', sessionKey: null };
const seed = (home, usage) => {
  const store = new Store(usage, roots(home));
  const records = [{ model: 'only-one' }, { model: 'mixed-cache' }, { model: 'two-prices' }, { model: 'nothing-like-it' }, { provider: 'vendor-a', model: 'only-one', quality: 'partial', output: null, totalTokens: 1200 }, { provider: 'vendor-a', model: 'only-one', usageConflict: true, totalTokens: 900 }];
  store.state.records = Object.fromEntries(records.map((record, index) => { const id = String(index).padStart(64, 'b'); return [id, { ...base, id, ...record }]; }));
  atomic(path.join(usage, 'statistics.json'), store.state);
  const price = (provider, model, input, cacheRead) => store.setPrice({ provider, model, inputUncached: input, output: 10, cacheRead, cacheWrite: 2.5 });
  price('vendor-a', 'only-one', 2, .2); price('vendor-b', 'mixed-cache', 2, null); price('vendor-c', 'mixed-cache', 3, .3); price('vendor-a', 'two-prices', 2, .2); price('vendor-b', 'two-prices', 4, .4);
  store.setEnabled(false);
};
const row = (page, key) => page.locator('[data-price-models] tr[data-row-key="' + key + '"]');

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-pricing-fix-')), home = path.join(root, 'home'), usage = path.join(root, 'usage'); fs.mkdirSync(home); seed(home, usage);
  const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home, '--force-device-scale-factor=1'], timeout: 60000 }), errors = [];
  try {
    await keepVisible(app); const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 960));
    await showView(page, 'settings'); await page.locator('[data-fix-entry]').waitFor(); await settle(page);
    const ledger = fs.readFileSync(path.join(usage, 'statistics.json'));

    // A candidate that lacks a rate is not offered as if it worked: the whole one comes first, the other says why not.
    await openPrice(page, 'router/mixed-cache'); const sheet = dialog(page);
    await sheet.locator('[data-candidate-verdict]').first().waitFor(); await until(page, () => document.querySelectorAll('[data-candidate-verdict]').length === 2);
    assert.deepEqual(await sheet.locator('[data-candidate]').evaluateAll(nodes => nodes.map(node => node.dataset.candidate)), ['vendor-c/mixed-cache', 'vendor-b/mixed-cache']);
    assert.deepEqual(await sheet.locator('[data-candidate-verdict]').allInnerTexts(), ['全部可计入', '不能计入']);
    await sheet.locator('[data-candidate="vendor-b/mixed-cache"]').getByRole('button', { name: '选择此模型' }).click();
    await sheet.locator('[data-mapping-result="none"]').waitFor();
    assert.match(await sheet.locator('[data-mapping-result]').innerText(), /不能计入[\s\S]*目录缺少该模型的部分费率/);
    assert.equal(await sheet.getByRole('button', { name: '按此模型计费' }).isDisabled(), true, 'a choice that counts nothing cannot be saved');
    await page.waitForTimeout(350); await page.screenshot({ path: path.join(output, 'candidate-none.png') });
    await sheet.locator('[data-candidate="vendor-c/mixed-cache"]').getByRole('button', { name: '选择此模型' }).click();
    await sheet.locator('[data-mapping-result="full"]').waitFor();
    assert.match(await sheet.locator('[data-mapping-result]').innerText(), /全部可计入[\s\S]*1\.7K Token 计入，约 <?\$/);
    assert(!fs.existsSync(path.join(usage, 'billing.json')) || !Object.keys(JSON.parse(fs.readFileSync(path.join(usage, 'billing.json'))).mappings).length, 'choosing saves nothing');
    await page.waitForTimeout(250); await page.screenshot({ path: path.join(output, 'candidate-full.png') });
    await sheet.getByRole('button', { name: '关闭', exact: true }).click(); await waitClosed(page);

    // Records no price can close say so instead of offering candidates that would do nothing.
    await openPrice(page, 'vendor-a/only-one');
    await sheet.locator('[data-gap-plain]').waitFor();
    assert.equal(await sheet.locator('[data-suggestions]').count(), 0);
    await sheet.getByRole('button', { name: '一键处理' }).click();

    // One click: what it will do comes first and nothing is written until 应用.
    const fix = page.locator('[data-quick-fix]'); await fix.waitFor();
    await page.locator('[data-fix-match]').first().waitFor();
    assert.deepEqual((await page.locator('[data-fix-match]').evaluateAll(nodes => nodes.map(node => node.dataset.fixMatch))).sort(), ['router/mixed-cache', 'router/only-one']);
    const undecided = await page.locator('[data-fix-undecided]').innerText();
    assert.match(undecided, /router\/two-prices[\s\S]*多个候选/); assert.match(undecided, /router\/nothing-like-it[\s\S]*目录里没有/);
    assert.match(await page.locator('[data-fix-left]').innerText(), /两个来源记下的用量不一致/);
    const floorBox = page.locator('[data-fix-floor]');
    assert.match(await floorBox.innerText(), /按已报告字段算下限（可选）[\s\S]*不会被填成 0/);
    assert.equal(await floorBox.evaluate(element => getComputedStyle(element.querySelector('span')).color === getComputedStyle(document.body).color), false, 'the floor is marked apart from the rest');
    assert.equal(await floorBox.getByRole('switch').getAttribute('aria-checked'), 'false', 'off until asked');
    await page.waitForTimeout(350); await page.screenshot({ path: path.join(output, 'quick-fix.png') });
    assert(!fs.existsSync(path.join(usage, 'billing.json')) || !Object.keys(JSON.parse(fs.readFileSync(path.join(usage, 'billing.json'))).mappings).length, 'previewing writes nothing');
    await page.locator('[data-ui-portal] [role="dialog"]').getByRole('button', { name: '应用', exact: true }).click();
    await until(page, () => document.querySelector('[data-quick-fix]') === null);
    await until(page, () => /^(?!.*未计入).*$/s.test(document.querySelector('[data-price-models] tr[data-row-key="router/only-one"]')?.textContent ?? '未计入'));
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(usage, 'billing.json'))).mappings).sort(), ['router/mixed-cache', 'router/only-one']);

    // 撤销 puts the rules back.
    await page.locator('[data-fix-undo]').getByRole('button', { name: '撤销' }).click();
    await until(page, () => /未计入/.test(document.querySelector('[data-price-models] tr[data-row-key="router/only-one"]')?.textContent ?? ''));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(usage, 'billing.json'))).mappings, {});

    // B then C: the fallback is labelled, the floor is red and says at least.
    await page.locator('[data-fix-entry]').getByRole('button', { name: '一键处理' }).click(); await fix.waitFor(); await page.locator('[data-fix-match]').first().waitFor();
    await pickCombobox(dialog(page), page, '保底模型', 'vendor-a/two-prices');
    await page.locator('[data-fix-fallback-gain]').waitFor();
    assert.match(await page.locator('[data-fix-fallback-gain]').innerText(), /2 个模型.*计入/, 'the undecided models: ' + await page.locator('[data-fix-fallback-gain]').innerText());
    await floorBox.getByRole('switch').click();
    await until(page, () => /\b100%|9\d%/.test(document.querySelector('[data-fix-result]')?.textContent ?? ''));
    await page.waitForTimeout(350); await page.screenshot({ path: path.join(output, 'quick-fix-all.png') });
    await page.locator('[data-ui-portal] [role="dialog"]').getByRole('button', { name: '应用', exact: true }).click();
    await page.locator('[data-fix-active="fallback"]').waitFor(); await page.locator('[data-fix-active="floor"]').waitFor();
    assert.match(await page.locator('[data-fix-active="fallback"]').innerText(), /保底估算.*vendor-a\/two-prices/);
    assert.match(await page.locator('[data-fix-active="floor"]').innerText(), /实际至少 <?\$/);
    assert.match(await row(page, 'router/nothing-like-it').innerText(), /保底估算/);
    const saved = JSON.parse(fs.readFileSync(path.join(usage, 'billing.json')));
    assert.equal(saved.fallback, 'vendor-a/two-prices'); assert.equal(saved.partialLowerBound, true);
    await page.screenshot({ path: path.join(output, 'settings-active.png') });

    // The cost page's card says the same, and the saved usage is untouched by any of it.
    await showView(page, 'cost'); await page.locator('[data-summary-floor]').waitFor();
    assert.match(await page.locator('#summaryPanel [data-page-summary="cost"]').innerText(), /保底估算[\s\S]*只算了已报告字段/);
    assert.deepEqual(fs.readFileSync(path.join(usage, 'statistics.json')), ledger, 'the ledger is not changed');
    assert.deepEqual(errors, []);
    console.log('PASS pricing fix');
  } finally { await app.close(); await cleanup(root); }
})().catch(error => { console.error(error); process.exitCode = 1; });
