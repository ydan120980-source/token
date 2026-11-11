'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {Service}=require('../../src/m1/service');
const {Store,atomic}=require('../../src/m1/store');
const {SOURCES}=require('../../src/m1/policy');
const {remove}=require('./temp');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'collection-batch-')),dir=path.join(root,'usage'),service=new Service(dir,{},()=>{},{home:path.join(root,'home'),appData:null,localAppData:null});
  t.after(async()=>{await service.close();await remove(root);});service.store.savePreferences({...service.store.settings,refreshIntervalMs:0});
  const record=(agent,id)=>({id:id.repeat(64),agent,entry:'cli',provider:'private',model:'fixture',timestamp:'2026-10-20T04:00:00Z',inputUncached:100,output:20,cacheRead:0,cacheWrite:0,reasoning:0,totalTokens:120,quality:'measured'});
  const custom={};for(const [n,id] of ['custom-11111111-1111-4111-8111-111111111111','custom-22222222-2222-4222-8222-222222222222'].entries()){
    service.store.state.customSources||={};service.store.state.customSources[id]={id,name:'Synthetic '+n,definition:{schemaVersion:'CustomSourceV1',name:'Synthetic '+n,template:'standard',mode:'per-request'},version:1,roots:[path.join(root,'source'+n)],files:{},enabled:true,archived:false,diagnostics:{}};
    custom[id]={files:{},diagnostics:{invalid:0,unsupported:0,conflicts:0,errors:[]},fileCount:1,records:[record(id,n?'c':'b')]};
  }
  atomic(path.join(dir,'statistics.json'),service.store.state);
  const scan=Object.fromEntries(SOURCES.map(agent=>[agent,{detected:false,records:[],sessions:[],errors:[],partial:false,fileCount:0,skipped:0,durationMs:0}]));scan.claude={...scan.claude,detected:true,records:[record('claude','a')]};
  let result={scan,custom,native:{status:'passed'},stamp:'synthetic-stamp',audit:{reads:0,sourceWrites:0,authenticationReads:0,networkAttempts:0}};
  class Worker extends EventEmitter{postMessage(request){queueMicrotask(()=>this.emit('message',{id:request.id,...result}));}terminate(){return Promise.resolve();}}
  service.spawn=()=>new Worker();return {service,dir,scan,custom,setResult:value=>{result=value;}};
}
test('refresh never leaves an earlier built-in/custom commit behind when a later custom draft fails',async t=>{
  const f=fixture(t),store=f.service.store,before=store.state,bytes=fs.readFileSync(path.join(f.dir,'statistics.json')),commit=store.commitCustom;let calls=0;
  t.mock.method(Store.prototype,'commitCustom',function(...args){if(++calls===2)throw Object.assign(new Error('synthetic private path and token'),{code:'EACCES'});return commit.apply(this,args);});
  const result=await f.service.refresh();assert.equal(result.error,'COLLECTION_FAILED');assert.equal(result.diagnostic.reason,'EACCES');
  assert.equal(store.state,before);assert.deepEqual(fs.readFileSync(path.join(f.dir,'statistics.json')),bytes);assert.equal(store.records().length,0);
  assert.equal(f.service.stamp,null);assert.equal(f.service.checkedAt,null);
  t.mock.restoreAll();await f.service.refresh();assert.equal(store.records().length,3);assert.equal(store.state.sequence,before.sequence+1);
  assert.equal(new Store(f.dir,{}).records().length,3);assert.equal(f.service.get().error,null);
});
test('one refresh commits all facts in one statistics rename; failed persistence retains memory/cache/disk',async t=>{
  const f=fixture(t),store=f.service.store,file=path.join(f.dir,'statistics.json'),before=store.state,snapshot=store.snapshot(),bytes=fs.readFileSync(file),rename=fs.renameSync;let writes=0,denied=true;
  t.mock.method(fs,'renameSync',(from,to)=>{if(to===file){writes++;if(denied)throw Object.assign(new Error('synthetic denied'),{code:'ENOSPC'});}return rename(from,to);});
  await f.service.refresh();assert.equal(store.state,before);assert.equal(store.snapshot(),snapshot);assert.deepEqual(fs.readFileSync(file),bytes);
  assert.equal(f.service.get().diagnostic.reason,'ENOSPC');assert.equal(writes,1);
  denied=false;writes=0;await f.service.refresh();assert.equal(writes,1);assert.equal(store.state.sequence,before.sequence+1);assert.equal(store.records().length,3);
  assert.deepEqual(new Store(f.dir,{}).state.records,store.state.records);
});
test('partial source observations retain history while other facts commit, quiet custom retries do not rewrite',async t=>{
  const f=fixture(t),store=f.service.store;await f.service.refresh();const sequence=store.state.sequence;
  f.scan.claude={...f.scan.claude,records:[],partial:true,errors:['SOURCE_UNREADABLE']};
  await f.service.refresh();assert.equal(store.records().length,3);assert.equal(store.state.statuses.claude.status,'error');assert.match(f.service.get().error,/保留历史/);
  assert.equal(store.state.sequence,sequence+1);const bytes=fs.readFileSync(path.join(f.dir,'statistics.json')),after=store.state.sequence;
  f.setResult({unchanged:true,reason:'quiet',stamp:'synthetic-stamp',custom:f.custom,audit:{reads:0}});
  await f.service.refresh();assert.equal(store.state.sequence,after);assert.deepEqual(fs.readFileSync(path.join(f.dir,'statistics.json')),bytes);
  await f.service.close();await f.service.refresh();assert.equal(store.state.sequence,after);
});
test('a failed projection is rejected before disk commit and custom-only batches commit once',t=>{
  const f=fixture(t),store=f.service.store,file=path.join(f.dir,'statistics.json'),bytes=fs.readFileSync(file),before=store.state;
  const snapshot=Store.prototype.snapshot;t.mock.method(Store.prototype,'snapshot',function(){if(this._collectionStaging)throw new Error('SYNTHETIC_PROJECTION_FAILURE');return snapshot.call(this);});
  assert.throws(()=>store.ingestCollection(f.scan,{status:'passed'},f.custom),/PROJECTION_FAILURE/);assert.equal(store.state,before);assert.deepEqual(fs.readFileSync(file),bytes);
  t.mock.restoreAll();store.ingestCollection(null,null,f.custom);assert.equal(store.records().length,2);assert.equal(store.state.sequence,before.sequence+1);
  const stable=store.state;store.ingestCollection(null,null,f.custom);assert.equal(store.state,stable,'quiet batch skips cloning the whole ledger');
});

