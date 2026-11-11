'use strict';
/* global document, innerWidth, innerHeight, getComputedStyle, requestAnimationFrame */
// Geometry and interaction regressions the DOM-state suites cannot see: overflow,
// layout shift, controls moving away from the pointer, chart transitions.
// Only disposable homes and synthetic statistics.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { settle, isolatePointer, keepVisible, cleanup } = require('./ui-settle');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const usageUi = require('./usage-ui-helpers');
const { usageLayoutChecks } = require('./usage-layout-checks');
const { fixtures } = require('../../tests/m1/fixtures');

const NOW = Date.parse('2026-10-11T06:00:00Z');
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, label + ' by ' + Math.round(actual - expected) + ' px');
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
// How far a clipping ancestor cuts into a mark's painted box: its border box after
// transforms, grown by the outer box-shadows (offset, blur and spread) of the mark and of
// its ::before layer, which covers the same box.
const paintClip = ([selector, index]) => {
  const all = document.querySelectorAll(selector), el = all[index < 0 ? all.length + index : index], box = el.getBoundingClientRect();
  const paint = { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  for (const shadow of [getComputedStyle(el), getComputedStyle(el, '::before')].flatMap(style => style.boxShadow.split(/,(?![^(]*\))/))) {
    if (shadow.includes('inset') || !shadow.includes('px')) continue;
    const [x, y, blur = 0, spread = 0] = shadow.match(/-?[\d.]+px/g).map(parseFloat);
    paint.left = Math.min(paint.left, box.left + x - blur - spread); paint.right = Math.max(paint.right, box.right + x + blur + spread);
    paint.top = Math.min(paint.top, box.top + y - blur - spread); paint.bottom = Math.max(paint.bottom, box.bottom + y + blur + spread);
  }
  for (let a = el.parentElement; a; a = a.parentElement) {
    const style = getComputedStyle(a), clip = a.getBoundingClientRect(), x = style.overflowX !== 'visible', y = style.overflowY !== 'visible';
    const cut = Math.max(x ? clip.left - paint.left : 0, x ? paint.right - clip.right : 0, y ? clip.top - paint.top : 0, y ? paint.bottom - clip.bottom : 0);
    if (cut > 1) return (a.id ? '#' + a.id : '.' + a.classList[0]) + ' cuts ' + Math.round(cut) + ' px';
  }
  return '';
};

// Several agents over five months, and three agents today, so filtering by one agent
// changes the height of the sections above the trend card.
function seed(store) {
  // Two models from the embedded price catalog and one without a price, so the estimate is a
  // partly priced range and hovering expands it.
  const agents = [['codex', 'openai', 'gpt-6.1-sol'], ['claude', 'anthropic', 'claude-sonnet-5-5'], ['opencode', 'synthetic', 'layout-unpriced-model']];
  let n = 0;
  // Inclusive usage: input_tokens contains the cached part and the total is input + output.
  const add = (agent, provider, model, time, tokens) => {
    const r = normalize(agent, { input_tokens: Math.round(tokens * .9), output_tokens: tokens - Math.round(tokens * .9), cached_input_tokens: Math.round(tokens * .6), cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: tokens }, { id: 'layout-' + n++, time, provider, model, entry: 'desktop' }, 'synthetic-salt');
    store.state.records[r.id] = r;
  };
  for (let d = 1; d < 150; d++) for (const [i, [agent, provider, model]] of agents.entries()) if ((d + i) % 4 !== 0) add(agent, provider, model, NOW - d * 86400000, 3000000 + Math.round(Math.abs(Math.sin(d * .3 + i)) * 60000000));
  for (const [i, [agent, provider, model]] of agents.entries()) add(agent, provider, model, NOW - (i + 1) * 3600000, 8000000 + i * 4000000);
}

async function size(app, page, width, height) {
  await app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h); win.show(); }, [width, height]);
  await page.waitForFunction(([w, h]) => Math.abs(innerWidth - w) <= 2 && Math.abs(innerHeight - h) <= 2, [width, height]);
  await page.evaluate(() => window.scrollTo(0, 0)); await settle(page); await frames(page);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-layout-'));
  const output = process.env.LAYOUT_EVIDENCE_DIR || 'artifacts/layout', evidence = {};
  fs.mkdirSync(output, { recursive: true });
  try {
    const home = path.join(dir, 'home'), f = fixtures(home), data = path.join(dir, 'usage'), store = new Store(data, f.roots);
    seed(store); store.state.sequence = 1; atomic(path.join(data, 'statistics.json'), store.state); store.setEnabled(false);
    const app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args: [...(process.env.QUOTA_PACKAGED_EXE ? [] : ['src/quota/main.js']), '--quota-data-dir', path.join(dir, 'quota'), '--usage-data-dir', data, '--m1-fixture-root', home], timeout: 60000 });
    try {
      const page = await app.firstWindow(), errors = []; await keepVisible(app);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.locator('#quotaCards').waitFor({ state: 'attached' }); await page.waitForLoadState('load');
      await page.clock.setFixedTime(new Date(NOW)); await page.reload();
      await isolatePointer(app);
      await page.locator('[data-view="usage"]').click();
      await usageUi.readyChart(page, 'strip');
      assert.equal(await page.evaluate(() => window.uiMotion.mode), 'full');
      await usageLayoutChecks(page, app, { size, near, frames, paintClip, evidence });
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, 'layout-final.png') });
    } finally { await app.close(); }
  } finally { await cleanup(dir); }
  fs.writeFileSync(path.join(output, 'layout-ui-results.json'), JSON.stringify(evidence, null, 2));
  console.log('PASS: layout geometry and interaction regressions (overflow, cover, expand, tooltip, edge hover, hour grid, calendar, filter hold, range calendar, legend, cost line).');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
