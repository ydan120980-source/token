'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const math = require('../../design/desktop-reference/insights-math');
const { Store } = require('../../src/m1/store');
const { selectSnapshot } = require('../../design/desktop-reference/local-snapshot');
const close = (a, b) => assert(Math.abs(a - b) < 1e-9, a + ' != ' + b);
// Row shaped like a snapshot daily row; null marks a field the records did not report.
function row(agent, values, extra = {}) {
  const fields = ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning'], knownUsage = {}, knownRecords = {};
  for (const field of fields) if (values[field] !== null && values[field] !== undefined) { knownUsage[field] = values[field]; knownRecords[field] = 1; }
  if (knownRecords.output && knownRecords.reasoning) { knownUsage.outputPlain = values.output - values.reasoning; knownRecords.outputPlain = 1; }
  const total = ['inputUncached', 'output', 'cacheRead', 'cacheWrite'].reduce((sum, field) => sum + (values[field] ?? 0), 0);
  return { date: '2026-10-05', agent, model: agent + '-model', totalTokens: total, records: 1, knownUsage, knownRecords, ...Object.fromEntries(fields.map(field => [field, values[field] ?? null])), ...extra };
}
const codex = row('codex', { inputUncached: 100, output: 40, cacheRead: 900, cacheWrite: null, reasoning: 10 });
const claude = row('claude', { inputUncached: 5, output: 60, cacheRead: 300, cacheWrite: 20, reasoning: null });

test('category tiles separate "not recorded" and "contained in output" from unreported values', () => {
  const recorded = math.recordedFields([codex, claude]);
  const view = rows => Object.fromEntries(math.categoryView(rows, recorded).map(tile => [tile.key, tile]));
  const onlyClaude = view([claude]);
  assert.deepEqual([onlyClaude.output.label, onlyClaude.output.value, onlyClaude.output.state], ['输出（含推理）', 60, 'value']);
  assert.equal(onlyClaude.reasoning.state, 'combined'); assert.equal(onlyClaude.reasoning.value, null);
  const onlyCodex = view([codex]);
  assert.deepEqual([onlyCodex.outputPlain.label, onlyCodex.outputPlain.value], ['输出（不含推理）', 30]);
  assert.deepEqual([onlyCodex.cacheWrite.state, onlyCodex.cacheWrite.value], ['not-recorded', null]);
  const both = view([codex, claude]);
  assert.deepEqual([both.output.value, both.output.state], [100, 'value']);
  assert.deepEqual([both.reasoning.value, both.reasoning.state], [10, 'partial']);
  assert.deepEqual([both.cacheWrite.value, both.cacheWrite.state], [20, 'value'], 'a source without the field adds nothing and is not a gap');
  // A recording source that missed the field on some records is a lower bound; with none known it is unknown.
  const gap = { ...claude, cacheWrite: null, records: 2, knownRecords: { ...claude.knownRecords, cacheWrite: 1 } };
  assert.deepEqual([view([gap]).cacheWrite.value, view([gap]).cacheWrite.state], [20, 'partial']);
  const none = { ...claude, cacheWrite: null, knownUsage: { ...claude.knownUsage, cacheWrite: undefined }, knownRecords: { ...claude.knownRecords, cacheWrite: 0 } };
  assert.equal(math.categoryView([none], recorded).find(tile => tile.key === 'cacheWrite').state, 'unknown');
  assert(math.categoryView([], recorded).every(tile => tile.state === 'unknown'));
});

test('cost destination parts sum to the total, hit rate ignores unrecorded writes, unpriced stays null', () => {
  const recorded = math.recordedFields([codex, claude]);
  const priced = [{ ...codex, estimatedCostUsd: 3, pricedTokens: codex.totalTokens, costParts: { inputUncached: 1, output: 1.5, cacheRead: 0.5, cacheWrite: 0 }, cacheSavingsUsd: 2 }, { ...claude, estimatedCostUsd: null, pricedTokens: 0, costParts: null, cacheSavingsUsd: null }];
  const result = math.costDestination(priced, recorded);
  close(result.total, 3); close(result.parts.reduce((sum, part) => sum + part.value, 0), 3); close(result.parts.reduce((sum, part) => sum + part.share, 0), 1);
  close(result.savings, 2); close(result.pricedShare, codex.totalTokens / (codex.totalTokens + claude.totalTokens));
  close(result.hitRate, 1200 / (100 + 900 + 5 + 300 + 20));
  assert.equal(math.costDestination([priced[1]], recorded).total, null);
  assert.equal(math.cacheHitRate([], recorded), null);
});

