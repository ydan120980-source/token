'use strict';
const { settle } = require('./ui-settle');
// Locators and actions for the quota page (docs/m2/UI-QUOTA-PAGE-20261027.md). The account cards keep
// their legacy renderer (quota-card-grid.js) and legacy DOM; the toolbar, overview, timeline, summary
// and every sheet are on the React layer and are addressed by data-* hooks, roles and names.

// The card grid and one card (legacy DOM). agent: the provider id (codex, workbuddy …).
const grid = page => page.locator('#quotaCards');
const cards = page => page.locator('#quotaCards .quota-card');
const card = (page, agent) => page.locator(`#quotaCards .quota-card[data-provider-row="${agent}"]`);
const cardByConnection = (page, id) => page.locator(`#quotaCards .quota-card[data-connections~="${id}"]`);
const cardOrder = page => cards(page).evaluateAll(list => list.map(item => item.dataset.providerRow));

// Sheets render in the shared portal. The details sheet holds [data-quota-details]; the Codex
// login holds the alias field; the provider connection holds its form.
const details = page => page.locator('[role="dialog"]:has(div[data-quota-details])');
const codexLogin = page => page.locator('[role="dialog"]:has([data-quota-alias-field])');
const providerForm = page => page.locator('[role="dialog"]:has(form[aria-label="连接账号额度"])');
const openDetails = async (page, agent) => { await card(page, agent).first().locator('[data-quota-details]').click(); await details(page).waitFor(); };

// The summary column (docked in a wide window) or, when it is not docked, the same lists inline.
const attention = page => page.locator('[data-quota-attention]').first();
const idleRow = (page, agent) => page.locator(`[data-quota-idle-agent="${agent}"]`).first();

// A kit Select: open it by its accessible name and pick the option by its label.
async function choose(page, name, label) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  // The list hands focus back to its trigger as it closes; let that finish before typing elsewhere.
  await page.getByRole('listbox').waitFor({ state: 'detached' }); await settle(page);
}
// The provider connection sheet (ui/src/pages/quota/connections.tsx). It opens from an idle Agent's
// row (inline below the cards, or in the pinned summary) or, for a connected Agent, from its details.
const METHODS = { website: '在 Chrome 登录后手动连接', manual: '手动提供凭据', 'client-new': '换账号／重新授权' };
const connection = {
  async open(page, agent) {
    const idle = idleRow(page, agent).locator('[data-provider-connect] button');
    if (await idle.count()) await idle.click();
    else { await card(page, agent).first().locator('[data-quota-sheet]').click(); await details(page).waitFor(); await details(page).locator(`[data-provider-connect="${agent}"] button`).click(); }
    await providerForm(page).waitFor();
  },
  adapter: page => providerForm(page).locator('[data-provider-adapter]').getAttribute('data-selection'),
  async setAdapter(page, id) {
    if (await connection.adapter(page) === id) return;
    const name = await page.evaluate(id => window.quotaHost.model.capabilities().flatMap(item => item.adapters).find(route => route.id === id)?.name, id);
    await choose(page, '读取服务', name); await page.locator(`[data-provider-adapter][data-selection="${id}"]`).waitFor();
  },
  hasMethod: page => providerForm(page).locator('[data-provider-method]').isVisible(),
  method: page => providerForm(page).locator('[data-provider-method]').getAttribute('data-selection'),
  async setMethod(page, value) {
    if (await connection.method(page) === value) return;
    if (value === 'client') { await page.getByRole('combobox', { name: '连接方式', exact: true }).click(); await page.getByRole('option').first().click(); await page.getByRole('listbox').waitFor({ state: 'detached' }); await settle(page); }
    else await choose(page, '连接方式', METHODS[value]);
    await page.locator(`[data-provider-method][data-selection="${value}"]`).waitFor();
  },
  // Picks the adapter and the manual method (when the route offers a choice) and forgets the credential.
  async manual(page, id) { await connection.setAdapter(page, id); if (await connection.hasMethod(page)) await connection.setMethod(page, 'manual'); await connection.check(page, 'remember', false); },
  field: (page, name) => providerForm(page).locator(`[data-provider-field="${name}"] input`),
  box: (page, which) => providerForm(page).locator(`[data-provider-${which}] [role="checkbox"]:not([aria-hidden="true"])`),
  checked: async (page, which) => (await connection.box(page, which).getAttribute('aria-checked')) === 'true',
  async check(page, which, on = true) { if (await connection.checked(page, which) !== on) await connection.box(page, which).click(); },
  submit: page => providerForm(page).locator('[data-sheet-footer] button').last().click(),
  // Escape, as a person would: the sheet re-renders while a read is pending, so its close button is
  // not a stable target. A focused field takes the first Escape to restore its value.
  async close(page) {
    for (let i = 0; i < 3 && await providerForm(page).count(); i++) { await page.keyboard.press('Escape'); await providerForm(page).waitFor({ state: 'detached', timeout: 2000 }).catch(() => {}); }
    await providerForm(page).waitFor({ state: 'detached' });
  },
  error: page => providerForm(page).locator('[data-provider-connect-error]'),
};

// An action in a connected Agent's details sheet (details.tsx footer); the sheet closes afterwards
// unless the action opened the connection sheet.
const DETAIL_ACTIONS = { cancel: '取消', 'passive-guide': '复制状态栏配置', credential: /^(重新连接／登录|重新提供凭据)$/ };
async function detailAction(page, agent, action) {
  await card(page, agent).first().locator('[data-quota-sheet]').click(); const sheet = details(page); await sheet.waitFor();
  const button = action === 'remove' ? sheet.locator('[data-quota-remove] button') : action === 'refresh' ? sheet.locator('[data-quota-sheet-refresh] button') : sheet.getByRole('button', { name: DETAIL_ACTIONS[action] });
  await button.first().click();
  if (action === 'credential') { await providerForm(page).waitFor(); return; }
  if (await sheet.isVisible()) { await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' }); }
}

const refreshAll = page => page.locator('[data-quota-refresh-all] button');
const batch = page => page.locator('[data-quota-summary]');
const message = page => page.locator('[data-provider-quota-message]');

module.exports = { grid, cards, card, cardByConnection, cardOrder, details, codexLogin, providerForm, openDetails, attention, idleRow, choose, connection, detailAction, refreshAll, batch, message };
