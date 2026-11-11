'use strict';
const {selectSnapshot}=require('./local-snapshot');
const {pack}=require('./snapshot-codec');
// A delta can reference only rows of the exact prior revision. Unknown/stale
// readers still receive the existing full whitelist transport. No ledger IDs
// or private metadata become part of this protocol.
function snapshotDelta(previous,next,baseRevision,catalog){
 if(!previous||!Number.isSafeInteger(baseRevision))return null;
 if(next.daily.length>100000||next.hourly.length>50000)throw Error('INVALID_USAGE_SNAPSHOT');
 let changed=0;
 const plan=(before,after)=>{
  const indices=new WeakMap(before.map((row,i)=>[row,i])),rows=[],order=[];
  for(const row of after){if(indices.has(row))order.push(indices.get(row));else{if(++changed>4096)return null;rows.push(row);order.push(-rows.length);}}
  return{rows,order};
 };
 const daily=plan(previous.daily,next.daily);if(!daily)return null;const hourly=plan(previous.hourly,next.hourly);if(!hourly)return null;
 const selected=selectSnapshot({...next,daily:daily.rows,hourly:hourly.rows},catalog);
 let start=null;for(const row of next.daily){if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date))throw Error('INVALID_USAGE_ROW');if(start===null||row.date<start)start=row.date;}selected.coverageStart=start;
 return{...pack(selected),codec:'LocalUsageDeltaV1',baseRevision,dailyOrder:daily.order,hourlyOrder:hourly.order};
}
module.exports={snapshotDelta};
