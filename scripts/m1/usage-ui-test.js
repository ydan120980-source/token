'use strict';
/* global document */
// Browser plugin not available. Test the actual Electron IPC with disposable sources.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { settle } = require('./ui-settle');
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
      const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const initial = await state(page, s => s.snapshot.sequence > 0 && !s.collecting);
      assert.equal(initial.snapshot.daily.reduce((sum, r) => sum + r.totalTokens, 0), f.total);
      assert.equal(initial.audit.networkAttempts, 0); assert.equal(initial.audit.authenticationReads, 0); assert.equal(initial.audit.sourceWrites, 0);
      assert.equal(await page.title(), 'Agent Usage · Codex 额度'); assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      await page.locator('[data-view="usage"]').click(); await page.waitForFunction(() => document.getElementById('totalTokens').textContent === '694');
      for (const period of ['today', '7', '30', 'all']) { await page.locator('[data-period="' + period + '"]').click(); assert.equal(await page.locator('#totalTokens').textContent(), '694'); }
      await page.locator('#agentPicker [data-agent="codex"]').click(); await settle(page); assert.equal(await page.locator('#totalTokens').textContent(), '180');
      await page.locator('#agentPicker [data-agent="all"]').click(); await page.locator('#modelFilter').selectOption('gpt-4.1'); await settle(page); assert.equal(await page.locator('#totalTokens').textContent(), '524');
      await page.locator('#modelFilter').selectOption('all'); await page.screenshot({ path: 'artifacts/maintenance/usage-' + scale + '.png' });
      await page.locator('[data-view="sources"]').click(); assert.equal(await page.locator('#sourceRows .source-row').count(), 9);
      await assert.rejects(page.evaluate(() => window.usageBridge.chooseSource('unsupported-agent')), /SOURCE_REJECTED/);
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, data);
      await assert.rejects(page.evaluate(() => window.usageBridge.chooseSource('codex')), /SOURCE_PRODUCT_OVERLAP/);
      await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, f.roots.codex[0]);
      await page.locator('[data-add-source="codex"]').click(); await state(page, s => !s.enabled && !s.collecting);
      await page.locator('[data-view="settings"]').click(); await page.locator('#settingsPause').filter({ hasText: '恢复采集' }).waitFor(); await page.locator('#settingsPause').click();
      await state(page, s => s.enabled && !s.collecting); await page.locator('#settingsPause').click(); await state(page, s => !s.enabled && !s.collecting);
      await page.locator('[data-view="usage"]').click(); await page.locator('#refresh').click(); await state(page, s => !s.collecting);
      await page.locator('[data-view="settings"]').click(); await page.locator('#pricingPanel').evaluate(element => { element.open = true; });
      await page.locator('#priceSearch').fill('gpt-4.1'); await page.locator('#priceRows [data-edit-price="openai/gpt-4.1"]').click(); await page.locator('[data-editor-mode="manual"]').click();
      await page.locator('#price-inputUncached').fill('5'); await page.locator('#price-output').fill('8'); await page.locator('#price-cacheRead').fill('.5'); await page.locator('#price-cacheWrite').fill('0');
      await page.locator('#savePrice').click(); await page.getByText('手动规则已保存，全部历史按新规则重算。').waitFor();
      assert.equal((await page.evaluate(() => window.usageBridge.pricing())).models.find(r => r.provider === 'openai' && r.model === 'gpt-4.1').rates.inputUncached, 5);
      const repriced = await page.evaluate(() => window.usageBridge.get());
      const codexCost = repriced.snapshot.daily.find(r => r.agent === 'codex').estimatedCostUsd; assert(Math.abs(codexCost - .000765) < 1e-12);
      await page.locator('#priceRows [data-edit-price="openai/gpt-4.1"]').click();await page.locator('#resetPrice').click(); await page.getByText(/手动规则已撤销/).waitFor();
      await page.locator('#codexMaintenance').evaluate(element => { element.open = true; });
      await page.locator('#codexPreview').click(); await page.locator('#codexApply').waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.getElementById('codexApply').disabled);
      assert.match(await page.locator('#codexPreviewResult').textContent(), /180 → 180 token/);
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 0 }); });
      await page.locator('#codexApply').click(); await page.getByText('已取消，统计未修改。').waitFor(); assert.equal(fs.existsSync(path.join(data,'backups')),false);
      await page.locator('#codexPreview').click(); await page.waitForFunction(() => !document.getElementById('codexApply').disabled);
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1 }); });
      await page.locator('#codexApply').click(); await page.getByText('已备份并重建；原始日志和账号连接保留。').waitFor();
      assert.equal(fs.readdirSync(path.join(data,'backups')).length,1); assert.equal((await page.evaluate(() => window.usageBridge.get())).snapshot.daily.reduce((n,r) => n+r.totalTokens,0),f.total);
      await page.screenshot({ path: 'artifacts/maintenance/usage-maintenance-' + scale + '.png' });
      await page.locator('[data-view="usage"]').click();
      const output = path.join(dir, 'export-' + scale + '.json');
      await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => { await new Promise(resolve => setTimeout(resolve, 500)); return { canceled: false, filePath: file }; }; }, output);
      await page.locator('#usage [data-export]').click(); await page.locator('#download').click();
      assert.equal(await page.locator('#download').getAttribute('aria-busy'), 'true');
      await page.getByText(/统计已导出/).waitFor();
      assert.equal(await page.locator('#download').getAttribute('aria-busy'), 'false');
      const bytes = fs.readFileSync(output, 'utf8'); assert.equal(/M1_PRIVATE_SENTINEL|authUrl|accountId/.test(bytes), false); assert.equal(bytes.includes(dir), false); assert.equal(JSON.parse(bytes).schemaVersion, 'LocalUsagePreviewV1');
      await page.locator('#exportDialog').evaluate(dialog => dialog.close());
      await page.locator('[data-view="settings"]').click(); await page.locator('#settingsPause').click(); await state(page, s => s.enabled && !s.collecting);
      const source = path.join(f.roots.claude[0], 'project/session.jsonl'), at = Date.now();
      fs.appendFileSync(source, JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { id: 'fresh', model: 'gpt-4.1', usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n');
      await state(page, s => s.snapshot.daily.reduce((sum, r) => sum + r.totalTokens, 0) === 704);
      const visibilityLatencyMs = Date.now() - at; assert.ok(visibilityLatencyMs < 60000);
      // The settings page no longer offers a "clear statistics" control: pausing
      // collection must retain already-saved history instead of discarding it.
      await page.locator('[data-view="settings"]').click(); await page.locator('#settingsPause').click();
      const paused = await state(page, s => !s.enabled && !s.collecting);
      assert.equal(paused.snapshot.daily.reduce((sum, r) => sum + r.totalTokens, 0), 704);
      evidencePausedRows = paused.snapshot.daily.length;
      assert.equal((await page.evaluate(() => window.quotaBridge.get())).state.autoRefresh, 'off'); assert.deepEqual(errors, []);
      evidence.push({ packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), scale, nineSources: true, filtersAndPeriods: true, sourceSelectionAndOverlapGuard: true, manualAndScheduledRefresh: true, pricingSaveRecalculateReset: true, codexPreviewCancelBackupApply: true, visibilityLatencyMs, pauseResume: true, whitelistExport: true, pauseRetainsHistory: true, pausedRows: evidencePausedRows, noPageErrors: true, noAccountRequests: true });
    } finally { await app.close(); }
    const restored = await electron.launch({ executablePath, args, timeout: 60000 });
    try { const page = await restored.firstWindow(), value = await state(page, s => s.enabled === false); assert.equal(value.snapshot.daily.length, evidencePausedRows); assert.equal(value.collecting, false); evidence.at(-1).restartPreservesPauseAndHistory = true; }
    finally { await restored.close(); }
    // First window can exist before loadFile settles. Quitting at that point
    // must not show a blocking initialization-error dialog.
    for (let i = 0; i < 3; i++) {
      const early = await electron.launch({ executablePath, args, timeout: 60000 });
      await early.firstWindow(); await early.close();
    }
    evidence.at(-1).earlyWindowExitCycles = 3;
  } } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  fs.writeFileSync('artifacts/maintenance/usage-ui-results.json', JSON.stringify(evidence, null, 2)); console.log('PASS: unified desktop usage controls at 100%/150%; five sources, refresh, pause, directory guards, export and restart.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
