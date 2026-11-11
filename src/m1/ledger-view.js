'use strict';
const {selectUsageSnapshot,keepIdentity}=require('./usage-snapshot');
// Shared in-memory reconciliation for GUI startup and read-only saved queries.
// The GUI supplies a backup callback; a reader supplies none and never persists.
function reconcile(state,beforeChange=()=>{},labels={}) {
  state.duplicateIds ||= {};
  const shared=new Map();
  for(const record of Object.values(state.records))if(record.sharedKey){
    const ownerId=shared.get(record.sharedKey);
    if(ownerId){
      const owner=state.records[ownerId],choice=selectUsageSnapshot(owner,record);
      if(state.duplicateIds[record.id]!==ownerId||choice.record!==owner){
        beforeChange();state.duplicateIds[record.id]=ownerId;state.records[ownerId]=keepIdentity(owner,choice.record);
      }
      if(choice.issue==='SOURCE_USAGE_CONFLICT')for(const agent of [owner.agent,record.agent]){
        const status=state.statuses[agent]||{agent,label:labels[agent],lastSuccess:null};
        state.statuses[agent]={...status,status:status.status==='not-detected'?status.status:'partial',errors:[...new Set([...(status.errors||[]),choice.issue])]};
      }
    }else{
      if(state.duplicateIds[record.id]&&state.records[state.duplicateIds[record.id]]?.sharedKey===record.sharedKey){beforeChange();delete state.duplicateIds[record.id];}
      shared.set(record.sharedKey,record.id);
    }
  }
  const records=Object.values(state.records).filter(record=>!state.duplicateIds[record.id]);
  const detailed=new Set(records.filter(r=>r.agent==='workbuddy'&&r.accountingKind!=='session-aggregate').map(r=>r.sessionKey).filter(Boolean));
  for(const record of records)if(record.agent==='workbuddy'&&record.accountingKind==='session-aggregate'&&detailed.has(record.sessionKey)){
    beforeChange();delete state.records[record.id];
  }
}
module.exports={reconcile};
