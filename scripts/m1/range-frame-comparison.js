'use strict';
/* global document, requestAnimationFrame, MouseEvent */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { seed } = require('./performance-benchmark');
const { showView, keepVisible, isolatePointer, settle, cleanup } = require('./ui-settle');
const usage = require('./usage-ui-helpers');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const stats = values => { const sorted = values.toSorted((a, b) => a - b), at = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null; return { samples: values.length, medianMs: at(.5), p95Ms: at(.95), maxMs: sorted.at(-1) ?? null, over16_7ms: values.filter(n => n > 16.7).length, over50ms: values.filter(n => n > 50).length, over100ms: values.filter(n => n > 100).length }; };
const PROFILES = { tuned: { semi: 4, growth: 10, flags: null }, adaptive: { semi: 0, growth: 0, flags: '--max-semi-space-size=0 --heap-growing-percent=0' } };
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'range-frame-compare-')), out = path.resolve(process.env.RANGE_FRAME_OUTPUT || 'artifacts/handoff-20261102/range-frames'); fs.mkdirSync(out, { recursive: true });
  const base = seed(path.join(root, 'base'), 20000), ledgerHash = digest(path.join(base.usage, 'statistics.json'));
  const report = { schemaVersion: 'RangeFrameComparisonV1', syntheticOnly: true, rows: 20000, models: 100, days: 200, profiles: PROFILES, runs: [], summary: [], measurement: 'native rAF gaps from real button event submission through UI settle; programmatic events, not physical input/compositor latency', noForcedGC: true, noSyntheticClock: true, workerYoungGenerationUnchanged: true, osCacheAndBackgroundLoad: 'uncontrolled', scope: 'usage page top-level range control, full motion; no real collection or account request' };
  const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  try {
    for (const scale of [1, 1.5]) {
      const order = scale === 1 ? ['tuned', 'adaptive', 'adaptive', 'tuned'] : ['adaptive', 'tuned', 'tuned', 'adaptive'];
      for (let repeat = 0; repeat < order.length; repeat++) {
        const profile = order[repeat], config = PROFILES[profile], dir = path.join(root, scale + '-' + repeat), data = path.join(dir, 'usage');
        fs.mkdirSync(dir); const clone = (from, to) => { fs.mkdirSync(to); for (const entry of fs.readdirSync(from, { withFileTypes: true })) { const source = path.join(from, entry.name), dest = path.join(to, entry.name); if (entry.isDirectory()) clone(source, dest); else { assert(entry.isFile(), 'owned fixture must not contain links'); fs.writeFileSync(dest, fs.readFileSync(source)); } } }; clone(base.usage, data);
        const args = [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', data, '--quota-data-dir', path.join(dir, 'quota'), '--m1-fixture-root', base.home, '--force-device-scale-factor=' + scale, ...(config.flags ? ['--js-flags=' + config.flags] : [])];
        const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args, timeout: 60000 });
        const record = { scale, profile, repeat, actions: [], errors: [], ledgerSha256: ledgerHash };
        try {
          const page = await app.firstWindow(); await page.waitForURL(/^file:/); await page.waitForLoadState('load'); const defaultBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()); await keepVisible(app); await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), defaultBounds); await isolatePointer(app); record.defaultBounds = defaultBounds;
          page.on('pageerror', error => record.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') record.errors.push(message.text()); });
          record.runtime = await app.evaluate(({ app, screen }) => ({ electron: process.versions.electron, chrome: process.versions.chrome, v8: process.versions.v8, rendererJsFlags: app.commandLine.getSwitchValue('js-flags'), displays: screen.getAllDisplays().map(d => ({ refreshRate: d.displayFrequency, scale: d.scaleFactor })) }));
          assert(record.runtime.rendererJsFlags.includes('--max-semi-space-size=' + config.semi)); assert(record.runtime.rendererJsFlags.includes('--heap-growing-percent=' + config.growth));
          await showView(page, 'usage'); await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.evaluate(() => window.uiMotion.setPreference('full'));
          await usage.waitValue(page, 'totalTokens', '2,000,000'); await usage.readyChart(page, 'strip'); await page.evaluate(() => window.scrollTo(0, 0)); await settle(page); await page.waitForTimeout(1000);
          // Keep samplers on window and poll synchronously. A suspended inspector
          // evaluation's Promise can itself be collected under adaptive V8 GC.
          await page.evaluate(() => { const sample = window.rangeFrameIdle = { gaps: [], previous: null }; sample.tick = now => { if (sample.previous !== null) sample.gaps.push(now - sample.previous); sample.previous = now; if (sample.gaps.length < 120) requestAnimationFrame(sample.tick); }; requestAnimationFrame(sample.tick); });
          await page.waitForFunction(() => window.rangeFrameIdle.gaps.length === 120);
          record.idle = await page.evaluate(() => window.rangeFrameIdle.gaps);
          for (const period of ['today', '7', '30', 'all', '7', 'today', '30', 'all']) {
            await page.evaluate(() => {
              const sample = window.rangeFrameSample = { running: true, frames: [], started: 0, previous: null };
              sample.tick = now => { if (!sample.running) return; if (sample.previous !== null) sample.frames.push({ at: now, gap: now - sample.previous }); sample.previous = now; requestAnimationFrame(sample.tick); };
              requestAnimationFrame(sample.tick);
            });
            await page.waitForFunction(() => window.rangeFrameSample.frames.length >= 2);
            const submitted = await page.evaluate(period => {
              const sample = window.rangeFrameSample;
              const button = document.querySelector('[data-usage-periods] [data-fluid-hover-index="' + { all: 0, '30': 1, '7': 2, today: 3 }[period] + '"]');
              if (!button) throw Error('RANGE_BUTTON_MISSING');
              sample.started = performance.now(); button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })); button.click();
              return { at: sample.started, syncMs: performance.now() - sample.started };
            }, period);
            await usage.waitValue(page, 'totalTokens', { today: '10,000', '7': '70,000', '30': '300,000', all: '2,000,000' }[period]); await settle(page);
            await page.evaluate(() => { window.rangeFrameSample.target = window.rangeFrameSample.frames.length + 2; });
            await page.waitForFunction(() => window.rangeFrameSample.frames.length >= window.rangeFrameSample.target);
            const frames = await page.evaluate(() => { const sample = window.rangeFrameSample; sample.running = false; return { observedSettleMs: performance.now() - sample.started, gaps: sample.frames.filter(frame => frame.at >= sample.started).map(frame => frame.gap), visible: !document.hidden, period: window.usageHost.filters().period }; });
            assert.equal(frames.period, period); assert(frames.visible && frames.gaps.length > 0 && frames.gaps.every(n => Number.isFinite(n) && n > 0));
            record.actions.push({ period, syncMs: submitted.syncMs, ...frames, summary: stats(frames.gaps) });
          }
          record.idleSummary = stats(record.idle); record.frameSummary = stats(record.actions.flatMap(action => action.gaps));
          assert.deepEqual(record.errors, []);
        } finally { await app.close(); }
        assert.equal(digest(path.join(data, 'statistics.json')), ledgerHash, 'range changes never alter saved facts');
        report.runs.push(record); save(); console.log('PASS scale=' + scale + ' profile=' + profile + ' sequence=' + repeat + ' maxFrame=' + record.frameSummary.maxMs);
      }
    }
    for (const scale of [1, 1.5]) for (const profile of Object.keys(PROFILES)) {
      const runs = report.runs.filter(run => run.scale === scale && run.profile === profile), actions = runs.flatMap(run => run.actions);
      report.summary.push({ scale, profile, runs: runs.length, actions: actions.length, frameGaps: stats(actions.flatMap(action => action.gaps)), synchronousSubmit: stats(actions.map(action => action.syncMs)), observedUISettle: stats(actions.map(action => action.observedSettleMs)), warmIdle: stats(runs.flatMap(run => run.idle)) });
    }
    save(); console.log(JSON.stringify(report.summary));
  } finally { await cleanup(root); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
