'use strict';
/* global document, getComputedStyle, NodeFilter */
// Check the visible content, including the existing wallet pocket whose background
// intentionally reaches behind the footer. A hidden grid must never pass as 0 x 0.
const assert = require('node:assert/strict');

async function assertQuotaCardsFit(page, expectedCount) {
  const report = await page.evaluate(() => {
    const quota = document.getElementById('quota'), main = document.getElementById('main');
    const visible = element => element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const bounds = element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const cards = [...document.querySelectorAll('#quotaCards .quota-card')].map(card => {
      const body = card.querySelector('.quota-card-body'), footer = card.querySelector('.quota-card-foot');
      const cardBox = bounds(card), bodyBox = bounds(body), footerBox = bounds(footer), issues = [];
      const check = (rect, description) => {
        if (rect.top < bodyBox.top - 1 || rect.bottom > bodyBox.bottom + 1 || !footer.classList.contains('is-quiet') && rect.bottom > footerBox.top + 1 ||
            rect.left < bodyBox.left - 1 || rect.right > bodyBox.right + 1) {
          issues.push({ description, rect });
        }
      };
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let textCount = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.data.trim() || !visible(node.parentElement) || node.parentElement.closest('[aria-hidden="true"]')) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const painted = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
          // Nothing on a card is abbreviated (owner 2026-11-04).
          for (let parent = node.parentElement; parent && parent !== body; parent = parent.parentElement) {
            if (getComputedStyle(parent).textOverflow === 'ellipsis' && parent.scrollWidth > parent.clientWidth + 1) issues.push({ description: 'abbreviated: ' + node.data.trim() });
          }
          check(painted, 'text: ' + node.data.trim()); textCount++;
        }
      }
      let graphicCount = 0;
      for (const element of body.querySelectorAll('svg:not(.quota-pocket-lip), .quota-segments, .quota-ladder, .quota-ghost, button, input, select, textarea, [role="progressbar"]')) {
        if (!visible(element)) continue;
        const rect = bounds(element); if (!rect.width || !rect.height) continue;
        check(rect, 'graphic/control: ' + element.tagName + '.' + element.getAttribute('class')); graphicCount++;
      }
      const pocket = Boolean(body.querySelector('.quota-wallet.is-pocket'));
      // The former whole-body scroll check remains unchanged for every other
      // shape. Only the approved pocket's decorative background is distinguished.
      if (!pocket && body.scrollHeight > body.clientHeight + 1) issues.push({ description: 'body scroll overflow', scroll: body.scrollHeight, client: body.clientHeight });
      return { key: card.dataset.cardKey, visible: visible(card), card: cardBox, body: bodyBox, footer: footerBox,
        scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, pocket, textCount, graphicCount, issues };
    });
    return { view: main?.dataset.currentView, visible: Boolean(quota && !quota.hidden && visible(quota)), cards };
  });
  assert.equal(report.view, 'quota', 'card geometry requires current quota view');
  assert.equal(report.visible, true, 'card geometry requires visible quota view');
  assert.equal(report.cards.length, expectedCount, 'card geometry checks every expected card');
  for (const card of report.cards) {
    assert(card.visible && card.card.width > 0 && card.card.height > 0 && card.body.width > 0 && card.body.height > 0,
      'card geometry cannot pass hidden or zero-size cards: ' + JSON.stringify(card));
    assert(card.card.height >= card.card.width - .01, 'cards remain at least square: ' + JSON.stringify(card));
    assert.equal(card.issues.length, 0, 'visible card content fits before its footer: ' + JSON.stringify(card));
  }
  for (const card of report.cards) for (const peer of report.cards) {
    if (Math.abs(card.card.top - peer.card.top) <= 1) {
      assert(Math.abs(card.card.height - peer.card.height) <= 1 / 64, 'cards of a row retain one height');
    }
  }
  return report;
}

module.exports = { assertQuotaCardsFit };
