'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pricing = require('../../design/desktop-reference/pricing-data');
const view = require('../../design/desktop-reference/pricing-view');
const ROOT = path.join(__dirname, '..', '..');
const DESIGN = path.join(ROOT, 'design', 'desktop-reference');
const row = (provider, model, rates, origin) => ({ provider, model, rates, origin });

test('pricing data marks which origins are actually priced and which are estimates', () => {
  assert.equal(pricing.scope(row('openai', 'gpt-4.1', { inputUncached: 2, output: 8 }, 'official-current-standard')), 'priced');
  assert.equal(pricing.scope(row('openai', 'gpt-4.1', { inputUncached: 2, output: 8 }, 'manual')), 'priced');
  assert.equal(pricing.scope(row('anthropic', 'claude-sonnet-4-5', { inputUncached: 3, output: 15 }, 'reference-unverified')), 'unverified');
  assert.equal(pricing.scope(row('zai', 'glm-4.6', {}, 'unpriced')), 'unpriced');
  assert.equal(pricing.scope(row('vendor', 'unknown-model', {}, 'brand-new-tier')), 'unpriced');
  assert.equal(pricing.isOfficial(row('openai', 'gpt-4.1', {}, 'official-thirdparty-unverified')), true);
  assert.equal(pricing.isOfficial(row('openai', 'gpt-4.1', {}, 'manual')), false);
});

test('pricing data filters and groups without losing or duplicating models', () => {
  const models = [
    row('openai', 'gpt-4.1', { inputUncached: 2, output: 8 }, 'official-current-standard'),
    row('openai', 'gpt-6.1-sol', { inputUncached: 5, output: 30 }, 'official-current-standard'),
    row('openai', 'mystery', {}, 'unpriced'),
    row('anthropic', 'claude-sonnet-4-5', { inputUncached: 3, output: 15 }, 'reference-unverified')
  ];
  assert.equal(pricing.filter(models, {}).length, 4);
  assert.equal(pricing.filter(models, { scope: 'priced' }).length, 2);
  assert.equal(pricing.filter(models, { scope: 'unverified' }).length, 1);
  assert.equal(pricing.filter(models, { scope: 'unpriced' }).length, 1);
  assert.equal(pricing.filter(models, { query: 'GPT-4.1' }).length, 1, 'the search is case-insensitive');
  assert.equal(pricing.filter(models, { query: 'mimo' }).length, 0);
  const groups = pricing.groups(models, {});
  assert.deepEqual(groups.map(group => group.provider), ['anthropic', 'openai'], 'providers are ordered and stable');
  assert.equal(groups.reduce((sum, group) => sum + group.rows.length, 0), 4);
  const openai = groups.find(group => group.provider === 'openai');
  assert.equal(openai.unpriced, 1); assert.equal(openai.unverified, 0);
});

test('pricing gaps report the collected records that fell back, not just absent models', () => {
  const gaps = pricing.gaps([
    { provider: 'openai', model: 'gpt-4.1', records: 2, pricingReasons: { exact: 2 } },
    { provider: 'openai', model: 'ghost', records: 3, pricingReasons: { 'model-unpriced': 3 } },
    { provider: 'anthropic', model: 'claude-sonnet-4-5', records: 1, pricingReasons: { 'price-unverified': 1, exact: 0 } }
  ]);
  assert.equal(gaps.records, 6);
  assert.deepEqual(gaps.reasons.map(entry => entry.reason), ['model-unpriced', 'price-unverified'], 'largest gap first, exact excluded');
  assert.equal(gaps.reasons[0].label, '模型 / provider 无规则');
  assert.deepEqual(gaps.unpriced, [{ key: 'openai/ghost', count: 3 }]);
  assert.equal(pricing.gaps([]).records, 0);
});

