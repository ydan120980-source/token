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

test('unpriced usage lists every model with tokens left out, by reason and cause, heaviest first', () => {
  const split = { ...usage,
    'vendor/half': { tokens: 100, pricedTokens: 40, agents: ['mimo', 'codex'], reasons: { exact: 1, 'usage-incomplete': 2 }, unpriced: { 'usage-incomplete': 60 }, incomplete: { 'missing-cacheWrite': 45, conflict: 15 }, unpricedAgents: { mimo: 60 } },
    'route/auto': { ...usage['route/auto'], unpriced: { 'model-unpriced': 300 } } };
  const models = pricing.usedModels(observed, catalog, split, {}, { mimo: 'MiMo Code', codex: 'Codex', opencode: 'OpenCode' });
  const list = pricing.unpricedUsage(models);
  assert.deepEqual(list.map(item => [item.key, item.tokens, item.fixable]), [['route/auto', 300, true], ['vendor/half', 60, false]]);
  assert.deepEqual(list[1].agents, ['MiMo Code'], 'only the Agents whose records are left out are named');
  assert.equal(list[1].ratio, .6);
  assert.deepEqual(list[1].groups, [{ reason: 'usage-incomplete', tokens: 60, fixable: false, causes: [{ cause: 'missing-cacheWrite', tokens: 45 }, { cause: 'conflict', tokens: 15 }] }]);
  assert.deepEqual(pricing.unpricedTotals(list), { fixable: 300, incomplete: 60 });
  // An older snapshot without per-reason tokens keeps the remainder under its one known kind.
  const old = pricing.unpricedUsage(pricing.usedModels(observed, catalog, usage, {}, {}));
  assert.deepEqual(old.map(item => [item.key, item.tokens, item.groups.map(group => group.reason)]), [['route/auto', 300, ['model-unpriced']], ['vendor/half', 60, ['usage-incomplete']]]);
  assert.deepEqual(pricing.unpricedUsage(pricing.usedModels([{ provider: 'openai', model: 'gpt-4.1' }], catalog, { 'openai/gpt-4.1': usage['openai/gpt-4.1'] }, {}, {})), [], 'fully priced usage lists nothing');
  for (const cause of ['missing-inputUncached', 'missing-output', 'missing-cacheRead', 'missing-cacheWrite', 'missing-reasoning', 'conflict', 'invalid-cache', 'invalid-reasoning', 'total-mismatch', 'partial']) assert.ok(pricing.CAUSES[cause], cause);
});

test('the editor builds a backend-shaped entry and keeps blanks as unknown', () => {
  assert.deepEqual(pricing.entry(' openai ', ' gpt-4.1 ', { inputUncached: '5', output: '8', cacheRead: '', cacheWrite: '0' }),
    { provider: 'openai', model: 'gpt-4.1', inputUncached: 5, output: 8, cacheRead: null, cacheWrite: 0 });
});

test('the view module says what the panel shows, with no markup and no full catalog table', () => {
  for (const name of ['rates', 'row', 'status', 'suggestions', 'coverageLegend', 'catalogLine', 'catalogTitle', 'countsText', 'templateOptions', 'fieldPlaceholder']) assert.equal(typeof view[name], 'function', name);
  for (const gone of ['panelHtml', 'rowsHtml', 'statusHtml', 'suggestionsHtml', 'coverageNote', 'escape', 'attr']) assert.equal(view[gone], undefined, gone + ' left with the HTML panel');
  assert.deepEqual(pricing.FIELDS.map(view.fieldPlaceholder), ['必填', '必填', '留空表示未知', '免费填 0，留空为未知'], 'blank cache rates are unknown, free is an explicit 0');
});

test('used-model rows show billing basis, known/unknown rates and left-out usage; actions live in the sheet', () => {
  const models = pricing.usedModels(observed, catalog, usage, {}, {});
  const rows = models.map(item => view.row(item, null, pricing));
  assert.deepEqual(rows.map(row => row.key), ['openai/gpt-4.1', 'route/auto', 'vendor/half']);
  assert.equal(rows[0].openLabel, 'gpt-4.1：价格与处理方法');
  assert.deepEqual(rows[0].rates.values, ['$2', '$8', '$0.5', null], 'an unknown write rate stays unknown, not $0');
  assert.match(rows[0].rates.title, /缓存写入 未知/);
  assert.deepEqual(rows[2].rates.values, ['$1', '$2', '$0', '$0'], 'a documented free rate shows as $0');
  assert.deepEqual(rows[1].rates, { priced: false, values: [], title: '' }, 'no input/output rate is unpriced');
  assert.equal(rows[0].share, '60.0%');
  const fixable = view.row(models[1], { fixable: true, tokens: 300, ratio: .75 }, pricing), incomplete = view.row(models[2], { fixable: false, tokens: 60, ratio: null }, pricing);
  assert.deepEqual(fixable.leftOut, { fixable: true, text: '未计入 75%', title: '300 Token 未计入估算' }, 'a row says how much of it is left out');
  assert.equal(incomplete.leftOut.text, '未计入 60', 'an unknown share falls back to tokens, never 0%');
  assert.equal(fixable.share, null, 'left-out usage replaces the share');
  assert.equal(view.row({ ...models[0], key: 'route/auto', model: 'auto', provider: 'route', target: 'openai/gpt-4.1' }, null, pricing).routedTo, 'openai/gpt-4.1');
  assert.equal(rows[0].routedTo, null);
});

