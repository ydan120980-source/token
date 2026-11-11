'use strict';
// Antigravity adapter (AGENT-INTEGRATION-CONTRACT, section "Antigravity").
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { agentFixtures, protobuf, agyModels } = require('./agent-fixtures');
const { SENTINEL } = require('./fixtures');
const { scanSources, sourceStamp } = require('../../src/m1/sources');
const antigravity = require('../../src/m1/antigravity');
const { allowedFile } = require('../../src/m1/policy');
function setup(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return { root, fixture: agentFixtures(path.join(root, 'home')) }; }
const only = fixture => ({ antigravity: fixture.roots.antigravity });

test('model calls are read once with disjoint buckets, their models from the conversation database', async t => {
  const { fixture } = setup(t), scan = await scanSources(only(fixture), 'salt', { reads: 0 }), result = scan.antigravity;
  assert.deepEqual(result.errors, []); assert.equal(result.fileCount, 1, 'the short transcript and chunks are not read again');
  assert.deepEqual(result.records.map(r => [r.model, r.provider, r.inputUncached, r.output, r.cacheRead, r.cacheWrite, r.reasoning, r.totalTokens, r.entry, r.quality]),
    [[agyModels[0], 'google', 50, 10, 30, null, null, 90, 'desktop', 'measured'], [agyModels[1], 'anthropic', 20, 5, 15, null, null, 40, 'desktop', 'measured']]);
  assert.equal(result.sessions.length, 1);
  assert.equal(JSON.stringify(result).includes(SENTINEL), false, 'no transcript text or metadata bytes leave the parser');
});

test('a call count that does not match the recorded generations leaves every model unknown', async t => {
  const { fixture } = setup(t), database = path.join(path.dirname(fixture.roots.antigravity[0]), 'conversations', fixture.agyId + '.db');
  const db = new DatabaseSync(database); db.prepare('DELETE FROM gen_metadata WHERE idx = 1').run(); db.close();
  let result = (await scanSources(only(fixture), 'salt', { reads: 0 })).antigravity;
  assert.deepEqual(result.records.map(r => r.model), ['unknown', 'unknown']); assert.deepEqual(result.errors, ['ANTIGRAVITY_MODEL_UNPAIRED']);
  assert.equal(result.records.reduce((n, r) => n + r.totalTokens, 0), 130, 'usage still counts');
  fs.rmSync(database);
  result = (await scanSources(only(fixture), 'salt', { reads: 0 })).antigravity;
  assert.deepEqual(result.records.map(r => r.model), ['unknown', 'unknown'], 'a missing database leaves models unknown');
});

test('a database change alone changes the source stamp', async t => {
  const { fixture } = setup(t), database = path.join(path.dirname(fixture.roots.antigravity[0]), 'conversations', fixture.agyId + '.db');
  const before = sourceStamp(only(fixture), 'salt', { reads: 0 });
  const db = new DatabaseSync(database); const blob = protobuf([[1, protobuf([[19, Buffer.from('gemini-2.5-flash')]])]]); db.prepare('UPDATE gen_metadata SET data = ? WHERE idx = 0').run(blob); db.close();
  assert.notEqual(sourceStamp(only(fixture), 'salt', { reads: 0 }), before);
  assert.equal((await scanSources(only(fixture), 'salt', { reads: 0 })).antigravity.records[0].model, 'gemini-2.5-flash');
});

test('only conversation transcripts are allowed; metadata decoding rejects malformed bytes', () => {
  const logs = path.join('C:', 'home', '.gemini', 'antigravity', 'brain', 'id', '.system_generated', 'logs');
  assert.equal(allowedFile('antigravity', path.join(logs, 'transcript_full.jsonl')), true);
  assert.equal(allowedFile('antigravity', path.join(logs, 'transcript.jsonl')), true);
  for (const file of [path.join(logs, 'chunks', 'transcript_full', '0.jsonl'), path.join(logs, 'other.jsonl'), path.join('C:', 'home', '.gemini', 'antigravity', 'brain', 'id', '.system_generated', 'messages', 'transcript.jsonl')]) assert.equal(allowedFile('antigravity', file), false, file);
  assert.throws(() => antigravity.message(Buffer.from([0x0a, 0x05, 0x01])), /ANTIGRAVITY_METADATA_INVALID/);
  assert.equal(antigravity.message(protobuf([[19, Buffer.from('m')]])).get(19)[0].toString(), 'm');
});

test('a failed generation attempt without model ID does not prevent valid calls from pairing', async t => {
  const { fixture } = setup(t), database = path.join(path.dirname(fixture.roots.antigravity[0]), 'conversations', fixture.agyId + '.db');
  const db = new DatabaseSync(database);
  // Insert an error row without model field 19 (e.g. 429 RESOURCE_EXHAUSTED)
  const errorBlob = protobuf([[1, protobuf([[4, protobuf([[1, 1318]])]])]]);
  db.prepare('INSERT INTO gen_metadata VALUES(?,?,?)').run(999, errorBlob, errorBlob.length);
  db.close();
  const result = (await scanSources(only(fixture), 'salt', { reads: 0 })).antigravity;
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.records.map(r => r.model), agyModels);
});

test('an undecodable generation row keeps its place: only its call is unknown and no later model shifts', async t => {
  const { fixture } = setup(t), database = path.join(path.dirname(fixture.roots.antigravity[0]), 'conversations', fixture.agyId + '.db');
  const db = new DatabaseSync(database), broken = Buffer.from([0x0a, 0x05, 0x01]);
  db.prepare('UPDATE gen_metadata SET data = ? WHERE idx = 0').run(broken); db.close();
  const result = (await scanSources(only(fixture), 'salt', { reads: 0 })).antigravity;
  assert.deepEqual(result.records.map(r => r.model), ['unknown', agyModels[1]]);
});

test('a call still in flight leaves the models unknown, even when every committed generation shares one model, and pairs once committed', async t => {
  const { fixture } = setup(t), database = path.join(path.dirname(fixture.roots.antigravity[0]), 'conversations', fixture.agyId + '.db');
  const blob = protobuf([[1, protobuf([[19, Buffer.from('gemini-2.5-pro')]])]]);
  let db = new DatabaseSync(database); db.prepare('UPDATE gen_metadata SET data = ?').run(blob); db.close();
  const agyLogs = path.join(fixture.roots.antigravity[0], fixture.agyId, '.system_generated', 'logs');
  fs.appendFileSync(path.join(agyLogs, 'transcript_full.jsonl'), JSON.stringify({ type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', step_index: 5, created_at: fixture.time, input_tokens: 30, output_tokens: 8, cache_read_tokens: 10 }) + '\n');
  let result = (await scanSources(only(fixture), 'salt', { reads: 0 })).antigravity;
  assert.deepEqual(result.records.map(r => r.model), ['unknown', 'unknown', 'unknown'], 'the last call may use another model');
  assert.deepEqual(result.errors, ['ANTIGRAVITY_MODEL_UNPAIRED']);
  db = new DatabaseSync(database); db.prepare('INSERT INTO gen_metadata VALUES(?,?,?)').run(2, blob, blob.length); db.close();
  result = (await scanSources(only(fixture), 'salt', { reads: 0 })).antigravity;
  assert.deepEqual(result.records.map(r => r.model), ['gemini-2.5-pro', 'gemini-2.5-pro', 'gemini-2.5-pro']); assert.deepEqual(result.errors, []);
});

