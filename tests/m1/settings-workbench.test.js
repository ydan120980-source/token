'use strict';
// The settings page lives on the React layer since M3 (docs/m2/UI-MIG-M3-20261025.md). These checks
// keep what the legacy-page test guarded: the route and its entry points, the five sections, the
// privacy statements and no resurrected controls. Behaviour is covered by settings-smoke-ui-test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DESIGN = path.resolve(__dirname, '../../design/desktop-reference');
const PAGE = path.resolve(__dirname, '../../ui/src/pages/settings');
const html = fs.readFileSync(path.join(DESIGN, 'index.html'), 'utf8');
const source = name => fs.readFileSync(path.join(PAGE, name), 'utf8');

test('the settings route is a direct App child and keeps its export entry points', () => {
  const app = fs.readFileSync(path.resolve(__dirname, '../../ui/src/app.tsx'), 'utf8');
  assert.match(html, /<div id="app" data-app-root><\/div>/);
  assert.match(app, /<section id="settings"[^\n]*<Settings \/>/);
  const usage = fs.readFileSync(path.resolve(__dirname, '../../ui/src/pages/usage/index.tsx'), 'utf8');
  const host = fs.readFileSync(path.join(DESIGN, 'preview.js'), 'utf8');
  assert.match(usage, /label="导出统计"[^\n]*onClick=\{host.export\}/, 'the usage control keeps its export action');
  assert.match(host, /export: \(\) => window.settingsUi\?\.openExport\(\)/, 'usage opens the same shared settings export');
  for (const id of ['settingsProfile', 'settingsPause', 'usageInterval', 'themeSelect', 'demoState', 'usageMaintenance', 'settingsSearch', 'profileDialog', 'exportDialog', 'priceEditor']) {
    assert.equal(html.includes('id="' + id + '"'), false, id + ' left with the legacy page');
  }
  assert.equal(/usageClear|settingsNotice/.test(html), false, 'Must not reference retired settings controls');
  assert.doesNotMatch(html, /islands\.js|data-island-host/);
});

test('the page has the five categories and sections', () => {
  const page = source('index.tsx');
  for (const [name, label] of [['general', '常规'], ['collection', '采集'], ['pricing', '定价'], ['privacy', '数据与安全'], ['about', '关于']]) assert.ok(page.includes('value: "' + name + '", label: "' + label + '"'), 'category ' + name);
  assert.ok(page.includes('aria-label="设置分类"'));
  for (const [file, name] of [['general.tsx', 'general'], ['collection.tsx', 'collection'], ['pricing/section.tsx', 'pricing'], ['privacy.tsx', 'privacy'], ['about.tsx', 'about']]) assert.ok(source(file).includes('<Section name="' + name + '"'), name + ' section');
});

test('the privacy statements match docs/PRIVACY.md and never claim the app is offline', () => {
  const privacy = source('privacy.tsx');
  // No statistics upload, credentials only on an explicit reuse/connection, configuration changes
  // only through previewed, backed-up management (UI-PRIVACY-COPY-20261025.md).
  for (const claim of ['不上传统计', 'models.dev', '用量采集不读取认证文件', '复用客户端登录', 'Windows 加密保存', '只读来源', '加密备份']) assert.ok(privacy.includes(claim), 'Missing privacy statement: ' + claim);
  assert.equal(/零外发|严格免疫|离线隐私承诺/.test(privacy), false, 'Privacy copy must not claim the app is offline');
});

test('the retired legacy settings files are gone and not served', () => {
  const serve = fs.readFileSync(path.join(DESIGN, 'serve.js'), 'utf8'), layers = fs.readFileSync(path.join(DESIGN, 'ui/agent-ui.css'), 'utf8');
  for (const file of ['settings.css', 'settings-ui.js']) {
    assert.equal(fs.existsSync(path.join(DESIGN, file)), false, file + ' was retired');
    assert.equal(serve.includes("'" + file + "'") || layers.includes(file), false, file + ' is no longer served');
  }
});
