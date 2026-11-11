'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const adapter=require('../../src/m1/jsonl-adapter');
const {Service}=require('../../src/m1/service');
const {Store}=require('../../src/m1/store');
const {remove}=require('./temp');
const id='custom-11111111-1111-4111-8111-111111111111';
test('moving a source reserves prior roots, preserves missing history and removal can be undone',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-move-')), a=path.join(root,'a'), b=path.join(root,'b');
 fs.mkdirSync(a);fs.mkdirSync(b);fs.writeFileSync(path.join(a,'calls.jsonl'),JSON.stringify(event())+'\n');fs.writeFileSync(path.join(b,'calls.jsonl'),JSON.stringify(event({id:'second'}))+'\n');
 const service=new Service(path.join(root,'usage'),{},()=>{}, {home:path.join(root,'home')});
 try{
  service.store.setEnabled(false);let draft=service.custom.draft();service.custom.choose(draft.token,[a]);let preview=await service.custom.preview(draft.token,mapped);await service.custom.apply(preview.id);
  const sourceId=draft.id,firstVersion=service.store.state.customSources[sourceId].version;
  draft=service.custom.draft(sourceId);service.custom.choose(draft.token,[b]);preview=await service.custom.preview(draft.token,mapped);assert.equal(preview.summary.retained,1);await service.custom.apply(preview.id);
  assert.equal(service.store.records().length,2);
  draft=service.custom.draft(sourceId);preview=await service.custom.preview(draft.token,{...mapped,name:'第二次修改'});await service.custom.apply(preview.id);
  assert.equal(service.store.state.customSources[sourceId].version,firstVersion);
  assert.equal(service.store.state.customSources[sourceId].diagnostics.mixedRules,undefined);
  const another=service.custom.draft();assert.throws(()=>service.custom.choose(another.token,[a]),/OVERLAP/);
  await service.custom.change(sourceId,'remove');assert(service.store.state.customSources[sourceId].archived);
  await service.custom.change(sourceId,'rollback');assert.equal(service.store.state.customSources[sourceId].archived,false);assert.equal(service.store.records().length,2);
  const stats=JSON.stringify(service.store.state);assert(!stats.includes('call-1'));assert(!stats.includes('"session":"s"'));
 }finally{await service.close();await remove(root);}
});
const mapped={schemaVersion:'CustomSourceV1',name:'私有工具',template:'mapped',mode:'per-request',mapping:{id:'id',session:'session',time:'timestamp',model:'model',provider:'provider',input:'usage.input',output:'usage.output',cacheRead:'usage.read',cacheWrite:'usage.write',reasoning:'usage.reason',total:'usage.total'},filters:[],timeUnit:'iso',inputSemantics:'inclusive',outputIncludesReasoning:true};
const event=(extra={})=>({id:'call-1',session:'s',timestamp:'2026-10-17T00:00:00Z',model:'gpt-5',provider:'openai',usage:{input:100,output:20,read:40,write:0,reason:0,total:120},...extra});
test('sample budgets count physical lines and never return bodies or identity values',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-sample-'));
 try{
  const secret='DO_NOT_RETURN_ID_OR_BODY';
  const row=event({id:secret,content:{secret:{input:991}},text:secret});
  fs.writeFileSync(path.join(root,'a.jsonl'),Array(250).fill(JSON.stringify(row)).join('\n')+'\n');
  fs.writeFileSync(path.join(root,'b.jsonl'),JSON.stringify(row)+'\n');
  const result=await adapter.sample({id,roots:[root],definition:mapped});
  assert(result.rows<=200);assert(result.bytes<=adapter.MAX_LINE);
  assert(!JSON.stringify(result).includes(secret));assert(!JSON.stringify(result).includes('content.secret'));
  fs.writeFileSync(path.join(root,'a.jsonl'),' '.repeat(adapter.MAX_LINE+20)+'\n');
  const bounded=await adapter.sample({id,roots:[root],definition:mapped});assert(bounded.bytes<=adapter.MAX_LINE);
 }finally{await remove(root);}
});
test('large/incomplete files preserve prior observations and invalid cache totals cannot price',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-bounds-'));
 try{
  const source={id,roots:[root],definition:mapped,version:1},file=path.join(root,'a.jsonl');
  fs.writeFileSync(file,JSON.stringify(event())+'\n');
  const initial=await adapter.scan(source,'salt');
  fs.writeFileSync(file,'x'.repeat(adapter.MAX_LINE+1)+'\n');
  const tooLarge=await adapter.scan(source,'salt',initial.files);
  assert(tooLarge.diagnostics.errors.includes('CUSTOM_LINE_LIMIT'));assert.equal(tooLarge.records[0].totalTokens,120);
  fs.writeFileSync(file,'{}\nnot-json\n'+JSON.stringify(event({id:'new',usage:{input:10,output:2,read:40,total:12}}))+'\n');
  const invalid=await adapter.scan(source,'salt');
  assert.equal(invalid.diagnostics.invalid,2);assert.equal(invalid.records[0].quality,'invalid-cache');
 }finally{await remove(root);}
});
test('failed atomic ledger save keeps bytes, configuration and active records unchanged',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-atomic-')),inputs=path.join(root,'inputs');fs.mkdirSync(inputs);
 const service=new Service(path.join(root,'usage'),{},()=>{}, {home:path.join(root,'home')});
 const rename=fs.renameSync;
 try{
  service.store.setEnabled(false);fs.writeFileSync(path.join(inputs,'a.jsonl'),JSON.stringify(event())+'\n');
  const draft=service.custom.draft();service.custom.choose(draft.token,[inputs]);
  const preview=await service.custom.preview(draft.token,mapped);
  const file=path.join(service.store.dir,'statistics.json'),bytes=fs.readFileSync(file),state=JSON.stringify(service.store.state);
  fs.renameSync=(from,to)=>{if(to===file){const error=new Error('test save failure');error.code='EACCES';throw error;}return rename(from,to);};
  await assert.rejects(service.custom.apply(preview.id),/save failure/);
  assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(JSON.stringify(service.store.state),state);
  assert.equal(service.store.records().length,0);
 }finally{fs.renameSync=rename;await service.close();await remove(root);}
});
test('authoritative source catalog admits custom statistics without exporting private configuration',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-export-'));
 try{
  const store=new Store(root,{}),record=adapter.parse(event(),{id,definition:mapped},'salt').record;
  store.commitCustom({id,name:'私有 <Agent>',definition:{...mapped,name:'私有 <Agent>'},roots:[path.join(root,'outside')],version:1,enabled:true,archived:false,files:{},diagnostics:{}},[record]);
  const {selectSnapshot}=require('../../src/m1/local-snapshot'),{costExport}=require('../../src/m1/cost-export');
  const snapshot=selectSnapshot(store.snapshot(),store.catalog());
  assert.equal(snapshot.daily[0].agent,id);assert(snapshot.sourceCatalog[id]);
  assert(!JSON.stringify(snapshot).includes('roots'));assert(!JSON.stringify(snapshot).includes('mapping'));assert(!JSON.stringify(snapshot).includes('call-1'));assert(!JSON.stringify(snapshot).includes(root));
  assert.throws(()=>selectSnapshot(store.snapshot()),/ROW/);
  const csv=costExport(snapshot,{by:'agent'});assert(csv.csv.includes('私有 <Agent>'));
  const unknown={...record,provider:'unknown'};assert.equal(store.estimate(unknown).reason,'model-unpriced');
  assert.equal(store.estimate({...record,provider:'private-router'}).reason,'model-unpriced');
  assert.equal(adapter.validSaved({...store.state.customSources,[id]:{...store.state.customSources[id],definition:{...mapped,script:'bad'}}}),false);
 }finally{await remove(root);}
});
test('custom mapping keeps buckets, nulls, stable identity and explicit semantics',()=>{
 const source={id,definition:adapter.definition(mapped)};
 const record=adapter.parse(event(),source,'salt').record;
 assert.equal(record.totalTokens,120); assert.equal(record.inputUncached,60);
 assert.equal(record.cacheRead,40);
 const missing=adapter.parse(event({usage:{input:100,output:20}}),source,'salt').record; assert.equal(missing.cacheRead,null);
 for(const bad of [-1,1.2,true,Number.MAX_SAFE_INTEGER+1]) assert(adapter.parse(event({usage:{input:bad,output:20}}),source,'salt').invalid);
 assert.equal(adapter.parse(event({id:null}),source,'salt').invalid,true);
 const exclusive={...source,definition:{...mapped,inputSemantics:'exclusive',outputIncludesReasoning:false}};
 const result=adapter.parse(event({usage:{input:100,output:20,read:40,write:10,reason:5}}),exclusive,'salt').record;
 assert.equal(result.output,25); assert.equal(result.totalTokens,175);
 assert.equal(adapter.parse(event(),{...source,definition:{...mapped,name:'改名'}},'salt').record.id,record.id);
 assert.notEqual(adapter.parse(event(),{...source,id:'custom-22222222-2222-4222-8222-222222222222'},'salt').record.id,record.id);
 assert.throws(()=>adapter.definition({...mapped,mapping:{...mapped.mapping,id:'__proto__.x'}}),/FIELD/);
 assert.throws(()=>adapter.definition({...mapped,mode:'cumulative'}),/COUNTER/);
 assert.throws(()=>adapter.definition({...mapped,script:'anything'}),/CONFIG/);
});
test('all three formats share null and per-request rules',()=>{
 const standard={id,definition:{schemaVersion:'CustomSourceV1',name:'standard',template:'standard',mode:'per-request'}};
 const row={schemaVersion:'AgentUsageEventV1',mode:'per-request',id:'a',timestamp:'2026-10-17T00:00:00Z',inputTokens:100,outputTokens:20};
 assert.equal(adapter.parse(row,standard,'salt').record.totalTokens,120);
 assert(adapter.parse({...row,mode:'cumulative'},standard,'salt').unsupported);
 const claude={id,definition:{...standard.definition,template:'claude'}};
 const record=adapter.parse({type:'assistant',timestamp:row.timestamp,message:{id:'a',model:'claude-opus-4',usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:40,cache_creation_input_tokens:10}}},claude,'salt').record;
 assert.equal(record.totalTokens,170); assert.equal(record.provider,'unknown');
 assert.equal(adapter.parse({type:'user',message:{content:'SECRET'}},claude,'salt').filtered,true);
});
test('stream scan retains failed/missing files and folds duplicate copies',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-jsonl-'));
 try{
  const source={id,roots:[root],definition:mapped,version:1}, file=path.join(root,'a.jsonl');
  fs.writeFileSync(file,JSON.stringify(event())+'\n'); fs.copyFileSync(file,path.join(root,'b.ndjson'));
  let scan=await adapter.scan(source,'salt'); assert.equal(scan.records.length,1); assert.equal(scan.diagnostics.duplicates,1);
  const unchanged=await adapter.scan(source,'salt',scan.files); assert.deepEqual(unchanged.files,scan.files);
  fs.unlinkSync(file);
  const changed={...source,version:2,definition:{...mapped,mapping:{...mapped.mapping,input:'usage.newInput'}}};
  fs.writeFileSync(path.join(root,'b.ndjson'),JSON.stringify(event({usage:{...event().usage,newInput:200,total:220}}))+'\n');
  scan=await adapter.scan(changed,'salt',scan.files); assert.equal(scan.diagnostics.retained,1); assert.equal(scan.records[0].totalTokens,220);
  fs.writeFileSync(path.join(root,'b.ndjson'),'{"unfinished":');
  const tail=await adapter.scan(changed,'salt',scan.files); assert(tail.diagnostics.errors.includes('CUSTOM_INCOMPLETE_LINE')); assert.equal(tail.records[0].totalTokens,220);
  fs.writeFileSync(path.join(root,'auth.jsonl'),'SECRET\n');
  const sample=await adapter.sample(source); assert(!JSON.stringify(sample).includes('SECRET'));
 }finally{await remove(root);}
});
test('source transaction preview/apply/stale/rollback/disabled/history and pricing',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-service-')), home=path.join(root,'home'), inputs=path.join(root,'inputs'), dir=path.join(root,'usage');
 fs.mkdirSync(home); fs.mkdirSync(inputs);
 const service=new Service(dir,{},()=>{}, {home,appData:null,localAppData:null});
 try{
  service.store.setEnabled(false);
  const draft=service.custom.draft(); service.custom.choose(draft.token,[inputs]);
  fs.writeFileSync(path.join(inputs,'calls.jsonl'),JSON.stringify(event())+'\n');
  let preview=await service.custom.preview(draft.token,mapped); assert.equal(preview.summary.totalTokens,120);
  await service.custom.apply(preview.id); assert.equal(service.store.records().length,1);
  const sourceId=draft.id, firstId=service.store.records()[0].id;
  await service.refresh(); assert.equal(service.store.records()[0].id,firstId); assert.equal(service.store.records().length,1);
  const old=service.store.state.sequence; await service.refresh(); assert.equal(service.store.state.sequence,old);
  const edit=service.custom.draft(sourceId); preview=await service.custom.preview(edit.token,{...mapped,name:'重命名'}); await service.custom.apply(preview.id);
  assert.equal(service.store.records()[0].id,firstId);
  await service.custom.change(sourceId,'enable',false); assert.equal(service.store.records().length,1);
  const saved=JSON.stringify(service.store.state);
  const stale=service.custom.draft(sourceId); preview=await service.custom.preview(stale.token,mapped);
  fs.appendFileSync(path.join(inputs,'calls.jsonl'),JSON.stringify(event({id:'call-2'}))+'\n');
  await assert.rejects(service.custom.apply(preview.id),/STALE/); assert.equal(JSON.stringify(service.store.state),saved);
  const reparse=service.custom.draft(sourceId); preview=await service.custom.preview(reparse.token,{...mapped,mapping:{...mapped.mapping,input:'usage.output'},inputSemantics:'exclusive'});
  await service.custom.apply(preview.id); assert.equal(service.store.records().length,2);
  await service.custom.change(sourceId,'rollback'); assert.equal(service.store.records().length,1);
  assert.deepEqual(Object.keys(service.custom.export(sourceId)).sort(),Object.keys(mapped).sort()); assert(!JSON.stringify(service.custom.export(sourceId)).includes(inputs));
  const overlap=service.custom.draft(); assert.throws(()=>service.custom.choose(overlap.token,[inputs]),/OVERLAP/);
  await service.custom.change(sourceId,'remove'); assert.equal(service.store.records().length,1);
  const again=new Store(dir,{}); assert.equal(again.records().length,1); assert.equal(again.catalog()[sourceId].name,'重命名');
 }finally{await service.close();await remove(root);}
});
