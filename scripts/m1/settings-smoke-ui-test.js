'use strict';
/* global document, CompositionEvent, getComputedStyle, innerHeight */
// Smoke and page checks for the React settings page (M3, docs/m2/UI-MIG-M3-20261025.md), from the
// M2 template: both themes, layer isolation, data semantics, each sheet's focus and Escape, no
// errors, motion off. Plus what only this page owns: search, categories, the profile sheet, the
// export sheet's contents and the source catalog link. Synthetic fixture home only.
const path = require('node:path'), assert = require('node:assert/strict');
const { runPageSmoke } = require('./ui-page-smoke-template');
const { until, settle } = require('./ui-settle');
const { dialog, waitClosed } = require('./settings-ui-helpers');
const output = process.env.SETTINGS_SMOKE_EVIDENCE_DIR || 'artifacts/ui-mig/M3';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SHEET = '[data-ui-portal] [role="dialog"]';
const sections = ['pricing', 'general', 'quota', 'collection', 'privacy', 'about'];
let flowsDone = false;

const visible = page => page.evaluate(names => names.filter(name => !document.getElementById('section-' + name).hidden), sections);
const tab = (page, name) => page.getByRole('tablist', { name: '设置分类' }).getByRole('tab', { name, exact: true });

async function searchChecks(page) {
  const search = page.getByRole('textbox', { name: '搜索设置项', exact: true });
  assert.equal(await search.getAttribute('maxlength'), '60');
  // An option label inside a closed select still matches (the legacy page searched <option> text).
  await search.fill('深色'); await settle(page);
  assert.deepEqual(await visible(page), ['general'], 'only the appearance card matches');
  assert.equal(await tab(page, '采集').isDisabled(), true, 'a category without matches is disabled');
  assert.equal(await tab(page, '常规').isDisabled(), false);
  // Model names in the pricing table are searchable text too.
  const key = await page.locator('[data-price-models] tr[data-row-key]').first().getAttribute('data-row-key');
  await search.fill(key.split('/')[1]); await settle(page);
  assert.ok((await visible(page)).includes('pricing'), 'a used model name finds the pricing section');
  await search.fill('不存在的设置项'); await settle(page);
  assert.deepEqual(await visible(page), []); await page.getByText('未找到匹配的设置项。按 ESC 清空搜索。', { exact: true }).waitFor();
  // Composition keeps the query; an ordinary Escape clears it and keeps focus.
  await search.focus(); await search.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await page.keyboard.press('Escape'); assert.equal(await search.inputValue(), '不存在的设置项');
  await search.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }))); await page.keyboard.up('Shift');
  await page.keyboard.press('Escape'); assert.equal(await search.inputValue(), ''); assert.equal(await search.evaluate(element => element === document.activeElement), true);
  await settle(page); assert.equal((await visible(page)).length, 1, 'clearing goes back to the one category');
  await page.screenshot({ path: path.join(output, 'search-cleared.png') });
}

async function categoryChecks(page) {
  await tab(page, '关于').click(); await settle(page);
  await until(page, () => { const top = document.getElementById('section-about').getBoundingClientRect().top; return top >= 0 && top < innerHeight; });
  assert.equal(await tab(page, '关于').getAttribute('aria-selected'), 'true');
  // One category at a time, and the choice stays.
  assert.deepEqual(await visible(page), ['about']);
  await tab(page, '常规').click(); await settle(page);
  assert.deepEqual(await visible(page), ['general']);
}