test('probe text states impact, current basis and the dry-run result', () => {
  const text = pricing.probeText({ affectedRecords: 12, affectedTokens: 3400, previous: { inputUncached: 2, output: 8 }, origin: 'official-current-standard', sample: { reason: 'exact', lower: 0.0102, upper: 0.0102 } });
  assert.match(text, /将影响 12 条已保存记录（3,400 token）/);
  assert.match(text, /当前依据：官方当前 Standard/);
  assert.match(text, /试算：桶字段已匹配，0.010200 USD/);
  assert.match(text, /试算不写入任何文件/);
  assert.match(pricing.probeText({ affectedRecords: 0, affectedTokens: 0, previous: null, origin: 'unpriced', sample: null }), /当前没有已保存记录使用该模型/);
  assert.equal(pricing.probeText(null), '');
  // A blocked reason carries a null estimate; Number(null) would print 0.000000.
  const blocked = pricing.probeText({ affectedRecords: 2, affectedTokens: 2000, previous: { inputUncached: 2, output: 8 }, origin: 'official-current-standard', sample: { reason: 'usage-incomplete', lower: null, upper: null } });
  assert.match(blocked, /试算：用量字段不完整或冲突，无语义金额/);
  assert.equal(/0\.000000/.test(blocked), false, 'a blocked probe must not read as a zero-dollar estimate');
});

test('the editor builds a backend-shaped entry and keeps blanks as unknown', () => {
  assert.deepEqual(pricing.entry(' openai ', ' gpt-4.1 ', { inputUncached: '5', output: '8', cacheRead: '', cacheWrite: '0' }),
    { provider: 'openai', model: 'gpt-4.1', inputUncached: 5, output: 8, cacheRead: null, cacheWrite: 0 });
  assert.equal(pricing.formatRate(null), '未知 / 未单列');
  assert.equal(pricing.formatRate(0), '0', 'a documented free tier must not look unknown');
});

test('panel markup keeps every id the UI contract depends on', () => {
  const html = view.panelHtml(pricing);
  for (const id of ['pricingPanel', 'priceSearch', 'priceScope', 'priceRows', 'priceEditor', 'priceForm', 'priceProvider', 'priceModel',
    'price-inputUncached', 'price-output', 'price-cacheRead', 'price-cacheWrite', 'savePrice', 'resetPrice', 'priceResult', 'priceProbe', 'priceCatalogLine']) {
    assert.ok(html.includes('id="' + id + '"'), id + ' must exist in the panel');
  }
  for (const field of pricing.FIELDS) assert.ok(html.includes('id="price-' + field + '"'));
  assert.equal(html.includes('未定价明细'),false);
  assert.equal(html.includes('id="pricingGaps"'),false);
  assert.equal(/[<>]script/.test(view.escape('<script>')), false);
  assert.equal(view.escape('a"b<c>&d'), 'a&quot;b&lt;c&gt;&amp;d');
});

test('rows render provider groups, known/unknown rates and only manual reset buttons', () => {
  const models = [
    row('openai', 'gpt-4.1', { inputUncached: 2, output: 8, cacheRead: null, cacheWrite: null }, 'official-current-standard'),
    row('openai', 'manual-model', { inputUncached: 5, output: 9, cacheRead: 0, cacheWrite: 0 }, 'manual'),
    row('openai', 'ghost', {}, 'unpriced')
  ];
  const html = view.rowsHtml(pricing.groups(models, {}), {}, pricing);
  assert.match(html, /data-edit-price="openai\/gpt-4\.1"/);
  assert.match(html, /data-edit-price="openai\/manual-model"/);
  assert.match(html, /data-reset-price="openai\/manual-model"/);
  assert.equal(/data-reset-price="openai\/gpt-4\.1"/.test(html), false, 'a catalog price cannot be reset like a manual rule');
  assert.match(html, /未知 \/ 未单列/);
  assert.match(html, /3 个模型 · 未定价 1/);
  assert.match(view.rowsHtml([], { empty: '没有匹配的模型。' }, pricing), /没有匹配的模型/);
});

test('catalog and gap lines expose version drift and never fabricate coverage', () => {
  const data = { version: 'official-review-2026-10-04', obtainedAt: '2026-10-03T14:11:58.758Z', sha256: 'abcdef0123456789', overrideSha256: '99887766aabbccdd', counts: { models: 100, priced: 94, unpriced: 3, manual: 3 } };
  const line = view.catalogLine(data, [], pricing);
  assert.match(line, /official-review-2026-10-04/);
  assert.match(line, /abcdef0123/);
  assert.match(line, /模型 100 · 已定价 94 · 未定价 3 · 手动 3/);
  assert.equal(view.catalogLine(null, [], pricing), '');
  assert.equal(view.countsText(data, []), '94 / 100 已定价');
  assert.match(view.gapsHtml({ records: 0, reasons: [], unpriced: [] }, pricing), /没有已保存记录/);
  assert.match(view.gapsHtml({ records: 9, reasons: [{ reason: 'price-unverified', label: '参考费率未核实 · 不计入估算', count: 9 }], unpriced: [] }, pricing), /全部按当前规则计价|缺口/);
  assert.match(view.gapsHtml({ records: 9, reasons: [{ reason: 'model-unpriced', label: '模型 / provider 无规则', count: 9 }], unpriced: [{ key: 'openai/ghost', count: 9 }] }, pricing), /data-edit-price="openai\/ghost"/);
});

