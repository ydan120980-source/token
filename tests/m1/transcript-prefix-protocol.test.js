'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const delta=require('../../src/m1/transcript-continuation');
const item=index=>({kind:index%2?'assistant':'user',time:null,text:'合成 '+index+'\n🙂\ud800',...(index%3?{}:{usage:0})});
const value=count=>({schemaVersion:'TranscriptV2',agent:'codex',stamp:'first',turns:Math.ceil(count/2),tools:0,failed:0,truncated:false,items:Array.from({length:count},(_,index)=>item(index))});
const open=source=>delta.merge(null,delta.make(source,'own-record',delta.request(null)));
const plain=result=>{const {continuation:_proof,...view}=result;return view;};
test('append-only transport reuses the displayed prefix, preserving all current metadata and Unicode',()=>{
 const first=value(147);first.items[140].text='长回复'.repeat(20000);const previous=open(first),next={...first,stamp:'second',turns:75,truncated:true,items:[...first.items,item(147),item(148)]};
 const wire=delta.make(next,'own-record',delta.request(previous));assert.equal(wire.offset,147);assert.equal(wire.transcript.items.length,2);
 const merged=delta.merge(previous,wire);assert.deepEqual(plain(merged),next);assert.equal(merged.items[140],previous.items[140]);assert.equal(previous.stamp,'first');
 assert.equal(merged.items[0].text,item(0).text,'lone surrogates and line endings are not re-encoded');
});
test('rewrites, shrinking records, inserted sub-agents and late tool results replace the affected prefix safely',()=>{
 const first=value(147),previous=open(first);
 for(const index of [0,13,64,70,100,146]){
  const next=structuredClone(first);next.stamp='rewrite';next.items[index].text='changed';
  const wire=delta.make(next,'own-record',delta.request(previous)),merged=delta.merge(previous,wire);
  assert.equal(wire.offset,Math.floor(index/delta.STEP)*delta.STEP);assert.deepEqual(plain(merged),next);
 }
 for(const count of [0,1,63,64,65,90,128,146]){const next={...first,stamp:'shrink',items:first.items.slice(0,count)},wire=delta.make(next,'own-record',delta.request(previous));assert.deepEqual(plain(delta.merge(previous,wire)),next);}
 const next=structuredClone(first);next.items.splice(100,0,{kind:'assistant',time:null,text:'sub-agent',side:'agent-child'});next.items[130]={kind:'tool',time:null,tool:{name:'Read',summary:'synthetic',output:'late result',error:false}};
 const wire=delta.make(next,'own-record',delta.request(previous));assert.equal(wire.offset,64);assert.deepEqual(plain(delta.merge(previous,wire)),next);
});
test('checkpoint boundaries, empty results and record identity remain request-local',()=>{
 for(const count of [0,1,63,64,65,127,128,129]){
  const first=value(count),previous=open(first),next={...first,stamp:'append',items:[...first.items,item(count)]},wire=delta.make(next,'own-record',delta.request(previous));
  assert.equal(wire.offset,count);assert.deepEqual(plain(delta.merge(previous,wire)),next);assert.equal(wire.continuation.digests.length,Math.ceil((count+1)/delta.STEP));
  assert.equal(delta.make(first,'another-record',delta.request(previous)).offset,0);
  assert.equal(delta.make({...first,agent:'claude'},'own-record',delta.request(previous)).offset,0);
 }
 const previous=open(value(65)),wire=delta.make({...value(65),stamp:'new-stamp'},'own-record',delta.request(previous));assert.equal(wire.offset,65);assert.equal(wire.transcript.items.length,0);assert.equal(delta.merge(previous,wire).stamp,'new-stamp');
});
test('malformed proofs and impossible response offsets fail without a partial publication; legacy full replies work',()=>{
 for(const proof of [null,[],{}, {count:-1,digests:[]},{count:1.5,digests:[]},{count:delta.MAX_ITEMS+1,digests:[]},{count:65,digests:['0'.repeat(64)]},{count:1,digests:['x'.repeat(64)]},{count:0,digests:[],body:'not allowed'}])assert.throws(()=>delta.validate(proof),/TRANSCRIPT_PART_INVALID/);
 const source=value(65),previous=open(source),wire=delta.make(source,'own-record',delta.request(previous));
 for(const mutate of [copy=>copy.offset++,copy=>copy.offset=-1,copy=>copy.continuation.count=2,copy=>copy.schemaVersion='wrong']){const copy=structuredClone(wire);mutate(copy);assert.throws(()=>delta.merge(previous,copy),/TRANSCRIPT_PART_INVALID/);}
 assert.throws(()=>delta.merge(null,wire),/TRANSCRIPT_PART_INVALID/);assert.throws(()=>delta.merge({...previous,agent:'claude'},wire),/TRANSCRIPT_PART_INVALID/);
 assert.equal(delta.merge(previous,source),source);assert.deepEqual(delta.request(source),{count:0,digests:[]});assert.deepEqual(delta.request({...source,continuation:{count:65,digests:[]}}),{count:0,digests:[]});
});
test('the browser merges the same protocol without crypto, reads or a stored index',()=>{
 const window={},context=vm.createContext({window});vm.runInContext(fs.readFileSync(path.join(__dirname,'../../src/m1/transcript-continuation.js'),'utf8'),context);
 const previous=open(value(65)),next=value(70),wire=delta.make(next,'own-record',delta.request(previous));assert.equal(JSON.stringify(window.transcriptContinuation.merge(previous,wire)),JSON.stringify(delta.merge(previous,wire)));
});

