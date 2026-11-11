'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {roots,allowedFile}=require('../../src/m1/policy');
const {scanSources,parseDatabase,sourceStamp}=require('../../src/m1/sources');
const extra=require('../../src/m1/batch1-extra-sources');
const {Store}=require('../../src/m1/store');
const {Service}=require('../../src/m1/service');
const {selectSnapshot}=require('../../src/m1/local-snapshot');
const {evaluate}=require('../../src/m1/pricing');
const {write,PRIVATE,time}=require('./batch1-fixtures');
const {remove}=require('./temp');
const sum=records=>records.reduce((n,r)=>n+r.totalTokens,0);
function qwen(session='qwen-session',timestamp=time){return {type:'assistant',sessionId:session,timestamp,model:'qwen3-coder-plus',usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,cachedContentTokenCount:40,thoughtsTokenCount:5,totalTokenCount:120},message:PRIVATE};}
function kimiModern(){return {type:'usage.record',usageScope:'turn',time:Date.parse(time),model:'kimi-code/kimi-for-coding',usage:{inputOther:60,output:20,inputCacheRead:40,inputCacheCreation:10},body:PRIVATE};}
function kiloMessage(){return {role:'assistant',modelID:'gpt-4.1',providerID:'openai',time:{created:Date.parse(time)},tokens:{input:60,output:20,reasoning:5,cache:{read:40,write:10},total:135},content:PRIVATE,cost:999};}
function makeDb(file,sql){fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);db.exec(sql);return db;}
function hashes(root){const result={};for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isDirectory())Object.assign(result,hashes(file));else result[file]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}return result;}
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usage-extra-')),home=path.join(dir,'home'),selected=roots(home);
  t.after(()=>remove(dir));
  const cont=makeDb(selected.continue[0],'CREATE TABLE tokens_generated(id INTEGER PRIMARY KEY,model TEXT,provider TEXT,tokens_prompt INTEGER,tokens_generated INTEGER,timestamp TEXT); CREATE TABLE private_context(secret TEXT);');
  cont.prepare('INSERT INTO tokens_generated VALUES(1,?,?,?,?,?)').run('gpt-4.1','openai',100,20,'2026-11-01 01:00:00');cont.prepare('INSERT INTO private_context VALUES(?)').run(PRIVATE);cont.close();
  const kilo=makeDb(selected.kilo[1],'CREATE TABLE message(id TEXT,session_id TEXT,data TEXT); CREATE TABLE part(secret TEXT);');
  kilo.prepare('INSERT INTO message VALUES(?,?,?)').run('kilo-request','kilo-session',JSON.stringify(kiloMessage()));kilo.prepare('INSERT INTO part VALUES(?)').run(PRIVATE);kilo.close();
  const kiloIde=path.join(selected.kilo[0],'ide-task','ui_messages.json');
  write(kiloIde,[{type:'say',say:'api_req_started',ts:Date.parse(time),modelInfo:{modelId:'gpt-4.1',providerId:'openai'},text:JSON.stringify({tokensIn:100,tokensOut:20,cacheReads:40,cacheWrites:10,request:PRIVATE})}],true);
  const qFile=path.join(selected.qwen[0],'project','chats','one.jsonl');write(qFile,[qwen()]);
  const kFile=path.join(selected.kimi[0],'group','legacy-session','wire.jsonl');write(kFile,[{timestamp:Date.parse(time)/1000,message:{type:'StatusUpdate',payload:{message_id:'legacy-call',token_usage:{input_other:60,output:20,input_cache_read:40,input_cache_creation:10,total:130},private:PRIVATE}}}]);
  const modernFile=path.join(selected.kimi[1],'workspace','modern-session','agents','main','wire.jsonl');write(modernFile,[kimiModern(),{...kimiModern(),usageScope:'session'},{type:'step.end',usage:kimiModern().usage}]);
  return {dir,home,selected,qFile,kFile,modernFile,kiloIde};
}
test('remaining first-batch sources read only approved numeric facts, preserve unknown/estimated semantics and restart',async t=>{
  const {dir,home,selected}=setup(t),before=hashes(home),scan=await scanSources(selected,'salt',{reads:0});
  assert.equal(sum(scan.continue.records),120);assert.deepEqual(scan.continue.errors,['SOURCE_USAGE_ESTIMATED']);assert.equal(scan.continue.records[0].quality,'partial');assert.equal(scan.continue.records[0].cacheRead,null);
  assert.equal(sum(scan.kilo.records),255);assert.deepEqual(scan.kilo.errors,[]);assert.equal(scan.kilo.records.find(r=>r.entry==='cli').output,25);assert.equal(scan.kilo.records.find(r=>r.entry==='desktop').inputUncached,50);
  assert.equal(sum(scan.qwen.records),120);assert.equal(scan.qwen.records[0].output,20);assert.equal(scan.qwen.records[0].cacheWrite,null);
  assert.equal(sum(scan.kimi.records),260);assert.equal(scan.kimi.records.length,2);assert(scan.kimi.records.some(r=>r.model==='unknown'));
  const store=new Store(path.join(dir,'app'),selected);store.ingestCollection(scan,{status:'passed'},{});const facts=JSON.stringify(store.state.records);store.ingestCollection(scan,{status:'passed'},{});assert.equal(JSON.stringify(store.state.records),facts);
  const restored=new Store(store.dir,selected),safe=selectSnapshot(restored.snapshot());assert.equal(sum(safe.daily),755);assert(!JSON.stringify(restored.state).includes(PRIVATE));assert(!JSON.stringify(safe).includes(home));assert.deepEqual(hashes(home),before);
  const estimate=evaluate(scan.continue.records[0],{}, {inputUncached:1,output:1,cacheRead:1,cacheWrite:1,provenance:'manual'});assert.equal(estimate.lower,null);assert.equal(estimate.reason,'usage-incomplete');
});
test('Qwen resolves reasoning overlap only from explicit totals and keeps ambiguous output unknown',()=>{
  const inclusive=extra.qwen([qwen()],'salt')[0];assert.equal(inclusive.output,20);assert.equal(inclusive.totalTokens,120);assert.equal(inclusive.reasoning,5);
  const separate=qwen();separate.usageMetadata.totalTokenCount=125;const r=extra.qwen([separate],'salt')[0];assert.equal(r.output,25);assert.equal(r.totalTokens,125);
  const ambiguous=qwen();delete ambiguous.usageMetadata.totalTokenCount;const rows=extra.qwen([ambiguous],'salt');assert.equal(rows[0].output,null);assert.equal(rows[0].quality,'partial');assert(rows.warnings.includes('USAGE_UNREPORTED'));
  const contradictory=qwen();contradictory.usageMetadata.totalTokenCount=119;const c=extra.qwen([contradictory],'salt')[0];assert.equal(c.totalTokens,119);assert.equal(c.output,null);assert.equal(c.quality,'total-mismatch');
});
test('Qwen stable identities preserve simultaneous multiplicity and ignore unbilled message insertion, copied exports dedupe',async t=>{
  const {selected,qFile}=setup(t),row=qwen();write(qFile,[row,row]);
  write(path.join(path.dirname(qFile),'copy.jsonl'),[{type:'user',body:PRIVATE},row,row]);
  const scan=await scanSources(selected,'salt',{reads:0});assert.equal(scan.qwen.records.length,2);assert.equal(sum(scan.qwen.records),240);
  const changed=qwen();changed.model='other';changed.usageMetadata.candidatesTokenCount=30;assert.equal(extra.qwen([row],'salt')[0].id,extra.qwen([changed],'salt')[0].id);
});
test('Kimi counts turn records, dedupes repeated legacy message IDs, keeps lanes distinct and never reads config for model',async t=>{
  const {selected,kFile,modernFile}=setup(t),old=JSON.parse(fs.readFileSync(kFile,'utf8'));
  write(kFile,[old,old]);write(path.join(path.dirname(path.dirname(modernFile)),'child','wire.jsonl'),[kimiModern()]);
  const scan=await scanSources(selected,'salt',{reads:0});assert.equal(scan.kimi.records.length,3);assert.equal(sum(scan.kimi.records),390);assert.equal(scan.kimi.records.filter(r=>r.model==='unknown').length,1);
  const symbol=kimiModern();symbol.model='__kimi_env_model__';assert.equal(extra.kimi([symbol],'salt',modernFile)[0].model,'unknown');
  assert.equal(extra.kimi([{...kimiModern(),usageScope:undefined}],'salt',modernFile).length,0);
});
test('Kilo CLI input/cache buckets and output overlap are proved by total; malformed rows are isolated',async t=>{
  const {selected}=setup(t),db=new DatabaseSync(selected.kilo[1]);db.exec("INSERT INTO message VALUES('bad','s','{broken')");db.close();
  const rows=await parseDatabase('kilo',selected.kilo[1],'salt',{reads:0});assert.equal(sum(rows),135);assert(rows.warnings.includes('SOURCE_ROW_INVALID'));
  const inclusive={...kiloMessage(),id:'id',session_id:'s'};inclusive.tokens={...inclusive.tokens,total:130};const value=extra.kilo([inclusive],'salt')[0];assert.equal(value.output,20);assert.equal(value.totalTokens,130);
  delete inclusive.tokens.total;const unknown=extra.kilo([inclusive],'salt');assert.equal(unknown[0].output,null);assert(unknown.warnings.includes('USAGE_UNREPORTED'));
});
test('Continue SQLite committed WAL is visible without modifying source bytes',async t=>{
  const {selected,home}=setup(t),db=new DatabaseSync(selected.continue[0]);
  try{
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;');db.prepare('INSERT INTO tokens_generated VALUES(2,?,?,?,?,?)').run('gpt-4.1','openai',10,5,'2026-11-01 02:00:00');
    const before=hashes(home),stamp=sourceStamp(selected,'salt',{reads:0}),rows=await parseDatabase('continue',selected.continue[0],'salt',{reads:0});assert.equal(sum(rows),135);assert.deepEqual(hashes(home),before);
    db.prepare('INSERT INTO tokens_generated VALUES(3,?,?,?,?,?)').run('gpt-4.1','openai',1,2,'2026-11-01 03:00:00');assert.notEqual(sourceStamp(selected,'salt',{reads:0}),stamp);
  }finally{db.close();}
});
test('new source whitelists reject auth/config/body/index files and only accept documented format locations',()=>{
  for(const agent of ['continue','kilo','qwen','kimi'])for(const name of ['auth.json','config.json','credentials.json','api_conversation_history.json','index.json','state.vscdb'])assert.equal(allowedFile(agent,name),false);
  assert(allowedFile('continue','devdata.sqlite'));assert(!allowedFile('continue','tokensGenerated.jsonl'));
  assert(allowedFile('qwen',path.join('chats','file.jsonl')));assert(!allowedFile('qwen',path.join('logs','file.jsonl')));
  assert(allowedFile('kimi','wire.jsonl'));assert(!allowedFile('kimi','context.jsonl'));
});
test('all seven new agents stay usage-only: no login or install, and at most a card waiting for its reader',()=>{
  const {agents}=require('../../src/m1/agent-catalog'),quota=require('../../src/quota/provider-catalog').capabilities(),{plans}=require('../../src/quota/agent-install-plans');
  for(const agent of ['copilot','cline','pi','continue','kilo','qwen','kimi']){assert(agents[agent].usageOnly);const row=quota.find(r=>r.provider===agent);assert(!row||row.mode==='planned'&&row.adapters.length===0);assert(!Object.hasOwn(plans,agent));}
  assert(!quota.some(r=>r.provider==='pi'||r.provider==='continue'),'no account of their own to read');
});
test('Kilo CLI copied/migrated OpenCode-schema calls dedupe across sources and retain the persisted first owner',async t=>{
  const {dir,selected}=setup(t),store=new Store(path.join(dir,'app'),selected);
  store.ingestCollection(await scanSources(selected,store.state.salt,{reads:0}),{status:'passed'},{});
  const file=path.join(selected.opencode[0],'opencode.db'),db=makeDb(file,'CREATE TABLE message(id TEXT,session_id TEXT,data TEXT)');
  db.prepare('INSERT INTO message VALUES(?,?,?)').run('kilo-request','kilo-session',JSON.stringify(kiloMessage()));db.close();
  const scan=await scanSources(selected,store.state.salt,{reads:0});
  assert.equal(sum(scan.opencode.records),135);assert.equal(sum(scan.kilo.records),120);
  store.ingestCollection(scan,{status:'passed'},{});
  assert.equal(sum(store.records()),755);assert.equal(store.records().find(r=>r.sharedKey)?.agent,'kilo');
  const reopened=new Store(store.dir,selected);assert.equal(sum(reopened.records()),755);
});
test('remaining four sources pass the collecting service/native projection without treating estimated data as an IO retry',async t=>{
  const {dir,home,selected}=setup(t),service=new Service(path.join(dir,'app'),selected,()=>{},{home,appData:path.join(home,'AppData','Roaming'),localAppData:path.join(home,'AppData','Local')});
  try{
    const value=await service.refresh();assert.equal(sum(value.snapshot.daily),755);assert.equal(service.retry,0);
    assert.equal(service.store.state.statuses.continue.nativeVerification,'passed');assert.equal(service.store.state.statuses.continue.status,'partial');
    assert.equal(value.audit.sourceWrites,0);assert.equal(value.audit.authenticationReads,0);assert.equal(value.audit.networkAttempts,0);
    const bytes=fs.readFileSync(path.join(service.store.dir,'statistics.json'));await service.refresh();assert.deepEqual(fs.readFileSync(path.join(service.store.dir,'statistics.json')),bytes);
  }finally{await service.close();}
});
