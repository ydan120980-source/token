'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store, atomic } = require('../../src/m1/store');
const { Service } = require('../../src/m1/service');
const { normalize } = require('../../src/m1/normalize');
const { parse } = require('../../src/m1/runtime-catalog');
const { query } = require('../../src/m1/usage-query');
const { remove } = require('./temp');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-consistency-'));
  t.after(() => remove(dir));
  const store = new Store(dir, {});
  const record = normalize('codex', {input_tokens:100,output_tokens:20,cached_input_tokens:0,cache_creation_input_tokens:0,reasoning_output_tokens:0}, {id:'synthetic',model:'alias',time:'2026-10-17T05:00:00Z',session:'synthetic'}, 'synthetic');
  record.provider = 'route'; store.state.records[record.id] = record; store.state.sequence++;
  atomic(path.join(dir,'statistics.json'), store.state); store.setEnabled(false);
  return {dir,store,file:path.join(dir,'statistics.json')};
}
function deny(t, file) {
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', function(from,to) {
    if (to === file) throw Object.assign(new Error('synthetic denied'), {code:'EACCES'});
    return rename.call(fs,from,to);
  });
}
test('failed clear retains ledger objects, projections, custom state, disk and restart; retry commits once', t => {
  const f=fixture(t),id='custom-11111111-1111-4111-8111-111111111111',definition={schemaVersion:'CustomSourceV1',name:'Synthetic custom',template:'standard',mode:'per-request'};
  const previous={id,name:definition.name,definition,version:1,enabled:false,archived:false,roots:[path.join(f.dir,'synthetic-source')],files:{}};
  f.store.state.customSources={[id]:{...previous,version:2,previous,files:{['a'.repeat(64)]:{configHash:'b'.repeat(64),version:2,records:[]}}}};atomic(f.file,f.store.state);
  const before=fs.readFileSync(f.file),state=f.store.state,snapshot=f.store.snapshot(),sessions=f.store.sessionList();
  deny(t,f.file); assert.throws(()=>f.store.clear(),{code:'EACCES'});
  assert.equal(f.store.state,state); assert.equal(f.store.snapshot(),snapshot); assert.equal(f.store.sessionList(),sessions);
  assert.deepEqual(fs.readFileSync(f.file),before); assert.equal(query(f.file).total.records,1);
  assert(!fs.readdirSync(f.dir).some(name=>name.includes('.tmp-')));
  t.mock.restoreAll(); assert.equal(new Store(f.dir,{}).records().length,1);
  f.store.clear(); assert.equal(f.store.records().length,0); assert.equal(f.store.state.sequence,state.sequence+1);
  assert.equal(Object.keys(state.customSources[id].files).length,1);assert.equal(state.customSources[id].previous,previous);assert.deepEqual(f.store.state.customSources[id].files,{});assert.equal(f.store.state.customSources[id].previous,null);
  assert.equal(new Store(f.dir,{}).records().length,0);
});
test('failed enabled/source preferences preserve memory and disk; successful retry and restart agree', t => {
  const f=fixture(t),file=path.join(f.dir,'preferences.json'),before=fs.readFileSync(file),settings=f.store.settings;
  deny(t,file);
  assert.throws(()=>f.store.setEnabled(true),{code:'EACCES'});
  assert.throws(()=>f.store.changeSources('enable','codex',false),{code:'EACCES'});
  assert.equal(f.store.settings,settings); assert.deepEqual(fs.readFileSync(file),before);
  t.mock.restoreAll(); const again=new Store(f.dir,{}); assert.deepEqual(again.settings,settings);
  f.store.setEnabled(true); f.store.changeSources('enable','codex',false);
  const saved=new Store(f.dir,{}); assert.equal(saved.settings.enabled,true); assert(saved.settings.sources.disabled.includes('codex'));
});
test('failed cadence/subscription updates do not publish settings, reschedule or notify', async t => {
  const f=fixture(t); let updates=0; const service=new Service(f.dir,{},()=>updates++); t.after(()=>service.close());
  const file=path.join(f.dir,'preferences.json'),before=fs.readFileSync(file),settings=service.store.settings;
  deny(t,file); assert.throws(()=>service.setRefreshInterval(5000),{code:'EACCES'}); assert.throws(()=>service.setSubscription('codex',12),{code:'EACCES'});
  assert.equal(service.store.settings,settings); assert.equal(service.timer,null); assert.equal(updates,0); assert.deepEqual(fs.readFileSync(file),before);
  t.mock.restoreAll(); service.setRefreshInterval(5000); service.setSubscription('codex',12);
  const again=new Store(f.dir,{}); assert.equal(again.settings.refreshIntervalMs,5000); assert.equal(again.settings.subscriptions.codex,12);
});
const price={provider:'manualvendor',model:'target',inputUncached:1,output:1,cacheRead:0,cacheWrite:0};
test('referenced manual price removal is rejected before write; removing references permits deletion', t => {
  for (const mode of ['mapping','default']) {
    const f=fixture(t); f.store.setPrice(price);
    f.store.setBilling({autoSync:false,defaults:mode==='default'?{codex:{mode:'default',model:'manualvendor/target',multiplier:1}}:{},mappings:mode==='mapping'?{'route/alias':'manualvendor/target'}:{}});
    const file=path.join(f.dir,'pricing.json'),before=fs.readFileSync(file),snapshot=f.store.snapshot();
    assert.throws(()=>f.store.setPrice(price,true),/PRICE_TARGET_IN_USE/); assert.deepEqual(fs.readFileSync(file),before); assert.equal(f.store.snapshot(),snapshot);
    assert(query(f.file).total.estimatedCostUsd>0);
    f.store.setBilling({autoSync:false,defaults:{},mappings:{}}); f.store.setPrice(price,true); assert.equal(query(f.file).total.estimatedCostUsd,null);
  }
});
test('catalog replacement preserves referenced targets or fails atomically; valid catalog fallback permits manual removal', t => {
  const f=fixture(t),catalog=model=>parse(JSON.stringify({manualvendor:{models:{[model]:{modalities:{output:['text']},cost:{input:2,output:2,cache_read:0,cache_write:0}}}}}));
  f.store.installCatalog(catalog('target')); f.store.setBilling({autoSync:false,defaults:{},mappings:{'route/alias':'manualvendor/target'}});
  const file=path.join(f.dir,'model-pricing.json'),before=fs.readFileSync(file),models=f.store.modelCatalog;
  assert.throws(()=>f.store.installCatalog(catalog('other')),/PRICE_TARGET_IN_USE/); assert.deepEqual(fs.readFileSync(file),before); assert.equal(f.store.modelCatalog,models);
  f.store.setPrice(price); f.store.setPrice(price,true); assert(Math.abs(query(f.file).total.estimatedCostUsd-.00024)<1e-12);
});
test('legacy dangling billing target remains unpriced in GUI and query without rewriting saved files; new writes reject it', t => {
  const f=fixture(t),billing={autoSync:false,defaults:{},mappings:{'route/alias':'manualvendor/removed'}};
  atomic(path.join(f.dir,'billing.json'),billing); f.store.billing=billing;
  const before=fs.readFileSync(path.join(f.dir,'billing.json'));
  assert.equal(f.store.snapshot().daily[0].estimatedCostUsd,null); assert.equal(query(f.file).total.estimatedCostUsd,null);
  assert.deepEqual(fs.readFileSync(path.join(f.dir,'billing.json')),before); assert.throws(()=>f.store.setBilling(billing),/PRICE_MAPPING_INVALID/);
});
