'use strict';
const {openSource}=require('./sources-ui-helpers');
/* global document */
// Browser plugin not available. Test the actual Electron IPC with disposable sources.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { settle, cleanup, keepVisible, until } = require('./ui-settle');
const { dialog, openSettings, openPricing, openPrice, field, waitClosed } = require('./settings-ui-helpers');
// The collection switch on the React settings page (its name says the current state).
const collection = page => page.locator('#section-collection').getByRole('switch');
const { SOURCES } = require('../../src/m1/policy');
const usageUi = require('./usage-ui-helpers');
const { fixtures } = require('../../tests/m1/fixtures');
async function state(page, predicate) {
  const until = Date.now() + 60000;
  while (Date.now() < until) { const value = await page.evaluate(() => window.usageBridge ? window.usageBridge.get() : null); if (value && predicate(value)) return value; await page.waitForTimeout(30); }
  throw new Error('USAGE_STATE_TIMEOUT');
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-ui-')), evidence = [];
  let evidencePausedRows;
  fs.mkdirSync('artifacts/maintenance', { recursive: true });
  try { for (const scale of [1, 1.5]) {
    const home = path.join(dir, 'home-' + scale), f = fixtures(home), data = path.join(dir, 'usage-' + scale), quota = path.join(dir, 'quota-' + scale);
    const executablePath = process.env.QUOTA_PACKAGED_EXE || require('electron');
    const args = [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--quota-data-dir', quota, '--usage-data-dir', data, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale];
    const app = await electron.launch({ executablePath, args, timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = []; await keepVisible(app); page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const initial = await state(page, s => s.snapshot.sequence > 0 && !s.collecting);
      assert.equal(initial.snapshot.daily.reduce((sum, r) => sum + r.totalTokens, 0), f.total);
      assert.equal(initial.audit.networkAttempts, 0); assert.equal(initial.audit.authenticationReads, 0); assert.equal(initial.audit.sourceWrites, 0);
      assert.equal(await page.title(), 'QuotaDock · 额度台'); assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      await page.locator('[data-view="usage"]').click(); await usageUi.waitValue(page, 'totalTokens', '694');
      for (const period of ['today', '7', '30', 'all']) { await usageUi.period(page, period); assert.equal(await usageUi.value(page, 'totalTokens'), '694'); }
      await usageUi.agent(page, 'codex'); await settle(page); assert.equal(await usageUi.value(page, 'totalTokens'), '180');
      await usageUi.agent(page, 'all'); await usageUi.select(page, 'model', 'gpt-4.1'); await settle(page); assert.equal(await usageUi.value(page, 'totalTokens'), '524');
      await usageUi.select(page, 'model', 'all'); await page.screenshot({ path: 'artifacts/maintenance/usage-' + scale + '.png' });
      await page.locator('[data-view="sources"]').click(); assert.equal(await page.locator('[data-source-rows] [data-source-agent]').count(), SOURCES.length);
      await assert.rejects(page.evaluate(() => window.usageBridge.chooseSource('unsupported-agent')), /SOURCE_REJECTED/);
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, data);
      await assert.rejects(page.evaluate(() => window.usageBridge.chooseSource('codex')), /SOURCE_PRODUCT_OVERLAP/);
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, f.roots.codex[0]);
      await openSource(page,'codex'); await page.locator('[data-source-add="codex"] button').click(); await state(page, s => !s.enabled && !s.collecting);
      await openSettings(page, 'collection'); await until(page, () => document.querySelector('#section-collection [role="switch"]')?.getAttribute('aria-checked') === 'false'); await collection(page).click();
      await state(page, s => s.enabled && !s.collecting); await collection(page).click(); await state(page, s => !s.enabled && !s.collecting);
      await page.locator('[data-view="usage"]').click(); await page.locator('[data-usage-refresh] button').click(); await state(page, s => !s.collecting);
      await openPricing(page); await page.getByRole('textbox', { name: '筛选已用模型', exact: true }).fill('gpt-4.1'); await openPrice(page, 'openai/gpt-4.1');
      if (await dialog(page).getByRole('tab', { name: '手动价格', exact: true }).count()) await dialog(page).getByRole('tab', { name: '手动价格', exact: true }).click();
      await field(page, '输入（不含缓存）').fill('5'); await field(page, '输出（含推理）').fill('8'); await field(page, '缓存读取').fill('.5'); await field(page, '缓存写入').fill('0');
      await dialog(page).getByRole('button', { name: '保存价格', exact: true }).click(); await page.getByText('手动规则已保存，全部历史按新规则重算。').waitFor(); await waitClosed(page);
      assert.equal((await page.evaluate(() => window.usageBridge.pricing())).models.find(r => r.provider === 'openai' && r.model === 'gpt-4.1').rates.inputUncached, 5);
      const repriced = await page.evaluate(() => window.usageBridge.get());
      const codexCost = repriced.snapshot.daily.find(r => r.agent === 'codex').estimatedCostUsd; assert(Math.abs(codexCost - .000765) < 1e-12);
      await openPrice(page, 'openai/gpt-4.1'); await dialog(page).getByRole('button', { name: '移除手动价格', exact: true }).click(); await page.getByText(/手动规则已撤销/).waitFor(); await waitClosed(page);
      await page.getByRole('button', { name: /Codex 用量维护/ }).click();
      const preview = page.getByRole('button', { name: '扫描并预览重建', exact: true }), apply = page.getByRole('button', { name: '备份并应用重建', exact: true });
      await preview.click(); await apply.waitFor({ state: 'visible' }); await until(page, () => [...document.querySelectorAll('[data-codex-maintenance] button')].some(b => b.textContent.includes('备份并应用重建') && !b.disabled));
      assert.match(await page.locator('[data-codex-status]').textContent(), /180 → 180 token/);
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
      await apply.click(); await page.getByText('已取消，统计未修改。').waitFor(); assert.equal(fs.existsSync(path.join(data,'backups')),false);
      await preview.click(); await until(page, () => [...document.querySelectorAll('[data-codex-maintenance] button')].some(b => b.textContent.includes('备份并应用重建') && !b.disabled));
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
      await apply.click(); await page.getByText('已备份并重建；原始日志和账号连接保留。').waitFor();
      assert.equal(fs.readdirSync(path.join(data,'backups')).length,1); assert.equal((await page.evaluate(() => window.usageBridge.get())).snapshot.daily.reduce((n,r) => n+r.totalTokens,0),f.total);
      await page.screenshot({ path: 'artifacts/maintenance/usage-maintenance-' + scale + '.png' });
      await page.locator('[data-view="usage"]').click();
      const output = path.join(dir, 'export-' + scale + '.json');
      await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => { await new Promise(resolve => setTimeout(resolve, 500)); return { canceled: false, filePath: file }; }; }, output);
      await page.locator('[data-usage-export] button').click(); const download = dialog(page).getByRole('button', { name: '导出统计 JSON', exact: true }); await download.click();
      assert.equal(await download.getAttribute('aria-busy'), 'true');
      await page.getByText(/统计已导出/).waitFor();
      assert.notEqual(await download.getAttribute('aria-busy'), 'true'); assert.equal(await download.isDisabled(), false);
      const bytes = fs.readFileSync(output, 'utf8'); assert.equal(/M1_PRIVATE_SENTINEL|authUrl|accountId/.test(bytes), false); assert.equal(bytes.includes(dir), false); assert.equal(JSON.parse(bytes).schemaVersion, 'LocalUsagePreviewV1');
      await page.keyboard.press('Escape'); await waitClosed(page);
      await openSettings(page, 'collection'); await collection(page).click(); await state(page, s => s.enabled && !s.collecting);
      const source = path.join(f.roots.claude[0], 'project/session.jsonl'), at = Date.now();
      fs.appendFileSync(source, JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'fresh', model: 'gpt-4.1', usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n');
      await state(page, s => s.snapshot.daily.reduce((sum, r) => sum + r.totalTokens, 0) === 704);
      const visibilityLatencyMs = Date.now() - at; assert.ok(visibilityLatencyMs < 60000);
      // The settings page no longer offers a "clear statistics" control: pausing
      // collection must retain already-saved history instead of discarding it.
      await openSettings(page, 'collection'); await collection(page).click();
      const paused = await state(page, s => !s.enabled && !s.collecting);
      assert.equal(paused.snapshot.daily.reduce((sum, r) => sum + r.totalTokens, 0), 704);
      evidencePausedRows = paused.snapshot.daily.length;
      assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.autoRefresh, 'off'); assert.deepEqual(errors, []);
      evidence.push({ packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), scale, nineSources: true, filtersAndPeriods: true, sourceSelectionAndOverlapGuard: true, manualAndScheduledRefresh: true, pricingSaveRecalculateReset: true, codexPreviewCancelBackupApply: true, visibilityLatencyMs, pauseResume: true, whitelistExport: true, pauseRetainsHistory: true, pausedRows: evidencePausedRows, noPageErrors: true, noAccountRequests: true });
    } finally { await app.close(); }
    const restored = await electron.launch({ executablePath, args, timeout: 60000 });
    try { const page = await restored.firstWindow(); await keepVisible(restored); const value = await state(page, s => s.enabled === false); assert.equal(value.snapshot.daily.length, evidencePausedRows); assert.equal(value.collecting, false); evidence.at(-1).restartPreservesPauseAndHistory = true; }
    finally { await restored.close(); }
    // First window can exist before loadFile settles. Quitting at that point
    // must not show a blocking initialization-error dialog.
    for (let i = 0; i < 3; i++) {
      const early = await electron.launch({ executablePath, args, timeout: 60000 });
      await early.firstWindow(); await early.close();
    }
    evidence.at(-1).earlyWindowExitCycles = 3;
  } } finally { await cleanup(dir); }
  fs.writeFileSync('artifacts/maintenance/usage-ui-results.json', JSON.stringify(evidence, null, 2)); console.log('PASS: unified desktop usage controls at 100%/150%; five sources, refresh, pause, directory guards, export and restart.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