test('template options only offer usable catalog and manual prices', () => {
  const models = [
    row('openai', 'gpt-4.1', { inputUncached: 2, output: 8 }, 'official-current-standard'),
    row('openai', 'manual-model', { inputUncached: 5, output: 9 }, 'manual'),
    row('anthropic', 'claude-sonnet-4-5', { inputUncached: 3, output: 15 }, 'reference-unverified')
  ];
  const options = view.templateOptions(models, 'openai/gpt-4.1', pricing);
  assert.match(options.html, /value="openai\/gpt-4\.1"/);
  assert.match(options.html, /value="openai\/manual-model"/);
  assert.equal(/reference-unverified|claude-sonnet/.test(options.html), false, 'an unverified price is not a template');
  assert.equal(options.selected, 'openai/gpt-4.1');
  assert.equal(view.templateOptions(models, 'openai/dropped-model', pricing).selected, '', 'a dropped model cannot stay selected');
  assert.equal(view.filterResult(4, 4), '4 个模型');
  assert.equal(view.filterResult(1, 4), '筛选后 1 / 4 个模型');
});

test('every script and stylesheet the page loads is served by the design server', () => {
  const html = fs.readFileSync(path.join(DESIGN, 'index.html'), 'utf8');
  const serve = fs.readFileSync(path.join(DESIGN, 'serve.js'), 'utf8');
  const listed = serve.slice(serve.indexOf('if (!['), serve.indexOf('].includes(relative)'))
    .split(',').map(part => part.trim().replace(/^'|'$/g, '')).filter(part => part && part !== 'if (![');
  // Only local files are checked: anchors and asset/ paths resolve elsewhere.
  // usage-data.js is the one script served by the dynamic bootstrap branch
  // instead of the static whitelist, so it is asserted against that route.
  const dynamic = serve.includes("requestPath === '/usage-data.js'");
  const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])
    .filter(url => /^[a-z0-9-]+\.(?:js|css|html)$/.test(url) && url !== 'usage-data.js');
  assert.ok(dynamic, 'usage-data.js must stay served by the bootstrap route');
  assert.ok(referenced.length > 5);
  for (const file of referenced) assert.ok(listed.includes(file), file + ' must be in the serve.js whitelist');
  for (const file of ['pricing-data.js', 'pricing-view.js', 'pricing-controller.js', 'codex-maintenance.js', 'maintenance-ui.js']) {
    assert.ok(fs.existsSync(path.join(DESIGN, file)), file + ' must exist');
    assert.ok(listed.includes(file), file + ' must be served');
  }
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.ok(scripts.indexOf('pricing-data.js') < scripts.indexOf('pricing-controller.js'), 'data loads before its consumer');
  assert.ok(scripts.indexOf('pricing-view.js') < scripts.indexOf('pricing-controller.js'), 'view loads before its consumer');
  assert.ok(scripts.indexOf('pricing-controller.js') < scripts.indexOf('maintenance-ui.js'), 'the shell appends after the panel paints');
  assert.ok(scripts.indexOf('maintenance-ui.js') < scripts.indexOf('codex-maintenance.js'), 'the mount exists before the Codex block fills it');
});

test('the removed clear control leaves no dead wiring behind', () => {
  const design = fs.readdirSync(DESIGN).filter(name => name.endsWith('.js'));
  for (const name of design) {
    const source = fs.readFileSync(path.join(DESIGN, name), 'utf8');
    assert.equal(/usageClear|settingsNotice/.test(source), false, name + ' must not reference the removed settings controls');
  }
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'quota', 'preload.js'), 'utf8');
  assert.equal(/clearStatistics|usage:clear/.test(preload), false, 'the clear IPC must not remain exposed');
});
