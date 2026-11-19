'use strict';
/* global requestAnimationFrame */
// Shared measurement for "the released card must travel with the page".
//
// The symptom (owner report, 2026-11-17): release a card, keep the wheel moving, and the card stays
// pinned to the screen instead of travelling with the document.
//
// Comparing the flying box's document position across frames cannot tell stickiness from the landing
// spring, which legitimately moves it. What separates the two cases is the box's relation to its own
// placeholder: both live in the same document, so a document-anchored box keeps a smoothly shrinking
// gap to the slot, while a `fixed` box holds a VIEWPORT position and the gap jumps by the whole
// scroll delta in a single frame.
//
// The scroll is applied late in the landing, when the spring is nearly at rest, so the gap's own
// motion is close to zero and any jump is stickiness rather than physics.

const RECORDER = `
  window.__landingLog = [];
  window.__recordLanding = (flyerSelector, slotSelector) => {
    const entries = [];
    const started = performance.now();
    const tick = () => {
      const flyer = document.querySelector(flyerSelector);
      const slot = document.querySelector(slotSelector);
      if (flyer) {
        const f = flyer.getBoundingClientRect();
        const s = slot ? slot.getBoundingClientRect() : null;
        entries.push({
          t: Math.round(performance.now() - started),
          flyerTop: +f.top.toFixed(2),
          slotTop: s ? +s.top.toFixed(2) : null,
          scrollY: Math.round(window.scrollY),
          position: getComputedStyle(flyer).position,
        });
      }
      if (performance.now() - started < 1800) requestAnimationFrame(tick);
      else window.__landingLog = entries;
    };
    requestAnimationFrame(tick);
  };
`;

// 60px per frame is what a real wheel notch does; anything slower hides a one-frame lag.
async function wheel(page, frames, step) {
  await page.evaluate(async ({ count, px }) => {
    for (let i = 0; i < count; i++) {
      window.scrollBy({ top: px, behavior: 'instant' });
      await new Promise(done => requestAnimationFrame(done));
    }
  }, { count: frames, px: step });
}

// The largest single-frame change in the gap between the flying box and its slot, over the frames
// where the page actually scrolled. A document-anchored layer keeps this at zero; a fixed layer
// shows the whole scroll delta. `fixedScrollFrames` counts the frames where the layer was still
// `position: fixed`, which is the defect in one number.
function analyse(log) {
  if (!log || !log.length) return { frames: 0, scrollFrames: 0, worstGapJumpPx: null, fixedScrollFrames: 0, positions: [] };
  let worst = 0, scrollFrames = 0, fixedScrollFrames = 0;
  for (let i = 1; i < log.length; i++) {
    const scrollDelta = log[i].scrollY - log[i - 1].scrollY;
    if (scrollDelta === 0 || log[i].flyerTop === null || log[i].slotTop === null) continue;
    scrollFrames++;
    if (log[i].position === 'fixed') fixedScrollFrames++;
    const gapBefore = log[i - 1].flyerTop - (log[i - 1].slotTop ?? 0);
    const gapAfter = log[i].flyerTop - (log[i].slotTop ?? 0);
    const jump = Math.abs(gapAfter - gapBefore);
    if (jump > worst) worst = jump;
  }
  return {
    frames: log.length,
    scrollFrames,
    worstGapJumpPx: +worst.toFixed(1),
    fixedScrollFrames,
    positions: [...new Set(log.map(entry => entry.position))],
  };
}

/**
 * Drag one item onto another, then scroll while the landing is still settling, and report whether
 * the released layer stayed glued to the viewport.
 *
 * `scrollDelay` is measured from the release, not from the pickup: landings run for roughly
 * 380ms (native grid) and 480-520ms (React board), so a late scroll sits in the tail where the
 * spring's own motion is nearly zero.
 */
async function dragThenScroll(page, { from, to, flyer, slot = '[data-sort-placeholder]', scrollDelay, frames = 6, step = 60 }) {
  await page.evaluate(RECORDER);
  const fb = await from.boundingBox(), tb = await to.boundingBox();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + 24);
  await page.mouse.down();
  await page.mouse.move(fb.x + fb.width / 2, fb.y + 40);
  await page.waitForTimeout(420);
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(fb.x + fb.width / 2 + (tb.x - fb.x) * i / 6, fb.y + 24 + (tb.y - fb.y) * i / 6);
    await page.waitForTimeout(16);
  }
  await page.evaluate(({ moved, target }) => window.__recordLanding(moved, target), { moved: flyer, target: slot });
  await page.mouse.up();
  await page.waitForTimeout(scrollDelay);
  await wheel(page, frames, step);
  await page.waitForTimeout(1900);
  return analyse(await page.evaluate(() => window.__landingLog));
}

module.exports = { dragThenScroll, analyse, wheel, RECORDER };
