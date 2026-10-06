'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const {DatabaseSync} = require('node:sqlite');
const {agentFixtures} = require('./agent-fixtures');
const {scanSources, parseObjects, parseDatabase} = require('../../src/m1/sources');
const {Store, atomic} = require('../../src/m1/store');
const {roots, allowedFile, SOURCES} = require('../../src/m1/policy');
const extended = require('../../src/m1/extended-sources');
const {selectSnapshot} = require('../../design/desktop-reference/local-snapshot');
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-agents-')); t.after(() => fs.rmSync(root, {recursive:true,force:true})); return root; }
function hashes(root) { const files = {}; for (const e of fs.readdirSync(root,{withFileTypes:true})) { const f = path.join(root,e.name); if(e.isDirectory()) Object.assign(files,hashes(f)); else files[f] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); } return files; }
test('nine real-format fixture sources: independent token totals, duplicate archives, retries, inherited fork, privacy and restart', async t => {
  const root = temporary(t), home = path.join(root,'home'), fixture = agentFixtures(home), before = hashes(home), audit = {reads:0};
  const scan = await scanSources(fixture.roots,'salt',audit);
  assert.deepEqual(SOURCES, Object.keys(fixture.expected));
  for (const [agent,total] of Object.entries(fixture.expected)) {
    assert.deepEqual(scan[agent].errors,[],agent); assert.equal(scan[agent].records.reduce((sum,r) => sum+r.totalTokens,0),total,agent);
  }
  assert.equal(scan.deepseek.fileCount,1); assert.equal(scan.gemini.records.length,1);
  const g = scan.gemini.records[0]; assert.equal(g.inputUncached,60); assert.equal(g.output,25); assert.equal(g.reasoning,5); assert.equal(g.cacheWrite,null);
  assert.equal(scan.cursor.records[0].quality,'measured'); assert.equal(scan.zcode.records[0].inputUncached,60);
  assert.deepEqual(hashes(home),before);
  const serialized = JSON.stringify(scan); assert(!serialized.includes(fixture.sentinel)); assert(!serialized.includes(home));
  const store = new Store(path.join(root,'app'),fixture.roots); store.ingest(scan,{status:'passed'}); store.ingest(scan,{status:'passed'});
  assert.equal(store.snapshot().daily.reduce((s,r) => s+r.totalTokens,0),fixture.total);
  const reopened = new Store(store.dir,fixture.roots), snapshot = selectSnapshot(reopened.snapshot());
  assert.equal(snapshot.sources.length,9); assert.equal(snapshot.daily.reduce((s,r) => s+r.totalTokens,0),fixture.total);
  assert(!JSON.stringify(snapshot).includes(fixture.sentinel));
  // Failed re-read preserves the last valid ledger rather than zeroing history.
  fs.writeFileSync(fixture.roots.cursor[0],'{torn');
  reopened.ingest(await scanSources(fixture.roots,'salt',audit),{status:'passed'});
  assert.equal(reopened.snapshot().daily.reduce((s,r) => s+r.totalTokens,0),fixture.total);
});
test('old preferences gain new default roots without overwriting custom roots, pause, bills, or statistics', t => {
  const root = temporary(t), selected = roots(path.join(root,'fixture'));
  atomic(path.join(root,'app','preferences.json'),{enabled:false,roots:{codex:[],claude:[path.join(root,'custom')]}});
  const store = new Store(path.join(root,'app'),selected);
  assert.equal(store.settings.enabled,false); assert.deepEqual(store.settings.roots.codex,[]); assert.equal(store.settings.roots.claude[0],path.join(root,'custom'));
  assert.deepEqual(store.settings.roots.gemini,selected.gemini); assert.deepEqual(store.settings.roots.cursor,selected.cursor);
});
test('allowlist rejects unsupported agents, auth/global state/checkpoints, noncanonical generations and arbitrary Gemini JSON', () => {
  for (const [agent,file] of [['unknown','opencode.db'],['cursor','state.vscdb'],['cursor','agents.ndjson'],['cursor','run_events.ndjson'],['cursor','checkpoints.ndjson'],['gemini','chats/config.json'],['deepseek','session.v0.jsonl'],['deepseek','session.v04.jsonl'],['zcode','auth.json']]) assert.equal(allowedFile(agent,file),false,agent+file);
  assert.equal(allowedFile('gemini',path.join('project','chats','session-known.jsonl')),true);
  assert.equal(allowedFile('deepseek','session.v4.jsonl.zstd'),true);
  assert.equal(allowedFile('cursor','Usage.CSV'),true);
});
test('Cursor CSV: quoted fields, duplicates retain multiplicity, copied exports dedupe, timezone and schema errors are explicit', async t => {
  const root = temporary(t), header = 'Date,Model,Input Tokens,Cache Read Tokens,Cache Write Tokens,Output Tokens,Total Tokens,Note\r\n';
  const line = '2026-10-05T12:00:00Z,gpt-4.1,60,40,10,20,130,"private,\r\ntext"\r\n', text = header + line + line;
  const records = extended.cursorCsv(text,'salt'); assert.equal(records.length,2); assert.equal(records[0].totalTokens,130); assert.notEqual(records[0].id,records[1].id);
  assert(!JSON.stringify(records).includes('private')); assert.throws(() => extended.cursorCsv('Date,Model,Messages\n2026-10-05,gpt-4.1,12','salt'),/CURSOR_CSV_SCHEMA/);
  const bad = extended.cursorCsv(header + line.replace('2026-10-05T12:00:00Z','2026/10/05 12:00'),'salt'); assert.equal(bad.length,0); assert.deepEqual(bad.warnings,['SOURCE_ROW_INVALID']);
  assert.equal(extended.cursorCsv(header + line.replace('2026-10-05','2026-02-30'),'salt').length,0);
  const split = extended.cursorCsv('Date,Model,Input Tokens (w/ Cache Write),Input Tokens (w/o Cache Write),Cache Read Tokens,Output Tokens,Total Tokens\n2026-10-05T12:00:00Z,gpt-4.1,70,60,40,20,130\n','salt'); assert.equal(split[0].cacheWrite,10); assert.equal(split[0].inputUncached,60); assert.equal(split[0].totalTokens,130);
  assert.throws(() => extended.cursorCsv(header + line.slice(0,-3),'salt'),/CURSOR_CSV_INVALID/);
  for (const name of ['a.csv','copy.csv']) fs.writeFileSync(path.join(root,name),text);
  const scan = await scanSources({cursor:[root]},'salt',{reads:0}); assert.equal(scan.cursor.records.length,2);
  fs.writeFileSync(path.join(root,'runs.ndjson'),''); const conflict = await scanSources({cursor:[root]},'salt',{reads:0}); assert.deepEqual(conflict.cursor.errors,['CURSOR_SOURCE_MODE_CONFLICT']); assert.equal(conflict.cursor.records.length,0);
});
test('DeepSeek current/historical accounting: assembled usage wins, stream attempts billed, fork cut and sequence enforced', t => {
  const fixture = agentFixtures(path.join(temporary(t),'home')), rows = fixture.deepseekRows;
  for (const version of [2,3,4]) {
    const parsed = extended.deepseek([{...rows[0],version},...rows.slice(1)],'salt','session.v'+version+'.jsonl'); assert.equal(parsed.reduce((s,r) => s+r.totalTokens,0),135);
  }
  const old = extended.deepseek(rows,'salt','session.v4.jsonl');
  const migrated = [rows[0],{seq:0,type:'system/message',time:Date.parse(fixture.time),data:{}},...rows.slice(1).map(e => ({...e,seq:e.seq+1}))];
  assert.deepEqual(extended.deepseek(migrated,'salt','session.v4.jsonl').map(r => r.id),old.map(r => r.id));
  assert.throws(() => extended.deepseek([{...rows[0],version:5}],'salt','session.v5.jsonl'),/FORMAT_UNSUPPORTED/);
  assert.throws(() => extended.deepseek([rows[0],rows[1]],'salt','session.v4.jsonl'),/SEED_INVALID/);
  const broken = extended.deepseek([...rows.slice(0,4),{...rows[4],seq:9},rows[5]],'salt','session.v4.jsonl'); assert.equal(broken.length,0); assert.deepEqual(broken.warnings,['DEEPSEEK_LOG_INCOMPLETE']);
  const plain = rows.map(r => JSON.stringify(r)).join('\n'); assert.equal(extended.decodeDeepseek(zlib.zstdCompressSync(Buffer.from(plain)),true),plain);
  assert.throws(() => extended.decodeDeepseek(Buffer.from('bad frame'),true),/COMPRESSION_INVALID/);
});
test('DeepSeek selects highest generation without falling back to older readable logs; corrupt middle stops the contiguous prefix', async t => {
  const fixture = agentFixtures(path.join(temporary(t),'home')), file = path.join(fixture.roots.deepseek[0],'project','child','session.v5.jsonl');
  fs.writeFileSync(file, JSON.stringify({...fixture.deepseekRows[0],version:5})+'\n');
  const scan = await scanSources(fixture.roots,'salt',{reads:0}); assert.equal(scan.deepseek.records.length,0); assert.deepEqual(scan.deepseek.errors,['DEEPSEEK_FORMAT_UNSUPPORTED']);
});
test('one corrupt SQLite message does not discard valid OpenCode/MiMo records; streaming Claude snapshots count once', async t => {
  const fixture = agentFixtures(path.join(temporary(t),'home'));
  for (const agent of ['opencode','mimo']) {
    const file = path.join(fixture.roots[agent][0],agent === 'mimo' ? 'mimocode.db' : 'opencode.db'), db = new DatabaseSync(file);
    db.exec("INSERT INTO message VALUES('bad','session','{torn')"); db.close();
    const rows = await parseDatabase(agent,file,'salt',{reads:0}); assert.equal(rows.length,1); assert.deepEqual(rows.warnings,['SOURCE_ROW_INVALID']);
  }
  const message = {type:'assistant',timestamp:fixture.time,sessionId:'session',message:{id:'one',model:'claude-sonnet-4-20250514',usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0}}};
  const values = parseObjects('claude',[message,{...message,message:{...message.message,usage:{...message.message.usage,output_tokens:20}}}],'salt','session');
  assert.equal(values[0].id,values[1].id); // scan/store collapse streaming snapshots by request ID.
});
test('ZCode validates aggregate/output semantics, does not add turn_usage, and preserves unknown fields and explicit mappings', t => {
  const fixture = agentFixtures(path.join(temporary(t),'home')), store = new Store(path.join(temporary(t),'app'),fixture.roots);
  const rows = extended.zcode([{id:'a',session_id:'s',model_id:'GLM-5.3',started_at:Date.parse(fixture.time),input_tokens:100,output_tokens:20,reasoning_tokens:5,cache_read_input_tokens:40,cache_creation_input_tokens:0,computed_total_tokens:120,provider_total_tokens:120}],'salt');
  assert.equal(rows[0].output,20); assert.equal(rows[0].reasoning,5); assert.equal(rows[0].provider,'zai'); assert.equal(rows[0].totalTokens,120);
  const bad = extended.zcode([{id:'b',model_id:'glm-5.3',started_at:Date.parse(fixture.time),input_tokens:100,output_tokens:20,computed_total_tokens:999}],'salt'); assert.equal(bad[0].quality,'total-mismatch');
  store.setBilling({autoSync:false,defaults:Object.fromEntries(SOURCES.map(a => [a,{mode:'actual',multiplier:1}])),mappings:{'unknown/auto':'openai/gpt-4.1'}});
  assert.equal(store.billing.defaults.gemini.mode,'actual'); assert.equal(store.resolvePrice({...rows[0],provider:'unknown',model:'auto'}).origin,'mapped');
});
test('Cursor acquisition mode cannot double count previously stored exports after switching to SDK; other sources still advance', async t => {
  const fixture = agentFixtures(path.join(temporary(t),'home')), store = new Store(path.join(temporary(t),'app'),fixture.roots);
  const scan = await scanSources(fixture.roots,'salt',{reads:0}); scan.cursor.records[0].entry = 'export'; store.ingest(scan,{status:'passed'});
  const rescan = await scanSources(fixture.roots,'salt',{reads:0}); rescan.cursor.records[0].id = 'new-sdk-id'; store.ingest(rescan,{status:'passed'});
  assert.equal(store.snapshot().daily.reduce((s,r) => s+r.totalTokens,0),fixture.total); assert.equal(store.state.statuses.cursor.status,'error');
  assert(store.state.statuses.cursor.errors.includes('CURSOR_SOURCE_MODE_CONFLICT')); assert.equal(store.state.sequence,2);
});
test('DeepSeek mixed encoding refuses ambiguous highest generation and unsupported compression never corrupts retained data', async t => {
  const fixture = agentFixtures(path.join(temporary(t),'home')), plain = path.join(fixture.roots.deepseek[0],'project','child','session.v4.jsonl');
  fs.writeFileSync(plain,fixture.deepseekRows.map(r => JSON.stringify(r)).join('\n'));
  const scan = await scanSources(fixture.roots,'salt',{reads:0}); assert.equal(scan.deepseek.records.length,0); assert.deepEqual(scan.deepseek.errors,['DEEPSEEK_ENCODING_CONFLICT']);
  assert.throws(() => extended.deepseek([{...fixture.deepseekRows[0],isSeeded:false},...fixture.deepseekRows.slice(1)],'salt','session.v4.jsonl'),/SEED_INVALID/);
});
