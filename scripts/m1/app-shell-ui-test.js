'use strict';
/* global document, KeyboardEvent, CompositionEvent, innerWidth */
// One App root, direct pages and M9 shell behavior. Isolated synthetic stores;
// explicit collection reads only the fixture home created by ui-smoke.launch.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { launch, setTheme } = require('./ui-smoke');
const { until, settle, showView } = require('./ui-settle');
const output = process.env.APP_SHELL_EVIDENCE_DIR || 'artifacts/m9/app-shell';
fs.mkdirSync(output, { recursive: true });
(async () => {
  const results = [];
  for (const scale of [1, 1.5]) {
    const session = await launch({ scale }), { app, page, errors } = session;
    try {
      await until(page, () => window.appShell?.get().ready === true);
      assert.equal(await page.locator('[data-app-root]').count(), 1);
      assert.equal(await page.locator('[data-island-host]').count(), 0);
      assert.equal(await page.evaluate(() => typeof window.uiIslands), 'undefined');
      assert.equal(await page.locator('#windowBack').isDisabled(), true, 'bootstrap does not enter navigation history');
      const indicatorAligned = () => page.waitForFunction(() => {
        const nav = document.querySelector('nav[aria-label="主导航"]');
        const selected = nav?.querySelector('button[aria-current="page"]'), indicator = nav?.querySelector('.motion-indicator');
        if (!selected || !indicator) return false;
        const a = selected.getBoundingClientRect(), b = indicator.getBoundingClientRect();
        return ['left', 'top', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= 1);
      }, null, { timeout: 5000 });
      const views = ['quota', 'usage', 'cost', 'sessions', 'sources', 'settings'];
      for (const [index, view] of views.entries()) {
        await page.keyboard.press('Control+' + (index + 1));
        await until(page, new Function('return document.getElementById("main").dataset.currentView === ' + JSON.stringify(view)));
        assert.equal(await page.locator('main > section:not([hidden])').count(), 1);
        assert.equal(await page.locator('[data-view][aria-current=page]').getAttribute('data-view'), view);
        await indicatorAligned();
      }
      const search = page.getByRole('textbox', { name: '搜索设置项', exact: true });
      await search.focus(); await page.keyboard.press('Control+1');
      assert.equal(await page.locator('#main').getAttribute('data-current-view'), 'settings', 'number shortcuts preserve input editing');
      await page.evaluate(() => {
        document.activeElement.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true, isComposing: true }));
      });
      assert.equal(await page.locator('#main').getAttribute('data-current-view'), 'settings');
      await search.evaluate(e => e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
      await page.keyboard.press('Tab'); await showView(page, 'cost'); await showView(page, 'sessions');
      await page.locator('#windowBack').click(); await until(page, () => window.appShell.get().view === 'cost');
      await page.locator('#windowForward').click(); await until(page, () => window.appShell.get().view === 'sessions');
      await page.locator('#windowBack').click(); await showView(page, 'sources');
      assert.equal(await page.locator('#windowForward').isDisabled(), true, 'a new route discards forward history');
      for (const theme of ['light', 'dark']) {
        await setTheme(page, theme); await showView(page, 'quota');
        assert.equal(await page.locator('#shellStatusAction').count(), 0, 'no collection card (owner 2026-10-29)');
        await page.locator('#windowSidebar').click(); await settle(page);
        assert.equal(await page.locator('#windowSidebar').getAttribute('aria-expanded'), 'false');
        await indicatorAligned();
        await page.locator('#windowSidebar').click(); await settle(page);
        assert.match(await page.locator('#windowSummary').innerText(), /概要/, 'the way to the summary says what it is');
        await indicatorAligned();
        await page.locator('#windowSummary').click(); await until(page, () => !document.getElementById('summaryPanel').hidden);
        await page.screenshot({ path: path.join(output, theme + '-' + scale + '-summary.png') });
        await page.keyboard.press('Escape'); await until(page, () => document.getElementById('summaryPanel').hidden);
        await page.keyboard.press('Control+Shift+B'); await until(page, () => !document.getElementById('summaryPanel').hidden);
        assert.equal(await page.locator('#windowSummary').getAttribute('aria-pressed'), 'true');
        await page.keyboard.press('Control+Shift+B'); await until(page, () => document.getElementById('summaryPanel').hidden);
        await page.screenshot({ path: path.join(output, theme + '-' + scale + '.png') });
      }
      await page.evaluate(() => window.settingsHost.collection.setEnabled(true));
      await until(page, async () => (await window.usageBridge.get()).enabled);
      await until(page, async () => !(await window.usageBridge.get()).collecting);
      await until(page, () => /已采集/.test(document.getElementById('collectionStatus')?.textContent ?? ''));
      await page.evaluate(() => window.settingsHost.collection.setEnabled(false));
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
      await settle(page); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#windowSidebar').click();
      assert.equal(await page.locator('.topbar').evaluate(e => e.inert), true);
      await page.locator('#windowSidebar').click();
      await page.screenshot({ path: path.join(output, 'narrow-' + scale + '.png') });
      assert.deepEqual(errors, []);
      results.push({ scale, singleAppRoot: true, directPages: true, shortcuts: true, ime: true, history: true, sidebarAndWidgets: true, syntheticCollection: true, errors });
    } finally { await session.close(); }
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ packaged: Boolean(process.env.QUOTA_PACKAGED_EXE), results }, null, 2));
  console.log('PASS: one React App root, six routes, history, input/IME shortcuts, sidebar/widgets and synthetic collection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
