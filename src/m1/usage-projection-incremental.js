'use strict';
// Recompute affected groups from complete saved facts; never subtract nullable
// aggregates. All unchanged rows are immutable across projection revisions.
const {add}=require('./aggregate');
const {day,projectionCalendar}=require('./usage-projection');
const registry=require('./source-registry');
const mapFields=['pricingReasons','unpricedTokens','incompleteTokens','knownUsage','knownRecords','costParts'];
function projectIncremental(options,prior){
 const previous=prior?.snapshot,state=prior?.state,{records,timezone,now,estimate,sequence,updatedAt,sourceCatalog,priceCatalog,statuses={},recovered=[],calendar=projectionCalendar(timezone)}=options;
 if(!previous||!state||previous.timezone!==timezone||previous.today!==day(now,timezone)||JSON.stringify(previous.priceCatalog)!==JSON.stringify(priceCatalog))return null;
 const identities=new Map();let identityCount=0;
 const identity=row=>{let agent=identities.get(row.agent);if(!agent){agent=new Map();identities.set(row.agent,agent);}let entry=agent.get(row.entry);if(!entry){entry=new Map();agent.set(row.entry,entry);}let provider=entry.get(row.provider);if(!provider){provider=new Map();entry.set(row.provider,provider);}if(!provider.has(row.model))provider.set(row.model,identityCount++);return provider.get(row.model);};
 const validIdentity=row=>typeof row.agent==='string'&&typeof row.entry==='string'&&typeof row.provider==='string'&&typeof row.model==='string';
 const key=(row,hourly)=>hourly?row.date+'/'+row.hour+'/'+identity(row):row.date+'/'+identity(row);
 // Cache only calendar conversion, never the identity of the first record at
 // that timestamp (different models/sources commonly share a timestamp).
 const keys=record=>{const value=calendar(record.timestamp),id=identity(record);return[value.date+'/'+id,value.date+'/'+value.hour+'/'+id];};
 const days=new Set(),hours=new Set();let changed=0;
 for(const record of records){if(typeof record.id!=='string'||!validIdentity(record))return null;if(state.records[record.id]!==record||state.duplicateIds?.[record.id]){const [d,h]=keys(record);days.add(d);hours.add(h);if(++changed>4096)return null;}}
 for(const record of Object.values(state.records))if(!state.duplicateIds?.[record.id]&&!recordsReference(record)){if(!validIdentity(record))return null;const [d,h]=keys(record);days.add(d);hours.add(h);if(++changed>8192)return null;}
 function recordsReference(record){return prior.currentRecords[record.id]===record&&!prior.currentDuplicates?.[record.id];}
 const oldDays=new Map(previous.daily.map(row=>[key(row,false),row])),oldHours=new Map(previous.hourly.map(row=>[key(row,true),row])),daily=new Map(),hourly=new Map();
 for(const record of records){const at=calendar(record.timestamp),id=identity(record),d=at.date+'/'+id,h=at.date+'/'+at.hour+'/'+id,dChanged=days.has(d),hChanged=hours.has(h);let valuation;
  if(dChanged||hChanged)valuation=estimate(record);
  if(dChanged)add(daily,d,{date:at.date},record,valuation);else if(!daily.has(d)){if(!oldDays.has(d))return null;daily.set(d,oldDays.get(d));}
  if(hChanged)add(hourly,h,{date:at.date,hour:at.hour},record,valuation);else if(!hourly.has(h)){if(!oldHours.has(h))return null;hourly.set(h,oldHours.get(h));}
 }
 const pools=Object.fromEntries(mapFields.map(field=>[field,new Map()])),semantics=Object.freeze({inputUncached:'excludes-cache',reasoning:'subset-of-output',totalTokens:'non-overlapping-source-total'});
 const finish=(groups,affected)=>{for(const [group,row] of groups)if(affected.has(group)){
  if(!row.pricedRecords){row.estimatedCostUsd=null;row.estimatedCostUpperUsd=null;row.costParts=null;row.cacheSavingsUsd=null;}row.semantics=semantics;
  for(const field of mapFields){const value=row[field];if(value===null)continue;const signature=JSON.stringify(value),pool=pools[field];if(pool.has(signature))row[field]=pool.get(signature);else if(pool.size<128)pool.set(signature,Object.freeze(value));}
 }};finish(daily,days);finish(hourly,hours);
 const dailyRows=[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)),hourRows=[...hourly.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.hour-b.hour);
 return {...previous,sequence,collectedAt:updatedAt||null,generatedAt:new Date(now).toISOString(),daily:dailyRows,hourly:hourRows,coverageStart:dailyRows[0]?.date||null,sourceCatalog,catalogRevision:registry.revision(sourceCatalog),priceCatalog,sources:Object.keys(sourceCatalog).map(agent=>statuses[agent]||{agent,label:sourceCatalog[agent]?.label,status:'unverified',lastSuccess:null,realSampleVerified:false}),recovered:recovered.map(row=>({...row}))};
}
module.exports={projectIncremental};
