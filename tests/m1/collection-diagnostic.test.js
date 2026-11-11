'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Worker}=require('node:worker_threads');
const {once}=require('node:events');
const {Service}=require('../../src/m1/service');
const {atomic}=require('../../src/m1/store');
const {classify,sanitize,failure,fromMessage}=require('../../src/m1/collection-diagnostic');
const {remove}=require('./temp');
const sensitive='C:/private-user/auth.json Bearer SECRET_TOKEN https://account.invalid/raw-response';
const clean=value=>{const json=JSON.stringify(value);for(const secret of ['private-user','auth.json','SECRET_TOKEN','account.invalid','raw-response','stack','command'])assert(!json.includes(secret),json);};
function workspace(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'collection-diagnostic-'));t.after(()=>remove(root));return root;}
// Replace only the native verifier inside an actual worker; no product fault hook,
// real source, authentication read or network access is involved.
function worker(mode='os'){
  return new Worker(`
    const {workerData}=require('node:worker_threads');
    require(workerData.native).verifyProjection=async()=>{
      if(workerData.mode==='network')require('node:https').get('https://synthetic.invalid');
      if(workerData.mode==='success')return {status:'passed',records:0,tokens:0};
      const error=new Error(workerData.mode==='native'?'NATIVE_TOTAL_MISMATCH':workerData.mode==='uppercase'?'SECRET_TOKEN':workerData.sensitive);
      if(workerData.mode==='os')error.code='EACCES';
      error.path=workerData.sensitive;error.command=workerData.sensitive;error.cause={token:workerData.sensitive};throw error;
    };
    const {parentPort}=require('node:worker_threads');
    const factory=require(workerData.entry).createExecutor,executor=factory();factory();
    parentPort.on('message',request=>{void executor.execute(request,value=>parentPort.postMessage(value));});
  `,{eval:true,workerData:{entry:require.resolve('../../src/m1/worker'),native:require.resolve('../../src/m1/native'),mode,sensitive}});
}
test('diagnostic projection admits only fixed reason/category/stage and strips all exception details',()=>{
  for(const reason of ['EACCES','EPERM','ENOENT','ENOSPC','EMFILE','ENFILE','EIO','EBUSY','EROFS','ENOTDIR','EISDIR','EINVAL','ETIMEDOUT']){
    const raw=Object.assign(new Error(sensitive),{code:reason,path:sensitive,command:sensitive,cause:{token:sensitive}});
    assert.deepEqual(classify(raw,'source-scan'),{stage:'source-scan',category:'os',reason});clean(failure(raw,'source-scan'));
  }
  for(const reason of ['NATIVE_UNAVAILABLE','NATIVE_BINARY_MISMATCH','NATIVE_TIMEOUT','NATIVE_OUTPUT_LIMIT','NATIVE_FAILED','NATIVE_SCHEMA_MISMATCH','NATIVE_TOTAL_MISMATCH']){
    const safe=failure(new Error(reason),'native-verification');assert.equal(safe.error,reason);assert.deepEqual(safe.diagnostic,{stage:'native-verification',category:'native',reason});
  }
  assert.deepEqual(classify(new SyntaxError(sensitive),'native-verification'),{stage:'native-verification',category:'unknown',reason:'UNKNOWN'});
  assert.deepEqual(classify(new Error('SOURCE_UNREADABLE',{cause:Object.assign(new Error(sensitive),{code:'EACCES'})}),'source-scan'),{stage:'source-scan',category:'os',reason:'EACCES'});
  assert.deepEqual(failure(new Error('SECRET_TOKEN'),'source-scan'),{error:'COLLECTION_FAILED',diagnostic:{stage:'source-scan',category:'unknown',reason:'UNKNOWN'}});
  assert.deepEqual(classify({code:sensitive,message:sensitive},sensitive),{stage:'collection',category:'unknown',reason:'UNKNOWN'});
  assert.equal(failure(new Error('SOURCE_LIMIT'),'source-scan').error,'SOURCE_LIMIT');
  assert.deepEqual(classify(new Error('SOURCE_LIMIT'),'source-scan'),{stage:'source-scan',category:'contract',reason:'CONTROLLED_ERROR'});
  for(const diagnostic of [{stage:sensitive,category:'os',reason:'EACCES'},{stage:'ingest',category:'os',reason:sensitive},{stage:'ingest',category:'native',reason:'EACCES'},{stage:'ingest',category:sensitive,reason:'UNKNOWN'}])assert.equal(sanitize(diagnostic),null);
  const error=fromMessage({error:sensitive,diagnostic:{stage:'ingest',category:'os',reason:'ENOSPC',path:sensitive,stack:sensitive}});
  assert.equal(error.message,'COLLECTION_FAILED');assert.deepEqual(error.diagnostic,{stage:'ingest',category:'os',reason:'ENOSPC'});clean({error:error.message,diagnostic:error.diagnostic});
});
test('actual worker retains native/OS/unknown distinctions without raw errors or data reads',async t=>{
  const dir=workspace(t);
  for(const [mode,category,reason,error] of [['os','os','EACCES','COLLECTION_FAILED'],['native','native','NATIVE_TOTAL_MISMATCH','NATIVE_TOTAL_MISMATCH'],['unknown','unknown','UNKNOWN','COLLECTION_FAILED'],['uppercase','unknown','UNKNOWN','COLLECTION_FAILED']]){
    const w=worker(mode);t.after(()=>w.terminate());
    const result=once(w,'message');w.postMessage({id:mode,roots:{},salt:'synthetic',dir,previousStamp:null});
    const [message]=await result;assert.equal(message.error,error);assert.deepEqual(message.diagnostic,{stage:'native-verification',category,reason});
    assert.deepEqual(message.audit,{reads:0,sourceWrites:0,authenticationReads:0,networkAttempts:0});clean(message);await w.terminate();
  }
});
test('unrecognised request failure is controlled and keeps its actual worker phase',async t=>{
  const w=new Worker(require.resolve('../../src/m1/worker'));t.after(()=>w.terminate());
  const pending=once(w,'message');w.postMessage({id:'invalid',roots:null});const [message]=await pending;
  assert.equal(message.error,'COLLECTION_FAILED');assert.deepEqual(message.diagnostic,{stage:'source-watch',category:'unknown',reason:'UNKNOWN'});
  assert.equal(message.audit.reads,0);clean(message);
});
test('co-located executors keep network denied and attribute blocked attempts to the active collection audit',async t=>{
  const dir=workspace(t),w=worker('network');t.after(()=>w.terminate());const pending=once(w,'message');w.postMessage({id:'network',roots:{},salt:'synthetic',dir,previousStamp:null});
  const [message]=await pending;assert.equal(message.error,'COLLECTION_FAILED');assert.equal(message.audit.networkAttempts,1);assert.equal(message.audit.authenticationReads,0);assert.equal(message.audit.sourceWrites,0);clean(message);
});
test('worker -> service -> getter keeps safe diagnostics in memory, preserves ledger on failure and clears on recovery',async t=>{
  const root=workspace(t),dir=path.join(root,'usage'),service=new Service(dir,{},()=>{},{home:path.join(root,'home'),appData:null,localAppData:null});t.after(()=>service.close());
  service.store.savePreferences({...service.store.settings,refreshIntervalMs:0});
  const record={id:'a'.repeat(64),agent:'codex',entry:'cli',provider:'private',model:'unknown',timestamp:'2026-10-20T04:00:00Z',inputUncached:10,output:null,cacheRead:null,cacheWrite:null,reasoning:null,totalTokens:10,quality:'partial'};
  service.store.state.records={[record.id]:record};service.store.state.sequence=5;atomic(path.join(dir,'statistics.json'),service.store.state);
  const bytes=fs.readFileSync(path.join(dir,'statistics.json')),before=JSON.stringify(service.store.state);let mode='os';service.spawn=()=>worker(mode);
  let result=await service.refresh();assert.equal(result.error,'COLLECTION_FAILED');assert.deepEqual(result.diagnostic,{stage:'native-verification',category:'os',reason:'EACCES'});clean(result);
  assert.equal(JSON.stringify(service.store.state),before);assert.deepEqual(fs.readFileSync(path.join(dir,'statistics.json')),bytes);
  for(const file of fs.readdirSync(dir))if(file.endsWith('.json')){const saved=fs.readFileSync(path.join(dir,file),'utf8');assert(!saved.includes('diagnostic'));assert(!saved.includes('SECRET_TOKEN'));}
  const again=new Service(dir,{},()=>{},{home:path.join(root,'home'),appData:null,localAppData:null});assert.equal(again.get().diagnostic,null);await again.close();
  await service.dropCollector();mode='success';result=await service.refresh();assert.equal(result.error,null);assert.equal(result.diagnostic,null);assert.equal(service.store.state.records[record.id].totalTokens,10);
  assert(result.snapshot.daily.some(row=>row.unpricedTokens),'unpriced usage remains data, not a collection error');
});
test('service sanitizes persistence failures, worker crashes and timeouts without changing the ledger',async t=>{
  const {EventEmitter}=require('node:events'),root=workspace(t),service=new Service(path.join(root,'usage'),{},()=>{},{home:path.join(root,'home')});t.after(()=>service.close());
  service.store.savePreferences({...service.store.settings,refreshIntervalMs:0});
  const bytes=fs.readFileSync(path.join(root,'usage','statistics.json')),state=service.store.state;
  class SyntheticWorker extends EventEmitter{
    constructor(mode){super();this.mode=mode;}
    postMessage(request){if(this.mode==='timeout')return;queueMicrotask(()=>this.mode==='crash'?this.emit('error',Object.assign(new Error(sensitive),{code:'EPERM'})):this.emit('message',{id:request.id,scan:{},custom:{},native:{status:'passed'}}));}
    terminate(){queueMicrotask(()=>this.emit('exit',1));return Promise.resolve();}
  }
  let mode='ingest';service.spawn=()=>new SyntheticWorker(mode);
  service.store.ingestCollection=()=>{throw Object.assign(new Error(sensitive),{code:'ENOSPC',path:sensitive});};
  let result=await service.refresh();assert.equal(result.error,'COLLECTION_FAILED');assert.deepEqual(result.diagnostic,{stage:'ingest',category:'os',reason:'ENOSPC'});clean(result);
  await service.dropCollector();mode='crash';result=await service.refresh();assert.equal(result.error,'COLLECTION_WORKER_FAILED');assert.deepEqual(result.diagnostic,{stage:'worker',category:'os',reason:'EPERM'});clean(result);
  mode='timeout';service.timeoutMs=5;result=await service.refresh();assert.equal(result.error,'COLLECTION_TIMEOUT');assert.deepEqual(result.diagnostic,{stage:'worker',category:'contract',reason:'COLLECTION_TIMEOUT'});
  assert.equal(service.store.state,state);assert.deepEqual(fs.readFileSync(path.join(root,'usage','statistics.json')),bytes);
});
