'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,atomic}=require('../../src/m1/store');
const {normalize}=require('../../src/m1/normalize');
const {query,request}=require('../../src/m1/usage-query');
const {readSavedModel}=require('../../src/m1/read-snapshot');
const {remove}=require('./temp');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'saved-query-'));t.after(()=>remove(dir));const store=new Store(dir,{}),file=path.join(dir,'statistics.json');const add=(id,model,changes={})=>{const r={...normalize('codex',{input_tokens:100,output_tokens:20,cached_input_tokens:0,cache_creation_input_tokens:0,reasoning_output_tokens:0},{id,model,time:'2026-10-17T05:00:00Z',session:'one'},'synthetic'),provider:'openai',...changes};store.state.records[r.id]=r;return r;};return {store,file,dir,add,save(){store.state.sequence++;atomic(file,store.state);}};}
test('saved query shares GUI estimates, zero/null, partial pricing, filters and session counts; never writes',async t=>{
  const f=fixture(t);f.add('a','gpt-4.1');f.add('b','private-alias');f.add('c','private-alias',{usageConflict:true});f.save();
  f.store.setPrice({provider:'openai',model:'private-alias',inputUncached:0,output:0,cacheRead:0,cacheWrite:0});
  f.store.state.sessions={secret:{id:'RAW_SESSION_SENTINEL',cwd:'C:/PRIVATE_PATH_SENTINEL'}};f.save();
  const files=fs.readdirSync(f.dir),before=files.map(name=>fs.readFileSync(path.join(f.dir,name)));
  const result=query(f.file,{groupBy:['model'],limit:1});assert.equal(result.rows.length,1);assert.equal(result.nextOffset,1);assert.equal(result.total.sessions,1);assert.equal(result.total.records,3);assert.equal(result.total.pricedRecords,2);
  const gui=f.store.snapshot().daily.reduce((n,r)=>n+(r.estimatedCostUsd??0),0);assert.equal(result.total.estimatedCostUsd,gui);
  const zero=query(f.file,{model:['private-alias']});assert.equal(zero.total.estimatedCostUsd,0);assert.equal(zero.total.inputUncached,null);assert.equal(zero.total.unpricedTokens,120);
  for(const value of ['RAW_SESSION_SENTINEL','PRIVATE_PATH_SENTINEL','sessionKey','mappings','duplicateIds','statistics.json'])assert(!JSON.stringify(result).includes(value));
  assert.deepEqual(fs.readdirSync(f.dir),files);for(let i=0;i<files.length;i++)assert.deepEqual(fs.readFileSync(path.join(f.dir,files[i])),before[i]);
  assert.equal(query(f.file,{from:'2026-10-18'}).total.estimatedCostUsd,null);
});
test('legacy missing session identity is unknown; empty ledger preserves null buckets; invalid data fails without quarantine',t=>{
  const f=fixture(t);assert.equal(query(f.file).total.inputUncached,null);assert.equal(query(f.file).total.sessions,null);
  f.add('a','unknown',{sessionKey:null});f.save();assert.equal(query(f.file).total.sessions,null);assert.equal(query(f.file).total.unattributedRecords,1);
  fs.writeFileSync(f.file,'{broken');assert.throws(()=>query(f.file),/QUERY_STORAGE_INVALID/);assert.equal(fs.readFileSync(f.file,'utf8'),'{broken');assert(!fs.existsSync(path.join(f.dir,'quarantine')));
});
test('query validation rejects unapproved dimensions, paths, invalid dates and oversized input',()=>{
  for(const selection of [{groupBy:['cwd']},{file:'auth.json'},{from:'2026-02-30'},{from:'2026-10-18',to:'2026-10-17'},{model:['C:\\private']},{limit:501},{offset:-1},{groupBy:['agent','agent']},{agent:Array(51).fill('codex')},[]])assert.throws(()=>request(selection),/QUERY_/);
  assert.throws(()=>readSavedModel('C:/auth.json'),/QUERY_DIRECTORY_INVALID/);
});
test('billing failure is atomic and does not change the in-memory price; saved pricing reread is fresh',t=>{
  const f=fixture(t);f.add('a','unknown');f.save();const value={autoSync:false,defaults:{codex:{mode:'actual',multiplier:0}},mappings:{}};
  f.store.setBilling(value);fs.unlinkSync(path.join(f.dir,'billing.json'));fs.mkdirSync(path.join(f.dir,'billing.json'));
  assert.throws(()=>f.store.setBilling({...value,defaults:{codex:{mode:'actual',multiplier:2}}}));assert.equal(f.store.billing.defaults.codex.multiplier,0);assert(!fs.readdirSync(f.dir).some(name=>name.includes('.tmp-')));
  fs.rmdirSync(path.join(f.dir,'billing.json'));f.store.setBilling(value);assert.equal(query(f.file).total.estimatedCostUsd,null);
});
test('stable saved reads retry a concurrent atomic replacement and fail closed if every attempt changes',t=>{
  const f=fixture(t);f.add('a','gpt-4.1');f.save();const read=fs.readFileSync;let reads=0;
  t.mock.method(fs,'readFileSync',function(file,...args){const bytes=read.call(fs,file,...args);if(file===f.file&&++reads%2===1){f.store.state.sequence++;atomic(f.file,f.store.state);}return bytes;});
  assert.throws(()=>query(f.file),/QUERY_SNAPSHOT_BUSY/);assert.equal(reads,6);
  t.mock.restoreAll();assert.equal(query(f.file).sequence,f.store.state.sequence);
});
test('query metadata cannot echo a corrupted saved path; shared cache ratio includes observed writes',t=>{
  const f=fixture(t);f.add('a','gpt-4.1',{inputUncached:60,cacheRead:20,cacheWrite:20,totalTokens:120});f.store.state.updatedAt='C:/PRIVATE_METADATA_SENTINEL';f.save();const result=query(f.file);assert.equal(result.collectedAt,null);assert.equal(result.total.cacheHitRate,.2);assert(!JSON.stringify(result).includes('PRIVATE_METADATA_SENTINEL'));
});
test('query filesystem access is restricted to the four saved files; session metadata and preferences never affect output',t=>{
  const f=fixture(t);f.add('a','gpt-4.1');f.save();fs.writeFileSync(path.join(f.dir,'preferences.json'),'{invalid source config');fs.writeFileSync(path.join(f.dir,'auth.json'),'PRIVATE_AUTH_SENTINEL');
  const touched=[],read=fs.readFileSync,lstat=fs.lstatSync;
  t.mock.method(fs,'readFileSync',function(file,...args){touched.push(path.basename(file));return read.call(fs,file,...args);});
  t.mock.method(fs,'lstatSync',function(file,...args){touched.push(path.basename(file));return lstat.call(fs,file,...args);});
  assert.equal(query(f.file).total.records,1);assert.deepEqual([...new Set(touched)].sort(),['billing.json','model-pricing.json','pricing.json','statistics.json']);
});
test('billing rejects array shapes and inherited object names as agents or targets',t=>{
 const {store}=fixture(t);for(const value of [{autoSync:false,defaults:[],mappings:{}},{autoSync:false,defaults:{},mappings:[]},{autoSync:false,defaults:{constructor:{mode:'actual',multiplier:1}},mappings:{}},{autoSync:false,defaults:{},mappings:{'route/alias':'constructor'}}])assert.throws(()=>store.validateBilling(value),/PRICE_(SETTING|MAPPING)_INVALID/);
});
test('registered custom agents support billing and aggregate query without exposing the definition or file index',t=>{
 const f=fixture(t),id='custom-11111111-1111-4111-8111-111111111111',definition={schemaVersion:'CustomSourceV1',name:'PRIVATE_CUSTOM_NAME',template:'standard',mode:'per-request'};
 f.store.state.customSources={[id]:{id,name:definition.name,definition,version:1,enabled:false,archived:false,roots:[path.join(f.dir,'PRIVATE_CUSTOM_ROOT')],files:{},diagnostics:{}}};
 f.add('custom','unknown',{agent:id,provider:'route'});f.save();f.store.setPrice({provider:'manual',model:'standard',inputUncached:0,output:0,cacheRead:null,cacheWrite:0});
 f.store.setBilling({autoSync:false,defaults:{[id]:{mode:'actual',multiplier:2}},mappings:{'route/unknown':'manual/standard'}});
 const result=query(f.file,{agent:[id],groupBy:['agent']});assert.equal(result.rows[0].dimensions.agent,id);assert.equal(result.total.records,1);assert.equal(result.total.estimatedCostUsd,0);assert.equal(result.total.sessions,1);for(const secret of ['PRIVATE_CUSTOM_NAME','PRIVATE_CUSTOM_ROOT','definition','files','mappings'])assert(!JSON.stringify(result).includes(secret));
});
test('legacy deduplication and WorkBuddy aggregate suppression match GUI startup in memory, with original bytes intact',t=>{
 const f=fixture(t);f.add('owner','gpt-4.1',{sharedKey:'same-request'});f.add('larger','gpt-4.1',{sharedKey:'same-request',inputUncached:200,totalTokens:220});
 f.add('wb-detail','gpt-4.1',{agent:'workbuddy',sessionKey:'wb-session'});f.add('wb-aggregate','gpt-4.1',{agent:'workbuddy',sessionKey:'wb-session',accountingKind:'session-aggregate'});f.save();
 const before=fs.readFileSync(f.file),result=query(f.file);assert.equal(result.total.records,2);assert.equal(result.total.totalTokens,340);assert.deepEqual(fs.readFileSync(f.file),before);assert(!fs.existsSync(path.join(f.dir,'backups')));
 const gui=new Store(f.dir,{}).snapshot();assert.equal(result.total.totalTokens,gui.daily.reduce((sum,r)=>sum+r.totalTokens,0));assert.equal(result.total.estimatedCostUsd,gui.daily.reduce((sum,r)=>sum+(r.estimatedCostUsd??0),0));
});
test('legacy equal-total conflicting copies stay unpriced in the read-only projection',t=>{
 const f=fixture(t);f.add('owner','gpt-4.1',{sharedKey:'same-request'});f.add('conflict','gpt-4.1',{sharedKey:'same-request',inputUncached:90,cacheRead:10});f.save();const before=fs.readFileSync(f.file),result=query(f.file);assert.equal(result.total.records,1);assert.equal(result.total.estimatedCostUsd,null);assert.equal(result.total.partialRecords,1);assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(new Store(f.dir,{}).snapshot().daily[0].estimatedCostUsd,null);
});

