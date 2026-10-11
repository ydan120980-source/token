'use strict';
/* global document, getComputedStyle, requestAnimationFrame, innerWidth, CSS */
// Native acceptance, synthetic homes only. Does not authorize an account.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');
const { settle, cleanup } = require('./ui-settle');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-motion-')), evidence = [];
  const output = process.env.MOTION_EVIDENCE_DIR || 'artifacts/motion'; fs.mkdirSync(output, { recursive: true });
  try {
    const home = path.join(root, 'home'), fixture = fixtures(home), usage = path.join(root, 'usage'), store = new Store(usage, fixture.roots);
    for (let i = 0; i < 20000; i++) { const r = normalize('codex', { input_tokens: 80, output_tokens: 20, cached_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 100 }, { id: 'motion-' + i, time: Date.now() - Math.floor(i / 100) * 86400000, model: 'synthetic-' + i % 100, entry: 'cli' }, 'synthetic-salt'); store.state.records[r.id] = r; }
    store.state.sequence = 1; atomic(path.join(usage, 'statistics.json'), store.state); store.setEnabled(false);
    for (const scale of [1, 1.5]) {
      const quota = path.join(root, 'quota-' + scale); fs.mkdirSync(quota);
      atomic(path.join(quota, 'quota-cache.json'), { accounts: [{ id: '11111111-1111-4111-8111-111111111111', alias: '合成动效验收', provider: 'codex', plan: 'plus', quota: { schemaVersion: 'AccountQuotaV1', fetchedAt: new Date().toISOString(), resetCredits: null, windows: [{ bucket: 'codex', name: 'codex', kind: 'primary', usedPercent: 36, remainingPercent: 64, durationMins: 300, resetsAt: null }] } }] });
      const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--quota-data-dir', quota, '--usage-data-dir', usage, '--m1-fixture-root', home, '--force-device-scale-factor=' + scale], timeout: 60000 });
      try {
        const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.locator('#quotaCards .quota-card').waitFor(); await settle(page);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        assert.equal(await page.locator('body').getAttribute('data-motion'), 'full');
        const before = await page.locator('#quotaCards .quota-card').boundingBox(); assert(Math.abs(before.width - 340) < .01); assert(Math.abs(before.height - 300) < .01);
        await page.locator('[data-view="settings"]').click(); await page.locator('#motionSelect').selectOption('off');
        assert.equal(await page.locator('body').getAttribute('data-motion'), 'off');
        await page.locator('#motionSelect').selectOption('system');
        await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => document.body.dataset.motion === 'reduced'); assert.equal(await page.locator('body').getAttribute('data-motion'), 'reduced');
        await page.locator('#motionSelect').selectOption('system'); assert.equal(await page.locator('body').getAttribute('data-motion'), 'reduced');
        await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForFunction(() => document.body.dataset.motion === 'full');
        await page.locator('#motionSelect').selectOption('reduced'); assert.equal(await page.locator('body').getAttribute('data-motion'), 'reduced');
        await page.locator('#settingsProfile').click();
        const reduced = await page.locator('#profileDialog').evaluate(d => ({ transform:getComputedStyle(d).transform, durations:d.getAnimations().map(a => a.effect.getTiming().duration) }));
        assert.equal(reduced.transform, 'none'); assert(reduced.durations.every(ms => ms <= 80));
        await page.locator('#profileDialog').press('Escape'); await settle(page);
        await page.locator('#motionSelect').selectOption('system');
        // Retarget during finite effects without disabling input.
        await page.evaluate(() => { for (let i = 0; i < 30; i++) document.querySelector('[data-view="' + ['quota', 'sources', 'settings', 'usage'][i % 4] + '"]').click(); document.querySelector('[data-view="usage"]').click(); });
        await settle(page); assert.equal(await page.locator('#main').getAttribute('data-current-view'), 'usage');
        assert.equal(await page.locator('main > section:not([hidden])').count(), 1);
        assert.equal(await page.locator('#totalTokens').textContent(), '2.0M');
        // Deterministic native transition frames: pause existing browser transitions,
        // sample their current times, then resume. No production test hooks.
        await page.locator('#editProfile').click();
        const native = await page.evaluate(() => { const d = document.getElementById('profileDialog'), animations = d.getAnimations(); animations.forEach(a => { a.pause(); a.currentTime = 0; }); return { count: animations.length, durations: animations.map(a => a.effect.getTiming().duration), supportsDetails: CSS.supports('interpolate-size', 'allow-keywords'), focusInside: d.contains(document.activeElement) }; });
        assert(native.count > 0); assert(native.durations.includes(280)); assert(native.focusInside);
        const frames = [];
        for (const time of [0, 70, 140, 280]) {
          await page.evaluate(time => { for (const a of document.getElementById('profileDialog').getAnimations()) a.currentTime = time; }, time);
          await page.screenshot({ path: path.join(output, 'profile-' + scale + '-' + time + '.png') });
          frames.push(await page.locator('#profileDialog').evaluate(d => ({ opacity: Number(getComputedStyle(d).opacity), transform: getComputedStyle(d).transform })));
        }
        assert(frames[0].opacity < frames[2].opacity); assert.equal(frames[3].opacity, 1);
        await page.evaluate(() => document.getElementById('profileDialog').getAnimations().forEach(a => a.finish()));
        await page.locator('#profileDialog').press('Escape');
        assert.equal(await page.locator('#profileDialog').evaluate(d => d.open), false);
        assert.equal(await page.locator('#editProfile').evaluate(b => document.activeElement === b), true);
        // Closing and reopening within one task must preserve the last request.
        await page.evaluate(() => { document.getElementById('editProfile').click(); document.getElementById('profileDialog').close(); document.getElementById('editProfile').click(); });
        assert.equal(await page.locator('#profileDialog').evaluate(d => d.open), true); await page.locator('#profileDialog').press('Escape'); await settle(page);
        await page.locator('#totalCost button').focus(); await page.locator('#totalCost button').press('Escape');
        await page.locator('[data-export]').first().click(); await page.getByRole('button', { name: '关闭导出', exact: true }).click();
        assert.equal(await page.locator('#exportDialog').evaluate(d => d.open), false);
        // The source dialog is a browser preview surface; production uses the OS picker.
        await page.evaluate(() => document.getElementById('sourceDialog').showModal());
        await page.getByRole('button', {name:'关闭来源选择', exact:true}).click();
        assert.equal(await page.locator('#sourceDialog').evaluate(d => d.open), false);
        await page.locator('[data-view="quota"]').click(); await page.locator('#quotaAdd').click();
        await page.locator('#quotaLoginDialog').press('Escape');
        assert.equal(await page.locator('#quotaLoginDialog').evaluate(d => d.open), false);
        await page.locator('[data-view="usage"]').click();
        await page.locator('#editProfile').click();
        const transitionFrames = await page.evaluate(() => new Promise(resolve => {
          const gaps = []; let last = performance.now(), start = last;
          function sample(now) { gaps.push(now - last); last = now; if (now - start < 500) requestAnimationFrame(sample); else resolve({ samples:gaps.length, averageMs:gaps.reduce((a,b) => a+b,0)/gaps.length, maxMs:Math.max(...gaps) }); }
          requestAnimationFrame(sample);
        }));
        await page.locator('#profileDialog').press('Escape');
        const closing = await page.locator('#profileDialog').evaluate(d => ({ open:d.open, pointerEvents:getComputedStyle(d).pointerEvents, durations:d.getAnimations().map(a => a.effect.getTiming().duration) }));
        assert.equal(closing.open, false); assert.equal(closing.pointerEvents, 'none'); assert(closing.durations.includes(180));
        await page.locator('#models summary').click(); await page.locator('#models summary').click(); await settle(page);
        await page.locator('#heatmap button').last().focus(); await page.locator('#heatmap button').last().press('Enter');
        assert.equal(await page.locator('#dayDetail').isVisible(), true); await page.locator('#closeDay').click();
        const changes = {};
        for (const mode of ['off', 'system']) {
          await page.evaluate(mode => window.uiMotion.setPreference(mode), mode);
          changes[mode] = await page.evaluate(async () => {
            const gaps = [], elapsed = []; let last = performance.now(), running = true;
            function sample(now) { gaps.push(now - last); last = now; if (running) requestAnimationFrame(sample); } requestAnimationFrame(sample);
            for (let i = 0; i < 20; i++) { const start = performance.now(); document.querySelector('[data-period="' + ['today', '7', '30', 'all'][i % 4] + '"]').click(); elapsed.push(performance.now() - start); await new Promise(resolve => requestAnimationFrame(resolve)); }
            running = false; return { maxCommitMs: Math.max(...elapsed), averageCommitMs: elapsed.reduce((a,b) => a+b,0)/elapsed.length, maxFrameGapMs: Math.max(...gaps), samples: gaps.length };
          });
          await settle(page); assert.equal(await page.locator('#totalTokens').textContent(), '2.0M');
        }
        assert(changes.system.maxCommitMs < 3000); assert(changes.system.averageCommitMs < changes.off.averageCommitMs * 1.5 + 20);
        await page.locator('#theme').click(); await page.locator('[data-view="quota"]').click(); await settle(page);
        await page.locator('#quotaCards [data-quota-details]').click(); await page.locator('#quotaDetailDialog .quota-diagnostics summary').click();
        const handles = await page.evaluateHandle(() => [document.querySelector('#quotaCards .quota-card'), document.querySelector('#quotaCards [data-quota-details]'), document.querySelector('#quotaDetailDialog .quota-diagnostics')]);
        await page.clock.install(); await page.clock.fastForward(30001); await page.clock.resume();
        assert.equal(await page.evaluate(handles => handles[0] === document.querySelector('#quotaCards .quota-card') && handles[1] === document.querySelector('#quotaCards [data-quota-details]') && handles[2] === document.querySelector('#quotaDetailDialog .quota-diagnostics') && handles[2].open, handles), true); await handles.dispose();
        await page.locator('#quotaDetailDialog').press('Escape'); await settle(page);
        await page.locator('[data-view="settings"]').click(); await page.locator('#settingsProfile').click();
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800,600)); await settle(page);
        assert.equal(await page.locator('#profileDialog').evaluate(d => d.open && d.contains(document.activeElement)), true);
        await page.locator('#profileDialog').press('Escape'); await page.locator('[data-view="quota"]').click(); await settle(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(output, 'quota-dark-narrow-' + scale + '.png') });
        assert.equal(await page.evaluate(() => window.uiMotion.activeCount), 0);
        assert.deepEqual(errors, []); assert.equal(fs.existsSync(path.join(quota, 'codex-homes')), false);
        await page.evaluate(() => window.uiMotion.setPreference('off')); await page.reload();
        await page.locator('#quotaCards .quota-card').waitFor();
        assert.equal(await page.locator('body').getAttribute('data-motion'), 'off');
        assert.equal(await page.evaluate(() => window.uiMotion.preference), 'off');
        evidence.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), workload: { rows:20000, models:100, rangeChanges:20 }, modes:true, systemPreferencePrecedence:true, persistedPreference:true, allFiveDialogSurfacesAndInlineCost:true, resizeDuringDialog:true, reduced, immediateFocusAndClose:true, interruption:true, cardAndDisclosureNodesRetained:true, native, frames, transitionFrames, closing, changes, noPageErrors:true, realLogin:false });
      } finally { await app.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
  } finally { await cleanup(root); }
})().catch(e => { console.error(e.stack); process.exitCode=1; });
