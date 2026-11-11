'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {shareSavedStrings}=require('../../src/m1/saved-string-sharing');
test('saved string sharing preserves bytes, unknowns and independently mutable objects',()=>{
 const key='a'.repeat(64),state=JSON.parse(JSON.stringify({records:{r1:{id:'r1',sessionKey:key,agent:'codex',entry:'cli',model:'gpt-4.1',provider:'openai',timestamp:'2026-11-04T00:00:00Z',quality:'partial',inputUncached:null,output:0,semantics:{input:'inclusive',sourceOutput:'includes-reasoning',reasoning:'subset-of-normalized-output'},extra:'preserve'},r2:{id:'r2',sessionKey:key,agent:'codex',model:'gpt-4.1',semantics:{input:'inclusive'}},r3:{id:'mismatch',sessionKey:'missing',quality:null}},sessions:{[key]:{agent:'codex',cwd:'E:/synthetic/project',title:null}},duplicateIds:{r3:true}}));
 const bytes=JSON.stringify(state),records=Object.values(state.records),semantics=records[0].semantics;
 shareSavedStrings(state);assert.equal(JSON.stringify(state),bytes);assert.equal(state.records.r1,records[0]);assert.equal(state.records.r1.semantics,semantics);
 state.records.r1.model='changed';state.records.r1.semantics.input='changed';assert.equal(state.records.r2.model,'gpt-4.1');assert.equal(state.records.r2.semantics.input,'inclusive');assert.equal(state.records.r3.id,'mismatch');assert.equal(state.records.r3.quality,null);
});
test('diverse saved strings beyond the temporary dictionary remain complete and exact',()=>{
 const state={records:Object.fromEntries(Array.from({length:5000},(_,i)=>[String(i),{id:String(i),model:'model-'+i,timestamp:'time-'+i,quality:i%2?null:'measured',output:0}])),extra:{unicode:['中文😀','\ud800','\udfff','line\nnext'],nested:{keep:null}}};
 const bytes=JSON.stringify(state);shareSavedStrings(state);assert.equal(JSON.stringify(state),bytes);assert.equal(Object.keys(state.records).length,5000);
});
