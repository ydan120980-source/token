'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { SessionLabels, FILE } = require('../../src/m1/session-labels');
const KEY = 'a'.repeat(64), OTHER = 'b'.repeat(64);
function dir(t) { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'labels-')); t.after(() => fs.rmSync(value, { recursive: true, force: true })); return value; }

test('names and pins persist in the app file only, keyed by the hashed session key', t => {
  const folder = dir(t), labels = new SessionLabels(folder);
  assert.deepEqual(labels.all(), {});
  assert.deepEqual(labels.set(KEY, { alias: '  重构\n计费  ' }), { [KEY]: { alias: '重构 计费' } });
  assert.deepEqual(labels.set(KEY, { pinned: true }), { [KEY]: { alias: '重构 计费', pinned: true } });
  labels.set(OTHER, { pinned: true });
  assert.deepEqual(new SessionLabels(folder).all(), { [KEY]: { alias: '重构 计费', pinned: true }, [OTHER]: { pinned: true } }, 'read back after restart');
  assert.deepEqual(labels.set(KEY, { alias: null, pinned: false }), { [OTHER]: { pinned: true } }, 'an empty label is removed');
  assert.deepEqual(labels.set(OTHER, { alias: '   ' }), { [OTHER]: { pinned: true } }, 'a blank name is no name');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(folder, FILE), 'utf8'))), ['schemaVersion', 'labels']);
});

test('a reading position is a turn number only, beside the name and removed at the start', t => {
  const folder = dir(t), labels = new SessionLabels(folder);
  assert.deepEqual(labels.set(KEY, { turn: 12 }), { [KEY]: { turn: 12 } });
  labels.set(KEY, { alias: '名字' });
  assert.deepEqual(new SessionLabels(folder).all(), { [KEY]: { alias: '名字', turn: 12 } }, 'read back after restart');
  assert.deepEqual(labels.set(KEY, { turn: null }), { [KEY]: { alias: '名字' } });
  for (const turn of [0, -1, 1.5, '3', 100001]) assert.throws(() => labels.set(KEY, { turn }), /SESSION_LABEL_INVALID/, String(turn));
  fs.writeFileSync(path.join(folder, FILE), JSON.stringify({ schemaVersion: 'SessionLabelsV1', labels: { [KEY]: { turn: 'x' }, [OTHER]: { turn: 3, text: '对话内容' } } }));
  assert.deepEqual(new SessionLabels(folder).all(), { [OTHER]: { turn: 3 } }, 'nothing else is read from the file');
});

test('invalid keys, fields and files are refused without changing saved labels', t => {
  const folder = dir(t), labels = new SessionLabels(folder);
  labels.set(KEY, { alias: 'kept' });
  for (const key of ['../x', 'A'.repeat(64), '', 7]) assert.throws(() => labels.set(key, { pinned: true }), /SESSION_NOT_FOUND/);
  for (const patch of [null, [], {}, { cwd: 'C:\\x' }, { alias: 7 }, { alias: 'x'.repeat(401) }, { pinned: 'yes' }]) assert.throws(() => labels.set(KEY, patch), /SESSION_LABEL_INVALID/, JSON.stringify(patch));
  assert.deepEqual(labels.all(), { [KEY]: { alias: 'kept' } });
  fs.writeFileSync(path.join(folder, FILE), JSON.stringify({ schemaVersion: 'Other', labels: { [KEY]: { alias: 'x' } } }));
  assert.deepEqual(new SessionLabels(folder).all(), {}, 'a foreign file means no labels');
  fs.writeFileSync(path.join(folder, FILE), JSON.stringify({ schemaVersion: 'SessionLabelsV1', labels: { [KEY]: { alias: 'ok', cwd: 'C:\\x' }, bad: { pinned: true } } }));
  assert.deepEqual(new SessionLabels(folder).all(), { [KEY]: { alias: 'ok' } }, 'only whitelisted fields and valid keys are read');
});
test('a group is the person\'s own, beside the other labels, and an old archive mark is dropped', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labels-'));
  try {
    const labels = new SessionLabels(dir), key = 'a'.repeat(64);
    assert.deepEqual(labels.set(key, { group: '  修图表  ' })[key], { group: '修图表' });
    assert.equal(labels.set(key, { group: 'x'.repeat(100) })[key].group.length, 40, 'a name is short');
    assert.deepEqual(new SessionLabels(dir).all()[key], { group: 'x'.repeat(40) }, 'kept across a restart');
    assert.equal(labels.set(key, { group: null })[key], undefined, 'nothing left, nothing kept');
    assert.throws(() => labels.set(key, { group: 3 }), /SESSION_LABEL_INVALID/);
    assert.throws(() => labels.set(key, { archived: true }), /SESSION_LABEL_INVALID/, 'archiving is gone');
    const old = 'b'.repeat(64), only = 'c'.repeat(64);
    fs.writeFileSync(path.join(dir, 'session-labels.json'), JSON.stringify({ schemaVersion: 'SessionLabelsV1', labels: { [old]: { group: '留下', archived: true }, [only]: { archived: true } } }));
    assert.deepEqual(new SessionLabels(dir).all(), { [old]: { group: '留下' } }, 'a file from before keeps everything but the mark');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
