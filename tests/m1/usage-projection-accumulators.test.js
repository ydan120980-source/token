'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectUsage,day}=require('../../src/m1/usage-projection'),{add}=require('../../src/m1/aggregate');
test('shared single-hour accumulators match independent daily/hourly aggregation across orders, timezone boundaries and unknowns',()=>{
 const records=Array.from({length:24},(_,i)=>({agent:'codex',entry:'cli',provider:'synthetic',model:i%3?'mixed-hours':'one-hour',timestamp:i%3?'2026-10-25T'+String(i%2?1:4).padStart(2,'0')+':30:00Z':'2026-10-25T02:30:00Z',totalTokens:100+i,inputUncached:i%5?80:null,output:20,cacheRead:i%4?0:null,cacheWrite:0,reasoning:0,quality:i%5?'measured':'partial',usageConflict:i%7===0}));
 const estimate=r=>({reason:r.totalTokens%2?'exact':'model-unpriced',lower:r.totalTokens%2?0.2:null,upper:0.3,parts:{inputUncached:0.1,output:0.1,cacheRead:0,cacheWrite:0},savings:0,cause:'missing-inputUncached'});
 for(const timezone of ['UTC','Europe/Berlin','Asia/Kolkata','Australia/Lord_Howe'])for(const list of [records,[...records].reverse(),[...records].sort((a,b)=>a.totalTokens%5-b.totalTokens%5)]){
  const groups=new Map(),hours=new Map(),format=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'});
  for(const r of list){const date=day(r.timestamp,timezone),hour=Number(format.format(new Date(r.timestamp))),identity=[r.agent,r.entry,r.provider,r.model];add(groups,JSON.stringify([date,...identity]),{date},r,estimate(r));add(hours,JSON.stringify([date,hour,...identity]),{date,hour},r,estimate(r));}
  const finish=rows=>rows.map(row=>{if(!row.pricedRecords){row.estimatedCostUsd=null;row.estimatedCostUpperUsd=null;row.costParts=null;row.cacheSavingsUsd=null;}return row;});
  const actual=projectUsage({records:list,estimate,sequence:1,sourceCatalog:{codex:{label:'Codex'}},timezone,now:Date.parse('2026-10-30T12:00:00Z')});
  const strip=rows=>rows.map(({semantics,...row})=>row);
  assert.deepEqual(strip(actual.daily),finish([...groups.values()].sort((a,b)=>a.date.localeCompare(b.date))));assert.deepEqual(strip(actual.hourly),finish([...hours.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.hour-b.hour)));
  assert(actual.daily.every(row=>!Object.hasOwn(row,'hour')));assert.equal(list[0].semantics,undefined);
 }
});
