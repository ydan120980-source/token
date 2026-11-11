'use strict';
const {createHash}=require('node:crypto');
const {projectResources,instant}=require('./resource-contract');
const {version}=require('./antigravity-command');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function projectAntigravity(raw,observedAt){
  if(!record(raw)||raw.product!=='antigravity'||!instant(observedAt)||raw.quota!=null&&!record(raw.quota))throw new Error('PROVIDER_RESPONSE_INVALID');
  const entries=Object.entries(raw.quota||{});if(entries.length>200)throw new Error('PROVIDER_OUTPUT_LIMIT');
  const windows=entries.sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value],index)=>{
    if(!record(value))throw new Error('PROVIDER_RESPONSE_INVALID');
    const fraction=value.remaining_fraction,valid=typeof fraction==='number'&&Number.isFinite(fraction)&&fraction>=0&&fraction<=1;
    // IDs may contain private model names or arbitrary input. Keep stable opaque
    // identity and a generated label; do not bind these to independent accounts.
    return {id:'bucket:'+createHash('sha256').update(key).digest('hex'),label:'额度约束 '+(index+1),unit:'percent',role:'other',cadence:'unknown',usedPercent:valid?(1-fraction)*100:null,resetsAt:value.reset_time,requiresEntitlement:true,
      issues:fraction!=null&&!valid?['INVALID_PERCENT']:[]};
  });
  return projectResources({schemaVersion:'AccountQuotaV2',provider:'antigravity',fetchedAt:observedAt,incomplete:true,provenance:{kind:'passive',version:version(raw.version)},entitlement:{},
    pools:windows.length?[{id:'statusline',label:'官方状态栏约束集合 · 归属未核验',scope:'unknown',modelIds:[],windows,balances:[]}]:[]});
}
module.exports={projectAntigravity};
