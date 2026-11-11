'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {snapshotDelta}=require('../../src/m1/snapshot-delta'),{selectSnapshot}=require('../../src/m1/local-snapshot'),{pack,unpack}=require('../../src/m1/snapshot-codec');
function fixture(){const row={date:'2026-10-30',agent:'codex',entry:'cli',provider:'synthetic',model:'a',totalTokens:100,records:1,pricedTokens:0,inputUncached:null,output:0,cacheRead:null,cacheWrite:0,reasoning:null,pricingReasons:{'model-unpriced':1},privateField:'PRIVATE_SENTINEL'},previous={schemaVersion:'UsageSnapshotV1',sequence:1,today:'2026-10-30',daily:[row,{...row,model:'b'}],hourly:[{...row,hour:0}],sources:[]};return{previous,next:{...previous,sequence:2,daily:[previous.daily[1],{...row,totalTokens:200,privateField:'PRIVATE_SENTINEL'}],hourly:[...previous.hourly,{...row,hour:2}]} };}
test('revision deltas preserve complete whitelist values, row order, deletions, nulls and unchanged object identity',()=>{
 const {previous,next}=fixture(),base=unpack(pack(selectSnapshot(previous))),delta=snapshotDelta(previous,next,1);
 assert(!JSON.stringify(delta).includes('PRIVATE_SENTINEL'));const restored=unpack(JSON.parse(JSON.stringify(delta)),{previous:base,revision:1,consume:true});assert.deepEqual(restored,selectSnapshot(next));assert.equal(restored.daily[0],base.daily[1]);assert.equal(restored.hourly[0],base.hourly[0]);assert.equal(restored.daily[1].inputUncached,null);assert.equal(restored.daily[1].output,0);
 assert.throws(()=>unpack(delta,{previous:base,revision:0}),/BASE_MISMATCH/);assert.throws(()=>unpack(delta),/BASE_MISMATCH/);
 for(const index of [NaN,2,-3,0.5])assert.throws(()=>unpack({...delta,dailyOrder:[index]},{previous:base,revision:1}),/INVALID_USAGE_TRANSPORT/);
 assert.deepEqual(unpack(snapshotDelta(previous,{...next,daily:[],hourly:[]},1),{previous:base,revision:1}),selectSnapshot({...next,daily:[],hourly:[]}));
 assert.equal(snapshotDelta(previous,{...next,daily:Array.from({length:4100},()=>({...next.daily[1]}))},1),null,'bulk changes use full transport');
 assert.throws(()=>snapshotDelta(previous,{...next,daily:[{...next.daily[1],totalTokens:-1}]},1),/INVALID_STATISTIC/);
});
test('page transport recovers a mismatched delta base and never regresses its cache on a late older full response',async()=>{
 const {previous:a,next:b}=fixture(),c={...b,sequence:3,daily:[...b.daily,{...b.daily[1],model:'c'}]},d={...c,sequence:4,daily:[...c.daily,{...c.daily[1],model:'d'}]};
 const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).buffer,envelope=(snapshot,revision)=>({snapshotBytes:bytes(pack(selectSnapshot(snapshot))),snapshotRevision:revision});let response,calls=0;
 const window={snapshotCodec:{unpack},usageTransport:{get:async revision=>{calls++;return revision===null?envelope(c,3):response;},refresh:async()=>response}};
 const context=vm.createContext({window,performance,TextDecoder});vm.runInContext(fs.readFileSync(require.resolve('../../design/desktop-reference/usage-data.js'),'utf8'),context);
 response=envelope(a,1);const first=await window.usageBridge.get(0);assert.equal(first.snapshot.sequence,1);
 response={snapshotBytes:bytes(snapshotDelta(a,b,1)),snapshotRevision:2};const second=await window.usageBridge.get(1);assert.equal(second.snapshot.daily[0],first.snapshot.daily[1]);
 const duplicate=await window.usageBridge.refresh(1);assert.equal(duplicate.snapshot,second.snapshot,'duplicate completion/update responses reuse the already decoded revision');assert.equal(calls,2);
 response={snapshotBytes:bytes(snapshotDelta(a,c,1)),snapshotRevision:3};const recovered=await window.usageBridge.get(1);assert.equal(recovered.snapshotRevision,3);assert.equal(calls,4,'one full read heals the base mismatch');
 response=envelope(a,1);await window.usageBridge.get(0);
 response={snapshotBytes:bytes(snapshotDelta(c,d,3)),snapshotRevision:4};const fourth=await window.usageBridge.get(3);assert.equal(fourth.snapshotRevision,4);assert.equal(fourth.snapshot.daily.length,4);assert.equal(calls,6,'late old data cannot make the next current delta require a full read');
});