async function profileChecks(page) {
  await page.locator('[data-profile-summary]').getByRole('button', { name: '编辑资料', exact: true }).click();
  const sheet = dialog(page); await sheet.waitFor();
  const name = sheet.getByRole('textbox', { name: '显示名称', exact: true });
  assert.deepEqual(await name.evaluate(element => [element.required, element.maxLength]), [true, 48]);
  assert.equal(await sheet.getByRole('textbox', { name: '简介', exact: true }).evaluate(element => element.maxLength), 80);
  await name.fill(''); await sheet.getByRole('button', { name: '保存资料', exact: true }).click();
  assert.equal(await name.evaluate(element => element.matches(':invalid')), true, 'an empty name is rejected natively'); assert.equal(await dialog(page).count(), 1);
  await name.fill('林小'); assert.equal(await sheet.getByRole('img', { name: '头像预览', exact: true }).textContent(), '林', 'initials follow the typed name');
  await sheet.getByRole('tab', { name: '青绿', exact: true }).click();
  assert.equal(await sheet.getByRole('img', { name: '头像预览', exact: true }).evaluate(element => getComputedStyle(element).color), 'rgb(39, 91, 80)');
  const file = sheet.locator('input[type="file"]');
  await file.setInputFiles({ name: 'avatar.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
  await sheet.locator('[data-profile-error]').filter({ hasText: '最大 512 KB 的 PNG、JPEG 或 WebP' }).waitFor();
  await file.setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PNG });
  await sheet.locator('[data-avatar-status]').filter({ hasText: '已选 1 KB' }).waitFor();
  assert.equal(await sheet.locator('[data-profile-error]').count(), 0, 'a good image clears the error');
  await page.screenshot({ path: path.join(output, 'profile-sheet.png') });
  await sheet.getByRole('button', { name: '保存资料', exact: true }).click(); await waitClosed(page);
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('agentusage-preview.profile.v1')));
  assert.equal(saved.name, '林小'); assert.equal(saved.tone, 'teal'); assert.match(saved.photo, /^data:image\/png;base64,/);
  assert.equal(await page.locator('#profileName').textContent(), '林小', 'the sidebar shows the saved profile');
  assert.match(await page.locator('[data-profile-summary]').textContent(), /林小/);
  await page.locator('#toast').filter({ hasText: '名称和头像已保存到本机。' }).waitFor();
}

async function exportChecks(page) {
  await tab(page, '数据与安全').click(); await settle(page);
  await page.locator('#section-privacy').getByRole('button', { name: '导出', exact: true }).click();
  const sheet = dialog(page); await sheet.waitFor();
  assert.match(await sheet.textContent(), /导出本机统计快照的白名单字段|只导出合成统计/);
  assert.match(await sheet.getByRole('combobox', { name: '导出范围', exact: true }).textContent(), /全部历史/);
  assert.equal(await sheet.getByRole('checkbox', { name: '包含来源状态', exact: true }).getAttribute('aria-checked'), 'true');
  await page.keyboard.press('Escape'); await waitClosed(page);
}

async function aboutChecks(page) {
  await tab(page, '关于').click(); await settle(page);
  assert.match(await page.locator('[data-about-version]').innerText(), /\d+\.\d+/);
  await page.getByRole('button', { name: '查看 Agent 管理', exact: true }).click();
  await until(page, () => document.getElementById('main').dataset.currentView === 'sources');
  await page.evaluate(() => window.usageData.view('settings')); await settle(page);
}

runPageSmoke({
  view: 'settings', ready: '[data-settings-page]', output,
  dialogs: [
    { before: page => tab(page, '常规').click(), trigger: '[data-profile-summary] button', dialog: SHEET },
    { before: page => tab(page, '数据与安全').click(), trigger: '#section-privacy [data-setting-row] button >> nth=0', dialog: SHEET },
    { before: page => tab(page, '定价').click(), trigger: '[data-price-models] tbody tr[data-row-key]:first-child td:first-child button', dialog: SHEET },
  ],
  prepare: page => until(page, () => document.querySelectorAll('[data-price-models] tr[data-row-key]').length > 0),
  async assertPage(page) {
    assert.equal(await page.getByRole('tablist', { name: '设置分类' }).getByRole('tab').count(), 7);
    for (const name of ['常规', '账号与同步', '采集', '定价', '数据与安全', '关于']) assert.equal(await tab(page, name).count(), 1, 'category ' + name);
    for (const claim of ['不上传统计', '凭据由你决定', '只读来源', '用量采集不读取认证文件', '加密备份']) assert.match(await page.locator('[data-privacy]').textContent(), new RegExp(claim));
    assert.equal((await page.locator('[data-price-models]').textContent()).includes('—'), false, 'unknown rates read 未知, never a dash');
    assert.match(await page.locator('[data-pricing-summary]').textContent(), /的用量已定价/);
    if (flowsDone) return; flowsDone = true;
    await searchChecks(page); await categoryChecks(page); await profileChecks(page); await exportChecks(page); await aboutChecks(page);
  },
}).then(results => console.log('PASS: settings page — ' + JSON.stringify(results)))
  .catch(error => { console.error(error.stack); process.exitCode = 1; });
