'use strict';
/* global document, getComputedStyle, CompositionEvent */
// M1 review evidence: app-owned isolated stores and synthetic home only.
// Browser plugin not available; use the project's existing Playwright Electron harness.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch, setTheme, cleanRoomDiff, isolationViolations, semanticViolations } = require('./ui-smoke');
const { until, settle, showView } = require('./ui-settle');
const output = process.env.UI_KIT_EVIDENCE_DIR || 'artifacts/ui-mig/M1';
fs.mkdirSync(path.join(output, 'before'), { recursive: true });

async function mount(page) {
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'kitGalleryHost';
    Object.assign(host.style, { position: 'absolute', top: '0', left: '0', width: document.documentElement.clientWidth + 'px', zIndex: '20' });
    document.body.appendChild(host);
    window.kitReview = window.agentUi.mount('kit-gallery', host);
  });
  await page.locator('[data-kit-gallery]').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(1, 1); await settle(page);
}
async function unmount(page) {
  await page.evaluate(() => { window.kitReview.unmount(); document.getElementById('kitGalleryHost').remove(); window.scrollTo(0, 0); });
}
async function motionMode(page, mode) {
  await page.evaluate(value => { document.body.dataset.motion = value; }, mode);
  await page.waitForTimeout(100);
}
async function checks(page, label) {
  assert.deepEqual(await isolationViolations(page), [], label + ': legacy class isolation');
  assert.deepEqual(await semanticViolations(page), [], label + ': data semantics');
}
async function screenshot(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage });
}

const tick = page => page.evaluate(() => new Promise(resolve => setTimeout(resolve, 20)));
async function composing(page, start) {
  await page.evaluate(value => document.activeElement.dispatchEvent(new CompositionEvent(value ? 'compositionstart' : 'compositionend', { bubbles: true, data: '合' })), start);
  if (!start) { await tick(page); await page.keyboard.up('Shift'); }
}
const closed = selector => page => until(page, new Function('return !document.querySelector(' + JSON.stringify(selector) + ')'));

