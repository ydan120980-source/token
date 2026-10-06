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
  assert.equal(pricing.priced(row('openai', 'gpt-4.1', { inputUncached: 0, output: 0 }, 'manual')), true, 'a documented free tier is priced');
});

const usage = {
  'openai/gpt-4.1': { tokens: 600, pricedTokens: 600, agents: ['codex'], reasons: { exact: 6 } },
  'route/auto': { tokens: 300, pricedTokens: 0, agents: ['opencode', 'codex'], reasons: { 'model-unpriced': 3 } },
  'vendor/half': { tokens: 100, pricedTokens: 40, agents: ['mimo'], reasons: { exact: 1, 'usage-incomplete': 1 } }
};
const observed = [{ provider: 'vendor', model: 'half', target: 'vendor/half' }, { provider: 'route', model: 'auto', target: null }, { provider: 'openai', model: 'gpt-4.1', target: 'openai/gpt-4.1' }];
const catalog = [row('openai', 'gpt-4.1', { inputUncached: 2, output: 8, cacheRead: .5, cacheWrite: null }, 'official-current-standard'), row('vendor', 'half', { inputUncached: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, 'manual')];

test('used models join observed identifiers with their price row and weight, heaviest first', () => {
  const models = pricing.usedModels(observed, catalog, usage, { mappings: { 'route/auto': 'openai/gpt-4.1' } }, { codex: 'Codex', opencode: 'OpenCode' });
  assert.deepEqual(models.map(item => item.key), ['openai/gpt-4.1', 'route/auto', 'vendor/half']);
  assert.deepEqual(models[1].agents, ['OpenCode', 'Codex']);
  assert.equal(models[1].row.origin, 'unpriced', 'an identifier missing from the catalog stays unpriced, never zero');
  assert.equal(models[1].mapped, true); assert.equal(models[2].manual, true);
  assert.equal(models[0].share, .6);
  assert.deepEqual(pricing.usedModels([], catalog, usage, {}, {}), []);
});

test('only gaps a pricing decision can close become actions; incomplete usage stays informational', () => {
  const gaps = pricing.pricingGaps(pricing.usedModels(observed, catalog, usage, {}, {}));
  assert.deepEqual(gaps, [{ key: 'route/auto', tokens: 300, reasons: ['model-unpriced'] }]);
  const value = pricing.coverage(usage);
  assert.equal(value.tokens, 1000); assert.equal(value.priced, 640); assert.equal(value.ratio, .64);
  assert.equal(pricing.coverage({}).ratio, null, 'no usage reports unknown coverage, not 0% or 100%');
  assert.equal(pricing.REASONS['model-unpriced'], '价格目录中没有此模型');
});

test('the editor builds a backend-shaped entry and keeps blanks as unknown', () => {
  assert.deepEqual(pricing.entry(' openai ', ' gpt-4.1 ', { inputUncached: '5', output: '8', cacheRead: '', cacheWrite: '0' }),
    { provider: 'openai', model: 'gpt-4.1', inputUncached: 5, output: 8, cacheRead: null, cacheWrite: 0 });
});

test('panel markup keeps every id the UI contract depends on and no full catalog table', () => {
  const html = view.panelHtml(pricing);
  for (const id of ['pricingPanel', 'priceSearch', 'priceRows', 'priceGaps', 'priceAttention', 'priceCoverageValue', 'priceEditor', 'priceForm', 'mappingForm', 'mappingTo', 'unmapPrice', 'priceProvider', 'priceModel',
    'price-inputUncached', 'price-output', 'price-cacheRead', 'price-cacheWrite', 'savePrice', 'resetPrice', 'priceResult', 'priceProbe', 'priceCatalogLine', 'billingRows', 'saveBilling', 'priceAuto', 'priceSyncNow']) {
    assert.ok(html.includes('id="' + id + '"'), id + ' must exist in the panel');
  }
  for (const gone of ['priceScope', 'priceObserved', 'priceMore', 'mappingRows', 'priceTabCatalog', 'mappingFrom']) assert.equal(html.includes('id="' + gone + '"'), false, gone + ' was removed with the catalog table');
  assert.equal(/[<>]script/.test(view.escape('<script>')), false);
  assert.equal(view.escape('a"b<c>&d'), 'a&quot;b&lt;c&gt;&amp;d');
});

test('used-model rows show billing basis, known/unknown rates and reset only for manual rules', () => {
  const models = pricing.usedModels(observed, catalog, usage, {}, {});
  const html = view.rowsHtml(models, {}, pricing);
  for (const key of ['openai/gpt-4.1', 'route/auto', 'vendor/half']) assert.ok(html.includes('data-edit-price="' + key + '"'), key);
  assert.ok(html.includes('data-reset-price="vendor/half"'));
  assert.equal(html.includes('data-reset-price="openai/gpt-4.1"'), false, 'a catalog price cannot be reset like a manual rule');
  assert.ok(html.includes('$2<i> · </i>$8<i> · </i>$0.5<i> · </i>—'), 'an unknown write rate shows as unknown, not $0');
  assert.ok(html.includes('$1<i> · </i>$2<i> · </i>$0<i> · </i>$0'), 'a documented free rate shows as $0');
  assert.ok(html.includes('pc-rates is-empty">未定价'));
  assert.match(view.rowsHtml([], { empty: '没有匹配的已用模型。' }, pricing), /没有匹配的已用模型/);
  const routed = view.rowsHtml([{ ...models[0], key: 'route/auto', model: 'auto', provider: 'route', target: 'openai/gpt-4.1' }], {}, pricing);
  assert.ok(routed.includes('按 openai/gpt-4.1'));
});

test('gap actions, catalog provenance and counts never fabricate coverage', () => {
  const gaps = [{ key: 'route/auto', tokens: 3e6, reasons: ['model-unpriced'] }];
  assert.ok(view.gapsHtml(gaps, pricing).includes('data-edit-price="route/auto"'));
  assert.ok(view.gapsHtml(gaps, pricing).includes('价格目录中没有此模型 · 未定价 3.0M Token'));
  assert.equal(view.gapsHtml([], pricing), '');
  const data = { version: 'official-review-2026-10-04+models-dev/1', obtainedAt: '2026-10-03T14:11:58.758Z', sha256: 'abcdef0123456789', overrideSha256: '99887766aabbccdd', counts: { models: 100 } };
  assert.match(view.catalogLine(data, pricing), /models\.dev 与官方价目 · 更新于 .* · 100 个模型/);
  assert.equal(/abcdef/.test(view.catalogLine(data, pricing)), false, 'digests stay out of the sentence');
  assert.match(view.catalogTitle(data), /目录 abcdef0123 · 手动规则 99887766aa/);
  assert.equal(view.catalogLine(null, pricing), '');
  assert.equal(view.countsText([{}, {}], gaps), '2 个已用模型 · 1 个待处理');
  assert.equal(view.countsText([{}], []), '1 个已用模型 · 全部已定价');
});

test('template options only offer usable catalog and manual prices', () => {
  const models = [
    row('openai', 'gpt-4.1', { inputUncached: 2, output: 8 }, 'official-current-standard'),
    row('openai', 'manual-model', { inputUncached: 5, output: 9 }, 'manual'),
    row('anthropic', 'claude-sonnet-4-5', { inputUncached: 3, output: 15 }, 'reference-unverified')
  ];
  const options = view.templateOptions(models, 'openai/gpt-4.1');
  assert.match(options.html, /value="openai\/gpt-4\.1"/);
  assert.match(options.html, /value="openai\/manual-model"/);
  assert.equal(/reference-unverified|claude-sonnet/.test(options.html), false, 'an unverified price is not a template');
  assert.equal(options.selected, 'openai/gpt-4.1');
  assert.equal(view.templateOptions(models, 'openai/dropped-model').selected, '', 'a dropped model cannot stay selected');
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
  for (const file of ['pricing-data.js', 'pricing-view.js', 'pricing-controller.js', 'codex-maintenance.js', 'maintenance-ui.js', 'segmented.js', 'date-range.js']) {
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
