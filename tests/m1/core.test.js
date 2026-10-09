'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { fixtures, SENTINEL } = require('./fixtures');
const { normalize } = require('../../src/m1/normalize');
const { scanSources, parseObjects } = require('../../src/m1/sources');
const { Store, price } = require('../../src/m1/store');
const { readDatabase, query } = require('../../src/m1/sqlite-memory');
const { localPath } = require('../../src/m1/policy');
const { seal, Receiver } = require('../../src/m1/crypto');
function temporary(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function hashes(dir) { const result = {}; for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); if (item.isDirectory()) Object.assign(result, hashes(file)); else result[file] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } return result; }
test('five independent fixture ledgers; copied archive, migration, repeated scans, restart, partial retention and whitelist', async t => {
  const dir = temporary(t), home = path.join(dir, 'home'), f = fixtures(home), before = hashes(home), audit = { reads: 0 };
  const originalOpen = fs.openSync, originalRead = fs.readFileSync;
  fs.openSync = function(file, flags, ...args) { if (typeof file === 'string' && file.startsWith(home)) assert.equal(flags, fs.constants.O_RDONLY); return originalOpen.call(fs, file, flags, ...args); };
  fs.readFileSync = function(file, ...args) { if (typeof file === 'string') assert(!/auth\.json$/.test(file)); return originalRead.call(fs, file, ...args); };
  let scan;
  try { scan = await scanSources(f.roots, 'fixed-salt', audit); } finally { fs.openSync = originalOpen; fs.readFileSync = originalRead; }
  for (const [agent, expected] of Object.entries(f.expected)) { assert.equal(scan[agent].errors.length, 0, agent); assert.equal(scan[agent].records.reduce((s, r) => s + r.totalTokens, 0), expected, agent); }
  assert.deepEqual(hashes(home), before);
  const store = new Store(path.join(dir, 'app'), f.roots); store.ingest(scan, { status: 'passed' }); store.ingest(scan, { status: 'passed' });
  assert.equal(store.snapshot().daily.reduce((s, r) => s + r.totalTokens, 0), f.total);
  assert.equal(new Store(store.dir).snapshot().daily.reduce((s, r) => s + r.totalTokens, 0), f.total);
  const broken = structuredClone(scan); broken.codex.records = []; broken.codex.errors = ['SOURCE_BUSY']; broken.codex.partial = true; store.ingest(broken, { status: 'passed' });
  assert.equal(store.snapshot().daily.reduce((s, r) => s + r.totalTokens, 0), f.total);
  assert.equal(store.snapshot().sources[0].status, 'error');
  const incomplete = structuredClone(scan); incomplete.codex.records[0].quality = 'partial'; incomplete.codex.records[0].totalTokens = 0;
  store.ingest(incomplete, { status: 'passed' }); assert.equal(store.snapshot().daily.reduce((s, r) => s + r.totalTokens, 0), f.total);
  for (const value of [JSON.stringify(store.snapshot()), fs.readFileSync(path.join(store.dir, 'statistics.json'), 'utf8')]) { assert(!value.includes(SENTINEL)); assert(!value.includes(home)); assert(!value.includes('claude-msg')); }
  store.clear(); assert.equal(store.snapshot().daily.length, 0); assert.deepEqual(hashes(home), before);
});
test('missing fields stay null; cache/reasoning do not double count; invalid date/model and unpriced data', () => {
  const info = { time: '2026-10-01T00:00:00Z', model: 'gpt-4.1', id: 'id' };
  const r = normalize('codex', { input_tokens: 100, output_tokens: 20, cached_input_tokens: 40, reasoning_output_tokens: 10, cache_creation_input_tokens: 0 }, info, 's');
  assert.equal(r.totalTokens, 120); assert.equal(r.inputUncached, 60); assert.equal(r.reasoning, 10);
  assert.equal(normalize('codex', { total_tokens: 10 }, info, 's').inputUncached, null);
  assert.equal(price(normalize('codex', { total_tokens: 10 }, info, 's')), null);
  assert.equal(normalize('codex', { total_tokens: 10 }, { ...info, time: null }, 's'), null);
  assert.equal(normalize('codex', { total_tokens: 10 }, { ...info, model: 'email@example.com' }, 's').model, 'unknown');
  assert.equal(normalize('codex', { total_tokens: 10 }, { ...info, model: 'C:/Users/private' }, 's').model, 'unknown');
  assert(price(r) > 0);
  assert.equal(price({ ...r, model: 'unknown' }), null);
});
test('Codex cumulative repeated value and fork baseline do not count inherited usage', () => {
  const rows = [{ type: 'session_meta', payload: { id: 'fork', forked_from_id: 'parent' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } }];
  const event = { timestamp: '2026-10-01', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 }, last_token_usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } } } };
  rows.push(event, event);
  assert.equal(parseObjects('codex', rows, 's', 'fallback').reduce((s, r) => s + r.totalTokens, 0), 25);
});
test('Codex copied fork history merges; distinct parent/child usage with identical counters stays distinct', async t => {
  const dir = temporary(t), f = fixtures(path.join(dir, 'home')), original = path.join(f.roots.codex[0], 'session.jsonl');
  const rows = fs.readFileSync(original, 'utf8').trim().split('\n').map(JSON.parse);
  const child = structuredClone(rows); child[0].payload.id = 'separate-child'; child[0].payload.parent_thread_id = 'synthetic-session';
  fs.writeFileSync(path.join(f.roots.codex[0], 'child.jsonl'), child.map(JSON.stringify).join('\n'));
  const fork = structuredClone(rows); fork[0].payload.id = 'fork'; fork[0].payload.forked_from_id = 'synthetic-session';
  const latest = structuredClone(rows.at(-1)); latest.timestamp = new Date(Date.parse(latest.timestamp) + 1000).toISOString(); latest.payload.info.total_token_usage = { input_tokens: 170, output_tokens: 34, total_tokens: 204 }; latest.payload.info.last_token_usage = { input_tokens: 20, output_tokens: 4, total_tokens: 24 }; fork.push(latest);
  fs.writeFileSync(path.join(f.roots.codex[0], 'fork.jsonl'), fork.map(JSON.stringify).join('\n'));
  const scan = await scanSources(f.roots, 's', { reads: 0 });
  assert.equal(scan.codex.records.reduce((sum, r) => sum + r.totalTokens, 0), 384); // parent180 + distinct child180 + fork24
});
test('SQLite committed WAL is read in memory without writes or checkpoints', async t => {
  const dir = temporary(t), file = path.join(dir, 'opencode.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE ledger(n INTEGER); INSERT INTO ledger VALUES(37);');
  const before = hashes(dir), rows = await readDatabase(file, { reads: 0 }, image => query(image, 'SELECT n FROM ledger'));
  try { assert.deepEqual(rows, [{ n: 37 }]); assert.deepEqual(hashes(dir), before); } finally { db.close(); }
});
test('UNC and auth paths rejected', () => { assert.throws(() => localPath('\\\\server\\share')); assert.throws(() => localPath(path.resolve('auth.json'))); });
test('damaged or structurally invalid statistics are quarantined, not fatal', t => {
  const dir = temporary(t), app = path.join(dir, 'app'), file = path.join(app, 'statistics.json');
  fs.mkdirSync(app, { recursive: true });
  // Truncated JSON: previously threw LOCAL_STORAGE_INVALID and aborted start-up.
  const truncated = '{"version":1,"deviceId":"fixture","records":';
  fs.writeFileSync(file, truncated);
  const store = new Store(app, {});
  assert.equal(store.snapshot().daily.length, 0); assert.equal(store.state.sequence, 0);
  assert.equal(store.snapshot().recovered.length, 1);
  assert.equal(store.snapshot().recovered[0].file, 'statistics.json');
  assert.equal(store.snapshot().recovered[0].code, 'INVALID_JSON');
  assert.match(store.snapshot().recovered[0].quarantined, /^quarantine\/statistics-.*\.json$/);
  assert.equal(fs.readFileSync(path.join(app, store.snapshot().recovered[0].quarantined), 'utf8'), truncated, 'the bytes stay on disk for inspection');
  const rewritten = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(rewritten.sequence, 0, 'a fresh ledger replaces the damaged one, so the next start is clean');
  assert.notEqual(rewritten.deviceId, 'fixture');
  // Parsable but structurally wrong: same treatment, reported under its own code.
  fs.writeFileSync(file, JSON.stringify({ version: 1, deviceId: 'fixture', salt: 's', sequence: 'not-a-number', records: {}, statuses: {} }));
  const second = new Store(app, {});
  assert.equal(second.snapshot().recovered.length, 1);
  assert.equal(second.snapshot().recovered[0].code, 'LOCAL_STORAGE_INVALID');
  // Other state files recover independently and the app keeps working defaults.
  fs.writeFileSync(path.join(app, 'preferences.json'), '{oops');
  fs.writeFileSync(path.join(app, 'billing.json'), 'also broken');
  const third = new Store(app, {});
  assert.deepEqual(third.snapshot().recovered.map(entry => entry.file).sort(), ['billing.json', 'preferences.json']);
  assert.equal(third.settings.enabled, true);
  assert.deepEqual(third.snapshot().recovered.map(entry => entry.file).sort(), ['billing.json', 'preferences.json'], 'the recovery record survives later snapshots');
  // Exactly one quarantine directory per damaged file, and it is not created for a clean start.
  const clean = new Store(path.join(dir, 'clean'), {});
  assert.deepEqual(clean.snapshot().recovered, []);
  assert.ok(!fs.existsSync(path.join(dir, 'clean', 'quarantine')));
});
test('calendar ranges include today and respect month/year boundaries', () => {
  const { startFor } = require('../../design/desktop-reference/usage-math');
  assert.equal(startFor('2026-01-03', '7'), '2025-12-28');
  assert.equal(startFor('2026-03-01', '30'), '2026-01-31');
  assert.equal(startFor('2026-10-02', 'today'), '2026-10-02');
  assert.equal(startFor('2026-10-02', 'all', '2025-01-01'), '2025-01-01');
});
test('OpenCode/MiMo reasoning is disjoint at source and part of normalized output', () => {
  const r = normalize('opencode', { input: 100, output: 10, reasoning: 5, cache: { read: 20, write: 0 } }, { model: 'gpt-4.1', time: '2026-10-01', id: 'a' }, 's', 'exclusive');
  assert.equal(r.output, 15); assert.equal(r.totalTokens, 135); assert.equal(r.reasoning, 5);
  assert.equal(normalize('codex', { input_tokens: 10, output_tokens: 1, cached_input_tokens: 20 }, { time: '2026-10-01' }, 's').quality, 'invalid-cache');
});
test('same OpenCode-schema usage copied into a MiMo database counts once', async t => {
  const dir = temporary(t), f = fixtures(path.join(dir, 'home'));
  fs.copyFileSync(path.join(f.roots.opencode[0], 'opencode.db'), path.join(f.roots.mimo[0], 'mimocode.db'));
  const scan = await scanSources(f.roots, 'salt', { reads: 0 });
  assert.equal(scan.opencode.records.length, 1); assert.equal(scan.mimo.records.length, 0);
});
test('WorkBuddy fallback is superseded per session, including persisted history', async t => {
  const dir = temporary(t), home = path.join(dir, 'home'), f = fixtures(home), file = f.roots.workbuddy[1];
  const db = new DatabaseSync(file); db.exec('CREATE TABLE session_usage(session_id TEXT,used INTEGER,updated_at INTEGER)'); db.prepare('INSERT INTO session_usage VALUES(?,?,?)').run('work-session', 120, Date.now()); db.close();
  const store = new Store(path.join(dir, 'app'), f.roots);
  const initial = await scanSources({ workbuddy: [file] }, store.state.salt, { reads: 0 }); store.ingest(initial, { status: 'passed' });
  const detail = path.join(f.roots.workbuddy[0], 'session.jsonl'), row = JSON.parse(fs.readFileSync(detail, 'utf8')); row.sessionId = 'work-session'; fs.writeFileSync(detail, JSON.stringify(row));
  const scan = await scanSources(f.roots, store.state.salt, { reads: 0 }); store.ingest(scan, { status: 'passed' });
  assert.equal(store.snapshot().daily.filter(r => r.agent === 'workbuddy').reduce((s, r) => s + r.totalTokens, 0), 120);
});
test('AES GCM correct key, wrong key, ciphertext/header tamper and replay', () => {
  const key = crypto.randomBytes(32), snapshot = { schemaVersion: 'UsageSnapshotV1', deviceId: 'synthetic', sequence: 2, daily: [] }, envelope = seal(snapshot, key);
  assert.equal(Buffer.from(envelope.nonce, 'base64').length, 12); assert.equal(Buffer.from(envelope.tag, 'base64').length, 16);
  assert.throws(() => new Receiver(crypto.randomBytes(32), 'synthetic').open(envelope));
  const altered = structuredClone(envelope); altered.ciphertext = Buffer.alloc(10).toString('base64'); assert.throws(() => new Receiver(key, 'synthetic').open(altered));
  const header = structuredClone(envelope); header.header.sequence = 3; assert.throws(() => new Receiver(key, 'synthetic').open(header));
  const receiver = new Receiver(key, 'synthetic'); assert.deepEqual(receiver.open(envelope), snapshot); assert.throws(() => receiver.open(envelope)); assert.throws(() => receiver.open(seal({ ...snapshot, sequence: 1 }, key)));
});
