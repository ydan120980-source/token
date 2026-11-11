'use strict';
/* global document, requestAnimationFrame */
// The cost page mounts everything below its first screen one frame after the view changes. Anything
// that asks to be shown a place in that page can ask before that frame lands, so this probe checks
// the ways in: a locate asked for on the same task as the switch, one asked for from another page,
// and one asked for once the page has settled. A mid-page target must end at the top of the screen;
// the coverage pair sits near the end of the page, so there it must simply be reachable and in view.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { seed, CODEX_ID } = require('../../tests/m1/sessions-reader-fixture');
const { Store, atomic } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { showView, settle, until, isolatePointer, cleanup } = require('./ui-settle');

// Reads where the section sits once it exists and the scroll has had a few frames to settle.
async function landing(page, caseName, selector) {
  return page.evaluate(({ name, target }) => new Promise(resolve => {
    const started = performance.now();
    const step = () => {
      const section = document.querySelector(target);
      if (section && performance.now() - started > 200) {
        const box = section.getBoundingClientRect(), scroller = document.scrollingElement;
        resolve({ case: name, top: Math.round(box.top), bottom: Math.round(box.bottom), viewport: Math.round(window.innerHeight),
          scrollTop: Math.round(scroller.scrollTop), maxScroll: Math.round(scroller.scrollHeight - window.innerHeight),
          view: document.getElementById('main').dataset.currentView, afterMs: Math.round(performance.now() - started) });
        return;
      }
      if (performance.now() - started > 8000) { resolve({ case: name, timedOut: true, view: document.getElementById('main').dataset.currentView }); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }), { name: caseName, target: selector });
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-locate-'));
  const out = path.resolve(process.env.COST_LOCATE_OUTPUT || 'artifacts/perf-20261103/cost-locate');
  fs.mkdirSync(out, { recursive: true });
  const seeded = await seed(root), { home, usage } = seeded;
  const producer = new Store(usage, roots(home)), now = Date.now();
  producer.state.sequence++; atomic(path.join(usage, 'statistics.json'), producer.state); producer.setEnabled(false);
  const rows = [{ timestamp: new Date(now - 600000).toISOString(), type: 'session_meta', payload: { id: CODEX_ID, cwd: 'C:/synthetic/cost-locate', originator: 'codex_cli_rs' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } }];
  for (let i = 0; i < 40; i++) {
    const timestamp = new Date(now - 600000 + i * 1000).toISOString();
    rows.push(
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '合成定位问题 ' + i }] } },
      { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '合成定位回复 ' + i + '。' + '说明段落。'.repeat(40) }] } },
      { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: (i + 1) * 100, output_tokens: (i + 1) * 20, total_tokens: (i + 1) * 120 } } } });
  }
  fs.writeFileSync(seeded.codexFile, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  const report = { schemaVersion: 'CostLocateProbeV1', syntheticOnly: true,
    measurement: 'a locate asked for before and during the deferred mount, from another page and on a settled page; the section box is read after the scroll settles', cases: [], errors: [] };
  let app;
  const save = () => fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  try {
    app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [
      ...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home], timeout: 60000 });
    await isolatePointer(app);
    const page = await app.firstWindow(); await page.waitForURL(/^file:/); await page.waitForLoadState('load');
    await until(page, () => window.usageData.ready());
    page.on('pageerror', error => report.errors.push(error.message));
    await page.evaluate(() => window.uiMotion.setPreference('off'));
    for (const view of ['quota', 'usage', 'cost', 'sessions']) await showView(page, view);

    // 1. A mid-page target, asked for on the same task as the switch, before anything below has mounted.
    await showView(page, 'sessions'); await settle(page);
    await page.evaluate(() => { document.querySelector('[data-view="cost"]').click(); window.costUi.locate('composition'); });
    const sameTask = await landing(page, 'locate a mid-page section on the same task as the switch', '[data-cost-section="composition"]');
    report.cases.push(sameTask); save();
    assert.equal(sameTask.timedOut, undefined, 'the section below the first screen exists after the deferred mount');
    assert.equal(sameTask.view, 'cost', 'the switch happened');
    assert(Math.abs(sameTask.top) <= 8, 'a locate asked for during the deferred mount still lands the section at the top: ' + JSON.stringify(sameTask));

    // 2. The coverage pair, asked for while another page is current.
    await showView(page, 'sessions'); await settle(page);
    await page.evaluate(() => window.costUi.locate('coverage'));
    await showView(page, 'cost'); await settle(page);
    const elsewhere = await landing(page, 'locate the coverage pair from another page', '[data-cost-coverage]');
    report.cases.push(elsewhere); save();
    assert.equal(elsewhere.timedOut, undefined, 'the section exists once the page is current');
    assert(elsewhere.scrollTop > 0, 'the page scrolled toward the section: ' + JSON.stringify(elsewhere));
    assert(elsewhere.top >= -8 && elsewhere.top < elsewhere.viewport, 'the section is in view: ' + JSON.stringify(elsewhere));

    // 3. A mid-page target on an already settled page still lands at the top.
    await page.evaluate(() => window.scrollTo(0, 0)); await settle(page);
    await page.evaluate(() => window.costUi.locate('composition'));
    const settled = await landing(page, 'locate a mid-page section on a settled page', '[data-cost-section="composition"]');
    report.cases.push(settled); save();
    assert.equal(settled.timedOut, undefined, 'the section stays mounted');
    assert(Math.abs(settled.top) <= 8, 'a settled locate lands the section at the top: ' + JSON.stringify(settled));

    // 4. The page's own coverage entry, while the page is already current and settled.
    await page.evaluate(() => window.scrollTo(0, 0)); await settle(page);
    await page.evaluate(() => window.costUi.locate('coverage'));
    const ownEntry = await landing(page, 'the page coverage entry while current', '[data-cost-coverage]');
    report.cases.push(ownEntry); save();
    assert.equal(ownEntry.timedOut, undefined, 'the section is mounted while the page is current');
    assert(ownEntry.top >= -8 && ownEntry.top < ownEntry.viewport, 'the coverage pair is in view: ' + JSON.stringify(ownEntry));

    assert.deepEqual(report.errors, []);
    report.ok = true; save();
    console.log(JSON.stringify(report.cases, null, 2));
  } catch (error) {
    report.failed = { message: error.message }; save(); throw error;
  } finally { if (app) await app.close(); await cleanup(root); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
