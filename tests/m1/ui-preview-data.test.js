'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectSnapshot } = require('../../design/desktop-reference/local-snapshot');
const { startFor, series, disjointMix } = require('../../design/desktop-reference/usage-math');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readSavedSnapshot } = require('../../scripts/m1/prepare-ui-preview');
function row(date, model, tokens, cost) { return { date, agent: 'codex', entry: 'desktop', provider: 'openai', model, totalTokens: tokens, inputUncached: tokens - 12, output: 10, cacheRead: 2, cacheWrite: 0, reasoning: null, records: 1, pricedTokens: cost === null ? 0 : tokens, estimatedCostUsd: cost, partialRecords: 0 }; }
test('preview snapshot preserves logged model names, nulls and zero with a statistics whitelist', () => {
  const original = { schemaVersion: 'UsageSnapshotV1', sequence: 7, timezone: 'Asia/Shanghai', daily: [{ ...row('2026-10-03', 'custom-route/model-a', 120, null), text: 'BODY_SENTINEL', title: 'TITLE_SENTINEL', path: 'PATH_SENTINEL', account: 'ACCOUNT_SENTINEL' }], salt: 'SALT_SENTINEL', sources: [{ agent: 'codex', status: 'partial', realSampleVerified: false, errors: ['PATH_SENTINEL'], email: 'EMAIL_SENTINEL' }], priceCatalog: { version: 'fixed/1' } };
  const selected = selectSnapshot(original);
  assert.equal(selected.daily[0].model, 'custom-route/model-a');
  assert.equal(selected.daily[0].reasoning, null);
  assert.equal(selected.daily[0].cacheWrite, 0);
  assert.equal(selected.daily[0].estimatedCostUsd, null);
  assert.doesNotMatch(JSON.stringify(selected), /SENTINEL/);
  assert.equal(selected.sources[0].status, 'partial');
  assert.deepEqual(selectSnapshot(selected), selected);
  assert.throws(() => selectSnapshot({ version: 1, records: {} }), /INVALID_USAGE_SNAPSHOT/);
  assert.throws(() => selectSnapshot({ ...original, daily: [{ ...original.daily[0], totalTokens: -1 }] }), /INVALID_STATISTIC/);
});
test('range boundaries include today and cumulative model curves match selected totals in both orders', () => {
  assert.equal(startFor('2026-10-03', '7', '2026-01-01'), '2026-09-27');
  assert.equal(startFor('2026-10-03', '30', '2026-01-01'), '2026-09-04');
  const rows = [row('2026-10-01', 'a', 120, 1), row('2026-10-02', 'a', 240, null), row('2026-10-03', 'a', 360, 3), row('2026-10-03', 'b', 500, 9)];
  const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
  assert.deepEqual(series(rows, 'a', days, 'total', 'tokens', days[0]), [120, 360, 720]);
  assert.deepEqual(series(rows, 'a', [...days].reverse(), 'total', 'tokens', days[0]), [720, 360, 120]);
  assert.deepEqual(series(rows, 'a', days, 'total', 'cost', days[0]), [1, 1, 4]);
  assert.deepEqual(series(rows, 'a', days, 'daily', 'cost', days[0]), [1, null, 3]);
});
test('unknown daily coverage and incomplete rolling windows remain blank', () => {
  const rows = [row('2026-10-03', 'a', 120, null)];
  assert.deepEqual(series(rows, 'a', ['2026-10-02', '2026-10-03'], 'daily', 'tokens', '2026-10-01', new Set(['2026-10-03'])), [null, 120]);
  assert.deepEqual(series(rows, 'a', ['2026-10-03'], 'average', 'tokens', '2026-01-01', new Set(['2026-10-03'])), [null]);
  assert.deepEqual(series(rows, 'a', ['2026-10-03'], 'total', 'cost', '2026-01-01'), [null]);
});
test('saved statistics projection reads current model fields without constructing or writing a Store', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'm1-preview-readonly-'));
  const file = path.join(directory, 'statistics.json');
  try {
    for (const model of ['logged-model-a', 'logged-model-b']) {
      const bytes = JSON.stringify({ sequence: 9, deviceId: 'fixture-device', updatedAt: '2026-10-03T00:00:00Z', records: { fixture: { ...row('2026-10-03', model, 120, null), timestamp: '2026-10-03T00:00:00Z', quality: 'measured' } }, statuses: {} });
      fs.writeFileSync(file, bytes);
      const snapshot = readSavedSnapshot(file);
      assert.equal(snapshot.daily[0].model, model);
      assert.equal(snapshot.daily[0].totalTokens, 120);
      assert.equal(fs.readFileSync(file, 'utf8'), bytes);
      assert.deepEqual(fs.readdirSync(directory), ['statistics.json']);
    }
  } finally { fs.unlinkSync(file); fs.rmdirSync(directory); }
});
test('distribution follows an independent disjoint ledger and excludes inconsistent totals', () => {
  const valid = { totalTokens: 120, inputUncached: 100, output: 10, cacheRead: 10, cacheWrite: 0, reasoning: 4 };
  const result = disjointMix([valid]);
  assert.deepEqual(result.values, [100, 6, 10, 0, 4]);
  assert.equal(result.values.reduce((a, b) => a + b), 120);
  const inconsistent = disjointMix([valid, { ...valid, totalTokens: 125 }]);
  assert.equal(inconsistent.total, 120);
  assert.equal(inconsistent.coverage, 120 / 245);
  const missing = disjointMix([{ ...valid, reasoning: null }]);
  assert.deepEqual(missing.displayValues, [100, null, 10, 0, null]);
  assert.equal(missing.coverage, 0);
});
test('hourly rows cover the whole history, split by local hour, and survive the whitelist', t => {
  const { Store } = require('../../src/m1/store');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'm1-hourly-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory, {}), now = new Date(), base = { agent: 'codex', entry: 'cli', provider: 'openai', model: 'gpt-4.1', quality: 'measured', inputUncached: 90, output: 10, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 100 };
  const at = (days, hour) => { const value = new Date(now); value.setDate(value.getDate() - days); value.setHours(hour, 5, 0, 0); return value.toISOString(); };
  store.state.records = { a: { ...base, timestamp: at(0, 0) }, b: { ...base, timestamp: at(0, 0), totalTokens: 50, inputUncached: 40 }, c: { ...base, timestamp: at(1, 13) }, d: { ...base, timestamp: at(10, 9) } };
  store.state.sequence = 1;
  const snapshot = store.snapshot(), today = snapshot.today;
  assert.equal(snapshot.daily.reduce((sum, row) => sum + row.totalTokens, 0), 350);
  assert.deepEqual(snapshot.hourly.map(row => [row.date === today, row.hour, row.totalTokens, row.records]), [[false, 9, 100, 1], [false, 13, 100, 1], [true, 0, 150, 2]]);
  const selected = selectSnapshot(snapshot);
  assert.equal(selected.today, today); assert.deepEqual(selected.hourly.map(row => row.hour), [9, 13, 0]);
  assert.deepEqual(selectSnapshot(selected), selected);
  assert.throws(() => selectSnapshot({ ...snapshot, hourly: [{ ...snapshot.hourly[0], hour: 24 }] }), /INVALID_USAGE_ROW/);
  assert.equal(selectSnapshot({ ...snapshot, hourly: undefined }).hourly.length, 0);
});
