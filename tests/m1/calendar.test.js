'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { localDay, startFor } = require('../../design/desktop-reference/usage-math');
test('today follows the snapshot timezone across midnight and the year boundary', () => {
  assert.equal(localDay('Asia/Shanghai', '2026-10-03T15:59:59Z'), '2026-10-03');
  assert.equal(localDay('Asia/Shanghai', '2026-10-03T16:00:00Z'), '2026-10-04');
  assert.equal(localDay('UTC', '2026-10-03T16:00:00Z'), '2026-10-03');
  const newYear = localDay('Asia/Shanghai', '2026-12-31T16:00:00Z');
  assert.equal(newYear, '2027-01-01');
  assert.equal(startFor(newYear, 'today', '2026-10-03'), '2027-01-01');
  assert.equal(startFor(newYear, '7', '2026-10-03'), '2026-12-26');
});
