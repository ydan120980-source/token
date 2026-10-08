'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {agentFixtures} = require('./agent-fixtures');
const {fixtures} = require('./fixtures');
const {scanSources} = require('../../src/m1/sources');
const {Store} = require('../../src/m1/store');
const {Service} = require('../../src/m1/service');
const time = '2026-10-05T12:00:00Z';
function workspace(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'scan-cache-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir; }
const comparable = scan => JSON.stringify(scan,(key,value) => key === 'durationMs' ? undefined : value);
const total = store => store.snapshot().daily.reduce((sum,row) => sum + row.totalTokens,0);
const claudeLine = id => JSON.stringify({type:'assistant',uuid:id,sessionId:'cache-session',timestamp:time,message:{id,role:'assistant',model:'claude-sonnet-4-20250514',usage:{input_tokens:7,output_tokens:3,cache_read_input_tokens:0,cache_creation_input_tokens:0}}}) + '\n';

test('cached scans equal a fresh scan after appends, deletions, database edits, cross-Agent merges and caller mutation', async t => {
  const fixture = agentFixtures(path.join(workspace(t),'home')), selected = fixture.roots;
  const cache = {salt:null,files:new Map(),seen:new Set()};
  const same = async label => {
    const audit = {reads:0}, cached = await scanSources(selected,'salt',audit,{cache,report:{failures:0}}), fresh = await scanSources(selected,'salt',{reads:0});
    assert.equal(comparable(cached),comparable(fresh),label);
    return {cached,audit};
  };
  await same('initial');
  const warm = await same('all hits');
  assert.equal(warm.audit.reads,0,'unchanged files must not be read again');
  // Merging mutates record objects; nothing a caller does may leak into the cache.
  for (const source of Object.values(warm.cached)) for (const record of source.records) { record.totalTokens = -1; record.model = 'mutated'; }
  await same('after caller mutation');
  const claude = path.join(selected.claude[0],'project','session.jsonl');
  fs.appendFileSync(claude,claudeLine('appended'));
  const appended = await same('after append');
  assert(appended.audit.reads > 0 && appended.audit.reads < 5,'only the changed file is read again');
  const db = new DatabaseSync(selected.zcode[0]);
  db.prepare('INSERT INTO model_usage (id,session_id,provider_id,model_id,started_at,completed_at,input_tokens,output_tokens,reasoning_tokens,cache_creation_input_tokens,cache_read_input_tokens,provider_total_tokens,computed_total_tokens) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run('z-two','z-session','zai','GLM-5.3',Date.parse(time),Date.parse(time),5,5,0,0,0,10,10);
  db.close();
  await same('after database edit');
  const message = (id,input,output) => ({role:'assistant',id,modelID:'gpt-4.1',time:{created:Date.parse(time)},tokens:{input,output,reasoning:0,cache:{read:0,write:0}}});
  const folder = path.join(selected.opencode[0],'storage','message','cross');
  fs.mkdirSync(folder,{recursive:true}); fs.writeFileSync(path.join(folder,'a.json'),JSON.stringify(message('shared-call',100,20)));
  const mimo = path.join(selected.mimo[0],'mimocode.db'); fs.mkdirSync(path.dirname(mimo),{recursive:true});
  const shared = new DatabaseSync(mimo); shared.exec('CREATE TABLE IF NOT EXISTS message(id TEXT,session_id TEXT,data TEXT)'); shared.prepare('INSERT INTO message VALUES(?,?,?)').run('shared-call','s',JSON.stringify(message('shared-call',100,40))); shared.close();
  await same('cross-Agent shared record');
  await same('cross-Agent shared record again');
  fs.rmSync(claude);
  await same('after deletion');
  assert(![...cache.files.keys()].some(key => key.endsWith(claude)),'deleted files leave the cache');
});

test('a rescan that reproduces the ledger neither rewrites statistics.json nor advances the sequence', async t => {
  const dir = workspace(t), fixture = fixtures(path.join(dir,'home')), store = new Store(path.join(dir,'app'),fixture.roots), file = path.join(store.dir,'statistics.json');
  store.ingest(await scanSources(fixture.roots,store.state.salt,{reads:0}),{status:'passed'});
  const sequence = store.state.sequence, bytes = fs.readFileSync(file);
  fs.utimesSync(file,new Date(0),new Date(0));
  store.ingest(await scanSources(fixture.roots,store.state.salt,{reads:0}),{status:'passed'});
  assert.equal(store.state.sequence,sequence); assert.equal(fs.statSync(file).mtimeMs,0); assert.deepEqual(fs.readFileSync(file),bytes);
  fs.appendFileSync(path.join(fixture.roots.claude[0],'project','session.jsonl'),'\n' + claudeLine('new-call'));
  store.ingest(await scanSources(fixture.roots,store.state.salt,{reads:0}),{status:'passed'});
  assert.equal(store.state.sequence,sequence + 1); assert.notEqual(fs.statSync(file).mtimeMs,0); assert.equal(total(new Store(store.dir,fixture.roots)),fixture.total + 10);
});

test('service skips unchanged sources without reading them and still collects changes and external ledger resets', async t => {
  const dir = workspace(t), fixture = fixtures(path.join(dir,'home')), service = new Service(path.join(dir,'app'),fixture.roots);
  t.after(() => service.close());
  await service.refresh(); const sequence = service.store.state.sequence, file = path.join(service.store.dir,'statistics.json');
  assert.equal(total(service.store),fixture.total); assert(service.audit.reads > 0);
  fs.utimesSync(file,new Date(0),new Date(0));
  const first = service.checkedAt; await new Promise(resolve => setTimeout(resolve,5));
  // With NTFS last-access updates on, the first scan's own reads raise change events,
  // so one stat-only check may follow before the tree counts as quiet.
  await service.refresh();
  assert.match(service.lastCollection,/^unchanged:(quiet|stamp)$/); assert.equal(service.audit.reads,0);
  const state = await service.refresh();
  assert.equal(service.lastCollection,'unchanged:quiet','a quiet source tree is not even walked');
  assert.equal(service.audit.reads,0); assert.equal(service.store.state.sequence,sequence); assert.equal(fs.statSync(file).mtimeMs,0);
  assert(state.checkedAt > first); assert(service.collector,'the collector worker is reused');
  // A transcript that grows by a line without usage is re-read but changes no outcome:
  // no merge, verification, ingest or write. Change events arrive asynchronously.
  const settleEvents = () => new Promise(resolve => setTimeout(resolve,300));
  const session = path.join(fixture.roots.claude[0],'project','session.jsonl');
  fs.appendFileSync(session,'\n' + JSON.stringify({type:'user',uuid:'u-1',sessionId:'cache-session',timestamp:time,message:{role:'user',content:'text'}}));
  await settleEvents(); await service.refresh();
  assert(service.audit.reads > 0); assert.equal(service.lastCollection,'unchanged:outcome'); assert.equal(service.store.state.sequence,sequence); assert.equal(fs.statSync(file).mtimeMs,0);
  fs.appendFileSync(session,'\n' + claudeLine('later-call'));
  await settleEvents(); await service.refresh(); assert.equal(service.lastCollection,'ingested');
  assert.equal(service.store.state.sequence,sequence + 1); assert.equal(total(service.store),fixture.total + 10);
  service.store.clear(); assert.equal(total(service.store),0);
  await service.refresh();
  assert.equal(total(service.store),fixture.total + 10,'a ledger changed outside collection is rebuilt even when sources are unchanged');
  await service.setEnabled(false); assert.equal(service.collector,null,'pausing releases the cached worker');
});
