'use strict';
// Calculations the React settings page shares with the legacy shell (M3, 2026-10-25). Each one
// moved verbatim out of preview.js, pricing-controller.js or codex-maintenance.js; these checks
// pin the outputs those scripts produced, including unknown, zero and partial inputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../../design/desktop-reference/pricing-data');
const model = require('../../design/desktop-reference/pricing-editor-model');
const profile = require('../../design/desktop-reference/profile-model');
const maintenance = require('../../design/desktop-reference/codex-maintenance-model');

const row = (provider, name, rates, origin) => ({ provider, model: name, rates, origin });
const used = (key, tokens, agents = ['Codex'], origin = 'official-current-standard') => ({ key, provider: key.split('/')[0], model: key.split('/')[1], agents, tokens, row: row(key.split('/')[0], key.split('/')[1], { inputUncached: 1, output: 2 }, origin) });

test('profile: saved values are validated, invalid ones fall back to the default', () => {
  assert.deepEqual(profile.parse(null), profile.DEFAULT);
  assert.deepEqual(profile.parse('{bad json'), profile.DEFAULT);
  assert.deepEqual(profile.parse(JSON.stringify({ name: '   ' })), profile.DEFAULT, 'a blank name is invalid');
  assert.deepEqual(profile.parse(JSON.stringify({ name: 'x'.repeat(49) })), profile.DEFAULT, 'over 48 characters is invalid');
  assert.deepEqual(profile.parse(JSON.stringify({ name: 'YD', bio: 'b'.repeat(90), tone: 'violet', photo: 'data:image/gif;base64,AAAA' })), { name: 'YD', bio: 'b'.repeat(80), tone: 'indigo', photo: null });
  assert.equal(profile.parse(JSON.stringify({ name: 'YD', photo: 'data:image/png;base64,iVBORw0K' })).photo, 'data:image/png;base64,iVBORw0K');
  assert.equal(profile.KEY, 'agentusage-preview.profile.v1', 'the stored format and key stay compatible');
});

test('profile: initials, typing preview, file checks and the saved shape', () => {
  assert.equal(profile.initials('本机用户'), '本', 'one CJK character fills the avatar');
  assert.equal(profile.initials('yu dan'), 'YU');
  assert.equal(profile.initials(' a '), 'A');
  assert.equal(profile.previewName(''), 'YD');
  assert.equal(profile.previewName('林'), '林');
  assert.equal(profile.fileProblem({ type: 'image/gif', size: 10 }), '请选择最大 512 KB 的 PNG、JPEG 或 WebP 图片，原头像未改变。');
  assert.equal(profile.fileProblem({ type: 'image/png', size: 512 * 1024 + 1 }), '请选择最大 512 KB 的 PNG、JPEG 或 WebP 图片，原头像未改变。');
  assert.equal(profile.fileProblem({ type: 'image/webp', size: 512 * 1024 }), null);
  assert.equal(profile.fileChosen({ size: 1500 }), '已选 2 KB · 保存资料后生效，仅保存在本机。');
  assert.deepEqual(profile.toSave({ name: 'old', bio: '', tone: 'teal', photo: null }, '  新名字 ', ' 简介 '), { name: '新名字', bio: '简介', tone: 'teal', photo: null });
});

test('pricing editor: the table puts left-out usage first, filters, folds at eight and counts', () => {
  const models = Array.from({ length: 10 }, (_, i) => used('p/m' + i, 100 - i));
  const gaps = [{ key: 'p/m9', tokens: 50 }];
  const view = model.table(models, gaps, '', false, pricing);
  assert.equal(view.rows[0].key, 'p/m9', 'the model with left-out usage heads the table');
  assert.equal(view.rows.length, 8); assert.equal(view.folded, true);
  assert.equal(view.expandText, '展开其余 2 个模型'); assert.equal(view.count, '10');
  assert.equal(model.table(models, gaps, '', true, pricing).rows.length, 10);
  assert.equal(model.table(models, gaps, '', true, pricing).expandText, '收起，只看前 8 个');
  const found = model.table(models, gaps, ' M3 ', false, pricing);
  assert.deepEqual(found.rows.map(item => item.key), ['p/m3']); assert.equal(found.folded, false); assert.equal(found.count, '1 / 10');
  assert.equal(model.table(models, gaps, '官方当前', false, pricing).rows.length, 10, 'the billing basis is searchable');
  assert.equal(model.table(models, gaps, 'zzz', false, pricing).empty, '没有匹配的已用模型。');
  assert.equal(model.table([], [], '', false, pricing).empty, '采集后显示已使用的模型。');
  assert.equal(model.table([], [], '', false, pricing).count, '');
  const manual = model.withManualRows([used('p/a', 1)], [row('p', 'a', {}, 'manual'), row('q', 'new', { inputUncached: 1, output: 1 }, 'manual'), row('r', 'x', {}, 'official-current-standard')]);
  assert.deepEqual(manual.map(item => [item.key, item.tokens, item.share]), [['p/a', 1, undefined], ['q/new', 0, null]], 'an unused manual rate stays editable, with no share');
});

