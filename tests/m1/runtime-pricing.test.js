'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { parse, verify, embedded } = require('../../src/m1/runtime-catalog');
const { Store } = require('../../src/m1/store');
const { PriceSyncService, fetchEnvironment } = require('../../src/m1/price-sync-service');
const { bucketSeries } = require('../../design/desktop-reference/chart-ui');
const { evaluate } = require('../../src/m1/pricing');
const raw = JSON.stringify({ vendor:{models:{'priced':{modalities:{output:['text']},cost:{input:2,output:8,cache_read:.2,cache_write:2.5,tiers:[{input:4,output:12,cache_read:.4,cache_write:5,tier:{type:'context',size:200000}}]}},'free':{modalities:{output:['text']},cost:{input:0,output:0}},'missing':{modalities:{output:['text']}},'bad':{modalities:{output:['text']},cost:{input:-1,output:0}},'image':{modalities:{output:['image']},cost:{input:1,output:1}}}}});
function temp(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'runtime-prices-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir; }
function record(model) { return {agent:'codex',entry:'cli',provider:'route',model,timestamp:'2026-10-04T01:00:00Z',quality:'measured',inputUncached:1000000,output:100000,cacheRead:100000,cacheWrite:0,reasoning:0,totalTokens:1200000,requestInputTokens:100000}; }
test('public directory: explicit free stays zero, missing/invalid/image prices excluded; context tiers and cached provenance survive',()=>{
  const catalog=parse(raw); assert.equal(Object.keys(catalog.models).length,2);assert.equal(catalog.models['vendor/free'].inputUncached,0);assert.equal(catalog.models['vendor/priced'].longContextThreshold,200000);assert.equal(catalog.models['vendor/priced'].longContext.output,.000012);
  assert.deepEqual(catalog.skipped,{missing:1,invalid:1,modality:1});assert.equal(verify(catalog),catalog);
  const bad=structuredClone(catalog);bad.models['vendor/free'].output=9;assert.throws(()=>verify(bad),/PRICE_CACHE_INVALID/);assert.throws(()=>parse('{}'),/PRICE_DOWNLOAD_EMPTY/);assert.throws(()=>parse('[]'),/PRICE_DOWNLOAD_SCHEMA/);assert.throws(()=>parse('x'.repeat(16*1024*1024+1)),/PRICE_DOWNLOAD_SIZE/);verify(embedded);
});
test('mapping/multipliers use independent bucket ledger, persist, reprice without sequence changes, and preserve source model/manual price',t=>{
  const dir=temp(t),store=new Store(dir,{});store.installCatalog(parse(raw));store.state.records.a=record('auto');store.state.records.b={...record('custom'),cacheRead:0,totalTokens:1100000};store.state.sequence=1;
  assert.equal(store.snapshot().daily[0].estimatedCostUsd,null);
  store.setBilling({autoSync:true,defaults:{codex:{mode:'actual',multiplier:2}},mappings:{'route/auto':'vendor/priced','route/custom':'vendor/free'}});
  const snapshot=store.snapshot();assert.equal(snapshot.daily.find(r=>r.model==='auto').estimatedCostUsd,5.64);assert.equal(snapshot.daily.find(r=>r.model==='custom').estimatedCostUsd,0);assert.equal(snapshot.sequence,1);assert.equal(store.state.records.a.model,'auto');
  const preview=store.probe({provider:'route',model:'auto',inputUncached:2,output:8,cacheRead:.2,cacheWrite:0});assert.equal(preview.sample.lower,5.64);
  const unknownWrite={...record('new-model'),provider:'openai',cacheWrite:null};store.state.records.c=unknownWrite;assert.equal(store.probe({provider:'openai',model:'new-model',inputUncached:2,output:8,cacheRead:.2,cacheWrite:null}).sample.reason,'usage-incomplete');delete store.state.records.c;
  store.setPrice({provider:'vendor',model:'priced',inputUncached:3,output:7,cacheRead:0,cacheWrite:0});store.installCatalog(parse(raw));assert.equal(store.snapshot().daily.find(r=>r.model==='auto').estimatedCostUsd,7.4);
  const again=new Store(dir,{});assert.equal(again.billing.defaults.codex.multiplier,2);assert.equal(again.billing.mappings['route/auto'],'vendor/priced');assert.equal(again.overrides['vendor/priced'].inputUncached,.000003);
  const before=fs.readFileSync(path.join(dir,'billing.json'));assert.throws(()=>store.setBilling({autoSync:true,defaults:{codex:{mode:'default',multiplier:1,model:'invalid'}},mappings:{}}),/PRICE_SETTING_INVALID/);assert.deepEqual(fs.readFileSync(path.join(dir,'billing.json')),before);
  const saved=store.snapshot();store.setBilling({autoSync:false,defaults:{},mappings:{}});assert.notEqual(store.snapshot(),saved);assert.equal(store.snapshot().daily[0].estimatedCostUsd,null);
});
test('sync is single-flight, rejects corrupted response before disk writes, retains last good cache and stops late close writes',async t=>{
  const dir=temp(t),store=new Store(dir,{}),last=store.remoteCatalog;
  let calls=0,child;
  const spawn=(_file,args,opts)=>{calls++;assert.deepEqual(args,[]);assert.deepEqual(Object.keys(opts.env).sort(),Object.keys(fetchEnvironment()).sort());child=new EventEmitter();child.kill=()=>queueMicrotask(()=>child.emit('exit',0));return child;};
  const service=new PriceSyncService(store,()=>{},false,spawn);t.after(()=>service.close());
  const first=service.sync();assert.equal(service.sync(),first);assert.equal(calls,1);child.emit('message',{catalog:{version:'bad'}});await assert.rejects(first,/PRICE_DOWNLOAD_SCHEMA/);assert.equal(store.remoteCatalog,last);assert.equal(fs.existsSync(path.join(dir,'model-pricing.json')),false);
  const partial=service.sync();child.emit('message',{catalog:parse(raw)});await assert.rejects(partial,/PRICE_DOWNLOAD_INCOMPLETE/);assert.equal(store.remoteCatalog,last);
  const next=service.sync();child.emit('message',{catalog:embedded});await next;assert.equal(Object.keys(store.remoteCatalog.models).length,Object.keys(embedded.models).length);const bytes=fs.readFileSync(path.join(dir,'model-pricing.json'));
  const late=service.sync();void service.close();child.emit('message',{catalog:embedded});await assert.rejects(late,/PRICE_SYNC_CLOSED|PRICE_DOWNLOAD_FAILED/);assert.deepEqual(fs.readFileSync(path.join(dir,'model-pricing.json')),bytes);
  const fixture=new PriceSyncService(store,()=>{},true,spawn);await assert.rejects(fixture.sync(),/OFFLINE_FIXTURE/);assert.equal(fixture.child,null);
});
test('price fetch environment drops auth, proxy and homes',()=>{const env=fetchEnvironment();for(const key of ['CODEX_HOME','HOME','USERPROFILE','OPENAI_API_KEY','HTTP_PROXY','HTTPS_PROXY','NODE_OPTIONS']) assert.equal(env[key],undefined);});
test('multiple context tiers select the correct request band; unknown context bounds every band; reasoning is never double counted',()=>{
 const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-12,actual+' != '+expected);
 const rates={inputUncached:2e-6,output:8e-6,cacheRead:.2e-6,cacheWrite:0,provenance:'models-dev',contextTiers:[{threshold:32000,rates:{inputUncached:4e-6,output:12e-6,cacheRead:.4e-6,cacheWrite:0}},{threshold:256000,rates:{inputUncached:6e-6,output:16e-6,cacheRead:.6e-6,cacheWrite:0}}]};
 const r={...record('priced'),requestInputTokens:300000};near(evaluate(r,{},rates).lower,7.66);near(evaluate({...r,requestInputTokens:null},{},rates).upper,7.66);near(evaluate({...r,requestInputTokens:32000},{},rates).lower,2.82);
 const reasoning={inputUncached:2e-6,output:8e-6,cacheRead:.2e-6,cacheWrite:0,reasoning:20e-6,provenance:'models-dev'};
 near(evaluate({...r,reasoning:20000},{},reasoning).lower,3.06);
 const bounded=evaluate({...r,reasoning:null},{},reasoning);assert.equal(bounded.reason,'reasoning-unreported');near(bounded.lower,2.82);near(bounded.upper,4.02);
});
test('calendar buckets retain null/known-zero, partial buckets, cumulative endpoint and rolling average semantics',()=>{
  const days=['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04'];
  assert.deepEqual(bucketSeries(days,[0,null,2,3,null,0,5],'week')[0],{label:'2026-09-28',start:days[0],end:days.at(-1),value:10,partial:true});
  assert.equal(bucketSeries(days,days.map(()=>null),'week')[0].value,null);assert.equal(bucketSeries(days,[0,1,2,3,4,5,null],'week','total')[0].value,null);assert.equal(bucketSeries(days,[0,1,2,3,4,5,6],'week','average')[0].value,3);assert.equal(bucketSeries(days,[0,1,2,3,4,5,6],'month').length,2);
});
