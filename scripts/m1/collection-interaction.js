'use strict';
/* global document, requestAnimationFrame, cancelAnimationFrame */
const assert = require('node:assert/strict');

const refresh = '[data-usage-refresh] button';

async function measureIdleNavigation(page) {
  await page.evaluate(() => {
    const sample = window.__collectionIdle = { events: [] };
    sample.observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (entry.name === 'click' && entry.interactionId) sample.events.push(entry.duration);
    });
    sample.observer.observe({ type: 'event', durationThreshold: 16 });
  });
  try {
    for (const view of ['cost', 'usage']) {
      await page.locator('[data-view="' + view + '"]').click();
      await page.waitForFunction(view => document.getElementById('main').dataset.currentView === view, view);
      await page.waitForTimeout(200);
    }
    return await page.evaluate(() => ({ measuredClickMs: window.__collectionIdle.events, collecting: window.usageData.collection().collecting }));
  } finally {
    await page.evaluate(() => { window.__collectionIdle?.observer.disconnect(); delete window.__collectionIdle; }).catch(() => {});
  }
}

// Observe the normal refresh button, the app-owned status and the first frame
// after the resulting data reaches the visible page. This also works against
// older source builds and does not expose any source or record identifiers.
async function measureCollection(page, { expected = null, overlap = false } = {}) {
  await page.evaluate(({ expected, refresh }) => {
    const startStatus = window.usageData.collection().checkedAt;
    const before = window.usageData.rows();
    const state = window.__collectionInteraction = { start: null, collecting: null, checked: null, facts: null, ready: null, events: [], longTasks: [], renderer: [], clicks: [] };
    const events = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (state.start === null || entry.startTime < state.start || entry.name !== 'click' || !entry.interactionId) continue;
        state.events.push({ start: entry.startTime - state.start, ms: entry.duration, inputDelay: entry.processingStart - entry.startTime });
      }
    });
    events.observe({ type: 'event', durationThreshold: 16 });
    const tasks = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (state.start === null || entry.startTime < state.start) continue;
        state.longTasks.push({ start: entry.startTime - state.start, ms: entry.duration });
      }
    });
    tasks.observe({ type: 'longtask' });
    const measures = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (state.start === null || entry.startTime < state.start || !['usage:decode', 'usage:hydrate', 'usage:project'].includes(entry.name)) continue;
        state.renderer.push({ name: entry.name, start: entry.startTime - state.start, ms: entry.duration });
      }
    });
    measures.observe({ type: 'measure' });
    let pending = false, frame = 0;
    const records = expected === null ? null : new RegExp('记录\\s*' + expected.toLocaleString('zh-CN') + '(?![\\d,])');
    const click = event => {
      if (!event.isTrusted) return;
      if (state.start === null && event.target.closest(refresh)) state.start = event.timeStamp;
      const view = event.target.closest('[data-view]')?.dataset.view;
      if (state.start !== null && (view === 'cost' || view === 'usage')) {
        state.clicks.push({ view, start: event.timeStamp - state.start, collecting: window.usageData.collection().collecting });
      }
    };
    const factChange = () => { if (state.start !== null && window.usageData.rows() !== before) state.facts ??= performance.now() - state.start; };
    const status = () => {
      if (state.start === null) return;
      const value = window.usageData.collection();
      if (value.collecting) state.collecting ??= performance.now() - state.start;
      if (!value.collecting && value.checkedAt && value.checkedAt !== startStatus) state.checked ??= performance.now() - state.start;
    };
    const draw = () => {
      if (state.checked !== null && !pending) {
        const onPage = document.querySelector('#usage:not([hidden]) [data-usage-hero]');
        const updated = !records || (state.facts !== null && records.test(onPage?.textContent ?? ''));
        if (onPage && updated && !document.querySelector(refresh)?.disabled) {
          pending = true;
          frame = requestAnimationFrame(() => { state.ready = performance.now() - state.start; });
          return;
        }
      }
      frame = requestAnimationFrame(draw);
    };
    window.addEventListener('click', click, true);
    window.addEventListener('usage-collection', status);
    window.addEventListener('usage-data-change', factChange);
    frame = requestAnimationFrame(draw);
    state.stop = () => {
      events.disconnect(); tasks.disconnect(); measures.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('click', click, true);
      window.removeEventListener('usage-collection', status);
      window.removeEventListener('usage-data-change', factChange);
    };
  }, { expected, refresh });
  try {
    await page.locator(refresh).click();
    if (overlap) {
      const result = await page.waitForFunction(() => {
        const sample = window.__collectionInteraction;
        return sample.collecting !== null || sample.checked !== null;
      }, null, { timeout: 30000 });
      await result.dispose();
      for (const view of ['cost', 'usage']) {
        await page.locator('[data-view="' + view + '"]').click();
        await page.waitForFunction(view => document.getElementById('main').dataset.currentView === view, view);
      }
    }
    await page.waitForFunction(() => window.__collectionInteraction.ready !== null, null, { timeout: 90000 });
    await page.waitForTimeout(125);
    const result = await page.evaluate(() => {
      const { start, collecting, checked, facts, ready, events, longTasks, renderer, clicks } = window.__collectionInteraction;
      return { start, collecting, checked, facts, ready, events, longTasks, renderer, clicks, statusError: Boolean(window.usageData.collection().error) };
    });
    assert(result.start !== null && result.ready > 0);
    if (overlap) assert.equal(result.clicks.length, 2, 'both navigation clicks must reach the renderer');
    return { ...result, clicks: result.clicks.map(click => {
      const event = result.events.find(entry => Math.abs(entry.start - click.start) < 1);
      return { ...click, event: event ?? null, duringCollection: click.collecting && click.start < result.checked };
    }) };
  } finally {
    await page.evaluate(() => { window.__collectionInteraction?.stop(); delete window.__collectionInteraction; }).catch(() => {});
  }
}

module.exports = { measureCollection, measureIdleNavigation };
