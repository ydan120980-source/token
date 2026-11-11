'use strict';
/* global document */
// Shared steps for UI suites that drive the React settings page (M3, docs/m2/UI-MIG-M3-20261025.md).
// Everything goes through what a person sees (roles, labels) or the page's documented hooks
// (data-* on its own elements, window.settingsUi / settingsHost); no legacy ids remain.
const { showView, until } = require('./ui-settle');

const dialog = page => page.locator('[data-ui-portal] [role="dialog"]');
async function openSettings(page, section) {
  await showView(page, 'settings');
  await page.locator('[data-settings-page]').waitFor();
  await page.getByRole('tablist', { name: '设置分类' }).getByRole('tab', { name: { general: '常规', quota: '额度', collection: '采集', pricing: '定价', privacy: '数据与安全', about: '关于' }[section || 'general'], exact: true }).click();
}
// Open pricing and wait until the used-model table has rows (optionally one with left-out usage).
async function openPricing(page, { gap = false } = {}) {
  await openSettings(page, 'pricing');
  await until(page, new Function('return [...document.querySelectorAll("[data-price-models] tr[data-row-key]")].some(row => ' + (gap ? 'row.textContent.includes("未计入")' : 'true') + ')'));
}
// The same reload the panel does when settings is shown again.
async function reloadPricing(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ui-view-change', { detail: 'settings' })));
}
async function openPrice(page, key) {
  await page.locator('[data-price-models] tr[data-row-key="' + key + '"] button').first().click();
  await dialog(page).waitFor();
  await until(page, new Function('return document.querySelector("[data-ui-portal] [data-price-editor]")?.dataset.priceEditor === ' + JSON.stringify(key)));
}
async function openNewPrice(page) {
  await page.getByRole('button', { name: '为其他模型添加价格', exact: true }).click();
  await dialog(page).waitFor();
}
// A text or number field by its accessible name (fluid labels repeat their text for a weight-change ghost).
const input = (scope, name) => scope.getByRole('textbox', { name, exact: true }).or(scope.getByRole('spinbutton', { name, exact: true }));
const field = (page, name) => input(dialog(page), name);
const text = (page, hook) => page.locator('[data-' + hook + ']').first().textContent();
async function waitText(page, hook, pattern) {
  await until(page, new Function('return ' + pattern.toString() + '.test(document.querySelector("[data-' + hook + ']")?.textContent || "")'));
}
async function waitClosed(page) { await until(page, () => !document.querySelector('[data-ui-portal] [role="dialog"]')); }
// The Agent rules disclosure, opened.
async function openBilling(page) {
  const trigger = page.getByRole('button', { name: /Agent 计费规则/ });
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.locator('[data-billing-rules]').waitFor();
}
// Pick an option from a kit Combobox by its trigger's accessible name.
async function pickCombobox(scope, page, name, option) {
  await scope.getByRole('button', { name, exact: true }).click();
  const search = page.locator('[data-ui-portal] [role="menu"] input');
  await search.waitFor(); await search.fill(option);
  await page.locator('[data-ui-portal] [role="menu"]').getByRole('menuitemradio', { name: option, exact: true }).click();
}
// Pick an option from a kit Select by its trigger's accessible name.
async function pickSelect(scope, page, name, option) {
  await scope.getByRole('combobox', { name, exact: true }).click();
  await page.locator('[data-ui-portal] [role="option"]').filter({ hasText: option }).first().click();
}

module.exports = { dialog, input, openSettings, openPricing, reloadPricing, openPrice, openNewPrice, field, text, waitText, waitClosed, openBilling, pickCombobox, pickSelect };
