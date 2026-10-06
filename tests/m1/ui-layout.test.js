'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { positionTooltip, tooltipSummary } = require('../../design/desktop-reference/chart-ui');

test('many-model tooltip retains nonzero values and excludes unknowns from its numeric total', () => {
  const points = Array.from({ length: 33 }, (_, i) => ({ label: 'model-' + i, value: i + 1 }));
  const result = tooltipSummary([...points, { label: 'unknown', value: null }, { label: 'zero', value: 0 }]);
  assert.equal(result.total, 561); // Independent arithmetic series: 33 * 34 / 2.
  assert.equal(result.entries.length, 33);
  assert.equal(result.entries[0].label, 'model-32');
  assert.equal(result.entries.at(-1).label, 'model-0');
  assert.equal(result.zeroCount, 1);
  assert.equal(result.unknownCount, 1);
  assert.equal(tooltipSummary([{ value: null }]).total, null);
});

test('tooltip follows its anchor and stays inside narrow and wide plot boundaries', () => {
  for (const width of [320, 600, 1000]) {
    const bounds = { width, height: 300 }, panel = { width: 280, height: 260 };
    for (const x of [0, width / 2, width]) for (const y of [0, 150, 300]) {
      const p = positionTooltip(bounds, panel, { x, y });
      assert.ok(p.x >= 8 && p.y >= 8);
      assert.ok(p.x + panel.width <= bounds.width - 8);
      assert.ok(p.y + panel.height <= bounds.height - 8);
    }
  }
  const left = positionTooltip({ width: 1000, height: 300 }, { width: 280, height: 150 }, { x: 150, y: 100 });
  const right = positionTooltip({ width: 1000, height: 300 }, { width: 280, height: 150 }, { x: 900, y: 100 });
  assert.notEqual(left.x, right.x);
  assert.ok(left.x > 150 && right.x < 900);
});
