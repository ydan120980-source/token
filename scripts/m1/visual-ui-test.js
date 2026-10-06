'use strict';
/* global document, innerWidth */
// Existing Electron acceptance tooling; all inputs and accounts are synthetic.
// Flow: estimate detail -> fixed widgets -> multi-window panel -> dark/narrow/keyboard.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { settle } = require('./ui-settle');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-visual-')), evidence = [];
  const output = process.env.VISUAL_EVIDENCE_DIR || 'artifacts/visual'; fs.mkdirSync(output, { recursive: true });
  try {
    const home = path.join(dir, 'home'), f = fixtures(home), data = path.join(dir, 'usage'), store = new Store(data, f.roots);
    for (let d = 0; d < 150; d++) for (const agent of ['codex', 'claude']) {
      if (d % 8 === 5) continue;
      const total = 2000000 + Math.round(Math.abs(Math.sin(d * .28)) * 40000000);
      const record = normalize(agent, { input_tokens: total, output_tokens: 8000, cached_input_tokens: total - 100000, cache_creation_input_tokens: null, reasoning_output_tokens: 1000, total_tokens: total + 8000 }, { id: agent + d, time: Date.now() - d * 86400000, provider: 'openai', model: 'gpt-6.1-sol', entry: 'desktop' }, 'synthetic-salt');
      store.state.records[record.id] = record;
    }
    store.state.sequence = 1; atomic(path.join(data, 'statistics.json'), store.state); store.setEnabled(false);
    const window = (mins, percent, reset) => ({ bucket: 'codex', name: 'codex', kind: mins === 300 ? 'primary' : 'secondary', durationMins: mins, remainingPercent: percent, usedPercent: percent === null ? null : 100 - percent, resetsAt: reset });
    for (const scale of [1, 1.5]) {
      const quotaDir = path.join(dir, 'quota-' + scale); fs.mkdirSync(quotaDir);
      const quota = { schemaVersion: 'AccountQuotaV1', fetchedAt: new Date(Date.now() - 8 * 60000).toISOString(), resetCredits: 2, windows: [window(300, 36, new Date(Date.now() + 134 * 60000).toISOString()), window(10080, 62, new Date(Date.now() + 3 * 86400000).toISOString())] };
      const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
      atomic(path.join(quotaDir, 'quota-cache.json'), { accounts: ids.map((id, i) => ({ id, provider: 'codex', alias: i === 0 ? '个人 · 合成示例' : i === 1 ? '工作 · 长备注用于验证固定组件尺寸与截断显示' : '未获得额度 · 合成示例', plan: i ? 'pro' : 'plus', quota: i === 2 ? null : i === 1 ? { ...quota, windows: [window(300, 0, '2020-01-01T00:00:00Z'), window(10080, null, null), window(60, 85, null)] } : quota })) });
      const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--quota-data-dir', quotaDir, '--usage-data-dir', data, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
      try {
        const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.locator('#quotaCards .quota-card').nth(2).waitFor();
        await settle(page); const dimensions = async () => page.locator('#quotaCards .quota-card').evaluateAll(cards => cards.map(card => ({ width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height })));
        const expected = [{ width: 340, height: 300 }, { width: 340, height: 300 }, { width: 340, height: 300 }];
        assert.deepEqual(await dimensions(), expected);
        const zero = page.locator('#quotaCards .quota-card').nth(1);
        assert.equal(await zero.locator('.quota-segments').first().getAttribute('aria-valuenow'), '0');
        assert.equal(await zero.locator('.quota-segments').nth(1).getAttribute('aria-valuenow'), null);
        assert.equal(await zero.getByText('待刷新', { exact: true }).count(), 1);
        await page.screenshot({ path: path.join(output, 'widgets-' + scale + '.png') });
        await page.locator('#quotaCards .quota-card').first().getByRole('button', { name: '账号详情' }).click();
        assert.deepEqual(await dimensions(), expected);
        await page.screenshot({ path: path.join(output, 'account-panel-' + scale + '.png') });
        await page.locator('#quotaDetailDialog').press('Escape');
        await zero.getByRole('button', { name: '账号详情' }).click();
        assert.equal(await page.locator('#quotaDetailDialog .quota-window').count(), 3);
        await page.locator('#quotaDetailDialog').press('Escape');
        await page.locator('[data-view="usage"]').click();
        const original = await page.evaluate(() => window.usageBridge.get());
        const lower = original.snapshot.daily.reduce((n, row) => n + (row.estimatedCostUsd ?? 0), 0), upper = original.snapshot.daily.reduce((n, row) => n + (row.estimatedCostUpperUsd ?? row.estimatedCostUsd ?? 0), 0);
        assert(upper > lower);
        await page.locator('#totalCost button').waitFor();
        assert.equal(Number(await page.locator('#totalCost button').getAttribute('data-cost-lower')), lower);
        assert.equal(Number(await page.locator('#totalCost button').getAttribute('data-cost-upper')), upper);
        assert.match(await page.locator('#totalCost .cost-lower').textContent(), /^\$[\d,.]+$/);
        // trendNote is intentionally visible since 2026-10-05: it explains the unrecorded-date bridges.
        for (const id of ['scopeSummary', 'profileBio', 'mixIncomplete', 'modelCount', 'dataBadge']) assert.equal(await page.locator('#' + id).isVisible(), false);
        assert.equal(await page.locator('#dayDetail').isVisible(), false);
        await page.screenshot({ path: path.join(output, 'usage-' + scale + '.png') });
        await page.locator('#totalCost button').hover(); await settle(page);
        assert.equal(await page.locator('#totalCost button').evaluate(b => b.classList.contains('cost-expanded')), true);
        assert.equal(await page.locator('#costDialog').count(), 0);
        assert.match(await page.locator('#totalCost button').getAttribute('aria-label'), /仅包括已定价部分/);
        await page.screenshot({ path: path.join(output, 'estimate-panel-' + scale + '.png') });
        await page.locator('#totalCost button').press('Escape');
        await page.locator('#heatmap button').last().press('Enter'); assert.equal(await page.locator('#dayDetail').isVisible(), true);
        await page.locator('#closeDay').click();
        await page.locator('#theme').click(); await page.screenshot({ path: path.join(output, 'usage-dark-' + scale + '.png') });
        await page.locator('[data-view="quota"]').click(); await page.screenshot({ path: path.join(output, 'widgets-dark-' + scale + '.png') });
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
        await page.screenshot({ path: path.join(output, 'widgets-narrow-' + scale + '.png') });
        assert.deepEqual(await dimensions(), expected);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.locator('[data-view="usage"]').click();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(output, 'usage-narrow-' + scale + '.png') });
        await page.locator('#totalCost button').click(); await page.locator('#totalCost button').press('Escape');
        assert.deepEqual(errors, []);
        const audit = await page.evaluate(() => window.usageBridge.get()); assert.equal(audit.enabled, false); assert.equal(audit.collecting, false); assert.equal(audit.audit, null);
        evidence.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), fixedWidgets: expected, darkAndNarrow: true, exactEstimateBounds: true, unknownAndZeroDistinct: true, threeWindowPanel: true, keyboardDialogs: true, noPageErrors: true });
      } finally { await app.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2)); process.stdout.write(JSON.stringify(evidence) + '\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
