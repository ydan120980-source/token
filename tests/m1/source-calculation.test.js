'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {agentFixtures} = require('./agent-fixtures');
const {scanSources} = require('../../src/m1/sources');
const {Store} = require('../../src/m1/store');
const {Service} = require('../../src/m1/service');
const adapter = require('../../src/m1/jsonl-adapter');
const {remove} = require('./temp');
const FIELDS = ['inputUncached','output','cacheRead','cacheWrite','reasoning','totalTokens'];
const view = r => FIELDS.map(f => r[f]);
function workspace(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'source-calculation-')); t.after(()=>remove(dir)); return dir; }
// These expected buckets are written from the fixture contracts. No production
// normalizer, snapshot selector or price evaluator generates expected values.
const EXPECTED = {
  codex:[[60,20,40,0,3,120],[40,10,10,0,3,60]],
  claude:[[100,20,40,10,null,170]], opencode:[[80,12,20,0,2,112]],
  workbuddy:[[60,20,40,0,null,120]], mimo:[[80,12,20,0,2,112]],
  gemini:[[60,25,40,null,5,125]], cursor:[[60,20,40,10,3,130]],
  zcode:[[60,20,40,0,2,120]], deepseek:[[10,5,0,0,null,15],[60,20,40,0,2,120]],
  antigravity:[[50,10,30,null,null,90],[20,5,15,null,null,40]]
};
test('ten source parsers match independently specified bucket ledgers before pricing',async t=>{
  const dir=workspace(t), fixture=agentFixtures(path.join(dir,'home'));
  const scan=await scanSources(fixture.roots,'oracle-salt',{reads:0});
  for(const [agent,want] of Object.entries(EXPECTED)) {
    assert.deepEqual(scan[agent].records.map(view),want,agent);
    assert.equal(scan[agent].errors.length,0,agent);
    assert(scan[agent].records.every(r=>r.quality==='measured'),agent);
  }
  const store=new Store(path.join(dir,'usage'),fixture.roots);store.ingest(scan,{status:'passed'});
  assert.equal(store.records().reduce((sum,r)=>sum+r.totalTokens,0),1334);
  const bytes=fs.readFileSync(path.join(store.dir,'statistics.json'));
  store.ingest(scan,{status:'passed'});assert.deepEqual(fs.readFileSync(path.join(store.dir,'statistics.json')),bytes);
  assert.equal(new Store(store.dir,fixture.roots).records().reduce((sum,r)=>sum+r.totalTokens,0),1334);
});
test('three custom formats match hand-written inclusive and disjoint ledgers with identity isolation',()=>{
  const timestamp='2026-10-18T00:00:00Z',id='custom-11111111-1111-4111-8111-111111111111';
  const base={schemaVersion:'CustomSourceV1',name:'personal',mode:'per-request'};
  const standard={schemaVersion:'AgentUsageEventV1',mode:'per-request',id:'call',sessionId:'s',timestamp,provider:'openai',model:'gpt-4.1',inputTokens:150,outputTokens:40,cacheReadTokens:30,cacheWriteTokens:20,reasoningTokens:10,totalTokens:190};
  const parsed=adapter.parse(standard,{id,definition:{...base,template:'standard'}},'salt').record;
  assert.deepEqual(view(parsed),[100,40,30,20,10,190]);
  const claude={type:'assistant',sessionId:'s',timestamp,message:{id:'call',model:'claude-sonnet-4-20250514',usage:{input_tokens:100,output_tokens:40,cache_read_input_tokens:30,cache_creation_input_tokens:20,reasoning_output_tokens:10}}};
  assert.deepEqual(view(adapter.parse(claude,{id,definition:{...base,template:'claude'}},'salt').record),[100,40,30,20,10,190]);
  const definition={...base,template:'mapped',mapping:{id:'id',session:'sessionId',time:'timestamp',input:'inputTokens',output:'outputTokens',cacheRead:'cacheReadTokens',cacheWrite:'cacheWriteTokens',reasoning:'reasoningTokens'},filters:[],timeUnit:'iso',inputSemantics:'exclusive',outputIncludesReasoning:false};
  const mapped=adapter.parse({...standard,inputTokens:100,outputTokens:30},{id,definition},'salt').record;
  assert.deepEqual(view(mapped),[100,40,30,20,10,190]);
  const source={id,definition:{...base,template:'standard'}};
  assert.equal(adapter.parse(standard,{...source,definition:{...source.definition,name:'renamed'}},'salt').record.id,parsed.id);
  assert.notEqual(adapter.parse({...standard,sessionId:'another'},source,'salt').record.id,parsed.id);
  assert.notEqual(adapter.parse(standard,{...source,id:'custom-22222222-2222-4222-8222-222222222222'},'salt').record.id,parsed.id);
  for(const inputTokens of [0,null,undefined]) {
    const r=adapter.parse({...standard,inputTokens,totalTokens:40,cacheReadTokens:0,cacheWriteTokens:0},source,'salt').record;
    assert.equal(r.inputUncached,inputTokens===0?0:null);
  }
  for(const bad of [-1,1.1,true,Number.MAX_SAFE_INTEGER+1]) assert(adapter.parse({...standard,inputTokens:bad},source,'salt').invalid);
});
test('WorkBuddy aggregate never returns after retained detailed history survives a missing file and restart',async t=>{
  const dir=workspace(t), fixture=agentFixtures(path.join(dir,'home')), file=path.join(fixture.roots.workbuddy[0],'session.jsonl');
  const rows=JSON.parse(fs.readFileSync(file,'utf8')); rows.sessionId='same-session';fs.writeFileSync(file,JSON.stringify(rows)+'\n');
  const database=fixture.roots.workbuddy[1];fs.mkdirSync(path.dirname(database),{recursive:true});
  const db=new DatabaseSync(database);db.exec("CREATE TABLE session_usage(session_id TEXT, used INTEGER, updated_at INTEGER)");db.prepare('INSERT INTO session_usage VALUES(?,?,?)').run('same-session',120,Date.now());db.close();
  let store=new Store(path.join(dir,'usage'),fixture.roots);
  store.ingest(await scanSources(fixture.roots,store.state.salt,{reads:0}),{status:'passed'});
  assert.equal(store.records().filter(r=>r.agent==='workbuddy').length,1);
  fs.unlinkSync(file);store=new Store(store.dir,fixture.roots);
  store.ingest(await scanSources(fixture.roots,store.state.salt,{reads:0}),{status:'passed'});
  assert.equal(store.records().filter(r=>r.agent==='workbuddy').reduce((sum,r)=>sum+r.totalTokens,0),120);
  assert.equal(store.records().filter(r=>r.agent==='workbuddy').length,1);
  // Old ledgers containing both forms are repaired with the original backed up.
  const aggregate=(await scanSources(fixture.roots,store.state.salt,{reads:0})).workbuddy.records[0];
  store.state.records[aggregate.id]=aggregate;
  fs.writeFileSync(path.join(store.dir,'statistics.json'),JSON.stringify(store.state));
  store=new Store(store.dir,fixture.roots);
  assert.equal(store.records().filter(r=>r.agent==='workbuddy').length,1);
  assert(fs.readdirSync(path.join(store.dir,'backups')).some(name=>name.startsWith('statistics-before-dedupe-')));
});
test('failed routine collection save keeps the previous in-memory ledger and permits a clean retry',async t=>{
  const dir=workspace(t),fixture=agentFixtures(path.join(dir,'home')),store=new Store(path.join(dir,'usage'),fixture.roots);
  const scan=await scanSources(fixture.roots,store.state.salt,{reads:0});
  store.ingest(scan,{status:'passed'});const oldState=store.state,oldSnapshot=store.snapshot(),file=path.join(store.dir,'statistics.json'),bytes=fs.readFileSync(file);
  const next=structuredClone(scan);next.claude.records.push({...next.claude.records[0],id:'extra-call'});
  const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to===file){const e=new Error('injected');e.code='EACCES';throw e;}return rename(from,to);};
  try {assert.throws(()=>store.ingest(next,{status:'passed'}),/injected/);}finally{fs.renameSync=rename;}
  assert.equal(store.state,oldState);assert.equal(store.snapshot(),oldSnapshot);assert.deepEqual(fs.readFileSync(file),bytes);
  assert.equal(store.records().reduce((sum,r)=>sum+r.totalTokens,0),1334);
  store.ingest(next,{status:'passed'});assert.equal(store.records().reduce((sum,r)=>sum+r.totalTokens,0),1504);
  assert.equal(new Store(store.dir,fixture.roots).records().reduce((sum,r)=>sum+r.totalTokens,0),1504);
});
test('custom rule replacement, missing history, unrelated sources and pricing remain consistent through rollback',async t=>{
  const dir=workspace(t),service=new Service(path.join(dir,'usage'),{},()=>{},{home:path.join(dir,'home')});
  t.after(()=>service.close());service.store.setEnabled(false);
  const roots=[path.join(dir,'a'),path.join(dir,'b')];for(const root of roots)fs.mkdirSync(root);
  const row={id:'call',timestamp:'2026-10-18T00:00:00Z',provider:'private',model:'test',input:100,nextInput:200,output:20,read:0,write:0,reason:0};
  const definition={schemaVersion:'CustomSourceV1',name:'personal',template:'mapped',mode:'per-request',mapping:{id:'id',time:'timestamp',provider:'provider',model:'model',input:'input',output:'output',cacheRead:'read',cacheWrite:'write',reasoning:'reason'},filters:[],timeUnit:'iso',inputSemantics:'inclusive',outputIncludesReasoning:true};
  for(const root of roots) fs.writeFileSync(path.join(root,'a.jsonl'),JSON.stringify(row)+'\n');
  fs.writeFileSync(path.join(roots[0],'b.jsonl'),JSON.stringify({...row,id:'missing'})+'\n');
  const ids=[];
  for(const root of roots){const d=service.custom.draft();ids.push(d.id);service.custom.choose(d.token,[root]);await service.custom.apply((await service.custom.preview(d.token,definition)).id);}
  const unrelated=JSON.stringify(service.store.records().filter(r=>r.agent===ids[1]));
  service.store.setPrice({provider:'private',model:'test',inputUncached:2,output:8,cacheRead:0,cacheWrite:0});
  service.store.setBilling({autoSync:false,defaults:{[ids[0]]:{mode:'actual',multiplier:2}},mappings:{}});
  const raw=JSON.stringify(service.store.state.records);
  // 3 calls: (100*2 + 20*8)/million; first source has two calls at multiplier 2.
  assert(Math.abs(service.store.snapshot().daily.reduce((sum,r)=>sum+r.estimatedCostUsd,0)-.0018)<1e-12);
  assert.equal(JSON.stringify(service.store.state.records),raw);
  fs.unlinkSync(path.join(roots[0],'b.jsonl'));
  const d=service.custom.draft(ids[0]),preview=await service.custom.preview(d.token,{...definition,mapping:{...definition.mapping,input:'nextInput'}});
  assert.equal(preview.summary.retained,1);assert.equal(preview.summary.replaced,1);await service.custom.apply(preview.id);
  assert.equal(service.store.state.customSources[ids[0]].diagnostics.mixedRules,1);
  assert.equal(service.store.records().filter(r=>r.agent===ids[0]).reduce((sum,r)=>sum+r.totalTokens,0),340);
  assert(Math.abs(service.store.snapshot().daily.reduce((sum,r)=>sum+r.estimatedCostUsd,0)-.0022)<1e-12);
  await service.custom.change(ids[0],'rollback');
  assert.equal(service.store.records().filter(r=>r.agent===ids[0]).reduce((sum,r)=>sum+r.totalTokens,0),240);
  assert.equal(JSON.stringify(service.store.records().filter(r=>r.agent===ids[1])),unrelated);
  assert(Math.abs(service.store.snapshot().daily.reduce((sum,r)=>sum+r.estimatedCostUsd,0)-.0018)<1e-12);
  const restarted=new Store(service.store.dir,{});
  assert(Math.abs(restarted.snapshot().daily.reduce((sum,r)=>sum+r.estimatedCostUsd,0)-.0018)<1e-12);
});
