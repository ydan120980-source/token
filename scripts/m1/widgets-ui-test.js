'use strict';
/* global document */
// The widget board on 概览 and the per-page summary column (owner 2026-10-29, docs/m2/UI-POLISH-M10-20261029.md;
// widgets from docs/m2/UI-PALETTE-QUOTA-SUMMARY-PROPOSAL-20261027.md section 4): each page's fixed summary
// but settings, the default board layout, edit mode (reorder by keyboard, size, remove), the library, one
// widget's settings, the title bar readout, click-to-expand rows, saved layouts across a reload and the
// settings card. Synthetic fixture home and isolated stores only.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { launch, setTheme, isolationViolations, semanticViolations } = require('./ui-smoke');
const { showView, settle, until } = require('./ui-settle');
const output = process.env.WIDGETS_EVIDENCE_DIR || 'artifacts/ui-widgets';
const SIDEBAR = '#quota [data-widget-board]', SHEET = '[data-ui-portal] [role="dialog"]';
const types = page => page.$$eval(SIDEBAR + ' [data-widget]', nodes => nodes.map(node => node.dataset.widget));
const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('agentusage.widgets.v1') || 'null'));

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const session = await launch({ size: [1440, 900] }), { page, errors } = session;
  try {
    await page.evaluate(() => localStorage.removeItem('agentusage.widgets.v1'));
    await page.reload(); await page.waitForFunction(() => document.readyState === 'complete' && Boolean(window.agentUi));
    for (const view of ['usage', 'cost', 'sessions', 'sources', 'quota']) {
      await showView(page, view); await page.locator('#summaryPanel [data-page-summary="' + view + '"] [data-summary-card]').first().waitFor();
      assert.equal(await page.locator('#summaryPanel').isVisible(), true, view + ' shows its summary column');
    }
    await page.locator(SIDEBAR).waitFor();
    assert.deepEqual(await types(page), ['quota.windows', 'usage.today', 'cost.daily', 'usage.week'], 'owner-approved default layout');
    await showView(page, 'settings'); await settle(page);
    assert.equal(await page.locator('#summaryPanel').isVisible(), false, 'settings has no summary column');
    await showView(page, 'quota'); await page.locator(SIDEBAR).waitFor();

    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme); await settle(page);
      assert.deepEqual(await isolationViolations(page), []);
      assert.deepEqual(await semanticViolations(page), []);
      // Unpriced and unknown never read as zero inside widgets.
      assert.equal(await page.locator(SIDEBAR).evaluate(element => /未计价\s*\$0|\$0\.00\s*未/.test(element.textContent)), false);
      await page.screenshot({ path: path.join(output, 'usage-' + theme + '.png') });
    }
    await setTheme(page, 'light');

    // A row with sub-rows opens in place.
    const row = page.locator(SIDEBAR + ' [data-widget="usage.today"] button[data-widget-row]').first();
    assert.equal(await row.getAttribute('aria-expanded'), 'false'); await row.click(); await settle(page);
    assert.equal(await row.getAttribute('aria-expanded'), 'true');

    // Edit mode: keyboard reorder, size, remove.
    await page.locator(SIDEBAR + ' header').getByRole('button', { name: '编辑', exact: true }).click();
    await page.locator(SIDEBAR + ' [data-widget-tools]').first().waitFor();
    const first = page.locator(SIDEBAR + ' [role="listitem"][aria-label="额度窗口"]');
    await first.focus(); await page.keyboard.press('Alt+ArrowDown'); await settle(page);
    assert.deepEqual(await types(page), ['usage.today', 'quota.windows', 'cost.daily', 'usage.week'], 'Alt+↓ moves a widget down');
    await page.locator(SIDEBAR + ' [data-widget-slot="w1"]').getByRole('button', { name: '尺寸大', exact: true }).click(); await settle(page);
    assert.equal((await saved(page)).layouts[0].widgets.find(item => item.key === 'w1').size, 'l');
    await page.locator(SIDEBAR + ' [data-widget-slot="w3"]').getByRole('button', { name: '移除每天花费', exact: true }).click(); await settle(page);
    assert.deepEqual(await types(page), ['usage.today', 'quota.windows', 'usage.week']);
    await page.screenshot({ path: path.join(output, 'edit.png') });

    // The library adds a widget at the end; its previews are inert.
    await page.locator(SIDEBAR + ' [data-widget-add]').click(); await page.locator(SHEET).waitFor();
    assert.equal(await page.locator(SHEET + ' [data-gallery-type] [inert]').count() > 0, true);
    await page.locator(SHEET + ' [data-gallery-type="agents.graph"]').getByRole('button', { name: '添加', exact: true }).click(); await settle(page);
    await page.screenshot({ path: path.join(output, 'gallery.png') });
    await page.keyboard.press('Escape'); await until(page, () => !document.querySelector('[data-ui-portal] [role="dialog"]'));
    assert.equal((await types(page)).at(-1), 'agents.graph');

    // One widget's settings: inverted background and the title bar readout.
    await page.locator(SIDEBAR + ' [data-widget-slot="w1"]').getByRole('button', { name: '设置额度窗口', exact: true }).click(); await page.locator(SHEET).waitFor();
    await page.locator(SHEET).getByRole('tab', { name: '反色', exact: true }).or(page.locator(SHEET).getByRole('radio', { name: '反色', exact: true })).first().click();
    await page.locator(SHEET).getByRole('switch', { name: '在标题栏显示读数', exact: true }).click(); await settle(page);
    assert.equal(await page.locator(SIDEBAR + ' [data-widget="quota.windows"]').getAttribute('data-widget-bg'), 'inv');
    await page.screenshot({ path: path.join(output, 'settings-sheet.png') });
    await page.keyboard.press('Escape'); await until(page, () => !document.querySelector('[data-ui-portal] [role="dialog"]'));
    // The readout is saved; the title bar shows it only when that widget has an account to read.
    assert.equal((await saved(page)).layouts[0].widgets.find(item => item.key === 'w1').readout, true);
    const accounts = await page.locator(SIDEBAR + ' [data-widget="quota.windows"] [data-widget-account]').count();
    if (accounts) await page.locator('.titlebar-readout [data-title-readout]').waitFor();
    else assert.equal(await page.locator('.titlebar-readout [data-title-readout]').count(), 0, 'no readout without a quota account');
    await page.locator(SIDEBAR + ' header').getByRole('button', { name: '完成', exact: true }).click();

    // Saved in this window's storage and restored after a reload.
    const before = await types(page);
    await page.reload(); await page.waitForFunction(() => document.readyState === 'complete' && Boolean(window.agentUi));
    await showView(page, 'quota'); await page.locator(SIDEBAR).waitFor();
    assert.deepEqual(await types(page), before, 'layout survives a reload');
    assert.equal(await page.locator(SIDEBAR + ' [data-widget="quota.windows"]').getAttribute('data-widget-bg'), 'inv');

    // Settings › 常规 › 小组件: a second layout, switching from the column.
    await showView(page, 'settings'); await page.getByRole('tablist', { name: '设置分类' }).getByRole('tab', { name: '常规', exact: true }).click();
    const layouts = page.locator('[data-widget-layouts]'); await layouts.waitFor();
    await layouts.getByRole('button', { name: '复制当前布局', exact: true }).click(); await page.locator(SHEET).waitFor();
    await page.locator(SHEET).getByRole('textbox', { name: '名字', exact: true }).fill('专注');
    await page.locator(SHEET).getByRole('button', { name: '复制当前布局', exact: true }).click(); await until(page, () => !document.querySelector('[data-ui-portal] [role="dialog"]'));
    assert.equal((await saved(page)).layouts.length, 2);
    await layouts.getByRole('button', { name: '恢复', exact: true }).click(); await settle(page);
    await showView(page, 'quota'); await page.locator(SIDEBAR).waitFor();
    assert.deepEqual(await types(page), ['quota.windows', 'usage.today', 'cost.daily', 'usage.week'], 'reset restores the default in the new layout');
    await page.locator(SIDEBAR + ' header [aria-label="小组件布局"]').waitFor();
    await page.screenshot({ path: path.join(output, 'layouts.png') });

    assert.deepEqual(errors, [], 'no renderer errors');
    process.stdout.write('PASS: per-page summary column, widget board on 概览, default layout, edit, library, settings, readout, saved layouts.\n');
  } finally { await session.close(); }
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
