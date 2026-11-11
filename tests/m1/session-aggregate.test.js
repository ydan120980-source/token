'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {add}=require('../../src/m1/aggregate'),{addSession}=require('../../src/m1/session-aggregate');
test('direct session DTOs equal the established pricing aggregate for unknown, partial, conflicting and bounded records in every order',()=>{
 const record={agent:'codex',entry:'cli',provider:'openai',model:'synthetic',totalTokens:100,inputUncached:70,output:20,cacheRead:10,cacheWrite:0,reasoning:5,quality:'measured'};
 const priced={lower:1,upper:2,reason:'bounded',parts:{inputUncached:0.7,output:0.2,cacheRead:0.1,cacheWrite:0},savings:0},unpriced={...priced,lower:null,upper:null};
 const cases=[[record,priced],[{...record,inputUncached:null,reasoning:null,quality:'partial'},unpriced],[{...record,usageConflict:true,quality:'partial'},unpriced],[{...record,totalTokens:0,inputUncached:0,output:0,cacheRead:0,reasoning:0},{...priced,lower:0,upper:0}]];
 const permutations=rows=>rows.length<2?[rows]:rows.flatMap((row,i)=>permutations(rows.filter((_,j)=>j!==i)).map(rest=>[row,...rest]));
 for(const rows of [[],...permutations(cases)]){const full=new Map(),small=new Map();for(const [r,e]of rows){add(full,'2026-11-03',{date:'2026-11-03'},r,e);addSession(small,'2026-11-03',r,e);}const actual=small.get('2026-11-03'),source=full.get('2026-11-03');if(!actual){assert.equal(source,undefined);continue;}const expected=Object.fromEntries(Object.keys(actual).map(key=>[key,source[key]]));if(!source.pricedRecords)expected.estimatedCostUsd=expected.estimatedCostUpperUsd=null;assert.deepEqual(actual,expected);}
});
