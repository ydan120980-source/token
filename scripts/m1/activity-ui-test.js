'use strict';
/* global document, innerWidth, innerHeight, getComputedStyle */
// Browser plugin not available; use the project's Electron acceptance workflow.
// Only disposable homes and synthetic statistics, including midnight/year transitions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { settle, cleanup } = require('./ui-settle');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-activity-'));
  const output = process.env.ACTIVITY_EVIDENCE_DIR || 'artifacts/activity', evidence = [];
  fs.mkdirSync(output, { recursive: true });
  try { for (const scale of [1, 1.5]) {
    const home = path.join(dir, 'home-' + scale), f = fixtures(home), data = path.join(dir, 'usage-' + scale), store = new Store(data, f.roots);
    const start = Date.parse('2026-12-31T15:59:50Z');
    function add(id, time, tokens) {
      const r = normalize('codex', { input_tokens: tokens, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: tokens }, { id, time, provider: 'openai', model: 'gpt-4.1', entry: 'desktop' }, 'synthetic-salt');
      store.state.records[r.id] = r;
    }
    for (let d = 0; d < 150; d++) if (d !== 1 && d !== 2 && d % 8 !== 5) add('daily-' + d, start - d * 86400000, 2000000 + Math.round(Math.abs(Math.sin(d * .28)) * 40000000));
    add('observed-zero', start - 2 * 86400000, 0);
    add('new-year', start + 30000, 6000000);
    store.state.sequence = 1; atomic(path.join(data, 'statistics.json'), store.state); store.setEnabled(false);
    const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--quota-data-dir', path.join(dir, 'quota-' + scale), '--usage-data-dir', data, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.locator('#quotaCards').waitFor({ state: 'attached' });
      await page.waitForLoadState('load');
      await page.clock.install({ time: new Date(start) }); await page.reload();
      await page.locator('[data-view="usage"]').click();
      await page.waitForFunction(() => document.getElementById('todayDate').textContent === '2026-12-31');
      assert.equal(await page.title(), 'Agent Usage · Codex 额度');
      assert.match(await page.locator('#todayTotals').textContent(), /2\.0M/);
      const gridDates = await page.locator('#heatmap button').evaluateAll(buttons => buttons.map(button => button.dataset.date));
      for (const period of ['30', '7', 'today', 'all']) {
        await page.locator('[data-period="' + period + '"]').click();
        assert.deepEqual(await page.locator('#heatmap button').evaluateAll(buttons => buttons.map(button => button.dataset.date)), gridDates);
        assert.equal(await page.locator('#heatRange').isEnabled(), true);
        assert.equal(await page.locator('#heatMonths').isVisible(), true);
        assert.equal(await page.locator('#heatmap button span, #heatmap button b').count(), 0);
        const sizes = await page.locator('#heatmap button').evaluateAll(buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
        assert(sizes.every(r => r.width < 24 && r.height < 24 && Math.abs(r.width - r.height) < 1));
        assert.equal(await page.locator('#heatmap').getAttribute('class'), 'heatmap');
        if (period === '30') {
          await page.locator('#activityBlock').scrollIntoViewIfNeeded();
          await page.locator('#heatmap [data-date="2026-12-31"]').hover(); await page.waitForTimeout(180);
          await page.screenshot({ path: path.join(output, 'heat-period-30-' + scale + '.png') });
        }
      }
      const known = page.locator('#heatmap [data-date="2026-12-31"]');
      await known.hover(); await page.waitForFunction(() => document.getElementById('heatTooltip').getAttribute('aria-hidden') === 'false');
      assert.match(await page.locator('#heatTooltip').textContent(), /2,000,000 Token/);
      assert.equal(await known.getAttribute('aria-describedby'), 'heatTooltip');
      const transition = await known.evaluate(button => getComputedStyle(button).transitionDuration);
      assert.match(transition, /0\.14s/);
      await page.locator('#activityBlock').scrollIntoViewIfNeeded(); await known.hover(); await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(output, 'heat-hover-' + scale + '.png') });
      await known.press('ArrowLeft');
      assert.equal(await page.locator('#heatmap :focus').getAttribute('data-date'), '2026-12-24');
      await page.locator('#heatmap :focus').press('Escape');
      assert.equal(await page.locator('#heatTooltip').getAttribute('aria-hidden'), 'true');
      const unknown = page.locator('#heatmap [data-date="2026-12-30"]');
      await unknown.focus(); assert.match(await page.locator('#heatTooltip').textContent(), /未观测到记录/);
      const zero = page.locator('#heatmap [data-date="2026-12-29"]');
      await zero.focus(); assert.match(await page.locator('#heatTooltip').textContent(), /0 Token/);
      await zero.press('Enter'); assert.equal(await page.locator('#dayDetail').isVisible(), true);
      assert.equal(await zero.getAttribute('aria-pressed'), 'true');
      assert.equal(await zero.evaluate(button => button === document.activeElement), true);
      await page.locator('#closeDay').click();
      await page.locator('.heat-range [data-value="2026"]').click();
      await page.clock.runFor(31000);
      assert.equal(await page.locator('#todayDate').textContent(), '2027-01-01');
      assert.match(await page.locator('#todayTotals').textContent(), /6\.0M/);
      assert.equal(await page.locator('#heatRange').inputValue(), '2027');
      const newYearSize = await page.locator('#heatmap button').first().boundingBox();
      assert(newYearSize.width < 24 && newYearSize.height < 24 && Math.abs(newYearSize.width - newYearSize.height) < 1);
      await page.locator('[data-period="today"]').click();
      await settle(page);
      assert.equal(await page.locator('#totalTokens').textContent(), '6.0M');
      await page.locator('[data-period="all"]').click(); await page.locator('.heat-range [data-value="365"]').click();
      await page.locator('#theme').click();
      await page.locator('#activityBlock').scrollIntoViewIfNeeded(); await page.locator('#heatmap [data-date="2027-01-01"]').hover(); await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(output, 'heat-dark-' + scale + '.png') });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.match(await zero.evaluate(button => getComputedStyle(button).transitionDuration), /^0s/);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
      await page.locator('#heatmap button').first().hover();
      const tooltipBounds = await page.locator('#heatTooltip').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
      assert.equal(tooltipBounds, true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.waitForTimeout(180); await page.screenshot({ path: path.join(output, 'heat-narrow-' + scale + '.png') });
      await page.clock.setSystemTime(new Date('2027-01-01T16:00:10Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await page.locator('#todayDate').textContent(), '2027-01-02');
      assert.match(await page.locator('#todayClients').textContent(), /采集已暂停/);
      assert.equal(await page.locator('#todayTotals button').count(), 0);
      assert.equal(await page.locator('#todayTotals').textContent(), 'Token—估算—记录—');
      // A real IPC scan over a new synthetic source must populate today's card.
      const file = path.join(f.roots.codex[0], 'today-new.jsonl');
      const usage = { input_tokens: 100, output_tokens: 20, cached_input_tokens: 40, reasoning_output_tokens: 3, total_tokens: 120 };
      fs.writeFileSync(file, [ { type: 'session_meta', payload: { id: 'activity-new-session', originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } }, { timestamp: '2027-01-01T16:00:20Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage, last_token_usage: usage } } } ].map(row => JSON.stringify(row)).join('\n') + '\n');
      await page.locator('[data-refresh-today]').click();
      await page.waitForFunction(() => document.getElementById('todayTotals').textContent.includes('120'));
      assert.match(await page.locator('#todayClients').textContent(), /Codex/);
      const state = await page.evaluate(() => window.usageBridge.get());
      assert.equal(state.enabled, false); assert.equal(state.audit.authenticationReads, 0); assert.equal(state.audit.sourceWrites, 0); assert.equal(state.audit.networkAttempts, 0);
      assert.deepEqual(errors, []);
      evidence.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), annualGridIndependentOfSummaryPeriod: true, allPeriodsKeepSmallSquares: true, hoverExactTokens: true, keyboardAndClick: true, zeroVersusUnknown: true, midnightAndNewYear: true, todayIpcRefresh: true, reducedMotion: true, narrowTooltipBounds: true, noPageErrors: true });
    } finally { await app.close(); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2)); process.stdout.write(JSON.stringify(evidence) + '\n');
  } finally { await cleanup(dir); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
