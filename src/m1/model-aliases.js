'use strict';
// Suggestions only. No edit, network, or implicit price resolution occurs here.
const {isIdentifier}=require('./pricing');
const VENDORS=new Set(['openai','anthropic','google','deepseek','xiaomi','zai','minimax']);
function signature(model){
  if(!isIdentifier(model))return null;
  let name=model.toLowerCase();const cut=name.indexOf('/');
  if(cut>=0){if(!VENDORS.has(name.slice(0,cut)))return null;name=name.slice(cut+1);}
  // Keep every version digit, release date and suffix. In particular latest,
  // thinking, pro, preview and dated releases are never stripped or conflated.
  return name.replace(/[._-]/g,'');
}
function suggest(observed,catalog,overrides={}){
  const index=new Map();
  for(const [target,rates] of Object.entries({...catalog,...overrides})){
    const cut=target.indexOf('/'),provider=target.slice(0,cut),model=target.slice(cut+1),id=signature(model);
    if(!id||!Number.isFinite(rates.inputUncached)||!Number.isFinite(rates.output)||['reference-unverified','official-thirdparty-unverified'].includes(rates.provenance))continue;
    const manual=Object.hasOwn(overrides,target),candidate={target,provider,model,origin:manual?'manual':rates.provenance,source:manual?null:rates.source||null,
      rates:Object.fromEntries(['inputUncached','output','cacheRead','cacheWrite'].map(f=>[f,Number.isFinite(rates[f])?rates[f]*1e6:null]))};
    if(!index.has(id))index.set(id,[]);index.get(id).push(candidate);
  }
  return Object.fromEntries(observed.map(row=>{
    const key=row.provider+'/'+row.model,id=signature(row.model),all=(index.get(id)||[]).filter(c=>c.target!==key);
    all.sort((a,b)=>Number(b.provider===row.provider)-Number(a.provider===row.provider)||a.target.localeCompare(b.target));
    return [key,{total:all.length,ambiguous:all.length>1,candidates:all.slice(0,8).map(c=>({...c,reason:c.model.toLowerCase()===row.model.toLowerCase()?'模型标识相同；请核对服务商与路由费率':'仅大小写、分隔符或明确厂商前缀不同；版本、日期与后缀保持一致'}))}];
  }));
}
module.exports={signature,suggest};
