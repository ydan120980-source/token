'use strict';
// Each day of a cost detail: what was priced, a range where the sources give one, and unknown as unknown.
const test = require('node:test'), assert = require('node:assert/strict');
const { table } = require('../../src/m1/cost-table');
test('a day keeps its own cost: summed, ranged, partial, or unknown rather than zero', () => {
  const row = (date, tokens, cost, upper, priced) => ({ date, agent: 'codex', provider: 'demo', model: 'demo-model', totalTokens: tokens, records: 1, pricedTokens: priced, boundedTokens: 0, estimatedCostUsd: cost, estimatedCostUpperUsd: upper, knownUsage: {}, knownRecords: {}, unpricedTokens: {}, incompleteTokens: {}, pricingReasons: {} });
  const [item] = table([row('2026-11-01', 10, 1, 1, 10), row('2026-11-01', 10, 2, 3, 10), row('2026-11-02', 10, null, null, 0), row('2026-11-03', 20, 1, 1, 5)]);
  assert.deepEqual(item.series, [
    { date: '2026-11-01', tokens: 20, cost: 3, costUpper: 4, partial: false },
    { date: '2026-11-02', tokens: 10, cost: null, costUpper: null, partial: true },
    { date: '2026-11-03', tokens: 20, cost: 1, costUpper: 1, partial: true },
  ]);
});
