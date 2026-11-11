'use strict';
/* global document */
const { remove } = require('../../tests/m1/temp');
// Wait on actual finite effects, not fixed sleeps or force-clicks. Scroll-driven animations (the
// React layer's edge fades) follow scroll position and never finish, so only time-based ones count.
async function settle(page) {
  try {
    await page.waitForFunction(() => (!window.uiDetail || window.uiDetail.activeCount === 0) && document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect.getTiming().iterations === Infinity || animation.timeline !== document.timeline), null, { timeout: 5000 });
  } catch (error) {
    // Keep the original failure, with enough evidence to distinguish a stalled
    // finite animation from a legitimate loading or scroll-driven effect.
    const pending = await page.evaluate(() => ({ detail: window.uiDetail?.activeCount, animations: document.getAnimations().filter(a => a.playState === 'running').map(a => ({ target: a.effect?.target?.outerHTML?.slice(0, 200), time: a.currentTime, timing: a.effect?.getTiming() })) })).catch(() => null);
    console.error('Unsettled UI:', JSON.stringify(pending));
    throw error;
  }
}
// page.waitForFunction treats a returned Promise as truthy and resolves at once,
// so conditions that await a bridge must be polled from the test side.
async function until(page, predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (!(await page.evaluate(predicate))) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + String(predicate).slice(0, 160));
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
// The desktop window opens on quota: quota-ui.js clicks that tab while the page is
// still loading. Wait for load, settle, then switch and confirm the view.
async function showView(page, name) {
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 30000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await settle(page);
    if (await page.evaluate(() => document.getElementById('main').dataset.currentView) === name) break;
    await page.locator('[data-view="' + name + '"]').click();
  }
  await page.waitForFunction(view => document.getElementById('main').dataset.currentView === view, name, { timeout: 5000 }); await settle(page);
}
// A test window opens in front, possibly under the cursor of whoever is using the
// desktop; a real mouse move then replaces Playwright's injected hover. Ignoring OS
// mouse events leaves the window to the injected pointer only.
async function isolatePointer(app) {
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.setIgnoreMouseEvents(true); });
}
// Something outside the test (the person at the desktop, the shell) may minimize the test
// window. A minimized Chromium window renders no new frames, so the next screenshot or
// animation-frame wait hangs. Put it back without activating it, once the minimize has
// finished (an immediate restore still leaves it unpainted), and repaint.
async function keepVisible(app) {
  // firstWindow can arrive while the main process is still loading the saved
  // ledger. Wait for the real document, not the initial about:blank context,
  // before the first Node inspector call (Electron 43 / Playwright 1.63).
  const page=await app.firstWindow();await page.waitForURL(/^file:/,{timeout:30000});await page.waitForLoadState('load');
  // Suites are written for this size; the product's default window is larger (session-reader-ui-test checks it).
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.setSize(1180, 850); });
  await app.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.on('minimize', () => setTimeout(() => { if (!win.isDestroyed()) { win.showInactive(); win.webContents.invalidate(); } }, 300));return true; });
}
// Teardown must not replace a suite's own result: removal retries Windows' transient
// locks, and a directory that still cannot be removed is reported, not thrown.
async function cleanup(dir) {
  try { await remove(dir); } catch (error) { process.stderr.write('cleanup left ' + dir + ' (' + error.code + ')\n'); }
}
module.exports = { settle, until, showView, isolatePointer, keepVisible, cleanup };
