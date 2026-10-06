'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { normalize } = require('../../src/m1/normalize');
const { evaluate } = require('../../src/m1/pricing');
const { parseObjects } = require('../../src/m1/sources');
const { Service } = require('../../src/m1/service');
const { Store } = require('../../src/m1/store');
const { fixtures } = require('./fixtures');
function record(model, write, input = 1000000) { return { ...normalize('codex', { input_tokens: input, output_tokens: 100000, cached_input_tokens: 400000, cache_write_tokens: write, reasoning_output_tokens: 10000 }, { time:'2026-10-03', model, id:'a' }, 's'), requestInputTokens: input }; }
test('official bucket ledger: old absent writes, new unknown writes, explicit writes, long context, reasoning only once', () => {
  const old = evaluate(record('gpt-4.1',undefined)); assert.equal(old.lower, 2.2); assert.equal(old.upper,2.2);
  const current = evaluate(record('gpt-6.1-sol',undefined,600000));
  // Long context: 200K input *4 +400K cached *.2 +100K output *15, per million.
  assert.equal(current.lower,2.38); assert.equal(current.upper,2.58);
  const writes = evaluate(record('gpt-6.1-sol',100000,600000)); assert.equal(writes.lower,2.48); assert.equal(writes.upper,2.48);
  const short = evaluate(record('gpt-6-luna',undefined,500000)); assert(short.upper > short.lower);
  assert.equal(evaluate({...record('gpt-4.1',0),model:'unknown'}).reason,'model-unpriced');
  assert.equal(evaluate({...record('gpt-4.1',0),cacheRead:null}).reason,'usage-incomplete');
});
test('price overrides use USD per million, survive restart, reprice cached snapshots, preserve records and reject invalid edits', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'price-test-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir,{}), r={...record('custom-route',0,600000),provider:'openai'}; store.state.records[r.id]=r;
  const before=JSON.stringify(store.state.records); assert.equal(store.snapshot().daily[0].estimatedCostUsd,null);
  const entry={provider:'openai',model:'custom-route',inputUncached:2,output:10,cacheRead:.1,cacheWrite:2.5}; store.setPrice(entry);
  assert.equal(store.snapshot().daily[0].estimatedCostUsd,1.44); assert.equal(JSON.stringify(store.state.records),before);
  assert.throws(()=>store.setPrice({...entry,inputUncached:-1}),/PRICE_RATE_INVALID/);
  assert.throws(()=>store.setPrice({...entry,model:'../auth.json'}),/PRICE_IDENTIFIER_INVALID/);
  assert.equal(new Store(dir,{}).overrides['openai/custom-route'].output,10/1e6);
  store.setPrice(entry,true); assert.equal(store.snapshot().daily[0].estimatedCostUsd,null);
});
test('Codex exact last usage handles lane changes, unchanged notifications, resets and >32 bit totals', () => {
  const rows=[{type:'session_meta',payload:{id:'a'}},{type:'turn_context',payload:{model:'gpt-4.1'}}];
  const event=(n,last,lane,time)=>({type:'event_msg',timestamp:'2026-10-03T00:00:0'+time+'Z',payload:{type:'token_count',rate_limits:{limit_id:lane},info:{total_token_usage:{input_tokens:n,output_tokens:0,total_tokens:n},last_token_usage:{input_tokens:last,output_tokens:0,total_tokens:last}}}});
  rows.push(event(100,100,'a',0),event(150,50,'a',1),event(100,100,'a',2),event(100,100,'b',3),event(4300000000,4300000000,'b',4));
  const parsed=parseObjects('codex',rows,'s','file'); assert.equal(parsed.reduce((n,r)=>n+r.totalTokens,0),4300000250);
});
test('Codex maintenance previews without writes; scoped backup, retained unavailable history, stale/incomplete rejection', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'maintenance-test-')), f=fixtures(path.join(dir,'home')), service=new Service(path.join(dir,'app'),f.roots);
  t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});
  await service.refresh(); await service.setEnabled(false);
  const phantom={...record('gpt-4.1',0),id:'unavailable',sessionKey:'unavailable'}; service.store.state.records[phantom.id]=phantom;
  const file=path.join(service.store.dir,'statistics.json'), before=fs.readFileSync(file), nonCodex=JSON.stringify(Object.values(service.store.state.records).filter(r=>r.agent!=='codex'));
  const candidate=await service.refresh(true); assert.equal(candidate.rebuiltTokens,180); assert.equal(candidate.retainedTokens,phantom.totalTokens); assert(fs.readFileSync(file).equals(before));
  const result=service.applyMaintenance(candidate.id); assert.equal(result.backupCreated,true);assert.equal(fs.readdirSync(path.join(service.store.dir,'backups')).length,1);
  assert.equal(JSON.stringify(Object.values(service.store.state.records).filter(r=>r.agent!=='codex')),nonCodex);
  assert.throws(()=>service.applyMaintenance(candidate.id),/MAINTENANCE_STALE/);
  const again=await service.refresh(true); await service.refresh(); assert.throws(()=>service.applyMaintenance(again.id),/MAINTENANCE_STALE/);
  fs.appendFileSync(path.join(f.roots.codex[0],'session.jsonl'),'\n{bad'); await assert.rejects(service.refresh(true),/MAINTENANCE_INCOMPLETE/);
});
