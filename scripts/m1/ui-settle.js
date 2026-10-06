'use strict';
/* global document */
// Wait on actual finite effects, not fixed sleeps or force-clicks.
async function settle(page) {
  await page.waitForFunction(() => (!window.uiDetail || window.uiDetail.activeCount === 0) && document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect.getTiming().iterations === Infinity), null, { timeout: 5000 });
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
module.exports = { settle, until, showView };
