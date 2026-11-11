'use strict';
/* global MouseEvent, document, getComputedStyle, requestAnimationFrame, innerWidth */
// Native acceptance, synthetic homes only. Does not authorize an account.
const usageUi = require('./usage-ui-helpers');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');
const { settle, cleanup, keepVisible, showView, until } = require('./ui-settle');
const { dialog, openSettings, pickSelect, waitClosed } = require('./settings-ui-helpers');
const q = require('./quota-ui-helpers');
// The sheet keeps a fixed centring translate; movement shows as a changing transform, scaling as a or d ≠ 1.
const unscaled = transform => transform === 'none' || transform.startsWith('matrix(1, 0, 0, 1,');
// Opacity and transform of the open sheet on every frame for a while (the React sheet uses Motion springs).
const sample = (page, ms) => page.evaluate(ms => new Promise(resolve => { const out = [], start = performance.now(); function frame(now) { const d = document.querySelector('[data-ui-portal] [role="dialog"]'); if (d) out.push({ t: now - start, opacity: Number(getComputedStyle(d).opacity), transform: getComputedStyle(d).transform, focusInside: d.contains(document.activeElement) }); if (now - start < ms) requestAnimationFrame(frame); else resolve(out); } requestAnimationFrame(frame); }), ms);
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
        const page = await app.firstWindow(), errors = []; await keepVisible(app); page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await showView(page, 'quota'); await page.locator('#quotaCards .quota-card').waitFor(); await settle(page);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        assert.equal(await page.locator('body').getAttribute('data-motion'), 'full');
        const before = await page.locator('#quotaCards .quota-card').boundingBox(); assert(before.width >= 260 && Math.abs(before.width - before.height) < .01, 'a quota card is a square at least 260 px wide');
        const settings = page.locator('[data-settings-page]'), motion = label => pickSelect(settings, page, '界面动效', label);
        await openSettings(page); await motion('关闭');
        assert.equal(await page.locator('body').getAttribute('data-motion'), 'off');
        await motion('跟随系统');
        await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => document.body.dataset.motion === 'reduced'); assert.equal(await page.locator('body').getAttribute('data-motion'), 'reduced');
        await motion('跟随系统'); assert.equal(await page.locator('body').getAttribute('data-motion'), 'reduced');
        await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForFunction(() => document.body.dataset.motion === 'full');
        await motion('减少动态'); assert.equal(await page.locator('body').getAttribute('data-motion'), 'reduced');
        // Reduced motion: the sheet fades only; no frame moves or scales it.
        await settings.getByRole('button', { name: '编辑资料', exact: true }).click();
        const reducedFrames = await sample(page, 300), reduced = { frames: reducedFrames.length, transforms: [...new Set(reducedFrames.map(frame => frame.transform))] };
        assert(reducedFrames.length && reduced.transforms.length === 1 && unscaled(reduced.transforms[0]), 'reduced sheet never moves or scales: ' + reduced.transforms);
        await page.keyboard.press('Escape'); await waitClosed(page); await settle(page);
        await motion('跟随系统');
        // Retarget during finite effects without disabling input.
        await page.evaluate(() => { for (let i = 0; i < 30; i++) document.querySelector('[data-view="' + ['quota', 'sources', 'settings', 'usage'][i % 4] + '"]').click(); document.querySelector('[data-view="usage"]').click(); });
        await settle(page); assert.equal(await page.locator('#main').getAttribute('data-current-view'), 'usage');
        assert.equal(await page.locator('main > section:not([hidden])').count(), 1);
        assert.equal(await usageUi.value(page, 'totalTokens'), '2,000,000');
        // Deterministic native transition frames: pause existing browser transitions,
        // sample their current times, then resume. No production test hooks.
        // Full motion: the sheet from the sidebar enters with spring.slow and settles within 400 ms, focus inside.
        await page.locator('#editProfile').click();
        const frames = await sample(page, 450), final = frames.at(-1).transform, settled = frames.find(frame => frame.opacity === 1 && frame.transform === final);
        await page.screenshot({ path: path.join(output, 'profile-' + scale + '.png') });
        assert(frames[0].opacity < 1 || frames[0].transform !== final, 'the sheet animates in'); assert(unscaled(final), 'it ends at full size');
        assert(settled && settled.t <= 400, 'the sheet settles within 400 ms'); assert(frames.at(-1).focusInside);
        const native = { frames: frames.length, settledMs: Math.round(settled.t), focusInside: frames.at(-1).focusInside };
        await page.keyboard.press('Escape'); await waitClosed(page);
        assert.equal(await page.locator('#editProfile').evaluate(b => document.activeElement === b), true, 'focus returns to the sidebar button');
        // Closing and reopening at once must end open.
        await page.locator('#editProfile').click(); await dialog(page).waitFor(); await page.keyboard.press('Escape'); await page.locator('#editProfile').click();
        await settle(page); assert.equal(await dialog(page).count(), 1); await page.keyboard.press('Escape'); await waitClosed(page); await settle(page);
        await page.locator('[data-usage-total-cost] button').focus(); await page.locator('[data-usage-total-cost] button').press('Escape');
        await page.locator('[data-usage-export] button').click(); await dialog(page).waitFor(); await dialog(page).getByRole('button', { name: '关闭', exact: true }).click();
        await waitClosed(page);
        // The source dialog is a browser preview surface; production uses the OS picker.
        const sourceDialog = await require('./sources-ui-helpers').demoDirectoryChecks(app, output, 'motion-' + scale);
        assert.equal(sourceDialog.openAfterClose, false);
        await page.locator('[data-view="quota"]').click(); await page.locator('#quotaCards [data-quota-details]').first().click(); await q.details(page).locator('[data-provider-connect="codex"] button').click(); await q.codexLogin(page).waitFor();
        await page.keyboard.press('Escape'); await q.codexLogin(page).waitFor({ state: 'detached' });
        assert.equal(await q.codexLogin(page).count(), 0);
        await page.locator('[data-view="usage"]').click();
        await page.locator('#editProfile').click();
        const transitionFrames = await page.evaluate(() => new Promise(resolve => {
          const gaps = []; let last = performance.now(), start = last;
          function sample(now) { gaps.push(now - last); last = now; if (now - start < 500) requestAnimationFrame(sample); else resolve({ samples:gaps.length, averageMs:gaps.reduce((a,b) => a+b,0)/gaps.length, maxMs:Math.max(...gaps) }); }
          requestAnimationFrame(sample);
        }));
        // Closing leaves within 300 ms and never blocks the page meanwhile.
        const closeStart = Date.now(); await page.keyboard.press('Escape');
        await until(page, () => { const d = document.querySelector('[data-ui-portal] [role="dialog"]'); return !d || getComputedStyle(d).pointerEvents === 'none'; }, 3000);
        const closing = { ms: Date.now() - closeStart }; assert(closing.ms <= 300 + 150, 'the sheet is gone or inert within 300 ms (+ polling), took ' + closing.ms);
        await usageUi.calendarCells(page).last().focus(); await usageUi.calendarCells(page).last().press('Enter');
        assert.equal(await page.locator('[data-usage-day]').isVisible(), true); await page.getByRole('button', { name: '关闭当日明细', exact: true }).click();
        const changes = {};
        for (const mode of ['off', 'system']) {
          await page.evaluate(mode => window.uiMotion.setPreference(mode), mode);
          changes[mode] = await page.evaluate(async () => {
            const gaps = [], elapsed = [], periods = [], readouts = []; let last = performance.now(), running = true;
            function sample(now) { gaps.push(now - last); last = now; if (running) requestAnimationFrame(sample); } requestAnimationFrame(sample);
            for(let i=0;i<20;i++){
              const button=document.querySelector('[data-usage-periods] [data-fluid-hover-index="'+[3,2,1,0][i%4]+'"]'),start=performance.now();
              button.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,button:0}));button.click();
              elapsed.push(performance.now()-start);await new Promise(resolve=>requestAnimationFrame(resolve));
              periods.push(window.usageHost.filters().period);
              const figure=document.querySelector('[data-usage-total-tokens] .text-figure-xl');
              readouts.push(figure.querySelector('[aria-label]')?.getAttribute('aria-label')??figure.textContent);
            }
            running = false; return { periods, readouts, maxCommitMs: Math.max(...elapsed), averageCommitMs: elapsed.reduce((a,b) => a+b,0)/elapsed.length, maxFrameGapMs: Math.max(...gaps), samples: gaps.length };
          });
          await settle(page);assert.deepEqual(changes[mode].periods,Array.from({length:20},(_,i)=>['today','7','30','all'][i%4]));
          assert.deepEqual(changes[mode].readouts,Array.from({length:20},(_,i)=>['10,000','70,000','300,000','2,000,000'][i%4]));
          assert.equal(await usageUi.value(page, 'totalTokens'), '2,000,000');
        }
        assert(changes.system.maxCommitMs < 3000); assert(changes.system.averageCommitMs < changes.off.averageCommitMs * 1.5 + 20);
        // A resize while the React sheet is open keeps focus inside. Checked before the fake clock below:
        // Playwright's fast-forwarded clock would start Motion's animations on a shifted timeline.
        await openSettings(page); await settings.getByRole('button', { name: '编辑资料', exact: true }).click(); await dialog(page).waitFor();
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800,600)); await settle(page);
        assert.equal(await dialog(page).evaluate(d => d.contains(document.activeElement)), true);
        await page.keyboard.press('Escape'); await waitClosed(page); await page.locator('[data-view="quota"]').click(); await settle(page);
        await page.locator('#theme').click(); await page.locator('[data-view="quota"]').click(); await settle(page);
        await page.locator('#quotaCards [data-quota-details]').click(); await q.details(page).locator('[data-quota-account]').waitFor();
        const handles = await page.evaluateHandle(() => [document.querySelector('#quotaCards .quota-card'), document.querySelector('#quotaCards [data-quota-details]'), document.querySelector('[role="dialog"] [data-quota-account]')]);
        await page.clock.install(); await page.clock.fastForward(30001); await page.clock.resume();
        assert.equal(await page.evaluate(handles => handles[0] === document.querySelector('#quotaCards .quota-card') && handles[1] === document.querySelector('#quotaCards [data-quota-details]') && handles[2] === document.querySelector('[role="dialog"] [data-quota-account]') && Boolean(document.querySelector('[role="dialog"] [data-quota-details]')), handles), true); await handles.dispose();
        await page.keyboard.press('Escape'); await q.details(page).waitFor({ state: 'detached' }); await settle(page);
        await page.locator('[data-view="quota"]').click(); await settle(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(output, 'quota-dark-narrow-' + scale + '.png') });
        assert.equal(await page.evaluate(() => window.uiMotion.activeCount), 0);
        assert.deepEqual(errors, []); assert.equal(fs.existsSync(path.join(quota, 'codex-homes')), false);
        await page.evaluate(() => window.uiMotion.setPreference('off')); await page.reload();
        await showView(page, 'quota'); await page.locator('#quotaCards .quota-card').waitFor();
        assert.equal(await page.locator('body').getAttribute('data-motion'), 'off');
        assert.equal(await page.evaluate(() => window.uiMotion.preference), 'off');
        evidence.push({ scale, packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), workload: { rows:20000, models:100, rangeChanges:20 }, modes:true, systemPreferencePrecedence:true, persistedPreference:true, allFiveDialogSurfacesAndInlineCost:true, resizeDuringDialog:true, reduced, immediateFocusAndClose:true, interruption:true, cardAndDisclosureNodesRetained:true, native, frames, transitionFrames, closing, changes, noPageErrors:true, realLogin:false });
      } finally { await app.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
  } finally { await cleanup(root); }
})().catch(e => { console.error(e.stack); process.exitCode=1; });
