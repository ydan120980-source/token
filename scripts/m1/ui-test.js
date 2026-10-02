'use strict';
/* global document */
// Browser plugin is not available; the approved plan specifically requires
// Playwright Electron to test the actual Windows main/preload/renderer paths.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { fixtures } = require('../../tests/m1/fixtures');
const { waitState } = require('./wait-state');
(async () => {
  const dir = fs.mkdtempSync(path.resolve('.cache/ui-')), f = fixtures(path.join(dir, 'home'));
  fs.mkdirSync('artifacts', { recursive: true });
  const evidence = [];
  for (const scale of [1, 1.5]) {
    const executablePath = process.env.M1_PACKAGED_EXE || require('electron');
    const args = process.env.M1_PACKAGED_EXE ? [] : ['.'];
    const data = path.join(dir, 'data-' + scale);
    const app = await electron.launch({ executablePath, args: [...args, '--m1-data-dir', data, '--m1-fixture-root', path.join(dir, 'home'), '--force-device-scale-factor=' + scale], timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await waitState(page, state => state.snapshot.sequence > 0);
      await page.waitForFunction(() => document.getElementById('total').textContent === '694');
      assert.equal(await page.title(), 'Agent Usage M1');
      assert.equal(await page.locator('#total').textContent(), '694');
      assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
      const exposed = await page.evaluate(() => Object.keys(window.agentUsage).sort());
      assert.deepEqual(exposed, ['chooseSource', 'clearStatistics', 'exportStatistics', 'get', 'onUpdate', 'quit', 'refresh', 'setEnabled']);
      assert.equal(await page.evaluate(async () => { try { await window.agentUsage.chooseSource('cursor'); return false; } catch { return true; } }), true);
      const initial = await page.evaluate(() => window.agentUsage.get());
      assert.equal(initial.runtimeNetworkAttempts, 0); assert.equal(initial.audit.networkAttempts, 0);
      assert.equal(initial.audit.sourceWrites, 0); assert.equal(initial.audit.authenticationReads, 0);
      for (const period of ['7', '30', 'all', 'today']) { await page.locator('[data-period="' + period + '"]').click(); assert.equal(await page.locator('#total').textContent(), '694'); }
      await page.locator('#agent').selectOption('codex'); assert.equal(await page.locator('#total').textContent(), '180');
      await page.locator('#agent').selectOption('all'); await page.locator('#model').selectOption('gpt-4.1'); assert.equal(await page.locator('#total').textContent(), '524');
      await page.locator('#model').selectOption('all');
      await page.screenshot({ path: path.resolve('artifacts/overview-' + scale + '.png'), fullPage: true });
      await page.locator('[data-view="sources"]').click(); assert.equal(await page.locator('.source-card').count(), 5);
      await page.screenshot({ path: path.resolve('artifacts/sources-' + scale + '.png'), fullPage: true });
      await page.locator('[data-view="settings"]').click(); await page.locator('#toggle').click(); assert.equal((await page.evaluate(() => window.agentUsage.get())).enabled, false);
      await page.locator('#toggle').click(); await waitState(page, state => !state.collecting);
      const output = path.join(dir, 'export-' + scale + '.json');
      await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); dialog.showMessageBox = async () => ({ response: 1 }); }, output);
      await page.locator('#export').click(); await page.waitForTimeout(100);
      const exported = fs.readFileSync(output, 'utf8'); assert(!exported.includes(f.sentinel)); assert(!exported.includes(dir)); assert.equal(JSON.parse(exported).schemaVersion, 'UsageSnapshotV1');
      // New on-disk usage must arrive through background scheduling, without a
      // manual refresh. Only synthetic input is changed by this test.
      const source = path.join(f.roots.claude[0], 'project/session.jsonl'), original = fs.readFileSync(source, 'utf8');
      const landedAt = Date.now();
      fs.appendFileSync(source, JSON.stringify({ type: 'assistant', uuid: 'fresh-usage', timestamp: new Date().toISOString(), message: { id: 'fresh-message', model: 'gpt-4.1', usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n');
      await waitState(page, state => state.snapshot.daily.reduce((s, r) => s + r.totalTokens, 0) === 704);
      const visibilityLatencyMs = Date.now() - landedAt; assert(visibilityLatencyMs < 60000);
      fs.writeFileSync(source, original);
      const windowLifecycle = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.close(); const hidden = !win.isVisible(); win.show(); return hidden && win.isVisible(); });
      assert(windowLifecycle);
      await page.locator('#clear').click(); await waitState(page, state => state.snapshot.daily.length === 0);
      assert.equal((await page.evaluate(() => window.agentUsage.get())).enabled, false);
      assert.equal(errors.length, 0, JSON.stringify(errors));
      evidence.push({ scale, title: await page.title(), tokens: f.total, visibilityLatencyMs, navigation: true, filters: true, periods: true, pauseResume: true, export: true, clear: true, closeHideRestore: true, rendererErrors: errors, sourceAudit: initial.audit, runtimeNetworkAttempts: initial.runtimeNetworkAttempts });
    } finally { await app.close(); }
    // Separate Windows process restart preserves state after clear and pause.
    const persisted = JSON.parse(fs.readFileSync(path.join(data, 'statistics.json'))); assert.deepEqual(persisted.records, {});
  }
  fs.writeFileSync('artifacts/ui-results.json', JSON.stringify({ packaged: Boolean(process.env.M1_PACKAGED_EXE), evidence }, null, 2));
  console.log('PASS: Windows Electron at 100%/150%; four periods, filters, sources, pause/resume, export, clear and window lifecycle.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
