'use strict';
/* global document, MutationObserver, ResizeObserver, requestAnimationFrame */
// Focused geometry/input checks for the production filter, reused by the Today suite.
const assert = require('node:assert/strict');
const { showView, until } = require('./ui-settle');
const { setTheme } = require('./ui-smoke');
const selector = '[data-usage-agents] [data-agent-filter]';
async function checkAgentFilter(page) {
  const original = await page.evaluate(() => ({ theme: window.settingsHost.theme.get(), motion: document.body.dataset.motion,
    agent: window.usageHost.get().state.agent, dark: document.body.classList.contains('dark') }));
  await showView(page, 'sessions');
  await page.evaluate(selector => {
    window.filterFirstPaint = null;
    window.plotFirstPaint = null;
    const observer = new MutationObserver(() => {
      const host = document.querySelector(selector); if (!host) return;
      observer.disconnect();
      const resize = new ResizeObserver(() => {
        const selected = host.querySelector('[aria-checked=true]'), indicator = host.querySelector('[data-agent-indicator]');
        const box = selected?.getBoundingClientRect(); if (!box?.width) return;
        const highlight = indicator?.getBoundingClientRect();
        window.filterFirstPaint = { present: Boolean(highlight), error: highlight ? Math.max(...['x', 'y', 'width', 'height'].map(k => Math.abs(box[k] - highlight[k]))) : null };
        resize.disconnect();
      }); resize.observe(host);
      const plot = document.querySelector('[data-usage-hero] [data-chart=bar]');
      if (plot) {
        const plotResize = new ResizeObserver(() => {
          if (!plot.clientWidth) return;
          window.plotFirstPaint = { width: plot.clientWidth, svgWidth: Number(plot.querySelector('svg')?.getAttribute('width')), shapes: plot.querySelectorAll('svg path,svg rect').length };
          plotResize.disconnect();
        }); plotResize.observe(plot);
      }
    }); observer.observe(document.querySelector('main'), { childList: true, subtree: true });
  }, selector);
  await showView(page, 'usage');
  await until(page, () => Boolean(window.filterFirstPaint));
  const first = await page.evaluate(() => window.filterFirstPaint);
  assert(first.present && first.error < 1, 'first pre-paint resize delivery already has the aligned highlight');
  const plotFirst = await page.evaluate(() => window.plotFirstPaint);
  assert(plotFirst && Math.abs(plotFirst.svgWidth - Math.max(240, plotFirst.width)) < 1, 'first pre-paint chart width is its real layout width');
  assert(plotFirst.shapes > 0, 'the sized chart subtree exists before the first paint');
  const root = page.locator(selector), buttons = root.getByRole('radio');
  const aligned = () => {
    const host = document.querySelector('[data-usage-agents] [data-agent-filter]'); if (!host) return false;
    const selected = host.querySelector('[aria-checked=true]'), indicator = host.querySelector('[data-agent-indicator]');
    if (!selected || !indicator) return false;
    const a = selected.getBoundingClientRect(), b = indicator.getBoundingClientRect();
    return ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) < 1);
  };
  const cases = [];
  try {
    for (const theme of ['light', 'dark']) for (const mode of ['full', 'off', 'reduced']) {
      await setTheme(page, theme); await page.evaluate(mode => { document.body.dataset.motion = mode; }, mode);
      await buttons.first().focus(); await buttons.first().press('Home');
      await until(page, aligned);
      await buttons.first().press('ArrowRight');
      await page.waitForFunction(() => document.querySelectorAll('[data-usage-agents] [role=radio]')[1]?.getAttribute('aria-checked') === 'true');
      assert(await buttons.nth(1).evaluate(button => document.activeElement === button), 'keyboard selection owns focus');
      // Retarget a moving spring before it settles; the final shape must match its real target.
      await buttons.nth(1).press('End'); await buttons.last().press('Home');
      await until(page, aligned);
      assert.equal(await buttons.first().getAttribute('aria-checked'), 'true');
      cases.push({ theme, mode, aligned: true, keyboard: true, retargeted: true });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { document.body.dataset.motion = 'full'; });
    await buttons.first().press('End'); await until(page, aligned);
    cases.push({ systemReduced: true, aligned: true });
  } finally {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(({ motion, agent }) => { document.body.dataset.motion = motion || 'full'; window.usageHost.set({ agent: agent || 'all' }); }, original);
    await page.evaluate(theme => window.settingsHost.theme.set(theme), original.theme);
    await page.waitForFunction(dark => document.body.classList.contains('dark') === dark, original.dark);
  }
  await showView(page, 'sessions');
  const usageButton = await page.locator('[data-view="usage"]').boundingBox(), costButton = await page.locator('[data-view="cost"]').boundingBox();
  assert(usageButton && costButton);
  await page.mouse.click(usageButton.x + usageButton.width / 2, usageButton.y + usageButton.height / 2);
  await page.mouse.click(costButton.x + costButton.width / 2, costButton.y + costButton.height / 2);
  await page.waitForFunction(() => document.getElementById('main').dataset.currentView === 'cost' && Boolean(document.querySelector('[data-cost-page]')));
  const superseded = await page.evaluate(async () => {
    const section = document.getElementById('usage');
    let lateMounts = 0;
    const observer = new MutationObserver(entries => {
      lateMounts += entries.reduce((sum, entry) => sum + entry.addedNodes.length, 0);
    });
    observer.observe(section, { childList: true, subtree: true });
    try {
      for (let frame = 0; frame < 8; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
      return { hidden: section.hidden, focus: section.contains(document.activeElement), lateMounts };
    } finally { observer.disconnect(); }
  });
  assert(superseded.hidden && !superseded.focus, 'the superseded page is hidden and gives up focus');
  assert.equal(superseded.lateMounts, 0, 'the superseded page never mounts deferred content after the switch');
  await showView(page, 'usage'); await until(page, aligned);
  assert.equal(await root.locator('[aria-checked=true]').getAttribute('data-agent'), original.agent);
  await page.locator('[data-usage-trend]').waitFor();
  const position = await page.evaluate(() => {
    const trend = document.querySelector('[data-usage-trend]');
    window.scrollTo({ top: window.scrollY + trend.getBoundingClientRect().top, behavior: 'instant' });
    return window.scrollY;
  });
  assert(position > 0, 'history test scrolls past the first screen');
  await showView(page, 'cost');
  await page.locator('#windowBack').click();
  await page.waitForFunction(top => document.getElementById('main').dataset.currentView === 'usage' &&
    Math.abs(window.scrollY - top) < 2, position);
  return { first, plotFirst, cases, rapidNavigation: true, scrollRestored: true };
}
module.exports = { checkAgentFilter };
