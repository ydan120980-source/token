'use strict';
// The session list exposes fewer fields than a usage/pricing row. Accumulate
// its own DTO directly instead of allocating then discarding pricing maps for
// every session/day. Request-local only, with the same unknown/conflict rules.
const fields=['inputUncached','output','cacheRead','cacheWrite','reasoning'];
function addSession(map,date,record,estimate){
 let row=map.get(date);
 if(!row){row={date,totalTokens:0,inputUncached:0,output:0,cacheRead:0,cacheWrite:0,reasoning:0,records:0,partialRecords:0,pricedTokens:0,boundedTokens:0,estimatedCostUsd:null,estimatedCostUpperUsd:null,knownUsage:{}};map.set(date,row);}
 row.totalTokens+=record.totalTokens;row.records++;
 if(record.quality!=='measured'||record.usageConflict)row.partialRecords++;
 for(const field of fields){row[field]=row[field]===null||record[field]===null||record.usageConflict?null:row[field]+record[field];if(!record.usageConflict&&Number.isFinite(record[field]))row.knownUsage[field]=(row.knownUsage[field]||0)+record[field];}
 const plain=record.output!==null&&record.reasoning!==null&&record.reasoning<=record.output?record.output-record.reasoning:null;
 if(!record.usageConflict&&Number.isFinite(plain))row.knownUsage.outputPlain=(row.knownUsage.outputPlain||0)+plain;
 if(estimate.lower!==null){row.estimatedCostUsd=(row.estimatedCostUsd??0)+estimate.lower;row.estimatedCostUpperUsd=(row.estimatedCostUpperUsd??0)+estimate.upper;row.pricedTokens+=record.totalTokens;if(estimate.upper>estimate.lower)row.boundedTokens+=record.totalTokens;}
}
module.exports={addSession};