test('built-in retries reuse the staged digest while changed custom facts receive a new final digest', async t => {
  const f = fixture(t), store = f.service.store;
  await f.service.refresh();
  const before = store.diagnostics(), sequence = store.state.sequence, bytes = fs.readFileSync(path.join(f.dir, 'statistics.json'));
  await f.service.refresh();
  const after = store.diagnostics();
  assert.equal(after.stages.digest.count - before.stages.digest.count, 1);
  assert.equal(after.stages.persist.count - before.stages.persist.count, 0);
  assert.equal(store.state.sequence, sequence);
  assert.deepEqual(fs.readFileSync(path.join(f.dir, 'statistics.json')), bytes);
  const selected = Object.values(f.custom)[0]; selected.fileCount = 2;
  selected.records.push({ ...selected.records[0], id: 'd'.repeat(64) });
  await f.service.refresh();
  assert.equal(store.records().length, 4);
  assert.equal(store.persistedDigest, store.digest());
  assert.equal(new Store(f.dir, {}).records().length, 4);
});

test('collection drafts preserve frozen retained facts and rollback replacements before persistence',async t=>{
 const f=fixture(t),store=f.service.store;await f.service.refresh();
 const before=store.state,expected=structuredClone(before),retained=Object.values(before.records).find(r=>r.agent.startsWith('custom-'));
 const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const item of Object.values(value))freeze(item);Object.freeze(value);}};freeze(before);
 const old=f.scan.claude.records[0];f.scan.claude={...f.scan.claude,records:[{...old,totalTokens:240,inputUncached:220}]};
 const file=path.join(f.dir,'statistics.json'),rename=fs.renameSync;t.mock.method(fs,'renameSync',(from,to)=>{if(to===file)throw Object.assign(Error('synthetic denied'),{code:'ENOSPC'});return rename(from,to);});
 await f.service.refresh();assert.equal(store.state,before);assert.deepEqual(store.state,expected);assert.equal(store.snapshot().daily.reduce((n,r)=>n+r.totalTokens,0),360);
 t.mock.restoreAll();await f.service.refresh();assert.deepEqual(before,expected);assert.equal(store.state.records[retained.id],retained);assert.equal(store.records().find(r=>r.agent==='claude').totalTokens,240);assert.equal(store.persistedDigest,store.digest());
 assert.deepEqual(new Store(f.dir,{}).state.records,JSON.parse(JSON.stringify(store.state.records)));
});

test('staged parser backups retain the complete observation before the rest of a batch replaces statuses and records',async t=>{
 const f=fixture(t),store=f.service.store,record={...f.scan.claude.records[0],id:'e'.repeat(64),agent:'codex',totalTokens:500,inputUncached:480};
 store.state.records[record.id]=record;store.state.statuses.codex={agent:'codex',status:'partial',errors:['SOURCE_USAGE_CONFLICT']};const before=JSON.parse(JSON.stringify(store.state));
 f.scan.codex={...f.scan.codex,detected:true,records:[{...record,totalTokens:600,inputUncached:580}]};await f.service.refresh();assert.equal(store.state.records[record.id].totalTokens,600);
 const directory=path.join(f.dir,'backups'),file=fs.readdirSync(directory).find(n=>n.startsWith('statistics-before-parser2-'));assert(file);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,file),'utf8')),before);
});
