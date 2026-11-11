'use strict';
/* global document, getComputedStyle, NodeFilter */
// Text that does not show in full: cut by an ellipsis or a clipped box, or painted outside the box it belongs to.
// Runs in the page; returns what it found under the given root selector.
function clippedText(root, { skip = null } = {}) {
  const found = [], seen = new Set();
  const visible = element => element.checkVisibility({ opacityProperty: false, visibilityProperty: true });
  for (const base of document.querySelectorAll(root)) {
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.data.trim(), parent = node.parentElement;
      if (!text || !visible(parent) || parent.closest('[aria-hidden="true"], .sr-only, [data-mark-only] h3') || skip && parent.closest(skip)) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(rect => rect.width && rect.height);
      if (!rects.length) continue;
      for (let box = parent; box && box !== base.parentElement; box = box.parentElement) {
        const style = getComputedStyle(box), clips = style.overflowX !== 'visible' || style.overflowY !== 'visible';
        if (!clips || box.getBoundingClientRect().width <= 1 || box.getAttribute('role') === 'listbox' || style.overflowX === 'auto' || style.overflowY === 'auto' || style.overflowX === 'scroll' || style.overflowY === 'scroll') continue;
        const frame = box.getBoundingClientRect(), over = rects.find(rect => rect.right > frame.right + 1 || rect.left < frame.left - 1 || rect.bottom > frame.bottom + 1.5 || rect.top < frame.top - 1.5);
        const clamped = style.textOverflow === 'ellipsis' && box.scrollWidth > box.clientWidth + 1 || style.webkitLineClamp !== 'none' && box.scrollHeight > box.clientHeight + 1;
        if (over || clamped) {
          const key = text + '|' + box.tagName + '.' + box.className;
          if (!seen.has(key)) { seen.add(key); found.push({ text: text.slice(0, 80), box: box.tagName.toLowerCase() + '.' + String(box.className).split(/\s+/).slice(0, 3).join('.'), why: clamped ? 'ellipsis' : 'clipped', width: Math.round(frame.width) }); }
          break;
        }
      }
    }
  }
  return found;
}
module.exports = { clippedText };
