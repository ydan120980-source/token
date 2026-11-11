'use strict';
/* global requestAnimationFrame */
// M7 equivalents of settings-ui-helpers: actual controls/DOM readouts, never a fake legacy renderer.
const { showView, settle, until } = require('./ui-settle');
const { pickCombobox, pickSelect } = require('./settings-ui-helpers');
const hooks = {
  totalTokens: '[data-usage-total-tokens]', totalCost: '[data-usage-total-cost]',
  today: '[data-usage-today]', calendar: '[data-usage-calendar]', weekHour: '[data-usage-week-hour]',
  trend: '[data-usage-trend]', day: '[data-usage-day]', tip: '#kit-window-chart-tooltip',
  strip: '[data-usage-strip]', refresh: '[data-usage-refresh] button', export: '[data-usage-export] button',
};
const root = page => page.locator('[data-usage-page]');
async function openUsage(page) { await showView(page, 'usage'); await root(page).waitFor(); }
// Motion's digit columns contain all ten digits. Their accessible label is the current truthful readout.
function renderedText(element) {
  const copy = element.cloneNode(true);
  for (const label of copy.querySelectorAll('span[aria-label]')) label.textContent = label.getAttribute('aria-label');
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return copy.textContent.trim();
}
const text = locator => locator.evaluate(renderedText);
async function value(page, key) {
  const readout = await text(page.locator(hooks[key] ?? '[data-usage-' + key + ']'));
  return key === 'totalTokens' ? readout.replace(/\s*Token$/, '') : readout;
}
async function waitValue(page, key, expected) {
  const deadline = Date.now() + 30000;
  while ((await value(page, key)) !== expected) {
    if (Date.now() >= deadline) throw Error('USAGE_READOUT_TIMEOUT: ' + key + ', expected ' + expected + ', saw ' + await value(page, key));
    await page.waitForTimeout(50);
  }
}
async function period(page, value) {
  await page.locator('[data-usage-periods]').getByRole('tab', { name: { all: '累计', '30': '30 天', '7': '7 天', today: '今日' }[value], exact: true }).click();
  await settle(page);
}
async function agent(page, id) { await page.locator('[data-usage-agents] [data-agent="' + id + '"]').click(); await settle(page); }
// Source, model, value and grain sit behind the trend's 更多 button.
async function more(page) {
  const box = page.locator('[data-usage-trend-more]');
  if (await box.getAttribute('data-open') !== 'true') { await box.locator('button').click(); await settle(page); }
  if (await box.locator('button').getAttribute('aria-expanded') !== 'true') throw Error('USAGE_MORE_STATE: the button must say it is open');
}
async function select(page, kind, value) {
  await settle(page); await more(page);
  const trigger = root(page).getByRole('button', { name: kind === 'model' ? '用量模型筛选' : '用量来源筛选', exact: true });
  await trigger.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const label = await page.evaluate(([kind, key]) => window.usageHost.get().view[kind === 'model' ? 'models' : 'sources'].find(option => option.value === key)?.label, [kind, value]);
  if (!label) throw Error('USAGE_OPTION_MISSING: ' + kind + '/' + value);
  await pickCombobox(root(page), page, kind === 'model' ? '用量模型筛选' : '用量来源筛选', label); await settle(page);
}
const cell = (page, day) => page.locator('[data-usage-calendar] [data-heat-key="' + day + '"]');
const calendarCells = page => page.locator('[data-usage-calendar] [data-heat-key]:not([aria-disabled="true"])');
async function heatRange(page, value) {
  await page.locator('[data-usage-calendar-range]').getByRole('tab', { name: value === '365' ? '最近一年' : value + ' 年', exact: true }).click();
  await settle(page);
}
async function palette(page, value) {
  await page.locator('[data-usage-palette]').getByRole('radio', { name: { orange: '橙色', blue: '蓝色', green: '绿色', mono: '单色' }[value], exact: true }).click();
  await settle(page);
}
async function grain(page, label) { await more(page); await pickSelect(root(page), page, '趋势时间粒度', label); await settle(page); }
async function readyChart(page, hook) {
  const chart = page.locator('[data-usage-' + hook + '] [data-chart]').first();
  await chart.scrollIntoViewIfNeeded(); await until(page, new Function('return document.querySelector(\'[data-usage-' + hook + '] [data-chart]\')?.dataset.ready === "true"'));
  return chart;
}
async function hover(page, mark) {
  await page.mouse.move(1, 1); await mark.scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await mark.hover();
}
module.exports = { hooks, root, openUsage, renderedText, text, value, waitValue, period, agent, more, select, cell, calendarCells, heatRange, palette, grain, readyChart, hover };
