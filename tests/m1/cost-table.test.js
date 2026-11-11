'use strict';
// The cost page's table and its CSV export (src/m1/cost-table.js).
const test = require('node:test'), assert = require('node:assert/strict');
const costTable = require('../../src/m1/cost-table');

const day = (date, agent, provider, model, values = {}) => ({
  date, agent, provider, model, totalTokens: 0, inputUncached: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, records: 1,
  pricedTokens: 0, boundedTokens: 0, estimatedCostUsd: null, estimatedCostUpperUsd: null, costParts: null, cacheSavingsUsd: null,
  unpricedTokens: {}, incompleteTokens: {}, ...values
});
const priced = (date, agent, provider, model, tokens, lower, upper = lower, extra = {}) => day(date, agent, provider, model, {
  totalTokens: tokens, inputUncached: tokens * 0.4, output: tokens * 0.1, cacheRead: tokens * 0.5, cacheWrite: null, pricedTokens: tokens,
  boundedTokens: upper > lower ? tokens : 0, estimatedCostUsd: lower, estimatedCostUpperUsd: upper,
  costParts: { inputUncached: lower * 0.6, output: lower * 0.3, cacheRead: lower * 0.1, cacheWrite: 0 }, cacheSavingsUsd: 1,
  pricingReasons: upper > lower ? { 'cache-write-unreported': 1 } : { exact: 1 }, ...extra
});
const rows = [
  priced('2026-10-01', 'claude', 'anthropic', 'claude-sonnet-5-5', 1000, 2, 2.5),
  priced('2026-10-02', 'opencode', 'anthropic', 'claude-sonnet-5-5', 500, 1, 1.25, { pricingReasons: { 'cache-write-unreported': 2, 'context-unreported': 3 } }),
  priced('2026-10-02', 'codex', 'openai', 'gpt-6.1-sol', 3000, 3),
  day('2026-10-02', 'codex', 'openai', 'gpt-6.1-mini', { totalTokens: 4000, inputUncached: 2000, output: 500, cacheRead: 1500, cacheWrite: null, unpricedTokens: { 'model-unpriced': 4000 } }),
  day('2026-10-03', 'opencode', 'deepseek', 'deepseek-v4-flash', { totalTokens: 900, inputUncached: null, cacheRead: null, unpricedTokens: { 'usage-incomplete': 900 }, incompleteTokens: { 'total-mismatch': 600 } })
];

test('a model groups its days and Agents; unknown fields stay null, partly reported ones are marked', () => {
  const items = costTable.table(rows), claude = items.find(item => item.key === 'anthropic/claude-sonnet-5-5');
  assert.deepEqual(items.map(item => item.key), ['openai/gpt-6.1-mini', 'openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5-5', 'deepseek/deepseek-v4-flash'], 'heaviest first');
  assert.equal(claude.tokens, 1500); assert.equal(claude.lower, 3); assert.equal(claude.upper, 3.75); assert.equal(claude.spread, 0.75);
  assert.deepEqual(claude.spreadReasons.map(reason => [reason.code, reason.records]), [['cache-write-unreported', 3], ['context-unreported', 3]], 'a range names every reason, not only the cache write');
  assert.deepEqual(items.find(item => item.model === 'gpt-6.1-sol').spreadReasons, [], 'an exact estimate has none');
  assert.deepEqual(claude.users.map(user => [user.agent, user.tokens, user.lower]), [['claude', 1000, 2], ['opencode', 500, 1]]);
  assert.deepEqual(claude.fields.cacheWrite, { value: null, partial: false }, 'never reported is unknown, not 0');
  const flash = items.find(item => item.model === 'deepseek-v4-flash');
  assert.equal(flash.lower, null); assert.equal(flash.perMillion, null); assert.equal(flash.hitRate, null, 'no rate without both buckets');
  const mixed = costTable.table([...rows, priced('2026-10-04', 'opencode', 'deepseek', 'deepseek-v4-flash', 100, 0.1)]).find(item => item.model === 'deepseek-v4-flash');
  assert.deepEqual(mixed.fields.inputUncached, { value: 40, partial: true }, 'a day without the field makes the sum partial');
});

test('the per-million rate covers only priced tokens; reasons name what is left out', () => {
  const partly = costTable.table([priced('2026-10-01', 'codex', 'openai', 'm', 1000, 2), day('2026-10-01', 'codex', 'openai', 'm', { totalTokens: 1000, unpricedTokens: { 'usage-incomplete': 1000 }, incompleteTokens: { 'missing-output': 1000 } })])[0];
  assert.equal(partly.coverage, 0.5); assert.equal(partly.perMillion, 2000, '$2 per 1,000 priced tokens, not per 2,000');
  const [mini] = costTable.table(rows).filter(item => item.model === 'gpt-6.1-mini');
  assert.deepEqual(mini.gaps.map(gap => [gap.code, gap.fixable, gap.tokens]), [['model-unpriced', true, 4000]]);
  const flash = costTable.table(rows).find(item => item.model === 'deepseek-v4-flash');
  assert.deepEqual(flash.gaps.map(gap => [gap.kind, gap.code, gap.tokens]), [['cause', 'total-mismatch', 600], ['reason', 'usage-incomplete', 300]], 'the cause first, the unexplained rest as its reason');
});

