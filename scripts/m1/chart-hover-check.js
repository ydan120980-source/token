'use strict';
/* global document, getComputedStyle */
// Observable hover contract: one entry animation, stable nodes during scrubbing and
// memory-only render, no hit-test interception; actual pointer and keyboard events.
const assert = require('node:assert/strict');
async function checkChartHover(page, { anchor, tip, render, output }) {
  const target = page.locator(anchor).first(); await target.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await page.evaluate(selector => {
    const tip = document.querySelector(selector); window.__chartProbe = { tip, entries: 0 };
    const original = tip.animate.bind(tip); tip.animate = (...args) => { window.__chartProbe.entries++; return original(...args); };
  }, tip);
  const box = await target.boundingBox(), x = box.x + box.width * .55, y = box.y + box.height * .5;
  await page.mouse.move(x, y); await page.waitForTimeout(240);
  assert(await page.locator(tip).isVisible(), 'pointer shows the readout');
  await page.evaluate(selector => { window.__chartProbe.child = document.querySelector(selector).firstChild; }, tip);
  for (let i = 0; i < 12; i++) await page.mouse.move(x + i % 2, y);
  const stable = await page.evaluate(({ selector, render }) => {
    const probe = window.__chartProbe, tip = document.querySelector(selector), child = tip.firstChild;
    const sameBucket = child === probe.child;
    if (render === 'cost') window.costPage.render();
    const next = document.querySelector(selector), style = getComputedStyle(next);
    return { sameBucket, sameNode: next === probe.tip, sameContent: next.firstChild === child, entries: probe.entries, hidden: next.hidden, opacity: Number(style.opacity), pointerEvents: style.pointerEvents, transform: style.transform };
  }, { selector: tip, render });
  assert(stable.sameBucket && stable.sameNode && stable.sameContent, 'same bucket and render retain the tooltip and its nodes');
  assert.equal(stable.entries, 1, 'scrubbing and collection render do not replay entry');
  assert.equal(stable.hidden, false); assert.equal(stable.opacity, 1); assert.equal(stable.pointerEvents, 'none'); assert.equal(stable.transform, 'none');
  for (let i = 0; i < 45; i++) { await page.mouse.move(box.x + box.width * (.15 + .7 * i / 44), y); assert.equal(await page.locator(tip).evaluate(e => e.hidden), false, 'continuous scrub stays visible'); }
  assert.equal(await page.evaluate(() => window.__chartProbe.entries), 1, 'changing buckets does not restart opacity');
  if (output) await page.screenshot({ path: output });
  await page.mouse.move(0, 0); assert(await page.locator(tip).isHidden(), 'leaving closes the readout');
  await target.focus(); await target.press('ArrowLeft').catch(() => {});
  // Quota anchors are buttons, cost anchors expose a keyboard cursor.
  if (!await page.locator(tip).isVisible()) { await target.blur(); await target.focus(); }
  assert(await page.locator(tip).isVisible(), 'keyboard focus/cursor exposes the readout');
  await target.press('Escape'); assert(await page.locator(tip).isHidden(), 'Escape dismisses keyboard readout');
  return stable;
}
async function checkTextContrast(page, selectors) {
  const readings = await page.evaluate(selectors => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = color => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data].map((v, i) => i === 3 ? v / 255 : v); };
    const over = (a, b) => { const alpha = a[3] + b[3] * (1 - a[3]); return [0, 1, 2].map(i => alpha ? (a[i] * a[3] + b[i] * b[3] * (1 - a[3])) / alpha : 0).concat(alpha); };
    const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)].filter(e => e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && e.textContent.trim()).map(e => {
      let bg = [0, 0, 0, 0]; for (let p = e; p; p = p.parentElement) { bg = over(bg, rgba(getComputedStyle(p).backgroundColor)); if (bg[3] >= .999) break; }
      bg = over(bg, [255, 255, 255, 1]); const style = getComputedStyle(e), color = rgba(style.color); let opacity = 1;
      for (let p = e; p; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
      color[3] *= opacity; const ink = over(color, bg), a = luminance(ink), b = luminance(bg), size = parseFloat(style.fontSize), large = size >= 24 || size >= 18.66 && Number(style.fontWeight) >= 700;
      return { selector, text: e.textContent.trim().slice(0, 60), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), minimum: large ? 3 : 4.5 };
    }));
  }, selectors);
  assert(readings.length > 0, 'contrast check inspected rendered text');
  assert.deepEqual(readings.filter(row => row.ratio < row.minimum), [], 'core text meets 4.5:1 (3:1 for large text), including ancestor opacity');
  return readings;
}
module.exports = { checkChartHover, checkTextContrast };
