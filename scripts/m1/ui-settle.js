'use strict';
/* global document */
// Wait on actual finite effects, not fixed sleeps or force-clicks.
async function settle(page) {
  await page.waitForFunction(() => (!window.uiDetail || window.uiDetail.activeCount === 0) && document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect.getTiming().iterations === Infinity), null, { timeout: 5000 });
}
module.exports = { settle };
