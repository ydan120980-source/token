'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,atomic}=require('../../src/m1/store');
const {StatisticsService}=require('../../src/m1/statistics-service');
const {selectSnapshot}=require('../../src/m1/local-snapshot');
const {normalize}=require('../../src/m1/normalize');
const {ParseCache}=require('../../src/m1/parse-cache');
const codec=require('../../src/m1/snapshot-codec');
const {requestError}=require('../../src/m1/statistics-errors');
const {CustomSources}=require('../../src/m1/custom-sources');
const {fixtures}=require('./fixtures');const {remove}=require('./temp');
test('statistics owner keeps ledger off main, preserves projections and revision semantics, rejects arbitrary commands and recovers',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'statistics-owner-'));let service;
  try{
    const home=path.join(root,'home'),fixture=fixtures(home),dir=path.join(root,'usage'),store=new Store(dir,fixture.roots);
    const record=normalize('codex',{input_tokens:100,output_tokens:20,cached_input_tokens:0,cache_creation_input_tokens:0,reasoning_output_tokens:0},{id:'owner-record',session:'owner-session',time:Date.now(),model:'owner-model',entry:'cli'},store.state.salt);
    store.state.records[record.id]=record;store.state.sequence=1;atomic(path.join(dir,'statistics.json'),store.state);store.setEnabled(false);
    const expected=selectSnapshot(store.snapshot(),store.catalog());
    service=new StatisticsService(dir,fixture.roots,()=>{},{home,appData:path.join(home,'AppData/Roaming'),localAppData:path.join(home,'AppData/Local')},{offline:true});
    const first=await service.get();assert.deepEqual(first.snapshot,expected);assert.equal(service.facts().records,undefined);assert.equal(service.facts().salt,undefined);
    const packed=await service.call('getPacked');assert.deepEqual(codec.unpack(JSON.parse(new TextDecoder().decode(packed.snapshotBytes))),expected);
    assert.equal((await service.call('getPacked',packed.snapshotRevision)).snapshotBytes,null);
    const metrics=service.performanceState();assert.equal(metrics.requests,metrics.completed+metrics.inFlight);assert(metrics.packedSnapshotBytes>0);assert.deepEqual(Object.keys(metrics).sort(),['completed','failed','inFlight','maxInFlight','packedSnapshotBytes','requests','workerPresent','workerStarts']);
    assert.equal((await service.get(first.snapshotRevision)).snapshot,null);
    const summary=await service.call('sessionSummary',{date:first.snapshot.today});assert.equal(summary.count,1);assert.deepEqual(Object.keys(summary).sort(),['agents','count','date','model']);
    await service.setPrice({provider:'unknown',model:'owner-model',inputUncached:1,output:2,cacheRead:0,cacheWrite:0});
    const priced=await service.get(first.snapshotRevision);assert(priced.snapshot);assert.equal(priced.snapshot.sequence,first.snapshot.sequence);assert(priced.snapshotRevision>first.snapshotRevision);
    await assert.rejects(service.call('constructor'),/STATISTICS_COMMAND_REJECTED/);
    const worker=service.worker;await worker.terminate();await new Promise(resolve=>setImmediate(resolve));
    const restored=await service.get(priced.snapshotRevision);assert(restored.snapshot);assert(restored.snapshotRevision>priced.snapshotRevision);assert.equal(restored.snapshot.daily[0].totalTokens,120);
  }finally{await service?.close();await remove(root);}
});
test('parse cache bounds payload and entries; reading refreshes recency and oversized entries are skipped',()=>{
  const cache=new ParseCache(2000,2);cache.set('a',{value:'a'});cache.set('b',{value:'b'});cache.get('a');cache.set('c',{value:'c'});
  assert.equal(cache.has('b'),false);assert(cache.has('a'));assert(cache.has('c'));assert(cache.bytes<=2000);
  cache.set('huge',{value:'x'.repeat(2000)});assert(!cache.has('huge'));assert.equal(cache.size,2);cache.clear();assert.equal(cache.bytes,0);assert.equal(cache.size,0);
});

test('closing the statistics owner rejects reads waiting on startup and concurrent close callers share termination',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'statistics-close-race-'));let service;
  try{
    const dir=path.join(root,'usage');new Store(dir,{}).setEnabled(false);
    service=new StatisticsService(dir,{},()=>{},{home:path.join(root,'home'),appData:null,localAppData:null},{offline:true});
    await service.ready;
    let resume;service.ready=new Promise(resolve=>{resume=resolve;});
    const read=service.get(),close=service.close();assert.equal(service.close(),close,'every close caller waits for the same worker termination');
    const rejected=assert.rejects(read,/STATISTICS_CLOSED/);resume();await rejected;await close;
    assert.equal(service.pending.size,0);assert.equal(service.worker,null);assert.equal(service.performanceState().workerStarts,1);
  }finally{await service?.close();await remove(root);}
});
test('replacement statistics owner resumes previously started enabled collection',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'statistics-resume-'));let service;
  try{
    const home=path.join(root,'home'),fixture=fixtures(home),dir=path.join(root,'usage'),store=new Store(dir,fixture.roots);
    store.setEnabled(false);
    service=new StatisticsService(dir,fixture.roots,()=>{},{home,appData:path.join(home,'AppData/Roaming'),localAppData:path.join(home,'AppData/Local')},{offline:true});
    await service.call('start');await service.setEnabled(true);assert((await service.get()).checkedAt);
    await service.worker.terminate();await new Promise(resolve=>setImmediate(resolve));
    let restored=await service.get();const deadline=Date.now()+3000;
    while(!restored.checkedAt&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,30));restored=await service.get();}
    assert.equal(restored.enabled,true);assert(restored.checkedAt,'enabled collection must restart without a manual refresh');assert.equal(restored.error,null);
    assert.equal(service.performanceState().workerStarts,2);
  }finally{await service?.close();await remove(root);}
});
test('statistics request errors use a fixed catalogue, never arbitrary uppercase exceptions',()=>{
  assert.equal(requestError(Error('SECRET_TOKEN')),'STATISTICS_REQUEST_FAILED');
  assert.equal(requestError(Error('C:/private-user/auth.json')),'STATISTICS_REQUEST_FAILED');
  assert.equal(requestError(Error('PRICE_TARGET_IN_USE')),'PRICE_TARGET_IN_USE');
  assert.equal(requestError(Error('NATIVE_BINARY_MISMATCH')),'NATIVE_BINARY_MISMATCH');
});
test('expired custom-source previews release payloads without discarding a valid draft; close releases all timers',()=>{
  const service={store:{dir:'synthetic',state:{customSources:{}}}},custom=new CustomSources(service);
  const draft=custom.draft();custom.previews.set('expired',{createdAt:Date.now()-6*60*1000,result:{records:[{synthetic:true}]}});custom.expire();
  assert.equal(custom.previews.size,0);assert.equal(custom.drafts.size,1);assert(custom.drafts.has(draft.token));custom.close();assert.equal(custom.expiryTimer,null);assert.equal(custom.drafts.size,0);
});
