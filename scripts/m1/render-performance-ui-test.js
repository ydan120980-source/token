'use strict';
/* global document, requestAnimationFrame, getComputedStyle, DOMMatrixReadOnly, MutationObserver */
// Browser plugin absent: isolated Electron/Playwright. This checks redraw work
// and real frame intervals, not merely whether a button eventually responded.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { seed } = require('../../tests/m1/ui-style-fixture');
const { fixture } = require('../../tests/m1/quota-hero-fixture');
const { keepVisible, isolatePointer, showView, settle, until, cleanup } = require('./ui-settle');
const q = require('./quota-ui-helpers');
const output = path.resolve(process.env.RENDER_EVIDENCE_DIR || 'artifacts/render-performance');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-performance-')), home = path.join(root, 'home'), usage = path.join(root, 'usage');
  seed(home, usage); fs.mkdirSync(output, { recursive: true }); const ledger = fs.readFileSync(path.join(usage, 'statistics.json'));
  const args = [...(process.env.QUOTA_PACKAGED_EXE ? [] : [path.resolve(process.env.RENDER_APP_ROOT || '.', 'src/quota/main.js')]), '--usage-data-dir', usage, '--quota-data-dir', path.join(root, 'quota'), '--m1-fixture-root', home];
  let app;
  try {
    app = await electron.launch({ executablePath: process.env.QUOTA_PACKAGED_EXE || require('electron'), args, timeout: 60000 }); await keepVisible(app); await isolatePointer(app);
    const page = await app.firstWindow(), errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await app.evaluate(({ ipcMain, BrowserWindow }, data) => {
      globalThis.renderFixture = data;
      const handlers = ipcMain._invokeHandlers;
      for (const [channel, edit] of [['quota:providers', s => s.accounts = data.providers], ['quota:getV2', s => s.accounts = [data.v2]], ['quota:get', s => s.accounts = [data.v1]]]) {
        const original = handlers.get(channel); handlers.set(channel, async (...args) => { const result = await original(...args); if (result?.ok) edit(result.state); return result; });
      }
      for (const win of BrowserWindow.getAllWindows()) { win.webContents.send('quota:update'); win.webContents.send('quota:providerUpdate'); }
    }, fixture(Date.now()));
    await showView(page, 'quota'); await page.waitForFunction(() => document.querySelectorAll('#quotaCards .quota-card').length === 5); await settle(page);
    const idle = await page.evaluate(async () => { const frames = []; let last; for (let i = 0; i < 40; i++) await new Promise(resolve => requestAnimationFrame(t => { if (last) frames.push(t - last); last = t; resolve(); })); return frames.sort((a, b) => a - b)[Math.floor(frames.length / 2)]; });
    // The home board is React; quota cards retain their owned leaf renderer. Cards are counted by their morph updates, the React page by
    // the DOM mutation batches it commits.
    await page.evaluate(() => {
      window.renderTrace = { cards: 0, hero: 0, frames: [] };
      window.cardObserver = new MutationObserver(() => { window.renderTrace.cards++; });
      window.cardObserver.observe(document.getElementById('quotaCards'), { subtree: true, childList: true, characterData: true, attributes: true });
      window.heroObserver = new MutationObserver(() => { window.renderTrace.hero++; });
      for (const root of document.querySelectorAll('[data-widget-board], [data-quota-after], #summaryPanel')) window.heroObserver.observe(root, { subtree: true, childList: true, characterData: true });
      let last; window.traceRunning = true; const frame = t => { if (last) window.renderTrace.frames.push(t - last); last = t; if (window.traceRunning) requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    });
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; for (let i = 0; i < 7; i++) { win.webContents.send('quota:update'); win.webContents.send('quota:providerUpdate'); } });
    await page.waitForTimeout(1200); const burst = await page.evaluate(() => { window.traceRunning = false; window.heroObserver.disconnect(); window.cardObserver.disconnect(); return { ...window.renderTrace }; });
    await app.evaluate(({ BrowserWindow }) => {
      const data = globalThis.renderFixture;
      data.providers[0].quota.pools[2].balances[0].remaining = '83';
      BrowserWindow.getAllWindows()[0].webContents.send('quota:providerUpdate');
    });
    await until(page, () => document.querySelector('#quotaCards [data-provider-row="workbuddy"]')?.textContent.includes('3,117'));
    // A press that wanders a few pixels is still a click: the balance card opens its details.
    const tile = page.locator('#quotaCards [data-provider-row="workbuddy"] .quota-card-head h3').first(); await tile.scrollIntoViewIfNeeded(); await settle(page); const rect = await tile.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + 4, rect.y + rect.height / 2 + 1); await page.mouse.up(); await q.details(page).waitFor(); await page.keyboard.press('Escape'); await q.details(page).waitFor({ state: 'detached' });
    await page.screenshot({ path: path.join(output, 'wallet-idle.png') });
    const typography = [];
    for (const [zoom, dark] of [[1, true], [1.25, false], [1.5, true]]) {
      await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(value), zoom);
      await page.evaluate(value => document.body.classList.toggle('dark', value), dark);
      await page.mouse.move(0, 0); await page.waitForTimeout(1300);
      // The M10 home board at rest: its four widgets and complete figure text at every zoom.
      // Rolling digits are checked independently in the gallery below.
      const glyphs = await page.evaluate(() => {
        const board = document.querySelector('#quota [data-widget-board]');
        const figures = [...board.querySelectorAll('[data-widget-figure]')];
        return { widgets: [...board.querySelectorAll('[data-widget]')].map(node => node.dataset.widget), figures: figures.length, moving: figures.some(figure => figure.getAnimations({ subtree: true }).some(a => a.playState === 'running')), text: figures.map(figure => figure.textContent.trim()) };
      });
      typography.push({ zoom, dark, ...glyphs });
      assert.deepEqual(glyphs.widgets, ['quota.windows', 'usage.today', 'cost.daily', 'usage.week']);
      assert(glyphs.figures >= 2 && glyphs.text.every(Boolean) && !glyphs.moving, 'widget figures at rest at ' + zoom + ': ' + JSON.stringify(glyphs));
      await page.screenshot({ path: path.join(output, 'wallet-' + zoom + '.png') });
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await page.evaluate(()=>{const host=document.createElement('div');host.id='renderFigures';document.body.append(host);window.renderFigures=window.agentUi.mount('kit-gallery',host);});
    const rollingCase=page.locator('#renderFigures [data-m8-case=rolling]');await rollingCase.scrollIntoViewIfNeeded();await page.waitForTimeout(1100);
    const rolling=await rollingCase.evaluate(async root=>{
      const figure=root.querySelector('.text-figure-cost-hero'),columns=figure.querySelectorAll('[aria-hidden=true] > .flex-col');
      const column=columns[1],digitHeight=column.firstElementChild.getBoundingClientRect().height;
      root.querySelector('button').click();await new Promise(resolve=>requestAnimationFrame(resolve));
      return{y:new DOMMatrixReadOnly(getComputedStyle(column).transform).m42,digitHeight,expectedStart:-5*digitHeight};
    });
    await page.evaluate(()=>{window.renderFigures.unmount();document.getElementById('renderFigures').remove();});
    fs.writeFileSync(path.join(output,'rolling-check.json'),JSON.stringify(rolling,null,2));
    assert(Math.abs(rolling.y-rolling.expectedStart)<rolling.digitHeight*.75,'settled Figure resumes at previous digit');
    await showView(page,'cost');await page.locator('[data-cost-duo]').scrollIntoViewIfNeeded();await page.waitForTimeout(1300);
    // The readout wrapper positions the label; spring.fast animates its keyed
    // child (UI-MOTION-APPLE-20261029), which can be interrupted mid-flight.
    const trace=page.evaluate(async()=>{const values=[],start=performance.now();while(performance.now()-start<500){const node=document.querySelector('[data-donut-center] > div');if(node)values.push(getComputedStyle(node).opacity+' '+getComputedStyle(node).transform);await new Promise(resolve=>requestAnimationFrame(resolve));}return[...new Set(values)];});
    await page.locator('[data-cost-composition] [data-legend-key]').first().hover();const readout=await trace;
    await settle(page);await page.screenshot({path:path.join(output,'cost-readout.png')});
    const free = await page.evaluate(async () => {
      const before = await window.usageBridge.get(), row = before.snapshot.daily.find(r => r.agent === 'codex');
      await window.usageBridge.savePrice({ provider: row.provider, model: row.model, inputUncached: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      return { sequence: before.snapshot.sequence, revision: before.snapshotRevision };
    });
    await until(page, () => document.querySelector('[data-cost-composition] [data-legend-key=codex] b')?.textContent==='$0.00');
    assert.match(await page.locator('[data-cost-months] [data-legend-key=codex]').textContent(), /\$0\.00$/, 'a priced zero is not an unpriced Agent');
    const afterPrice = await page.evaluate(async () => { const s = await window.usageBridge.get(); return { sequence: s.snapshot.sequence, revision: s.snapshotRevision }; });
    assert.equal(afterPrice.sequence, free.sequence); assert(afterPrice.revision > free.revision);
    const frameStats = trace => { const frames = [...trace.frames].sort((a, b) => a - b); return { ...trace, frames: undefined, count: frames.length, p95Ms: frames[Math.ceil(frames.length * .95) - 1], maxMs: Math.max(...frames) }; };
    const report = { packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), idleFrameMs: idle, burst: frameStats(burst), typography, rolling, changedQuotaArrives: true, readoutValues: readout, sameSequenceFreeReprice: true, errors, ledgerUnchanged: fs.readFileSync(path.join(usage, 'statistics.json')).equals(ledger), realAccountRequests: 0 };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    assert.deepEqual(errors, []); assert(report.ledgerUnchanged);
    assert(burst.cards <= 1 && burst.hero <= 1, 'unchanged notification burst cannot rebuild each page: ' + JSON.stringify(report.burst));
    assert(readout.length >= 3, 'kit donut centre visibly fades/moves through spring.fast states');
    assert(report.burst.p95Ms <= idle * 2 + 1 && report.burst.maxMs < 50, 'notification work must meet the measured idle frame budget');
    console.log('PASS render performance: ' + output);
  } finally { if (app) await app.close(); await cleanup(root); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
