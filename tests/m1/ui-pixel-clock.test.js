'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { freezeFixtureTimes, installSourceClock } = require('../../scripts/m1/ui-pixel-clock');
const fixed = Date.parse('2026-10-26T11:51:00Z');

test('pixel fixture preparation changes only temporary home file mtimes, preserving bytes and ledger', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-pixel-gate-')), home = path.join(root, 'home');
  try {
    fs.mkdirSync(path.join(home, 'nested'), { recursive: true });
    const source = path.join(home, 'nested', 'usage.jsonl'), ledger = path.join(root, 'statistics.json');
    const bytes = Buffer.from('{"date":"2026-10-25","tokens":23}\n');
    fs.writeFileSync(source, bytes); fs.writeFileSync(ledger, 'preserved ledger');
    const ledgerBefore = fs.statSync(ledger).mtimeMs;
    assert.deepEqual(freezeFixtureTimes(home, root, fixed), { files: 1, mtime: new Date(fixed).toISOString() });
    assert.equal(fs.statSync(source).mtimeMs, fixed); assert.deepEqual(fs.readFileSync(source), bytes);
    assert.equal(fs.statSync(ledger).mtimeMs, ledgerBefore); assert.equal(fs.readFileSync(ledger, 'utf8'), 'preserved ledger');
    assert.throws(() => freezeFixtureTimes(root, root, fixed), /ROOT_REJECTED/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('source clock wrapper replaces only known checkedAt, without changing dates, values or unknown metadata', async () => {
  const report = { schemaVersion: 'SourceDiscoveryV1', checkedAt: '2026-10-27T10:00:00Z',
    sources: [{ latest: '2026-10-26T11:51:00Z', files: 2, paths: [{ latest: null }] }], unsupported: [],
    fixtureSentinel: { date: '2026-10-25', tokens: 23, price: null, state: 'partial' } };
  const before = structuredClone(report), other = () => 'unchanged';
  const ipcMain = { _invokeHandlers: new Map([['usage:sources', async () => report], ['usage:get', other]]) };
  installSourceClock({ ipcMain }, fixed);
  const result = await ipcMain._invokeHandlers.get('usage:sources')();
  assert.deepEqual(result, { ...before, checkedAt: new Date(fixed).toISOString() });
  assert.notEqual(result, report); assert.equal(result.sources, report.sources); assert.deepEqual(report, before);
  assert.equal(ipcMain._invokeHandlers.get('usage:get'), other);
  report.checkedAt = null;
  assert.equal((await ipcMain._invokeHandlers.get('usage:sources')()).checkedAt, null);
});