// M3k additions (docs/m2/UI-MIG-M1-M3-REVIEW-20261025.md section 3). Runs with motion off.
async function m3k(page, theme) {
  const shot = name => screenshot(page, 'm3k-' + name + '-' + theme);
  // Disabled segment and select.
  assert.equal(await page.locator('[data-case="segmented-disabled"]').getByRole('tab', { name: '定价', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('combobox', { name: '已禁用 Agent', exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '已禁用模型', exact: true }).isDisabled(), true);

  // Combobox: search filters label/description/value, keyboard picks, empty text, Escape and focus return.
  const combo = page.getByRole('button', { name: '合成模型', exact: true });
  await combo.click();
  const search = page.locator('[data-ui-portal] input[aria-label="搜索模型"]');
  await search.waitFor(); await until(page, () => document.activeElement?.getAttribute('aria-label') === '搜索模型');
  assert.equal(await page.locator('[data-ui-portal] [role="menuitemradio"]').count(), 24);
  await shot('combobox-open'); await checks(page, 'combobox');
  await page.keyboard.type('model-24');
  assert.equal(await page.locator('[data-ui-portal] [role="menuitemradio"]').count(), 1);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await closed('[data-ui-portal] [role="menu"]')(page);
  assert.equal(await page.locator('[data-combobox-result]').textContent(), 'provider/model-24');
  assert.match(await combo.textContent(), /合成模型 24/);
  await combo.click(); await search.waitFor(); await until(page, () => document.activeElement?.getAttribute('aria-label') === '搜索模型');
  await page.keyboard.type('手动价格');
  assert.equal(await page.locator('[data-ui-portal] [role="menuitemradio"]').count(), 8, 'description matches');
  await search.fill('不存在的模型');
  assert.equal(await page.locator('[data-ui-portal]').getByText('没有匹配的模型', { exact: true }).count(), 1);
  await shot('combobox-empty');
  // Composition keys stay with the input method.
  await composing(page, true); await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-ui-portal] [role="menu"]').count(), 1, 'IME Escape keeps the popup');
  await composing(page, false);
  await page.keyboard.press('Escape'); await closed('[data-ui-portal] [role="menu"]')(page);
  assert.equal(await combo.evaluate(element => document.activeElement === element), true, 'focus returns to the combobox');

  // Inside a Sheet, Escape closes only the popup.
  const sheetTrigger = page.getByRole('button', { name: '在弹窗中选择', exact: true });
  await sheetTrigger.click(); await page.locator('[data-ui-portal] [role="dialog"]').waitFor();
  await page.getByRole('button', { name: '弹窗合成模型', exact: true }).click();
  await page.locator('[data-ui-portal] [role="menu"]').waitFor(); await shot('combobox-sheet');
  await page.keyboard.press('Escape'); await closed('[data-ui-portal] [role="menu"]')(page);
  assert.equal(await page.locator('[data-ui-portal] [role="dialog"]').count(), 1, 'the sheet stays open');
  // Sheet Escape during composition does not close it.
  await composing(page, true); await page.keyboard.press('Escape'); await tick(page);
  assert.equal(await page.locator('[data-ui-portal] [role="dialog"]').count(), 1, 'IME Escape keeps the sheet');
  await composing(page, false);
  await page.keyboard.press('Escape'); await closed('[data-ui-portal] [role="dialog"]')(page);
  assert.equal(await sheetTrigger.evaluate(element => document.activeElement === element), true);

  // SearchField: length limit, Escape clears, IME Escape keeps the text.
  const limited = page.getByRole('textbox', { name: '限长搜索', exact: true });
  assert.equal(await limited.getAttribute('maxlength'), '60');
  await limited.fill('定价'); await limited.focus();
  await composing(page, true); await page.keyboard.press('Escape');
  assert.equal(await limited.inputValue(), '定价', 'IME Escape keeps the query');
  await composing(page, false); await page.keyboard.press('Escape');
  assert.equal(await limited.inputValue(), '');
  assert.equal(await limited.evaluate(element => document.activeElement === element), true);

  // Form: native validity, IME Enter, native attributes on TextField.
  const nameField = page.getByRole('textbox', { name: '名称（必填）', exact: true });
  assert.deepEqual(await nameField.evaluate(element => [element.required, element.maxLength, element.name]), [true, 48, 'name']);
  assert.deepEqual(await page.getByRole('spinbutton', { name: '每百万 Token 费率', exact: true }).evaluate(element => [element.min, element.max, element.step, element.inputMode]), ['0', '100000', 'any', 'decimal']);
  assert.equal(await page.getByRole('textbox', { name: '只读输入', exact: true }).evaluate(element => element.readOnly), true);
  assert.equal(await page.getByRole('textbox', { name: '禁用输入', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '提交合成表单', exact: true }).click();
  assert.equal(await page.locator('[data-form-result]').textContent(), '尚未提交', 'invalid form does not submit');
  assert.equal(await nameField.evaluate(element => element.matches(':invalid')), true);
  await nameField.fill('合成名'); await nameField.focus();
  await composing(page, true); await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-form-result]').textContent(), '尚未提交', 'IME Enter does not submit');
  await composing(page, false);
  await page.getByRole('spinbutton', { name: '每百万 Token 费率', exact: true }).fill('1.5');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-form-result]').textContent(), '已提交：合成名 / 1.5');

  // FileButton picks the same file twice.
  const fileInput = page.locator('[data-setting-row] input[type="file"]');
  for (let index = 0; index < 2; index++) await fileInput.setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) });
  assert.equal(await page.locator('[data-file-result]').textContent(), 'synthetic.png · 第 2 次选择');
  assert.equal(await fileInput.evaluate(element => element.value), '');

  // Avatar: three tones on the token gradient, initials announced, photo loads.
  const avatars = page.locator('[data-case="avatars"] [role="img"]');
  assert.equal(await avatars.count(), 9);
  assert.equal(await avatars.nth(3).evaluate(element => getComputedStyle(element).color), 'rgb(39, 91, 80)', 'teal initials colour');
  assert.equal(await avatars.nth(0).evaluate(element => getComputedStyle(element).backgroundImage.includes('linear-gradient')), true);
  assert.deepEqual(await avatars.evaluateAll(list => list.map(element => Math.round(element.getBoundingClientRect().width))), [24, 40, 64, 24, 40, 64, 24, 40, 64]);
  assert.equal(await page.locator('[data-case="avatars"] img[alt="合成照片头像"]').evaluate(image => image.complete && image.naturalWidth > 0), true);

  // Meter with motion off: the new width is there on the next frame.
  await page.getByRole('button', { name: '更新覆盖', exact: true }).click(); await tick(page);
  const share = await page.locator('[data-meter-segment="已计价"]').evaluate(element => element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width);
  assert.ok(Math.abs(share - 0.3) < 0.01, 'meter shows the final share at once, got ' + share);
  assert.equal(await page.locator('[data-case="meter"] [role="img"]').getAttribute('aria-label'), '合成覆盖：已计价、可补价格、用量缺失');
  await page.locator('[data-case="meter"]').screenshot({ path: path.join(output, 'm3k-meter-' + theme + '.png') });

  // ScrollArea: fades only where content continues, none while focused or without overflow,
  // and the wheel moves the page on at the end.
  const viewport = page.locator('[data-case="scroll-area"] [data-slot="scroll-area-viewport"]');
  const fade = () => viewport.evaluate(element => { const style = getComputedStyle(element); return [Number(style.getPropertyValue('--sf-start')), Number(style.getPropertyValue('--sf-end')), style.maskImage]; });
  await viewport.scrollIntoViewIfNeeded(); await viewport.evaluate(element => { element.scrollTop = 0; }); await tick(page);
  let [start, end] = await fade();
  assert.deepEqual([start, end], [1, 0], 'top: solid start, fading end');
  await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; }); await tick(page);
  [start, end] = await fade();
  assert.deepEqual([start, end], [0, 1], 'bottom: fading start, solid end');
  await page.locator('[data-case="scroll-area"]').screenshot({ path: path.join(output, 'm3k-scroll-' + theme + '.png') });
  await page.locator('[data-case="scroll-area"]').getByRole('button').last().focus();
  assert.equal((await fade())[2], 'none', 'no fade while focus is inside');
  const before = await page.evaluate(() => window.scrollY);
  const box = await viewport.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, 400);
  await until(page, new Function('return window.scrollY > ' + before));
  const short = page.locator('[data-case="scroll-short"] [data-slot="scroll-area-viewport"]');
  assert.deepEqual(await short.evaluate(element => { const style = getComputedStyle(element); return [Number(style.getPropertyValue('--sf-start')), Number(style.getPropertyValue('--sf-end'))]; }), [1, 1], 'no overflow, no fade');

  // DataTable: row click is a pointer shortcut, the inner button keeps its own action, titles stay.
  const table = page.locator('[data-case="table-rows"]');
  await table.locator('[data-row-key="b"] td').last().click();
  assert.equal(await page.locator('[data-row-result]').textContent(), '整行打开：合成模型 B');
  await table.getByRole('button', { name: '合成模型 A', exact: true }).click();
  assert.equal(await page.locator('[data-row-result]').textContent(), '按钮打开：合成模型 A');
  assert.equal(await table.locator('[data-row-key="b"] td').last().getAttribute('title'), '费率未知');
  assert.equal(await table.locator('th').last().getAttribute('title'), '每百万 Token 美元');
  assert.equal(await table.locator('[data-row-key="b"] [data-value="unknown"]').textContent(), '未定价');
  await checks(page, 'm3k ' + theme);
}

