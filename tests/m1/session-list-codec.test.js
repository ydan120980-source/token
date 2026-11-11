'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {pack,packIterable,unpack,unpackAsync}=require('../../src/m1/session-list-codec'),{selectSessions}=require('../../src/m1/session-list');
function list(n=2){return {schemaVersion:'SessionListV1',sequence:8,timezone:'Asia/Shanghai',today:'2026-11-03',sessions:Array.from({length:n},(_,i)=>({key:i.toString(16).padStart(64,'0'),agent:'codex',entries:['cli'],models:['gpt-4.1'],start:'2026-11-03T00:00:00Z',end:'2026-11-03T00:01:00Z',id:'own-'+i,cwd:'C:/synthetic',title:null,project:'synthetic',resumable:true,secret:'DO_NOT_TRANSPORT',days:[{date:'2026-11-03',totalTokens:10,records:1,partialRecords:1,pricedTokens:0,boundedTokens:0,inputUncached:null,output:0,cacheRead:null,cacheWrite:0,reasoning:null,estimatedCostUsd:null,estimatedCostUpperUsd:0,knownUsage:i%2?{}:{inputUncached:0}}]})),unattributed:{codex:{'2026-11-03':2}}};}
test('session transport retains the exact whitelist, unknown versus zero, sparse maps and local metadata without commands',()=>{
 const source=list(),wire=pack(source),decoded=unpack(wire);assert.deepEqual(decoded,selectSessions(source));assert.equal(new TextDecoder().decode(wire.sessionBytes).includes('DO_NOT_TRANSPORT'),false);assert.equal(decoded.sessions[0].days[0].inputUncached,null);assert.equal(decoded.sessions[0].days[0].output,0);assert.deepEqual(decoded.sessions[1].days[0].knownUsage,{});assert.deepEqual(decoded.sessions[0].days[0].knownUsage,{inputUncached:0});assert.equal(decoded.sessions[0].models,decoded.sessions[1].models);assert(Object.isFrozen(decoded.sessions[0].models));
});
test('large repeated saved facts compact on wire and remain lossless',()=>{
 const source=list(2000),wire=pack(source);assert(wire.sessionBytes.byteLength<Buffer.byteLength(JSON.stringify(selectSessions(source)))*.6);assert.deepEqual(unpack(wire),selectSessions(source));
});

test('cooperative decoding lets other tasks run, publishes a complete lossless list, and leaves transferred bytes reusable',async()=>{
 const source=list(20000),wire=pack(source),before=Buffer.from(wire.sessionBytes).toString('base64');let ticks=0,complete=false;
 const timer=setInterval(()=>{if(!complete)ticks++;},1);
 let decoded;try{decoded=await unpackAsync(wire);complete=true;}finally{clearInterval(timer);}
 assert(ticks>0,'a large decode must not monopolize the task queue');
 assert.deepEqual(decoded,selectSessions(source));assert.equal(decoded.sessions.length,20000);
 assert.equal(Buffer.from(wire.sessionBytes).toString('base64'),before,'consumption is confined to the private parsed frame');
 assert.deepEqual(unpack(wire),decoded);assert.equal(decoded.sessions[0].models,decoded.sessions[1].models);assert(Object.isFrozen(decoded.sessions[0].models));
});

test('cooperative decoding rejects late malformed facts without returning a partial result',async()=>{
 const frame=JSON.parse(new TextDecoder().decode(pack(list(1000)).sessionBytes));frame.days.at(-1)[1]=-1;
 const wire={schemaVersion:'SessionListBytesV1',sessionBytes:new TextEncoder().encode(JSON.stringify(frame)).buffer};
 await assert.rejects(unpackAsync(wire),/INVALID_SESSION_LIST/);assert.throws(()=>unpack(wire),/INVALID_SESSION_LIST/);
 assert.deepEqual(await unpackAsync(pack(list())),selectSessions(list()),'a failed request does not poison a later decoder');
});
test('streamed saved sessions retain identical wire bytes and reject invalid or excessive rows',()=>{
 const source=list(2000),stream=()=>({...source,sessions:(function*(){yield* source.sessions;})()});
 assert.deepEqual(new Uint8Array(packIterable(stream()).sessionBytes),new Uint8Array(pack(source).sessionBytes));
 assert.deepEqual(unpack(packIterable(stream())),selectSessions(source));
 assert.throws(()=>pack(stream()),/INVALID_SESSION_LIST/,'public array contract is unchanged');
 for(const sessions of [null,{},(function*(){yield {...source.sessions[0],key:'invalid'};})(),(function*(){for(let i=0;i<50001;i++)yield source.sessions[0];})()])assert.throws(()=>packIterable({...source,sessions}),/INVALID_SESSION_LIST/);
});
test('the browser codec uses the same selector and supports cross-realm buffers and approved custom catalogues',()=>{
 const window={agentCatalog:require('../../src/m1/agent-catalog')},context=vm.createContext({window,TextEncoder,TextDecoder});for(const name of ['session-list','session-list-codec'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../../src/m1',name+'.js'),'utf8'),context);const source=list();source.sessions[0].agent='custom-owned';const wire=pack(source,{...window.agentCatalog.agents,'custom-owned':{}});assert.equal(JSON.stringify(window.sessionListCodec.unpack(wire)),JSON.stringify(unpack(wire)));
});
test('malformed indices, dimensions and invalid usage never become a believable decoded list',()=>{
 const original=JSON.parse(new TextDecoder().decode(pack(list()).sessionBytes));
 for(const mutate of [f=>f.rows[0][0]=999999,f=>f.rows[0][12]=4001,f=>f.days[0][1]=-1,f=>f.rows[0][11]=1,f=>f.days.push(f.days[0]),f=>f.rows[0].pop()]){const frame=structuredClone(original);mutate(frame);assert.throws(()=>unpack({schemaVersion:'SessionListBytesV1',sessionBytes:new TextEncoder().encode(JSON.stringify(frame)).buffer}),/INVALID_SESSION_LIST/);}
});

test('fused packed-day selection matches ordinary validation for every numeric field and sparse usage',async()=>{
 const fields=[...require('../../src/m1/session-list').COUNTS,...require('../../src/m1/session-list').NULLABLE];
 const original=JSON.parse(new TextDecoder().decode(pack(list(1)).sessionBytes));
 const check=async(source,frame)=>{
  const wire={schemaVersion:'SessionListBytesV1',sessionBytes:new TextEncoder().encode(JSON.stringify(frame)).buffer};
  let expected;try{expected=selectSessions(source);}catch{assert.throws(()=>unpack(wire),/INVALID_SESSION_LIST/);await assert.rejects(unpackAsync(wire),/INVALID_SESSION_LIST/);return;}
  assert.deepEqual(unpack(wire),expected);assert.deepEqual(await unpackAsync(wire),expected);
 };
 for(let index=0;index<fields.length;index++)for(const value of [-1,0,null,1.25,Number.MAX_SAFE_INTEGER,'0',true]){
  const source=list(1),frame=structuredClone(original);source.sessions[0].days[0][fields[index]]=value;frame.days[0][index+1]=value;await check(source,frame);
 }
 for(const value of [null,{},[],{inputUncached:0,output:4,reasoning:null,cacheRead:-1,secret:100},{output:'4',cacheWrite:1.5},'untrusted']){
  const source=list(1),frame=structuredClone(original);source.sessions[0].days[0].knownUsage=value;frame.usage[0]=value;await check(source,frame);
 }
});