test('pricing editor: coverage is unknown without usage, never 0%', () => {
  assert.equal(model.coverageText({ tokens: 0, priced: 0, ratio: null }), null);
  assert.equal(model.coverageText({ tokens: 10, priced: 5, ratio: .5 }), '50.0%');
  assert.equal(model.coverageText({ ratio: .9995 }), '99.95%');
  assert.equal(model.coverageText({ ratio: 1 }), '100.0%');
  assert.equal(model.coverageText({ ratio: 0 }), '0.0%', 'a real zero is shown as zero');
  assert.deepEqual(model.shares({ tokens: 10, priced: 6 }, { fixable: 3, incomplete: 1 }), { priced: .6, fixable: .3, incomplete: .1 });
  assert.deepEqual(model.shares({ tokens: 0, priced: 0 }, { fixable: 0, incomplete: 0 }), { priced: 0, fixable: 0, incomplete: 0 });
  assert.equal(model.attentionText([], { fixable: 0, incomplete: 0 }), '');
  assert.equal(model.attentionText([{}, {}], { fixable: 2e6, incomplete: 5e5 }), '2 个模型有 2.5M Token 未计入估算');
});

test('pricing editor: sync state, sheet heading, mapping preview and dry run wording', () => {
  assert.equal(model.syncText({ syncing: true }, pricing), '正在更新价格目录…');
  assert.equal(model.syncText({ error: 'X' }, pricing), '同步失败，继续使用上次有效价格');
  assert.match(model.syncText({ lastSuccess: '2026-10-25T01:00:00Z' }, pricing), /^上次同步 /);
  assert.equal(model.syncText(undefined, pricing), '内置价格可离线使用');
  const rows = [row('openai', 'gpt-4.1', { inputUncached: 2, output: 8, cacheRead: .5, cacheWrite: null }, 'official-current-standard'), row('vendor', 'half', { inputUncached: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, 'manual'), row('x', 'ref', { inputUncached: 1, output: 1 }, 'reference-unverified')];
  const models = [{ key: 'vendor/half', agents: ['MiMo Code'], tokens: 2500, row: rows[1] }, { key: 'openai/gpt-4.1', agents: [], tokens: 10, row: rows[0] }];
  assert.deepEqual(model.editor('vendor/half', models, rows, pricing), { provider: 'vendor', model: 'half', title: 'half', eyebrow: 'vendor', meta: 'MiMo Code · 2.5K Token · 手动规则', fill: rows[1].rates, manual: true, startMode: 'manual' });
  assert.equal(model.editor('openai/gpt-4.1', models, rows, pricing).startMode, 'map');
  assert.equal(model.editor('openai/gpt-4.1', models, rows, pricing).meta, '10 Token · 官方当前 Standard', 'no Agent names, no empty separator');
  assert.deepEqual(model.editor(null, models, rows, pricing), { provider: '', model: '', title: '为其他模型添加价格', eyebrow: '手动价格', meta: '模型尚未出现在记录中时，保存后对之后的采集生效。', fill: null, manual: false, startMode: 'manual' });
  assert.deepEqual(model.priceTargets(rows, pricing), ['openai/gpt-4.1', 'vendor/half'], 'unverified prices are not billing targets');
  assert.equal(model.mappingPreview(' openai/gpt-4.1 ', rows, pricing), '每百万 Token：输入（不含缓存） $2 · 输出（含推理） $8 · 缓存读取 $0.5 · 缓存写入 未知');
  assert.equal(model.mappingPreview('nope/x', rows, pricing), '目录中没有这个可计价模型。');
  assert.equal(model.mappingPreview('  ', rows, pricing), '');
  assert.equal(model.probeReady({ provider: 'p', model: 'm', inputUncached: 0, output: 0 }), true, 'explicit zero rates can be tried');
  assert.equal(model.probeReady({ provider: 'p', model: 'm', inputUncached: null, output: 1 }), false);
  assert.equal(model.probeText({ affectedRecords: 1200, affectedTokens: 34000, sample: { lower: .000765, upper: .000765 } }, pricing), '影响 1,200 条历史记录 · 34,000 Token。一条记录试算：$0.000765（已应用当前倍率）。保存前不会改变估算。');
  assert.equal(model.probeText({ affectedRecords: 1, affectedTokens: 1, sample: { lower: .1, upper: .2 } }, pricing).includes('$0.100000 – $0.200000'), true);
  assert.equal(model.probeText({ affectedRecords: 0, sample: { lower: null } }, pricing), '当前没有历史记录使用此模型。示例记录的用量不完整，暂时无法确定费用。保存前不会改变估算。');
  assert.equal(model.probeText({ affectedRecords: 0, sample: null }, pricing), '当前没有历史记录使用此模型。保存后，新采集记录也会使用此价格。保存前不会改变估算。');
  assert.equal(model.probeErrorText(new Error('PRICE_INVALID')), '请确认模型标识，并填写有效的非负价格。空白缓存费率表示未知。');
  assert.equal(model.probeErrorText(new Error('IPC failed')), '试算不可用，保存仍会由后端校验。');
  assert.match(model.resetErrorText(new Error('PRICE_TARGET_IN_USE')), /仍被模型映射或默认模型引用/);
  assert.equal(model.resetErrorText(new Error('x')), '撤销未完成，输入与原规则保留；请重试移除。');
});

test('pricing editor: Agent rules keep blank apart from zero and need a priced default model', () => {
  const rows = [row('openai', 'gpt-4.1', { inputUncached: 2, output: 8 }, 'official-current-standard'), row('x', 'ref', { inputUncached: 1, output: 1 }, 'reference-unverified')];
  assert.deepEqual(model.billingDraft({ defaults: {} }, 'codex'), { mode: 'actual', multiplier: '1', model: '' });
  assert.deepEqual(model.billingDraft({ defaults: { codex: { mode: 'default', multiplier: 0, model: 'openai/gpt-4.1' } } }, 'codex'), { mode: 'default', multiplier: '0', model: 'openai/gpt-4.1' });
  assert.deepEqual(model.billingCheck({ mode: 'actual', multiplier: '', model: '' }, rows, pricing), { valid: false, modelValid: true, error: '倍率必须为 0–1000 的数字；空白不等于 0。' });
  assert.equal(model.billingCheck({ mode: 'actual', multiplier: '0', model: '' }, rows, pricing).valid, true, 'zero is an explicit multiplier');
  assert.equal(model.billingCheck({ mode: 'actual', multiplier: '1000.5', model: '' }, rows, pricing).valid, false);
  assert.equal(model.billingCheck({ mode: 'actual', multiplier: '-1', model: '' }, rows, pricing).valid, false);
  assert.deepEqual(model.billingCheck({ mode: 'default', multiplier: '1.5', model: 'x/ref' }, rows, pricing), { valid: true, modelValid: false, error: '请选择目录中的完整计费模型标识。' });
  assert.equal(model.billingCheck({ mode: 'default', multiplier: '1.5', model: ' openai/gpt-4.1 ' }, rows, pricing).modelValid, true);
  assert.deepEqual(model.billingValue({ mode: 'default', multiplier: '1.5', model: ' openai/gpt-4.1 ' }), { multiplier: 1.5, mode: 'default', model: 'openai/gpt-4.1' });
});

test('Codex maintenance: the preview sentence adds rebuilt and retained tokens of one preview', () => {
  assert.equal(maintenance.previewText({ files: 2, records: 3, previousTokens: 1000, rebuiltTokens: 900, retainedTokens: 280 }),
    '2 个文件 · 3 条重建记录。原有 1,000 → 1,180 token（差额 180）；其中保留不可重读历史 280 token。');
  assert.match(maintenance.previewText({ files: 1, records: 1, previousTokens: 500, rebuiltTokens: 100, retainedTokens: 0 }), /差额 -400/);
});
