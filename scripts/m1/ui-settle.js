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
module.exports = { settle, until };