test('the sheet status, catalog provenance and counts never fabricate coverage', () => {
  const gaps = [{ key: 'route/auto', provider: 'route', model: 'auto', agents: ['Codex'], tokens: 3e6, total: 4e6, ratio: .75, fixable: true, groups: [{ reason: 'model-unpriced', tokens: 3e6, fixable: true, causes: [] }] },
    { key: 'google/flash', provider: 'google', model: 'flash', agents: ['Antigravity'], tokens: 2e6, total: 8e6, ratio: .25, fixable: false, groups: [{ reason: 'usage-incomplete', tokens: 2e6, fixable: false, causes: [{ cause: 'missing-cacheWrite', tokens: 1.5e6 }, { cause: 'conflict', tokens: 5e5 }] }] }];
  const fixable = view.status(gaps[0], pricing), incomplete = view.status(gaps[1], pricing);
  assert.equal(fixable.lines[0].text, '价格目录中没有此模型'); assert.match(fixable.amount, /占该模型 75%/);
  assert.deepEqual(fixable.sources, [], 'a missing price is fixed in the same sheet, not in source management');
  assert.equal(incomplete.checkManual, true, 'a missing write fee offers the manual-rate check');
  assert.ok(incomplete.guides.some(guide => (guide.title + guide.steps.join('')).includes('只有确认不收费时')), 'an optional fee decision requires a confirmed zero write fee and never fabricates usage');
  assert.ok(incomplete.guides.some(guide => (guide.title + guide.steps.join('')).includes('原始文件从未记录')));
  assert.deepEqual(incomplete.lines.map(line => line.text), ['来源没有报告缓存写入 · 1.5M', '两个来源记下的用量不一致 · 500.0K'], 'incomplete usage names each cause with its tokens');
  assert.deepEqual(incomplete.sources, [{ id: 'all', label: '查看来源' }]);
  assert.equal(view.status(null, pricing), null);
  const legend = view.coverageLegend({ tokens: 10e6, priced: 5e6, ratio: .5 }, { fixable: 3e6, incomplete: 2e6 });
  assert.deepEqual(legend.items.map(item => item.label + ' ' + item.tokens), ['已定价 5.0M', '可设置价格 3.0M', '来源未报告完整 2.0M']);
  assert.equal(legend.total, '共 10.0M Token');
  assert.equal(view.coverageLegend({ tokens: 0, priced: 0, ratio: null }, { fixable: 0, incomplete: 0 }).empty, '采集后显示定价覆盖。');
  const data = { version: 'official-review-2026-10-04+models-dev/1', obtainedAt: '2026-10-03T14:11:58.758Z', sha256: 'abcdef0123456789', overrideSha256: '99887766aabbccdd', counts: { models: 100 } };
  assert.match(view.catalogLine(data, pricing), /models\.dev 与官方价目 · 更新于 .* · 100 个模型/);
  assert.equal(/abcdef/.test(view.catalogLine(data, pricing)), false, 'digests stay out of the sentence');
  assert.match(view.catalogTitle(data), /目录 abcdef0123 · 手动规则 99887766aa/);
  assert.equal(view.catalogLine(null, pricing), '');
  assert.equal(view.countsText([{}, {}], gaps), '2 个已用模型 · 2 个有未计入估算的用量');
  assert.equal(view.countsText([{}], []), '1 个已用模型 · 全部已定价');
});

test('gap source actions keep IDs paired with displayed names when token ranks differ', () => {
  const models = pricing.usedModels([{ provider: 'p', model: 'm' }], [], { 'p/m': { tokens: 100, pricedTokens: 0, agents: ['codex', 'claude'], unpriced: { 'usage-incomplete': 100 }, incomplete: { 'missing-cacheRead': 100 }, unpricedAgents: { codex: 10, claude: 90 } } }, {}, { codex: 'Codex', claude: 'Claude Code' });
  const [gap] = pricing.unpricedUsage(models); assert.deepEqual(gap.agentIds, ['claude', 'codex']); assert.deepEqual(gap.agents, ['Claude Code', 'Codex']);
  const value = view.status(gap, pricing);
  assert.deepEqual(value.sources[0], { id: 'claude', label: '检查 Claude Code' });
  assert.ok(value.guides.some(guide => (guide.title + guide.steps.join('')).includes('补价格无法补齐')));
  assert.equal(value.checkManual, false, 'no price action for usage the source never reported');
});

