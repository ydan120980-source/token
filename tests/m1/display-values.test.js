'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cost, reset, usd } = require('../../design/desktop-reference/display-values');

test('the shared money formatter preserves locale rounding, bounds and invalid-input behaviour', () => {
  const values = [0, -0, .004999, .005, 1.005, 2.675, -3.005, 1e-12, 123456789.12345, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, NaN, Infinity, -Infinity];
  for (let i = 0; i < 100; i++) values.push(i / 7);
  for (const value of values) assert.equal(usd(value), '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  for (const value of [null, undefined]) assert.throws(() => usd(value), TypeError, 'missing amounts must not become $0.00');
  for (const value of [1n, 'unknown', true, new Number(2)]) assert.equal(usd(value), '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
});
test('compact estimates retain the priced lower bound and distinguish ranges, partial prices and unknowns', () => {
  assert.deepEqual(cost(631.21, 722.84, .79), { text: '$631.21+', lower: 631.21, upper: 722.84, partial: true });
  assert.equal(cost(3, 3, .5).text, '$3.00+');
  assert.equal(cost(0, 0, 1).text, '$0.00');
  assert.equal(cost(null, null, 0).text, '未定价');
  assert.equal(cost(3, 3, 1).text, '$3.00');
});
test('elapsed and unknown reset dates stay unknown without inferring replenished quota', () => {
  const now = Date.parse('2026-10-03T08:00:00Z');
  assert.equal(reset(null, now), '重置未知');
  assert.equal(reset('invalid', now), '重置未知');
  assert.equal(reset('2026-10-03T07:00:00Z', now), '待刷新');
  assert.equal(reset('2026-10-03T10:14:00Z', now), '2 小时 14 分钟后');
});
