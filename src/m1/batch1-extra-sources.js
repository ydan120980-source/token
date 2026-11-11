'use strict';
// Remaining first-batch local usage projections. No config/model guessing or IO.
const path = require('node:path');
const {normalize,number,timestamp,digest} = require('./normalize');
const {observe} = require('./sessions');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
function rows() { const result=[];result.warnings=[];result.sessions=[];return result; }
function warn(result,code='SOURCE_ROW_INVALID') { if(!result.warnings.includes(code))result.warnings.push(code); }
function add(result,agent,usage,info,salt,semantics='exclusive') {
  if(!info.id){warn(result);return null;}
  const record=normalize(agent,usage,info,salt,semantics);
  if(!record){warn(result);return null;}
  if(Object.values(usage).some(value=>value!=null&&number(value)===null)){record.quality='partial';warn(result);}
  result.push(record);return record;
}
// Resolve overlap only when the reported total proves it. Missing/contradictory
// evidence keeps output unknown and pricing disabled, with a reported total or
// conservative lower bound retained. A zero total is never treated as a hint.
function outputInfo(input,output,read,write,reasoning,total,inclusive) {
  const base=number(input)!==null&&number(output)!==null?input+output+(inclusive?0:(number(read)??0)+(number(write)??0)):null;
  const r=number(reasoning),t=number(total);
  const separate=r!==null&&r>0&&base!==null&&t===base+r;
  const known=r===0||base!==null&&t===base||separate;
  return {separate,known,total:t,base};
}
function preserveOverlap(result,record,evidence) {
  if(!record||evidence.known)return;
  record.output=null;if(record.quality==='measured')record.quality='partial';
  if(evidence.total!==null&&evidence.total>0)record.totalTokens=evidence.total;
  warn(result,'USAGE_UNREPORTED');
}
function qwen(objects,salt) {
  const result=rows(),occurrences=new Map();
  for(const row of objects){
    if(row?.type!=='assistant'||!object(row.usageMetadata))continue;
    const u=row.usageMetadata,session=id(row.sessionId),time=timestamp(row.timestamp);
    if(!session||!time){warn(result);continue;}
    const key=JSON.stringify([session,time]),occurrence=occurrences.get(key)||0;occurrences.set(key,occurrence+1);
    const evidence=outputInfo(u.promptTokenCount,u.candidatesTokenCount,u.cachedContentTokenCount,null,u.thoughtsTokenCount,u.totalTokenCount,true);
    const record=add(result,'qwen',{input:u.promptTokenCount,output:u.candidatesTokenCount,cacheReadTokens:u.cachedContentTokenCount,reasoning:u.thoughtsTokenCount,totalTokens:u.totalTokenCount},
      {id:JSON.stringify([session,time,occurrence]),session,model:row.model,time,entry:'cli',outputExcludesReasoning:evidence.separate},salt,'inclusive');
    preserveOverlap(result,record,evidence);
    const meta=observe('qwen',session,null,salt);if(meta)result.sessions.push(meta);
  }
  return result;
}
function kilo(objects,salt) {
  const result=rows();
  for(const row of objects){
    if(row?.role!=='assistant'||!object(row.tokens))continue;
    const u=row.tokens,session=id(row.sessionID??row.session_id),message=id(row.id),time=row.time?.created??row.timestamp;
    const evidence=outputInfo(u.input,u.output,u.cache?.read,u.cache?.write,u.reasoning,u.total,false);
    const record=add(result,'kilo',{input:u.input,output:u.output,cacheReadTokens:u.cache?.read,cacheWriteTokens:u.cache?.write,reasoning:u.reasoning,totalTokens:u.total},
      {id:session&&message?JSON.stringify(['cli',session,message]):null,session,model:row.modelID,provider:row.providerID,time,entry:'cli',outputExcludesReasoning:evidence.separate},salt);
    preserveOverlap(result,record,evidence);
    if(record){
      // Kilo CLI inherits the OpenCode message schema. Use the same recorded
      // call evidence to suppress migrated/copied DBs across these sources.
      record.sharedKey=digest(salt,JSON.stringify(['shared-opencode-schema/2',message,record.timestamp,record.model]));
      record.sharedRecordIds=['opencode','mimo'].map(agent=>digest(salt,agent+':'+message)).concat(record.id);
    }
    const meta=observe('kilo',session,null,salt);if(meta)result.sessions.push(meta);
  }
  return result;
}
function kiloDatabase(data,salt) {
  const objects=[];let invalid=false;
  for(const row of data){
    let value;try{value=JSON.parse(row.data);}catch{invalid=true;continue;}
    if(!object(value)){invalid=true;continue;}
    objects.push({id:row.id,session_id:row.session_id,role:value.role,tokens:value.tokens,modelID:value.modelID,providerID:value.providerID,time:value.time});
  }
  const result=kilo(objects,salt);if(invalid)warn(result);return result;
}
function kimi(objects,salt,file) {
  const result=rows(),parts=file.split(path.sep),agentLayout=parts.at(-3)==='agents';
  const session=id(agentLayout?parts.at(-4):parts.at(-2)),lane=agentLayout?id(parts.at(-2)):'main',occurrences=new Map();
  for(const row of objects){
    const modern=row?.type==='usage.record';
    if(modern&&row.usageScope!=='turn')continue;
    if(!modern&&row?.message?.type!=='StatusUpdate')continue;
    const payload=row.message?.payload,u=modern?row.usage:payload?.token_usage;
    if(!object(u))continue;
    const time=modern?timestamp(row.time):typeof row.timestamp==='number'?timestamp(row.timestamp*1000):null;
    if(!session||!lane||!time){warn(result);continue;}
    const key=JSON.stringify([session,lane,time]),occurrence=occurrences.get(key)||0;occurrences.set(key,occurrence+1);
    const message=modern?null:id(payload?.message_id);
    const model=modern&&typeof row.model==='string'&&!row.model.startsWith('__')?row.model:undefined;
    add(result,'kimi',{input:modern?u.inputOther:u.input_other,output:u.output,cacheReadTokens:modern?u.inputCacheRead:u.input_cache_read,cacheWriteTokens:modern?u.inputCacheCreation:u.input_cache_creation,totalTokens:modern?undefined:u.total},
      {id:JSON.stringify([session,lane,modern?'code':'cli',message??time,message?0:occurrence]),session,model,time,entry:'cli'},salt);
  }
  const meta=observe('kimi',session,null,salt);if(meta)result.sessions.push(meta);
  return result;
}
function continueRows(data,salt) {
  const result=rows();
  for(const row of data){
    const time=typeof row.timestamp==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.timestamp)?row.timestamp.replace(' ','T')+'Z':null;
    const record=add(result,'continue',{input:row.tokens_prompt,output:row.tokens_generated},
      {id:Number.isSafeInteger(row.id)&&time?JSON.stringify([row.id,time]):null,model:row.model,provider:row.provider,time,entry:'desktop'},salt,'inclusive');
    if(record){record.quality='partial';record.measurementBasis='client-estimated';warn(result,'SOURCE_USAGE_ESTIMATED');}
  }
  return result;
}
module.exports={qwen,kilo,kiloDatabase,kimi,continueRows};
