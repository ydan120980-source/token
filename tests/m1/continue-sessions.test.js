'use strict';
// Continue's usage names no session, so its sessions come from its own index and carry no usage. Invented records only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { roots } = require('../../src/m1/policy');
const { scanSources, sourceStamp } = require('../../src/m1/sources');
const { Store } = require('../../src/m1/store');
const { selectSessions } = require('../../src/m1/session-list');
const { transcript } = require('../../src/m1/transcript');
const MESSAGE = 'CONTINUE_PRIVATE_MESSAGE_SENTINEL';
const today = new Date(), old = new Date(Date.now() - 40 * 86400000);
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'continue-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'), selected = roots(home), sessions = path.join(path.dirname(path.dirname(selected.continue[0])), 'sessions');
  fs.mkdirSync(path.dirname(selected.continue[0]), { recursive: true }); fs.mkdirSync(sessions, { recursive: true });
  const db = new DatabaseSync(selected.continue[0]);
  db.exec('CREATE TABLE tokens_generated(id INTEGER PRIMARY KEY,model TEXT,provider TEXT,tokens_prompt INTEGER,tokens_generated INTEGER,timestamp TEXT)');
  db.prepare('INSERT INTO tokens_generated VALUES(1,?,?,?,?,?)').run('demo-model', 'demo', 100, 20, today.toISOString().slice(0, 19).replace('T', ' ')); db.close();
  fs.writeFileSync(path.join(sessions, 'sessions.json'), JSON.stringify([
    { sessionId: 'demo-new', title: '整理示例', dateCreated: String(today.getTime()), workspaceDirectory: 'file:///C:/demo/alpha' },
    { sessionId: 'demo-old', title: '更早的示例', dateCreated: String(old.getTime()), workspaceDirectory: 'not a path' },
    { sessionId: 'demo-bad', title: '没有时间', dateCreated: 'never' },
    { title: '没有编号', dateCreated: String(today.getTime()) },
  ]));
  fs.writeFileSync(path.join(sessions, 'demo-new.json'), JSON.stringify({ sessionId: 'demo-new', title: '整理示例', history: [{ message: { role: 'user', content: MESSAGE }, contextItems: [] }] }));
  return { dir, selected, sessions };
}

test('sessions come from the index, show no usage instead of zero, and no message is kept', async t => {
  const { dir, selected } = setup(t), store = new Store(path.join(dir, 'app'), selected);
  const scan = await scanSources(selected, 'salt', { reads: 0 });
  assert.equal(scan.continue.records.length, 1, 'usage is untouched');
  assert.equal(scan.continue.sessions.length, 2, 'a row without an id or time is skipped');
  store.ingestCollection(scan, { status: 'passed' }, {});
  const list = selectSessions(store.sessionList({ range: 'all' })), rows = list.sessions.filter(row => row.agent === 'continue');
  assert.equal(rows.length, 2);
  assert.deepEqual(require('../../src/m1/session-list-codec').unpack(store.sessionListPacked()).sessions.filter(item => item.agent === 'continue'), rows, 'compact delivery preserves unknown usage for indexed conversations too');
  assert.equal(store._sessionReferences().filter(item => item.agent === 'continue').length, 2, 'conversations without usage remain readable scan candidates');
  const row = rows.find(item => item.id === 'demo-new');
  assert.equal(row.title, '整理示例'); assert.match(row.cwd, /alpha$/); assert.equal(row.resumable, false);
  assert.deepEqual(row.models, []); assert.equal(row.days.length, 1);
  assert.equal(row.days[0].records, 0, 'no records is what says unknown');
  assert.equal(row.days[0].estimatedCostUsd, null); assert.equal(row.days[0].cacheRead, null);
  assert.equal(rows.find(item => item.id === 'demo-old').cwd, null, 'a folder that is not a path is not kept');
  assert(!JSON.stringify(store.state).includes(MESSAGE), 'no message reaches the ledger');
  assert(!fs.readFileSync(path.join(store.dir, 'statistics.json'), 'utf8').includes(MESSAGE));
  // A period only holds what was created in it.
  const week = selectSessions(store.sessionList({ range: '7' })).sessions.filter(item => item.agent === 'continue');
  assert.equal(week.find(item => item.id === 'demo-old').days.length, 0);
  assert.equal(week.find(item => item.id === 'demo-new').days.length, 1);
  // The widget of current sessions is about usage, so these stay out of it.
  assert.equal(store.sessionList({ range: 'all', recent: true }).sessions.filter(item => item.agent === 'continue').length, 0);
  // Saved and read back.
  const again = new Store(store.dir, selected);
  assert.equal(again.sessionList({ range: 'all' }).sessions.filter(item => item.agent === 'continue').length, 2);
  assert.equal((await transcript('continue', 'demo-new', selected.continue)).items[0].text, MESSAGE);
});

test('a new session in the index is noticed even when the usage database did not change', async t => {
  const { selected, sessions } = setup(t), before = sourceStamp(selected, 'salt', { reads: 0 });
  assert.equal(sourceStamp(selected, 'salt', { reads: 0 }), before);
  fs.writeFileSync(path.join(sessions, 'sessions.json'), JSON.stringify([{ sessionId: 'demo-later', title: '新', dateCreated: String(Date.now()) }]));
  fs.utimesSync(path.join(sessions, 'sessions.json'), new Date(), new Date(Date.now() + 5000));
  assert.notEqual(sourceStamp(selected, 'salt', { reads: 0 }), before);
});

test('a broken index or a chosen source that is not the default leaves usage alone', async t => {
  const { selected, sessions } = setup(t);
  fs.writeFileSync(path.join(sessions, 'sessions.json'), '{ not json');
  const scan = await scanSources(selected, 'salt', { reads: 0 });
  assert.equal(scan.continue.records.length, 1); assert.deepEqual(scan.continue.sessions, []);
  assert.deepEqual(scan.continue.errors, ['SOURCE_USAGE_ESTIMATED']);
});