// MK-a additions: exact interfaces from the unified rulings, in both themes.
async function mka(page, theme) {
  const root = page.locator('[data-mka-gallery]'), shot = name => screenshot(page, 'mka-' + name + '-' + theme);
  const input = root.getByRole('textbox', { name: '提交输入', exact: true });
  const commits = () => root.locator('[data-mka-commits]').textContent().then(JSON.parse);
  await input.focus(); await input.fill('失焦提交'); await root.locator('input[type="password"]').focus();
  assert.deepEqual(await commits(), ['失焦提交']);
  await input.focus(); await input.fill('回车提交'); await input.press('Enter');
  assert.deepEqual(await commits(), ['失焦提交', '回车提交']);
  await root.locator('input[type="password"]').focus(); assert.equal((await commits()).length, 2, 'Enter then blur is one commit');
  await input.focus(); await input.fill('撤销草稿'); await input.press('Escape');
  assert.equal(await input.inputValue(), '回车提交');
  await root.locator('input[type="password"]').focus(); assert.equal((await commits()).length, 2, 'Escape does not commit the discarded draft');
  await input.focus(); await input.fill('输入法草稿'); await composing(page, true); await input.press('Enter'); await input.press('Escape');
  assert.equal((await commits()).length, 2); assert.equal(await input.inputValue(), '输入法草稿');
  await composing(page, false); await input.press('Escape');
  const secret = root.locator('input[type="password"]');
  assert.deepEqual(await secret.evaluate(e => [e.value, e.autocomplete, e.spellcheck, e.maxLength]), ['', 'new-password', false, 16384]);
  assert.equal(await root.getByRole('textbox', { name: '格式约束', exact: true }).getAttribute('pattern'), '[a-z]+');
  assert.equal(await root.getByRole('textbox', { name: '格式约束', exact: true }).evaluate(e => e.validity.patternMismatch), true);
  assert.equal(await input.getAttribute('autocomplete'), 'off'); assert.equal(await input.getAttribute('spellcheck'), 'false');
  await secret.fill('synthetic-secret'); assert.equal(await secret.getAttribute('type'), 'password');
  assert.equal(await root.getByRole('button', { name: /显示密码/ }).count(), 0);
  const sheetTrigger = root.getByRole('button', { name: '打开提交输入弹窗', exact: true }); await sheetTrigger.click();
  const sheetDraft = page.getByRole('textbox', { name: '弹窗草稿', exact: true }); await sheetDraft.waitFor(); await sheetDraft.fill('未提交的草稿');
  await composing(page, true); await sheetDraft.press('Escape'); assert.equal(await sheetDraft.inputValue(), '未提交的草稿');
  await composing(page, false); await sheetDraft.press('Escape');
  await until(page, () => !document.querySelector('[data-ui-portal] [role="dialog"]'));
  assert.equal(await sheetTrigger.evaluate(e => e === document.activeElement), true, 'restoring a field does not trap Escape inside the sheet');
  await sheetTrigger.click(); assert.equal(await sheetDraft.inputValue(), '焦点值');
  await page.keyboard.press('Escape'); await until(page, () => !document.querySelector('[data-ui-portal] [role="dialog"]'));
  await shot('fields');

  const area = root.getByRole('textbox', { name: '合成 JSON 过滤', exact: true });
  assert.deepEqual(await area.evaluate(e => [e.tagName, e.rows, e.maxLength, e.spellcheck]), ['TEXTAREA', 6, 4096, false]);
  assert.equal(await root.getByRole('textbox', { name: '三行说明', exact: true }).getAttribute('rows'), '3');
  assert.equal(await root.getByRole('textbox', { name: '禁用多行', exact: true }).isDisabled(), true);
  assert.equal(await root.getByRole('textbox', { name: '错误多行', exact: true }).getAttribute('aria-invalid'), 'true');
  await area.fill('第一行'); await area.press('End'); await area.press('Enter'); await area.press('a');
  assert.equal(await area.inputValue(), '第一行\na'); assert.equal(await root.locator('[data-mka-area-submits]').textContent(), '0');
  await composing(page, true); await area.press('Enter'); assert.equal(await root.locator('[data-mka-area-submits]').textContent(), '0'); await composing(page, false);
  await root.getByRole('button', { name: '提交多行表单', exact: true }).click(); assert.equal(await root.locator('[data-mka-area-submits]').textContent(), '1');
  await shot('textarea');
  for (const [label, searchName, value, result, customText] of [
    ['自由字段', '输入自定义字段', '  custom.path  ', '[data-mka-custom]', '使用 “  custom.path  ”'],
    ['自由路径', '输入新路径', 'records.value', '[data-mka-custom-label]', '采用路径：records.value'],
  ]) {
    await root.getByRole('button', { name: label, exact: true }).click();
    const search = page.locator('[data-ui-portal] input[aria-label="' + searchName + '"]'); await search.fill(value);
    const choice = page.locator('[data-ui-portal] [role="menuitemradio"]').first(); assert.equal(await choice.getAttribute('aria-label'), customText);
    await shot('custom-' + label); await search.press('ArrowDown'); await page.keyboard.press('Enter');
    await until(page, () => !document.querySelector('[data-ui-portal] [role="menu"]'));
    assert.equal(await root.locator(result).textContent(), value, 'custom choice retains the original text');
  }
  const disclosure = root.getByRole('button', { name: '独立动作的项目', exact: true });
  await root.getByRole('button', { name: '项目独立动作', exact: true }).click();
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false'); assert.equal(await root.locator('[data-mka-actions]').textContent(), '1');
  assert.equal(await root.getByRole('button', { name: '项目独立动作', exact: true }).evaluate(e => e.parentElement.closest('button') === null), true);
  await disclosure.press('Enter'); assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
  await shot('disclosure-actions');
  for (const label of ['图标 Agent 筛选', '名称 Agent 筛选']) {
    const group = root.getByRole('radiogroup', { name: label, exact: true }), geometry = () => group.getByRole('radio').evaluateAll(es => es.map(e => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight]));
    const before = await geometry();
    await group.getByRole('radio').first().focus(); await page.keyboard.press('End');
    assert.equal(await group.getByRole('radio', { name: 'Gemini CLI', exact: true }).getAttribute('aria-checked'), 'true', 'unrecorded Agent remains selectable');
    assert.deepEqual(await geometry(), before, 'selection does not change layout');
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
    assert.equal(await group.getByRole('radio', { name: 'Codex', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await group.getByRole('radio', { name: 'Codex', exact: true }).getAttribute('title'), 'Codex');
    await composing(page, true); await page.keyboard.press('End'); assert.equal(await group.getByRole('radio', { name: 'Codex', exact: true }).getAttribute('aria-checked'), 'true'); await composing(page, false);
    assert(await group.evaluate(e => { const a = e.querySelector('[aria-checked="true"]').getBoundingClientRect(), b = e.querySelector('[data-agent-indicator]').getBoundingClientRect(); return ['x','y','width','height'].every(key => Math.abs(a[key] - b[key]) <= 1); }), 'indicator aligns within one px');
  }
  const copy = root.getByRole('button', { name: '复制合成路径', exact: true }), copyState = copy.locator('xpath=ancestor::*[@data-copy-state][1]');
  await copy.click(); await until(page, () => document.querySelector('[data-mka-gallery] [data-copy-state="copied"]'));
  assert.equal(await copyState.getAttribute('data-copy-state'), 'copied'); await shot('copied');
  await until(page, () => !document.querySelector('[data-mka-gallery] [data-copy-state="copied"]'), 3000);
  await root.getByRole('button', { name: '切换复制失败', exact: true }).click(); await copy.click();
  await until(page, () => document.querySelector('[data-mka-copy-count]').textContent === '2');
  assert.equal(await copyState.getAttribute('data-copy-state'), 'idle', 'failure never shows a check');
  const delayed = root.getByRole('button', { name: '延迟复制合成值', exact: true }); await delayed.click(); assert.equal(await delayed.isDisabled(), true);
  await until(page, () => !document.querySelector('[aria-label="延迟复制合成值"]').disabled);
  const dot = root.locator('[data-status-dot]'); assert.equal(await dot.getAttribute('title'), '合成活跃会话');
  assert.deepEqual(await dot.evaluate(e => [e.getBoundingClientRect().width, e.getBoundingClientRect().height, e.getAnimations().length]), [8,8,0]);
  const unknown = root.getByRole('group', { name: '未知额度条', exact: true });
  assert.equal(await unknown.getAttribute('aria-valuetext'), '未知'); assert.equal(await unknown.locator('[data-stack-key]').count(), 0);
  assert.equal(await root.getByRole('group', { name: '明确为零的额度条', exact: true }).getAttribute('data-unknown'), null);
  assert.equal(await root.getByRole('group', { name: '会话消耗条', exact: true }).getAttribute('width'), '44');
  assert.equal(await root.getByRole('group', { name: '分段额度条', exact: true }).locator('clipPath rect').count(), 16);
  assert.equal(await unknown.locator('clipPath rect').count(), 30);
  assert.equal(await root.locator('[data-stack-marker="fee"]').count(), 1); assert.equal(await root.locator('[data-stack-marker="today"]').count(), 1);
  const mix = root.getByRole('group', { name: '费用上下界构成条', exact: true });
  assert.match(await mix.locator('[data-stack-key="range"]').evaluate(e => getComputedStyle(e).fill), /url\(/, 'hatch is the painted fill, not overridden by a colour class');
  assert.equal(await mix.locator('[data-stack-key="light"]').evaluate(e => getComputedStyle(e).fillOpacity), '0.35');
  await mix.locator('[data-stack-key]').first().focus(); await page.keyboard.press('ArrowRight'); assert.equal(await mix.getAttribute('data-active'), 'range');
  await page.keyboard.press('Escape'); assert.equal(await mix.getAttribute('data-active'), null);
  for (const mode of ['reduced', 'off']) {
    await motionMode(page, mode); await root.getByRole('button', { name: '更新合成进度', exact: true }).click();
    const bar = root.getByRole('group', { name: '合成安装进度条', exact: true });
    assert(await bar.evaluate(e => { const r = e.querySelector('[data-stack-key]'); return Math.abs(r.getBBox().width - Number(r.dataset.fraction) * e.viewBox.baseVal.width) < .01; }), mode + ': geometry immediately final');
    assert.equal(await bar.getAttribute('data-ready'), 'true'); assert.equal(await bar.evaluate(e => e.getAnimations({ subtree: true }).length), 0);
    await shot('stacks-' + mode);
  }
  await motionMode(page, 'full');
  const filter = root.getByRole('radiogroup', { name: '名称 Agent 筛选', exact: true });
  await filter.getByRole('radio', { name: 'Gemini CLI', exact: true }).click();
  await filter.getByRole('radio', { name: 'Claude Code', exact: true }).click();
  await until(page, () => { const group = document.querySelector('[aria-label="名称 Agent 筛选"]'), a = group.querySelector('[aria-checked="true"]').getBoundingClientRect(), b = group.querySelector('[data-agent-indicator]').getBoundingClientRect(); return ['x','y','width','height'].every(key => Math.abs(a[key] - b[key]) <= 1); });
  assert.equal(await filter.getByRole('radio', { name: 'Claude Code', exact: true }).getAttribute('aria-checked'), 'true', 'interrupted indicator settles at the new target');
  const progress = root.getByRole('group', { name: '合成安装进度条', exact: true });
  await progress.scrollIntoViewIfNeeded(); await root.getByRole('button', { name: '更新合成进度', exact: true }).click();
  await page.waitForTimeout(60); await root.getByRole('button', { name: '更新合成进度', exact: true }).click();
  await until(page, () => { const e = document.querySelector('[aria-label="合成安装进度条"]'), r = e.querySelector('[data-stack-key]'); return e.dataset.ready === 'true' && Math.abs(r.getBBox().width - Number(r.dataset.fraction) * e.viewBox.baseVal.width) < .01; });
  await shot('retarget');
  assert.equal(await root.getByRole('button', { name: '复制合成路径', exact: true }).evaluate(e => e.getBoundingClientRect().height), 36);
  assert.equal(await root.getByRole('button', { name: '复制紧凑合成路径', exact: true }).evaluate(e => e.getBoundingClientRect().height), 28);
  await motionMode(page, 'off'); await checks(page, 'MK-a ' + theme);
}

(async () => {
  const session = await launch(), { app, page, errors } = session;
  const results = { viewport: [1280, 900], synthetic: true, themes: [], errors };
  try {
    await showView(page, 'usage');
    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme); await motionMode(page, 'off'); await settle(page);
      await screenshot(page, 'before/usage-' + theme);
      await mount(page);
      // The initial IO delivery can intersect below its threshold: do not enter at 2/18 px.
      await motionMode(page, 'full');
      await page.evaluate(() => { const e = document.querySelector('[aria-label="合成安装进度条"]'); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - window.innerHeight + 2); });
      await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
      assert.equal(await page.getByRole('group', { name: '合成安装进度条', exact: true }).evaluate(e => e.querySelector('[data-stack-key]').getBBox().width), 0, 'below 25% stays at the entrance baseline');
      await page.evaluate(() => { const e = document.querySelector('[aria-label="合成安装进度条"]'); window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY - window.innerHeight + 12); });
      await until(page, () => document.querySelector('[aria-label="合成安装进度条"]')?.dataset.ready === 'true');
      await motionMode(page, 'off'); await page.evaluate(() => window.scrollTo(0,0));
      await checks(page, theme + ' default');
      const hostWidth = await page.locator('#kitGalleryHost').evaluate(element => element.getBoundingClientRect().width);
      // The two new EdgeTriggers own the first/last 24px of the window. Keep
      // both rooms in their resting state; (1,1) now intentionally reveals one.
      await page.mouse.move(hostWidth / 2, 1);
      await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
      const diff = await cleanRoomDiff(app, page, { island: 'kit-gallery', rootSelector: '#kitGalleryHost', width: hostWidth, dark: theme === 'dark', motion: 'off' });
      fs.writeFileSync(path.join(output, 'clean-room-' + theme + '.json'), JSON.stringify(diff, null, 2));
      assert.deepEqual(diff, [], 'every gallery element matches a room without legacy CSS: ' + theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal overflow');
      assert.equal(await page.locator('[data-ui-portal] [role="status"]').textContent(), '', 'new gallery has no stale toast');
      assert.equal(await page.locator('[data-case="values"] [data-value="unknown"]').count(), 3);
      assert.deepEqual(await page.locator('[data-case="values"] [data-value="unknown"]').allTextContents(), ['未知', '未知', '未定价']);
      assert.equal(await page.locator('[data-case="values"]').getByText('0.10000000000000000001', { exact: true }).count(), 1);
      assert.equal(await page.locator('[data-case="values"]').getByText('至多 12.34', { exact: true }).count(), 1);
      assert.equal(await page.locator('[data-kit-gallery] img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true, 'official agent assets load');
      const defaults = page.locator('[data-case="button-secondary"] button');
      assert.equal(await defaults.nth(0).evaluate(element => element.getBoundingClientRect().height), 36);
      assert.equal(await defaults.nth(3).evaluate(element => element.getBoundingClientRect().height), 28);
      assert.equal(await defaults.nth(1).isDisabled(), true);
      assert.equal(await defaults.nth(2).getAttribute('aria-busy'), 'true');
      await screenshot(page, 'gallery-' + theme, true);
      await screenshot(page, 'viewport-' + theme);

      const range = page.getByRole('tablist', { name: '默认范围', exact: true });
      await range.getByRole('tab', { name: '今日', exact: true }).click();
      await range.getByRole('tab', { name: '今日', exact: true }).press('ArrowRight');
      await until(page, () => [...document.querySelectorAll('[aria-label="默认范围"] [role="tab"]')].some(e => e.textContent.includes('7 天') && e.getAttribute('aria-selected') === 'true'));
      assert.equal(await range.getByRole('tab', { name: '7 天', exact: true }).getAttribute('aria-selected'), 'true');
      const checkbox = page.getByRole('checkbox', { name: 'Gemini CLI', exact: true }).first();
      await checkbox.press('Space'); assert.equal(await checkbox.getAttribute('aria-checked'), 'true');
      const disabledCheckbox = page.getByRole('checkbox', { name: 'Gemini CLI', exact: true }).last();
      await disabledCheckbox.press('Space'); assert.equal(await disabledCheckbox.getAttribute('aria-checked'), 'false');
      assert.equal(await disabledCheckbox.getAttribute('tabindex'), '-1');
      const radio = page.getByRole('radio', { name: 'Codex', exact: true }).first();
      await radio.press('Space'); assert.equal(await radio.getAttribute('aria-checked'), 'true');
      assert.equal(await page.getByRole('radio', { name: 'Codex', exact: true }).last().getAttribute('tabindex'), '-1');
      const slider = page.getByRole('slider', { name: '合成阈值', exact: true });
      await slider.press('ArrowRight'); assert.equal(await slider.getAttribute('aria-valuenow'), '50');
      const text = page.getByRole('textbox', { name: '示例名称', exact: true });
      await text.fill('已编辑的合成内容'); assert.equal(await text.inputValue(), '已编辑的合成内容');
      const listRow = page.getByRole('button', { name: /选中行/ });
      await listRow.press('Enter'); assert.equal(await listRow.getAttribute('aria-pressed'), 'true');
      await page.locator('section').filter({ has: page.getByRole('heading', { name: '翻页圆点 CarouselDots', exact: true }) }).getByRole('button', { name: '余额', exact: true }).click();
      assert.equal(await page.getByText('当前页：余额', { exact: true }).count(), 1);

      // Every single-choice popup opens, portals, chooses by keyboard, and restores focus.
      for (const name of ['default', 'compact', 'placeholder']) {
        const trigger = page.locator('[data-case="select-' + name + '"] [role="combobox"]');
        await trigger.click();
        await page.locator('[data-ui-portal] [role="option"]').first().waitFor();
        await screenshot(page, 'select-' + name + '-' + theme);
        await checks(page, 'select ' + name);
        await page.keyboard.press('Escape');
        await until(page, () => !document.querySelector('[data-ui-portal] [role="listbox"]'));
        assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
      }
      const defaultSelect = page.getByRole('combobox', { name: '默认 Agent', exact: true });
      await defaultSelect.click();
      await page.locator('[data-ui-portal] [role="option"]').filter({ hasText: 'Gemini CLI' }).click();
      assert.match(await defaultSelect.textContent(), /Gemini CLI/);

      for (const triggerName of ['打开操作菜单', '更多合成操作']) {
        const trigger = page.getByRole('button', { name: triggerName, exact: true });
        await trigger.click(); await page.locator('[data-ui-portal] [role="menu"]').waitFor();
        await screenshot(page, 'menu-' + (triggerName === '打开操作菜单' ? 'button' : 'icon') + '-' + theme);
        if (triggerName === '打开操作菜单') {
          const danger = page.getByRole('menuitem', { name: '断开合成连接', exact: true });
          assert.equal(await danger.evaluate(element => getComputedStyle(element).color === getComputedStyle(element.querySelector('span span:last-child')).color), true, 'danger tone reaches the visible menu label');
        }
        await checks(page, 'menu'); await page.keyboard.press('Escape');
        await until(page, () => !document.querySelector('[data-ui-portal] [role="menu"]'));
        assert.equal(await trigger.evaluate(element => document.activeElement === element), true);
      }
      await page.getByRole('button', { name: '打开操作菜单', exact: true }).click();
      assert.equal(await page.getByRole('menuitem', { name: '不可用操作', exact: true }).getAttribute('aria-disabled'), 'true');
      await page.getByRole('menuitem', { name: '查看合成记录', exact: true }).click();
      assert.equal(await page.locator('[data-menu-result]').textContent(), '已查看合成记录');

      for (const size of ['sm', 'lg', 'xl']) {
        const trigger = page.getByRole('button', { name: '打开 ' + size + ' 弹窗', exact: true });
        await trigger.click(); const dialog = page.locator('[data-ui-portal] [role="dialog"]');
        await dialog.waitFor();
        await until(page, () => document.querySelector('[data-ui-portal] [role="dialog"]')?.contains(document.activeElement));
        await screenshot(page, 'sheet-' + size + '-' + theme);
        assert.equal(Math.round(await dialog.evaluate(element => element.getBoundingClientRect().width)), { sm: 400, lg: 540, xl: 880 }[size]);
        await page.keyboard.press('Tab');
        assert.equal(await dialog.evaluate(element => element.contains(document.activeElement)), true);
        await checks(page, 'sheet'); await page.keyboard.press('Escape');
        await until(page, () => !document.querySelector('[data-ui-portal] [role="dialog"]'));
        assert.equal(await trigger.evaluate(element => document.activeElement === element), true, 'sheet restores focus');
      }
      await page.getByRole('button', { name: '清空搜索', exact: true }).click();
      assert.equal(await page.getByRole('textbox', { name: '合成搜索', exact: true }).inputValue(), '');
      assert.equal(await page.getByRole('textbox', { name: '合成搜索', exact: true }).evaluate(element => document.activeElement === element), true);
      const disclosure = page.getByRole('button', { name: '展开合成详情', exact: true });
      await disclosure.click(); assert.equal(await disclosure.getAttribute('aria-expanded'), 'true');
      await screenshot(page, 'disclosure-' + theme);
      await disclosure.press('Enter'); assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
      const switchControl = page.getByRole('switch', { name: '开启示例', exact: true });
      await switchControl.press('Space'); assert.equal(await switchControl.getAttribute('aria-checked'), 'false');

      for (const tone of ['info', 'warn', 'error']) await page.locator('[data-case="banner-' + tone + '"]').screenshot({ path: path.join(output, 'banner-' + tone + '-' + theme + '.png') });
      for (const [label, expected, name] of [['显示普通提示', '合成操作已保存', 'neutral'], ['显示警示提示', '合成窗口已用尽', 'warn']]) {
        await page.getByRole('button', { name: label, exact: true }).click();
        await until(page, () => document.querySelector('[data-ui-portal] [role="status"]')?.children.length === 1);
        assert.equal(await page.locator('[data-ui-portal] [role="status"]').textContent(), expected);
        await screenshot(page, 'toast-' + name + '-' + theme);
      }
      // A message leaves on its own after 4.5 s, like the legacy toast.
      const shownAt = Date.now();
      await until(page, () => document.querySelector('[data-ui-portal] [role="status"]')?.children.length === 0, 8000);
      const shownFor = Date.now() - shownAt;
      assert.ok(shownFor > 3500 && shownFor < 7000, 'toast hides after about 4.5 s, took ' + shownFor);
      await m3k(page, theme);
      await mka(page, theme);
      // Full/reduced/off: changed values settle, including a digit-count change.
      for (const mode of ['full', 'reduced', 'off']) {
        await motionMode(page, mode); await page.getByRole('button', { name: '更新同位数', exact: true }).click();
        await page.waitForTimeout(1000);
        await screenshot(page, 'figures-' + mode + '-' + theme);
        await page.getByRole('button', { name: '更新位数', exact: true }).click();
        await page.waitForTimeout(1000);
        await screenshot(page, 'figure-length-' + mode + '-' + theme);
        if (mode !== 'full') assert.match(await page.locator('[data-case="figures"]').textContent(), /^12\.34/);
      }
      await checks(page, theme + ' final'); await screenshot(page, 'motion-off-' + theme, true);
      results.themes.push(theme); await unmount(page);
    }
    assert.deepEqual(errors, [], 'no console or page errors including CSP');
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log('PASS: kit gallery — both themes, clean room, semantics, controls, popups, keyboard/focus, motion and screenshots.');
  } catch (error) {
    await screenshot(page, 'failure').catch(() => {});
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, errors }, null, 2));
    throw error;
  } finally { await session.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