test('alias suggestions are offered for review, unsorted by price, and never applied', () => {
  assert.equal(view.suggestions('a/b', null), null);
  const value = view.suggestions('route/auto', { total: 3, ambiguous: true, candidates: [{ target: 'openai/gpt-4.1', reason: '同名', provider: 'openai', origin: 'models-dev', source: null, rates: { inputUncached: 2, output: 8, cacheRead: null, cacheWrite: 0 } }] });
  assert.equal(value.title, '匹配建议 · 3 个候选'); assert.match(value.note, /存在多个候选，尚未选择。.*选择后仍需明确保存/);
  assert.equal(value.candidates[0].rates, 'USD / 百万 Token：输入 $2 · 输出 $8 · 缓存读取 未知 · 缓存写入 $0');
  assert.match(value.more, /没有按价格排序/);
});

test('template options only offer usable catalog and manual prices', () => {
  const models = [
    row('openai', 'gpt-4.1', { inputUncached: 2, output: 8 }, 'official-current-standard'),
    row('openai', 'manual-model', { inputUncached: 5, output: 9 }, 'manual'),
    row('anthropic', 'claude-sonnet-4-5', { inputUncached: 3, output: 15 }, 'reference-unverified')
  ];
  const options = view.templateOptions(models, 'openai/gpt-4.1');
  assert.deepEqual(options.options.map(option => option.value), ['', 'openai/gpt-4.1', 'openai/manual-model'], 'an unverified price is not a template');
  assert.equal(options.options[0].label, '不复制');
  assert.equal(options.selected, 'openai/gpt-4.1');
  assert.equal(view.templateOptions(models, 'openai/dropped-model').selected, '', 'a dropped model cannot stay selected');
});

test('every script and stylesheet the page loads is served by the design server', () => {
  const html = fs.readFileSync(path.join(DESIGN, 'index.html'), 'utf8');
  const serve = fs.readFileSync(path.join(DESIGN, 'serve.js'), 'utf8');
  const listed = JSON.parse(serve.match(/if \(!(?<files>\["index\.html"[^\n]+\])\.includes\(relative\)/).groups.files);
  // Only local files are checked: anchors and asset/ paths resolve elsewhere.
  // usage-data.js is the one script served by the dynamic bootstrap branch
  // instead of the static whitelist, so it is asserted against that route.
  const dynamic = serve.includes("requestPath === '/usage-data.js'");
  const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1])
    .filter(url => /^[a-z0-9-]+\.(?:js|css|html)$/.test(url) && url !== 'usage-data.js');
  assert.ok(dynamic, 'usage-data.js must stay served by the bootstrap route');
  assert.ok(referenced.length > 5);
  for (const file of referenced) assert.ok(listed.includes(file), file + ' must be in the serve.js whitelist');
  const models = ['pricing-data.js', 'pricing-view.js', 'pricing-editor-model.js', 'profile-model.js', 'codex-maintenance-model.js'];
  for (const file of models) {
    assert.ok(fs.existsSync(path.join(DESIGN, file)), file + ' must exist');
    assert.ok(listed.includes(file), file + ' must be served');
  }
  // The settings page migrated to the React layer (M3); its DOM controllers are gone.
  for (const file of ['pricing-controller.js', 'maintenance-ui.js', 'codex-maintenance.js', 'settings-ui.js', 'date-range.js', 'agent-picker.js', 'insights.js']) {
    assert.equal(fs.existsSync(path.join(DESIGN, file)), false, file + ' was retired');
    assert.equal(listed.includes(file) || html.includes('src="' + file + '"'), false, file + ' is no longer served');
  }
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.ok(scripts.indexOf('pricing-data.js') < scripts.indexOf('pricing-view.js'), 'formatting loads before the view module');
  assert.ok(scripts.indexOf('pricing-view.js') < scripts.indexOf('pricing-editor-model.js'), 'the view loads before the editor model that uses it');
  assert.ok(scripts.indexOf('profile-model.js') < scripts.indexOf('preview.js'), 'the profile rules load before the shell that stores the profile');
  for (const file of models.slice(0, 5)) assert.ok(scripts.includes(file), file + ' loads in the parser before DOMContentLoaded');
  assert.doesNotMatch(html, /<script[^>]+\b(?:async|defer)\b/);
  const entry = fs.readFileSync(path.resolve(DESIGN, '../../ui/src/main.tsx'), 'utf8');
  assert.match(entry, /addEventListener\("DOMContentLoaded", appShell\.start, \{ once: true \}\)/, 'App activates direct page children only after the data hosts load');
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
