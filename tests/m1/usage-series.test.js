'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { seriesByModel, shift } = require('../../src/m1/usage-math');
test('batched curves retain a calendar ledger: gaps, null cost, zero, prior-window history and both orders', () => {
  const days = Array.from({ length: 32 }, (_, i) => shift('2026-09-01', i)), rows = [];
  for (const date of days) rows.push({ date, model: 'a', totalTokens: 30, estimatedCostUsd: null }, { date, model: 'b', totalTokens: 0, estimatedCostUsd: 0 });
  rows.push({ date: days[31], model: 'a', totalTokens: 15, estimatedCostUsd: 3 });
  const observed = new Set(days);
  const curves = (display, metric, order = days) => seriesByModel(rows, ['a', 'b', 'absent'], order, display, metric, days[0], observed);
  assert.deepEqual(curves('daily', 'tokens').get('a'), [...Array(31).fill(30), 45]);
  assert.deepEqual(curves('daily', 'cost').get('a'), [...Array(31).fill(null), 3]);
  assert.deepEqual(curves('daily', 'cost').get('b'), Array(32).fill(0));
  assert.deepEqual(curves('daily', 'cost').get('absent'), Array(32).fill(0));
  // The 30-day average is the mean of the recorded days among the last 30, from 7 of them on.
  assert.deepEqual(curves('average', 'tokens').get('a'), [...Array(6).fill(null), ...Array(25).fill(30), 30.5]);
  assert.deepEqual(curves('average', 'tokens').get('absent'), [...Array(6).fill(null), ...Array(26).fill(0)], 'a recorded day without the series is a known zero');
  assert.deepEqual(curves('average', 'cost').get('a'), Array(32).fill(null), 'unpriced days are unknown, not zero: one priced day is not an average');
  assert.deepEqual(curves('total', 'tokens').get('a'), days.map((_, i) => (i + 1) * 30 + (i === 31 ? 15 : 0)));
  for (const display of ['daily', 'average', 'total']) for (const metric of ['tokens', 'cost'])
    for (const [model, values] of curves(display, metric)) assert.deepEqual(curves(display, metric, [...days].reverse()).get(model), [...values].reverse());
  // A seven-day view may use earlier rows for its 30-calendar-day average.
  assert.deepEqual(curves('average', 'tokens', days.slice(25)).get('a'), [30, 30, 30, 30, 30, 30, 30.5]);
  observed.delete(days[30]);
  assert.equal(curves('daily', 'tokens').get('a')[30], null);
  assert.equal(curves('average', 'tokens').get('a')[31], (28 * 30 + 45) / 29, 'an unrecorded day leaves the window instead of counting as zero');
  assert.equal(curves('total', 'tokens').get('a')[31], 975);
  assert.deepEqual(seriesByModel([], ['a'], [], 'average', 'cost', days[0]).get('a'), []);
  // Every third day unrecorded: the average stays the recorded days' mean instead of vanishing.
  const sparse = Array.from({ length: 40 }, (_, i) => shift('2026-09-01', i)), kept = sparse.filter((_, i) => i % 3);
  const values = seriesByModel(kept.map(date => ({ date, model: 'c', totalTokens: 30, estimatedCostUsd: null })), ['c'], sparse, 'average', 'tokens', sparse[0], new Set(kept)).get('c');
  assert.equal(values.findIndex(Number.isFinite), 10); assert.ok(values.slice(10).every(value => value === 30));
});