test('shares rank by tokens and fold the tail; weekday x hour and efficiency stay honest', () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ agent: 'codex', model: 'm' + i, totalTokens: 10 * (9 - i), estimatedCostUsd: i === 8 ? null : 1 }));
  const items = math.shares(rows, 'model', 6);
  assert.equal(items.length, 7); assert.deepEqual(items.slice(0, 2).map(item => item.key), ['m0', 'm1']);
  assert.deepEqual([items[6].key, items[6].count, items[6].tokens], [null, 3, 30 + 20 + 10]);
  close(items.reduce((sum, item) => sum + item.tokenShare, 0), 1);
  assert.equal(math.shares([{ agent: 'x', totalTokens: 5, estimatedCostUsd: null }], 'agent')[0].cost, null);
  // 2026-10-05 is a Monday; 2026-10-11 a Sunday.
  const grid = math.weekHour([{ date: '2026-10-05', hour: 9, totalTokens: 50, records: 2 }, { date: '2026-10-12', hour: 9, totalTokens: 70, records: 1 }, { date: '2026-10-11', hour: 23, totalTokens: 10, records: 1 }]);
  assert.deepEqual([grid.cells[0][9].tokens, grid.cells[0][9].days, grid.cells[6][23].tokens], [120, 2, 10]);
  assert.deepEqual([grid.peak, grid.active, grid.peakHour, grid.peakWeekday], [{ weekday: 0, hour: 9 }, 2, 9, 0]);
  assert.equal(math.weekHour([]).peak, null);
  const recorded = math.recordedFields([codex]);
  const now = math.efficiency([{ ...codex, estimatedCostUsd: 2, pricedTokens: codex.totalTokens, records: 4 }, { ...codex, date: '2026-10-06', estimatedCostUsd: 4, pricedTokens: codex.totalTokens, records: 4 }], recorded);
  assert.deepEqual([now.activeDays, now.costPerDay, now.tokensPerRecord], [2, 3, codex.totalTokens * 2 / 8]); close(now.costPerMillion, 6 / (codex.totalTokens * 2) * 1e6);
  assert.equal(math.efficiency([{ ...codex, estimatedCostUsd: null }], recorded).costPerDay, null);
  close(math.change(12, 10), 0.2); assert.equal(math.change(5, 0), null); assert.equal(math.change(null, 3), null);
});

test('snapshot cost parts allocate the multiplied estimate exactly and cache savings use the uncached rate', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'insights-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir, {});
  store.setPrice({ provider: 'anthropic', model: 'claude-test', inputUncached: 2, output: 8, cacheRead: 0.5, cacheWrite: 2.5 });
  store.setBilling({ autoSync: false, defaults: { claude: { mode: 'actual', multiplier: 2 } }, mappings: {} });
  const base = { agent: 'claude', entry: 'cli', provider: 'anthropic', model: 'claude-test', quality: 'measured', timestamp: new Date().toISOString(), reasoning: null };
  store.state.records = { a: { ...base, inputUncached: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 0, totalTokens: 3e6 }, b: { ...base, model: 'unpriced-model', inputUncached: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } };
  store.state.sequence = 1;
  const snapshot = selectSnapshot(store.snapshot()), priced = snapshot.daily.find(r => r.model === 'claude-test'), unpriced = snapshot.daily.find(r => r.model === 'unpriced-model');
  close(priced.estimatedCostUsd, 21);
  close(priced.costParts.inputUncached, 4); close(priced.costParts.output, 16); close(priced.costParts.cacheRead, 1); close(priced.costParts.cacheWrite, 0);
  close(priced.cacheSavingsUsd, 3);
  assert.equal(unpriced.costParts, null); assert.equal(unpriced.cacheSavingsUsd, null);
  close(snapshot.hourly.find(r => r.model === 'claude-test').costParts.output, 16);
});
