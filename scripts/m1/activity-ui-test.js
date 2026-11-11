'use strict';
/* global document, innerWidth, innerHeight, getComputedStyle */
// Browser plugin not available; use the project's Electron acceptance workflow.
// Only disposable homes and synthetic statistics, including midnight/year transitions.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { settle, cleanup, isolatePointer, keepVisible, until } = require('./ui-settle');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const usageUi = require('./usage-ui-helpers');
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
      const page = await app.firstWindow(), errors = []; await keepVisible(app);
      await isolatePointer(app);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.locator('#quotaCards').waitFor({ state: 'attached' });
      await page.waitForLoadState('load');
      // Freeze Date only. Fast-forwarding performance/RAF moves Motion's WAAPI startTime
      // into the future relative to document.timeline; retain the real frame/timer clocks.
      await page.clock.setFixedTime(new Date(start)); await page.reload();
      await page.locator('[data-view="usage"]').click();
      await page.waitForFunction(() => document.querySelector('[data-usage-today]').textContent.includes('2026-12-31'));
      assert.equal(await page.title(), 'Agent Usage · Codex 额度');
      assert.match(await usageUi.value(page, 'today-tokens'), /2\.0M/);
      const gridDates = await usageUi.calendarCells(page).evaluateAll(buttons => buttons.map(button => button.dataset.heatKey));
      for (const period of ['30', '7', 'today', 'all']) {
        await usageUi.period(page, period);
        assert.deepEqual(await usageUi.calendarCells(page).evaluateAll(buttons => buttons.map(button => button.dataset.heatKey)), gridDates);
        assert.equal(await page.locator('[data-usage-calendar-range] [role=tab]').first().isEnabled(), true);
        assert.equal(await page.locator('[data-usage-calendar] svg text').first().isVisible(), true);
        assert.equal(await page.locator('[data-usage-calendar] [data-heat-key] span, [data-usage-calendar] [data-heat-key] b').count(), 0);
        const sizes = await usageUi.calendarCells(page).evaluateAll(buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { width: r.width, height: r.height }; }));
        assert(sizes.every(r => r.width < 24 && r.height < 24 && Math.abs(r.width - r.height) < 1));
        assert.equal(await page.locator('[data-usage-calendar] [data-chart]').getAttribute('data-variant'), 'calendar');
        if (period === '30') {
          await page.locator('[data-usage-activity]').scrollIntoViewIfNeeded();
          await usageUi.hover(page, usageUi.cell(page, '2026-12-31')); await page.waitForTimeout(180);
          await page.screenshot({ path: path.join(output, 'heat-period-30-' + scale + '.png') });
        }
      }
      const known = usageUi.cell(page, '2026-12-31');
      await usageUi.hover(page, known); await page.locator('#kit-window-chart-tooltip').waitFor();
      assert.match(await page.locator('#kit-window-chart-tooltip').textContent(), /2,000,000 Token/);
      assert.equal(await known.getAttribute('aria-describedby'), 'kit-window-chart-tooltip');
      await settle(page);
      assert.equal(await known.evaluate(button => getComputedStyle(button).opacity), '1', 'entered cell is completely visible');
      assert.equal(await known.evaluate(button => getComputedStyle(button).transform), 'none', 'cell layout does not lift or scale');
      await page.locator('[data-usage-activity]').scrollIntoViewIfNeeded(); await usageUi.hover(page, known); await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(output, 'heat-hover-' + scale + '.png') });
      await known.focus(); await known.press('ArrowLeft');
      assert.equal(await page.locator('[data-usage-calendar] :focus').getAttribute('data-heat-key'), '2026-12-24');
      await page.locator('[data-usage-calendar] :focus').press('Escape');
      await page.locator('#kit-window-chart-tooltip').waitFor({ state: 'detached' });
      assert.equal(await page.locator('#kit-window-chart-tooltip').count(), 0);
      const unknown = usageUi.cell(page, '2026-12-30');
      await unknown.focus(); assert.match(await page.locator('#kit-window-chart-tooltip').textContent(), /未观测到记录/);
      const zero = usageUi.cell(page, '2026-12-29');
      await zero.focus(); assert.match(await page.locator('#kit-window-chart-tooltip').textContent(), /0 Token/);
      await zero.press('Enter'); assert.equal(await page.locator('[data-usage-day]').isVisible(), true);
      assert.equal(await zero.getAttribute('aria-pressed'), 'true');
      assert.equal(await zero.evaluate(button => button === document.activeElement), true);
      await page.getByRole('button', { name: '关闭当日明细', exact: true }).click();
      await usageUi.heatRange(page, '2026');
      await page.clock.setFixedTime(new Date(start + 31000));
      await until(page, () => document.querySelector('[data-usage-today]').textContent.includes('2027-01-01'), 35000);
      assert.match(await page.locator('[data-usage-today]').textContent(), /2027-01-01/);
      assert.match(await usageUi.value(page, 'today-tokens'), /6\.0M/);
      assert.equal(await usageUi.text(page.locator('[data-usage-calendar-range] [role=tab][aria-selected=true]')), '2027 年');
      const newYearSize = await usageUi.calendarCells(page).first().boundingBox();
      assert(newYearSize.width < 24 && newYearSize.height < 24 && Math.abs(newYearSize.width - newYearSize.height) < 1);
      await usageUi.period(page, 'today');
      await settle(page);
      assert.equal(await usageUi.value(page, 'totalTokens'), '6,000,000');
      await usageUi.period(page, 'all'); await usageUi.heatRange(page, '365');
      await page.locator('#theme').click();
      await page.locator('[data-usage-activity]').scrollIntoViewIfNeeded(); await usageUi.hover(page, usageUi.cell(page, '2027-01-01')); await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(output, 'heat-dark-' + scale + '.png') });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // Reduced keeps colour and shadow fades but drops movement; off drops both.
      const reducedTransforms = await usageUi.cell(page, '2026-12-29').evaluate(button => button.getAnimations()
        .flatMap(animation => animation.effect.getKeyframes()).map(frame => frame.transform).filter(Boolean));
      assert(reducedTransforms.every(transform => transform === 'none'), 'reduced mode has no moving/scaling cell keyframes');
      await settle(page); assert.equal(await page.locator('[data-usage-calendar] [data-chart]').getAttribute('data-ready'), 'true');
      await page.evaluate(() => window.uiMotion.setPreference('off'));
      await settle(page);
      assert.equal(await page.locator('[data-usage-calendar] [data-heat-key]').evaluateAll(cells => cells.every(cell => cell.getAnimations().every(animation => animation.playState !== 'running'))), true);
      await page.evaluate(() => window.uiMotion.setPreference('system'));
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
      await usageUi.hover(page, usageUi.calendarCells(page).first());
      const tooltipBounds = await page.locator('#kit-window-chart-tooltip').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; });
      assert.equal(tooltipBounds, true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.waitForTimeout(180); await page.screenshot({ path: path.join(output, 'heat-narrow-' + scale + '.png') });
      await page.clock.setFixedTime(new Date('2027-01-01T16:00:10Z'));
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.match(await page.locator('[data-usage-today]').textContent(), /2027-01-02/);
      assert.match(await page.locator('[data-usage-today]').textContent(), /采集已暂停/);
      assert.equal(await page.locator('[data-usage-today-sessions] button').count(), 0);
      assert.equal(await usageUi.value(page, 'today-tokens'), 'Token未知'); assert.equal(await usageUi.value(page, 'today-records'), '记录未知');
      // A real IPC scan over a new synthetic source must populate today's card.
      const file = path.join(f.roots.codex[0], 'today-new.jsonl');
      const usage = { input_tokens: 100, output_tokens: 20, cached_input_tokens: 40, reasoning_output_tokens: 3, total_tokens: 120 };
      fs.writeFileSync(file, [ { type: 'session_meta', payload: { id: 'activity-new-session', originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } }, { timestamp: '2027-01-01T16:00:20Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage, last_token_usage: usage } } } ].map(row => JSON.stringify(row)).join('\n') + '\n');
      await page.getByRole('button', { name: '刷新今日', exact: true }).click();
      await usageUi.waitValue(page, 'today-tokens', 'Token120');
      assert.match(await page.locator('[data-usage-today]').textContent(), /Codex/);
      const state = await page.evaluate(() => window.usageBridge.get());
      assert.equal(state.enabled, false); assert.equal(state.audit.authenticationReads, 0); assert.equal(state.audit.sourceWrites, 0); assert.equal(state.audit.networkAttempts, 0);
      assert.deepEqual(errors, []);
      evidence.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), annualGridIndependentOfSummaryPeriod: true, allPeriodsKeepSmallSquares: true, hoverExactTokens: true, keyboardAndClick: true, zeroVersusUnknown: true, midnightAndNewYear: true, todayIpcRefresh: true, reducedMotion: true, narrowTooltipBounds: true, noPageErrors: true });
    } catch (error) {
      const page = await app.firstWindow();
      fs.writeFileSync(path.join(output, 'failure-' + scale + '.json'), JSON.stringify(await page.evaluate(() => ({
        date: Date.now(), now: performance.now(), timeline: document.timeline.currentTime,
        motion: document.body.dataset.motion,
        animations: document.getAnimations().filter(animation => animation.playState === 'running').map(animation => ({
          time: animation.currentTime, start: animation.startTime, timing: animation.effect.getComputedTiming(),
          target: animation.effect.target?.outerHTML?.slice(0, 220),
        })),
      })), null, 2));
      await page.screenshot({ path: path.join(output, 'failure-' + scale + '.png') }); throw error;
    } finally { await app.close(); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2)); process.stdout.write(JSON.stringify(evidence) + '\n');
  } finally { await cleanup(dir); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
