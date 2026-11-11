'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {suggest,signature}=require('../../src/m1/model-aliases');
const rate={inputUncached:.000003,output:.000015,cacheRead:null,cacheWrite:0,provenance:'models-dev',source:'https://models.dev/api.json'};
test('alias suggestions preserve dates, versions and qualifiers; ambiguity stays visible and no automatic mapping is made',()=>{
 const observed=[{provider:'route',model:'claude-3-5-sonnet-20241022'}];
 const catalog={'anthropic/claude-3.5-sonnet-20241022':rate,'other/claude-3-5-sonnet-20241022':{...rate,output:0},'anthropic/claude-3-5-sonnet-20240620':rate,'anthropic/claude-sonnet-4-5':rate,'anthropic/claude-3-5-sonnet':rate};
 const before=JSON.stringify({observed,catalog}),result=suggest(observed,catalog)['route/claude-3-5-sonnet-20241022'];
 assert.equal(result.total,2);assert.equal(result.ambiguous,true);assert.deepEqual(result.candidates.map(c=>c.target),['anthropic/claude-3.5-sonnet-20241022','other/claude-3-5-sonnet-20241022']);
 assert.equal(result.candidates[0].rates.cacheRead,null);assert.equal(result.candidates[0].rates.cacheWrite,0);assert.equal(JSON.stringify({observed,catalog}),before);
 assert.notEqual(signature('gpt-4.1'),signature('gpt-4.1-mini'));assert.notEqual(signature('claude-3-5-sonnet-latest'),signature('claude-3-5-sonnet-20241022'));
 assert.equal(signature('anthropic/Claude_3.5_Sonnet_20241022'),signature(observed[0].model));
 assert.equal(signature('unknown/path/model'),null);assert.equal(suggest(observed,{})['route/claude-3-5-sonnet-20241022'].total,0);
});
test('unverified candidates are excluded; saved manual zero prices are explicit and maximum candidate count is bounded',()=>{
 const observed=[{provider:'route',model:'gpt-4-1'}],catalog=Object.fromEntries(Array.from({length:12},(_,i)=>['vendor'+i+'/gpt-4.1',rate]));catalog['bad/gpt-4.1']={...rate,provenance:'reference-unverified'};
 const value=suggest(observed,catalog,{'manual/gpt-4.1':{inputUncached:0,output:0,cacheRead:null,cacheWrite:null}})['route/gpt-4-1'];assert.equal(value.total,13);assert.equal(value.candidates.length,8);assert.equal(value.candidates[0].origin,'manual');assert.equal(value.candidates[0].rates.output,0);
});