test('long-string verification distinguishes lone surrogates from replacement characters across scratch boundaries',()=>{
 const first=value(70);first.items[65].text='x'.repeat(32767)+'\ud800'+'中'.repeat(5000);const previous=open(first);
 const next=structuredClone(first);next.items[65].text=next.items[65].text.replace('\ud800','\ufffd');
 const wire=delta.make(next,'own-record',delta.request(previous));assert.equal(wire.offset,64);assert.deepEqual(plain(delta.merge(previous,wire)),next);
});

test('source and statistics owner reread changes, reject bad proofs before reading and never persist a body or proof',async()=>{
 const os=require('node:os'),direct=require('../../src/m1/transcript'),{Store,atomic}=require('../../src/m1/store'),{StatisticsService}=require('../../src/m1/statistics-service');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'prefix-protocol-')),home=path.join(root,'home'),dir=path.join(root,'usage'),record=path.join(home,'own-record.jsonl'),key='a'.repeat(64);let service;
 const message=(role,text)=>({type:'response_item',payload:{type:'message',role,content:[{text}]}});
 const rows=[{type:'session_meta',payload:{id:'own-record'}},...Array.from({length:70},(_,index)=>message(index%2?'assistant':'user','合成 '+index))];
 const write=()=>fs.writeFileSync(record,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
 try{
  fs.mkdirSync(home,{recursive:true});write();const store=new Store(dir,{codex:[home]});store.setEnabled(false);store.state.sessions[key]={agent:'codex',id:'own-record',cwd:null};atomic(path.join(dir,'statistics.json'),store.state);const saved=fs.readFileSync(path.join(dir,'statistics.json'));
  service=new StatisticsService(dir,{codex:[home]},()=>{},{home,appData:null,localAppData:null},{offline:true});
  const legacy=await service.transcript(key);assert.equal(legacy.continuation,undefined);assert.equal(legacy.schemaVersion,'TranscriptV2');
  const first=delta.merge(null,await service.transcript(key,delta.request(null)));assert.deepEqual(plain(first),legacy);
  rows.push(message('user','follow question'),message('assistant','follow answer'));write();
  const wire=await service.transcript(key,delta.request(first));assert.equal(wire.offset,70);assert.equal(wire.transcript.items.length,2);const followed=delta.merge(first,wire);assert.deepEqual(plain(followed),await direct.transcript('codex','own-record',[home]));
  rows[66]=message('assistant','rewritten original');write();const rewritten=await service.transcript(key,delta.request(followed));assert.equal(rewritten.offset,64);assert.deepEqual(plain(delta.merge(followed,rewritten)),await store.transcript(key));
  // Matching previews do not authorize reuse of a full-text page. A hidden
  // tail may change while the preview and its length remain exactly equal.
  const text='x'.repeat(direct.LIMITS.spoken+20);rows[66]=message('assistant',text+'OLD');write();
  const beforeTail=delta.merge(null,await service.transcript(key,delta.request(null)));
  assert.equal((await direct.part('codex','own-record',[home],{stamp:beforeTail.stamp,index:65,field:'text',offset:text.length})).text,'OLD');
  rows[66]=message('assistant',text+'NEW');write();const later=new Date(Date.now()+2000);fs.utimesSync(record,later,later);
  const tailWire=await service.transcript(key,delta.request(beforeTail));assert.equal(tailWire.offset,beforeTail.items.length);const afterTail=delta.merge(beforeTail,tailWire);assert.notEqual(afterTail.stamp,beforeTail.stamp);
  await assert.rejects(direct.part('codex','own-record',[home],{stamp:beforeTail.stamp,index:65,field:'text',offset:text.length}),/TRANSCRIPT_CHANGED/);
  assert.equal((await direct.part('codex','own-record',[home],{stamp:afterTail.stamp,index:65,field:'text',offset:text.length})).text,'NEW');
  fs.unlinkSync(record);await assert.rejects(direct.transcript('codex','own-record',[home],{count:1,digests:[]}),/TRANSCRIPT_PART_INVALID/);await assert.rejects(service.transcript(key,{count:1,digests:[]}),/TRANSCRIPT_PART_INVALID/);
  assert.deepEqual(fs.readFileSync(path.join(dir,'statistics.json')),saved);
 }finally{await service?.close();await require('../../src/m1/transcript-tasks').close();fs.rmSync(root,{recursive:true,force:true});}
});