test('continued pages require a result revision, are deterministic across sizes, and reject a different selection',t=>{
 const f=fixture(t);for(const model of ['d','c','b','a'])f.add(model,model);f.save();
 const all=query(f.file,{groupBy:['model'],limit:500}),first=query(f.file,{groupBy:['model'],limit:1});
 assert.match(first.revision,/^uq1_[a-f0-9]{64}$/);assert.equal(first.revision,all.revision);
 assert.throws(()=>query(f.file,{groupBy:['model'],offset:1}),/QUERY_REVISION_REQUIRED/);
 assert.throws(()=>query(f.file,{groupBy:['agent'],revision:first.revision}),/QUERY_SNAPSHOT_CHANGED/);
 assert.throws(()=>request({revision:'not-a-revision'}),/QUERY_ARGUMENT_INVALID/);
 const second=query(f.file,{groupBy:['model'],offset:1,limit:2,revision:first.revision});
 const last=query(f.file,{groupBy:['model'],offset:3,limit:1,revision:first.revision});
 assert.deepEqual([...first.rows,...second.rows,...last.rows],all.rows);assert.deepEqual(second.total,all.total);assert.equal(last.nextOffset,null);
 assert.deepEqual(query(f.file,{groupBy:['model'],offset:99,revision:first.revision}).rows,[]);
 const a=query(f.file,{model:['b','a'],groupBy:['model','agent']}),b=query(f.file,{model:['a','b','a'],groupBy:['agent','model']});assert.equal(a.revision,b.revision);
});
test('price, mapping, multiplier, catalog, usage and timezone changes invalidate earlier query versions',t=>{
 const f=fixture(t);f.add('a','alias');f.save();
 const price={provider:'openai',model:'alias',inputUncached:1,output:1,cacheRead:0,cacheWrite:0};
 const change=action=>{const before=query(f.file);action();const after=query(f.file);assert.notEqual(after.revision,before.revision);assert.throws(()=>query(f.file,{revision:before.revision}),/QUERY_SNAPSHOT_CHANGED/);return [before,after];};
 change(()=>f.store.setPrice(price));const [before,after]=change(()=>f.store.setPrice({...price,inputUncached:2}));assert.equal(before.sequence,after.sequence);assert.notEqual(before.total.estimatedCostUsd,after.total.estimatedCostUsd);
 change(()=>f.store.setBilling({autoSync:false,defaults:{codex:{mode:'actual',multiplier:2}},mappings:{}}));
 f.store.setPrice({...price,model:'mapped'});change(()=>f.store.setBilling({autoSync:false,defaults:{},mappings:{'openai/alias':'openai/mapped'}}));
 const {parse}=require('../../src/m1/runtime-catalog');change(()=>f.store.installCatalog(parse(JSON.stringify({vendor:{models:{other:{modalities:{output:['text']},cost:{input:1,output:1}}}}}))));
 change(()=>{f.add('b','alias');f.save();});
 const original=process.env.TZ;t.after(()=>{if(original===undefined)delete process.env.TZ;else process.env.TZ=original;});process.env.TZ='UTC';change(()=>{process.env.TZ='Asia/Shanghai';});
});
test('query revision excludes raw saved bytes and identity metadata, rather than hashing the storage file',t=>{
 const f=fixture(t);f.add('a','gpt-4.1');f.save();const before=query(f.file);
 f.store.state.sessions={raw:{id:'PRIVATE_RAW_SESSION',cwd:'C:/PRIVATE_PATH'}};
 const record=f.store.records()[0];delete f.store.state.records[record.id];record.id='PRIVATE_RECORD_ID';record.sessionKey='PRIVATE_SESSION_KEY';f.store.state.records[record.id]=record;
 atomic(f.file,f.store.state);const after=query(f.file);assert.deepEqual(after,before);
 for(const secret of ['PRIVATE_RAW_SESSION','PRIVATE_PATH','PRIVATE_RECORD_ID','PRIVATE_SESSION_KEY'])assert(!JSON.stringify(after).includes(secret));
});

test('legacy unsupported entry uses the same unknown dimension for aggregates and session counts',t=>{
 const f=fixture(t);f.add('a','gpt-4.1',{entry:'legacy-window'});f.save();const result=query(f.file,{groupBy:['entry'],entry:['unknown']});assert.equal(result.total.records,1);assert.equal(result.total.sessions,1);assert.equal(result.rows[0].dimensions.entry,'unknown');assert.equal(result.rows[0].sessions,1);
});