test('by Agent, delta against a comparable window, sorting and folding', () => {
  const agents = costTable.table(rows, { by: 'agent', previousRows: [day('2026-09-01', 'codex', 'openai', 'gpt-6.1-sol', { totalTokens: 3500 })] });
  const codex = agents.find(item => item.agent === 'codex'), claude = agents.find(item => item.agent === 'claude');
  assert.equal(codex.tokens, 7000); assert.equal(codex.coverage, 3000 / 7000); assert.equal(codex.delta, 1);
  assert.equal(claude.delta, null); assert.equal(claude.isNew, true, 'absent from the earlier window');
  assert.equal(costTable.table(rows)[0].delta, null, 'no comparable window, no delta');
  assert.deepEqual(costTable.sort(costTable.table(rows), 'cost').map(item => item.model), ['gpt-6.1-sol', 'claude-sonnet-5-5', 'gpt-6.1-mini', 'deepseek-v4-flash'], 'estimate order, uncounted after');
  const many = costTable.table(Array.from({ length: 9 }, (_, i) => priced('2026-10-01', 'codex', 'openai', 'm' + i, 100 + i, 1)));
  const folded = costTable.fold(many);
  assert.equal(folded.length, 7); assert.equal(folded[6].other, true); assert.equal(folded[6].count, 3); assert.equal(folded[6].tokens, 100 + 101 + 102);
  assert.equal(costTable.fold(many.slice(0, 7)).length, 7, 'a single remaining entry is shown, not folded');
  assert.equal(costTable.points(Array.from({ length: 200 }, (_, i) => ({ date: String(i), tokens: 1 }))).length, 67);
});

test('the export takes only a grouping and date windows; numbers come from the snapshot', () => {
  const { costExport } = require('../../src/m1/cost-export');
  const result = costExport({ daily: rows }, { by: 'agent', from: '2026-10-02', to: '2026-10-03', previousFrom: '2026-09-30', previousTo: '2026-10-01' });
  assert.equal(result.fileName, 'AgentUsage-cost-2026-10-02_2026-10-03.csv'); assert.equal(result.rows, 2, 'only Codex and OpenCode have days in the window');
  assert.match(result.csv, /2026-10-02 至 2026-10-03,Agent,Codex,,/); assert.match(result.csv, /,OpenCode,,/);
  assert.equal(costExport({ daily: rows }, { by: 'model', from: null, to: null }).fileName, 'AgentUsage-cost-all.csv');
  for (const bad of [null, {}, { by: 'session' }, { by: 'model', from: '2026-10-03', to: '2026-10-01' }, { by: 'model', from: 'C:\\x', to: '2026-10-01' }, { by: 'model', from: '2026-10-01', to: null }, { by: 'model', rows: [{ tokens: 1 }], from: 1, to: 2 }])
    assert.throws(() => costExport({ daily: rows }, bad), /EXPORT_REJECTED/);
});

test('CSV: BOM and header, unknown cells empty, names guarded against formulas', () => {
  const items = costTable.table([...rows, day('2026-10-03', 'codex', 'openai', '=HYPERLINK("x")', { totalTokens: 1, unpricedTokens: { 'model-unpriced': 1 } })]);
  const text = costTable.csv(items, { range: '2026-10-01 至 2026-10-03', agentName: id => ({ codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode' })[id] || id });
  assert.ok(text.startsWith('﻿范围,分组,名称,服务商,使用方,Token,占比,')); assert.ok(text.endsWith('\r\n'));
  const lines = text.slice(1).trim().split('\r\n'), mini = lines.find(line => line.includes(',gpt-6.1-mini,'));
  assert.equal(mini.split(',')[7], '', 'unpriced: empty, not 0'); assert.match(mini, /价格目录中没有此模型（4000 Token）/);
  const sonnet = lines.find(line => line.includes('claude-sonnet-5-5')).split(',');
  assert.deepEqual(sonnet.slice(4, 9), ['Claude Code / OpenCode', '1500', '16.0%', '3.0000', '3.7500']);
  assert.ok(lines.some(line => line.includes(`"'=HYPERLINK(""x"")"`)), 'a formula-like name is quoted and prefixed');
});
