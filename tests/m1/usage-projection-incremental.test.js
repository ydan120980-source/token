'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectUsage}=require('../../src/m1/usage-projection'),{projectIncremental}=require('../../src/m1/usage-projection-incremental');
const estimate=r=>({reason:r.totalTokens%2?'exact':'model-unpriced',lower:r.totalTokens%2?0.2:null,upper:0.3,parts:{inputUncached:0.1,output:0.1,cacheRead:0,cacheWrite:0},savings:0,cause:'missing-inputUncached'});
const options=(state,patch={})=>({records:Object.values(state.records).filter(r=>!state.duplicateIds[r.id]),estimate,sequence:state.sequence,deviceId:'synthetic',sourceCatalog:{codex:{label:'Codex'}},priceCatalog:{version:'synthetic'},timezone:'Europe/Berlin',now:Date.parse('2026-10-30T12:00:00Z'),...patch});
const record=i=>({id:'synthetic-'+i,agent:'codex',entry:'cli',provider:'synthetic',model:'model-'+i%5,timestamp:'2026-10-'+String(24+i%3).padStart(2,'0')+'T'+String(i%6).padStart(2,'0')+':30:00Z',totalTokens:100+i,inputUncached:i%5?80:null,output:20,cacheRead:i%4?0:null,cacheWrite:0,reasoning:0,quality:i%5?'measured':'partial',usageConflict:i%7===0});
test('incremental projections match full recomputation for additions, complete replacements, removals, duplicate changes and source metadata',()=>{
 const state={sequence:1,records:Object.fromEntries(Array.from({length:200},(_,i)=>{const r=record(i);return[r.id,r];})),duplicateIds:{}},before=projectUsage(options(state)),copy=JSON.stringify(before);
 for(const row of [...before.daily,...before.hourly])Object.freeze(row);
 const revisions=[
  {...state,sequence:2,records:{...state.records,'synthetic-201':record(201)}},
  {...state,sequence:2,records:{...state.records,'synthetic-2':{...record(2),model:'changed-model',inputUncached:null,totalTokens:600,quality:'partial'}}},
  {...state,sequence:2,records:Object.fromEntries(Object.entries(state.records).filter(([,r])=>r.model!=='model-2'))},
  {...state,sequence:2,duplicateIds:{'synthetic-2':'synthetic-1'}},
  {...state,sequence:2},
 ];
 for(const next of revisions){next.duplicateIds||={};const input=options(next,{statuses:{codex:{agent:'codex',status:'partial',errors:['SOURCE_UNREADABLE']}}}),actual=projectIncremental(input,{state,snapshot:before,currentRecords:next.records,currentDuplicates:next.duplicateIds});assert(actual);assert.deepEqual(actual,projectUsage(input));assert(actual.daily.some(row=>before.daily.includes(row)),'unaffected immutable rows are reused');assert.equal(JSON.stringify(before),copy);}
 const hidden={...state,duplicateIds:{'synthetic-2':'synthetic-1'}},previous=projectUsage(options(hidden));assert.deepEqual(projectIncremental(options(state),{state:hidden,snapshot:previous,currentRecords:state.records,currentDuplicates:{}}),before);
});
test('incremental projection falls back for pricing, local-day, timezone and bulk changes',()=>{
 const r=record(1),state={sequence:1,records:{[r.id]:r},duplicateIds:{}},base=options(state),prior={state,snapshot:projectUsage(base),currentRecords:state.records,currentDuplicates:{}};
 for(const patch of [{priceCatalog:{version:'reprice'}},{timezone:'Asia/Kolkata'},{now:base.now+86400000}])assert.equal(projectIncremental({...base,...patch},prior),null);
 assert.equal(projectIncremental(base,null),null);
 const bulk={...state,records:Object.fromEntries(Array.from({length:4100},(_,i)=>{const value=record(i);return[value.id,value];}))};assert.equal(projectIncremental(options(bulk),{...prior,currentRecords:bulk.records}),null);
});
