'use strict';
// Development-only expectations independent of normalize/snapshot/pricing.
const fs=require('node:fs');
const zlib=require('node:zlib');
const {readBytes}=require('../../src/m1/policy');
const {readDatabase,query}=require('../../src/m1/sqlite-memory');
// Shared wire framing is not usage extraction; all usage expectations below
// remain independent of the production harness parser and normalizer.
const {frameEnd}=require('../../src/m1/zstd-frame');
const FIELDS=['inputUncached','output','cacheRead','cacheWrite','reasoning','totalTokens'];
const unknown=reason=>({comparable:false,reason});
// Independent protobuf field walk; no production model decoder or pairing helper.
function metadataModel(bytes){
  function take(data,wanted,prefix=false){let at=0;const integer=(safe=true)=>{let n=0,shift=0;for(let i=0;i<10;i++){if(at>=data.length)throw Error();const b=data[at++];n+=(b&127)*2**shift;if(safe&&!Number.isSafeInteger(n))throw Error();if(!(b&128))return n;shift+=7;}throw Error();};while(at<data.length){const tag=integer(),wire=tag%8;if(wire===2){const size=integer();if(Math.floor(tag/8)===wanted){if(at+size>data.length&&!prefix)throw Error();return data.subarray(at,Math.min(at+size,data.length));}at+=size;if(at>data.length)throw Error();}else if(wire===0){integer(false);}else if(wire===1||wire===5){at+=wire===1?8:4;if(at>data.length)throw Error();}else throw Error();}return undefined;}
  try{const generation=take(bytes,1,true);if(!generation)return null;const name=take(generation,19);return name?Buffer.from(name).toString('utf8'):undefined;}catch{return null;}
}
async function pairedTranscript(rows,file,audit){
  const expected=jsonRows('antigravity',rows);if(!expected.comparable)return expected;
  const path=require('node:path'),conversation=path.dirname(path.dirname(path.dirname(file))),database=path.join(path.dirname(path.dirname(conversation)),'conversations',path.basename(conversation)+'.db');
  let names,limited=false;try{names=await readDatabase(database,audit,db=>query(db,'SELECT length(data) AS size,substr(data,1,65536) AS data FROM gen_metadata ORDER BY idx LIMIT 1025').map(r=>{const model=r.data?metadataModel(Buffer.from(r.data)):null;if(r.size>65536&&model==null)limited=true;return model;}).filter(n=>n!==undefined));}catch{return {...expected,modelPairingVerified:false,modelPairingReason:'MODEL_DATABASE_UNAVAILABLE'};}
  const calls=rows.filter(r=>r?.type==='PLANNER_RESPONSE'&&count(r.input_tokens)!==null&&Number.isSafeInteger(r.step_index)).sort((a,b)=>a.step_index-b.step_index);
  if(limited||names.length>1024||names.length!==calls.length||names.some(n=>!n))return {...expected,modelPairingVerified:false,modelPairingReason:limited||names.length>1024?'MODEL_SAMPLE_LIMIT':names.length!==calls.length?'MODEL_CALL_COUNT_MISMATCH':'MODEL_METADATA_INVALID'};
  const ordered=result(calls.map(r=>observation(String(r.step_index),r.input_tokens,r.output_tokens,r.cache_read_tokens,undefined,undefined,undefined,false,false)));
  if(!ordered.comparable||ordered.records.length!==names.length)return {...expected,modelPairingVerified:false};
  return {...ordered,method:'independent-transcript-and-generation-models',dimensions:[...FIELDS,'model'],records:ordered.records.map((r,i)=>({...r,model:names[i]})),modelPairingVerified:true};
}
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
function observation(id,input,output,read,write,reasoning,total,inclusive,separate) {
  if(typeof id!=='string'||!id)return null;
  for(const value of [input,output,read,write,reasoning,total])if(value!=null&&count(value)===null)return null;
  input=count(input);output=count(output);read=count(read);write=count(write);reasoning=count(reasoning);total=count(total);
  if(input===null||output===null||inclusive&&(read||0)+(write||0)>input||!separate&&reasoning!==null&&reasoning>output)return null;
  const normalizedOutput=output+(separate?(reasoning||0):0),computed=input+normalizedOutput+(inclusive?0:(read||0)+(write||0));
  if(!Number.isSafeInteger(computed)||total!==null&&total!==computed)return null;
  return {id,inputUncached:inclusive?input-(read||0)-(write||0):input,output:normalizedOutput,cacheRead:read,cacheWrite:write,reasoning,totalTokens:computed};
}
function result(rows,method='independent-usage-buckets') {
  const calls=new Map();
  for(const row of rows){
    if(!row)return unknown('MISSING_OR_INCONSISTENT_FIELDS');
    const old=calls.get(row.id);
    if(!old||row.totalTokens>old.totalTokens)calls.set(row.id,row);
    else if(row.totalTokens===old.totalTokens&&FIELDS.some(f=>old[f]!==row[f]))return unknown('AMBIGUOUS_OBSERVATIONS');
  }
  return calls.size?{comparable:true,method,dimensions:FIELDS,records:[...calls.values()].map(({id:_id,...r})=>r)}:unknown('NO_COMPARABLE_USAGE');
}
function jsonRows(agent,rows) {
  if(agent==='codex'){
    if(rows.some(r=>r?.type==='session_meta'&&(r.payload?.forked_from_id||r.payload?.forked_from)))return unknown('INHERITED_BASELINE');
    const infos=rows.filter(r=>r?.type==='event_msg'&&r.payload?.type==='token_count'&&r.payload.info?.total_token_usage).map(r=>r.payload.info);
    const counts=infos.map(info=>info.total_token_usage.total_tokens);
    if(!counts.length||counts.some((n,i)=>count(n)===null||i&&n<counts[i-1]))return unknown('CUMULATIVE_RESET_OR_UNKNOWN');
    for(let i=0;i<infos.length;i++)if((!i||counts[i]>counts[i-1])&&infos[i].last_token_usage&&infos[i].last_token_usage.total_tokens!==counts[i]-(counts[i-1]||0))return unknown('REQUEST_CUMULATIVE_DIVERGENCE');
    return {comparable:true,method:'independent-final-cumulative-total',dimensions:['totalTokens'],expectedTokens:counts.at(-1)};
  }
  if(agent==='claude')return result(rows.filter(r=>r?.type==='assistant'&&r.message?.usage).map(r=>{const u=r.message.usage;return observation(r.message.id||r.uuid,u.input_tokens,u.output_tokens,u.cache_read_input_tokens,u.cache_creation_input_tokens,u.reasoning_output_tokens,u.total_tokens,false,false);}));
  if(agent==='workbuddy')return result(rows.filter(r=>r?.providerData?.rawUsage||r?.providerData?.usage||r?.usage).map(r=>{const u=r.providerData?.rawUsage||r.providerData?.usage||r.usage;return observation(r.providerData?.messageId||r.id,u.input_tokens??u.prompt_tokens,u.output_tokens??u.completion_tokens,u.cached_input_tokens??u.cache_read_input_tokens??u.prompt_cache_hit_tokens??u.prompt_tokens_details?.cached_tokens,u.cache_creation_input_tokens??u.cache_write_tokens??u.prompt_tokens_details?.cache_write_tokens,u.reasoning_output_tokens??u.completion_tokens_details?.reasoning_tokens,u.total_tokens,true,false);}));
  if(agent==='opencode'||agent==='mimo')return result(rows.filter(r=>r?.role==='assistant'&&r.tokens).map(r=>{const u=r.tokens;return observation(r.id,u.input,u.output,u.cache?.read,u.cache?.write,u.reasoning,u.total,false,true);}));
  if(agent==='gemini'){
    let session='';const found=[];
    for(const row of rows){session=row?.sessionId??row?.$set?.sessionId??session;for(const r of [...(row?.messages||row?.$set?.messages||[]),row])if(r?.type==='gemini'&&r.tokens){const u=r.tokens;if(u.tool>0)return unknown('TOOL_BUCKET_UNSPECIFIED');found.push(observation(session+':'+r.id,u.input,u.output,u.cached,undefined,u.thoughts,u.total,true,true));}}
    return result(found);
  }
  if(agent==='cursor')return result(rows.filter(r=>r?.usage).map(r=>{const u=r.usage;return observation(r.agentId+':'+r.runId,u.inputTokens,u.outputTokens,u.cacheReadTokens,u.cacheWriteTokens,u.reasoningTokens,u.totalTokens,false,false);}));
  if(agent==='antigravity')return result(rows.filter(r=>r?.type==='PLANNER_RESPONSE'&&count(r.input_tokens)!==null&&Number.isSafeInteger(r.step_index)).map(r=>observation(String(r.step_index),r.input_tokens,r.output_tokens,r.cache_read_tokens,undefined,undefined,undefined,false,false)),'independent-transcript-buckets-model-unverified');
  if(agent==='deepseek'){
    const [header,...events]=rows;
    if(header?.type!=='session'||typeof header.id!=='string'||![2,3,4].includes(header.version)||typeof header.isSeeded!=='boolean')return unknown('HARNESS_SCHEMA_UNSUPPORTED');
    if(events.some((event,index)=>event?.seq!==index))return unknown('HARNESS_SEQUENCE_INCOMPLETE');
    const boundaries=events.filter(e=>e.type==='session/end-seed'&&e.data?.inherited===true);
    if(header.isSeeded?boundaries.length!==1:boundaries.length!==0)return unknown('HARNESS_SEED_AMBIGUOUS');
    const cutoff=header.isSeeded?boundaries[0].seq:-1,attempts=new Map(),calls=[];
    for(const e of events){
      if(!['assistant/message','assistant/attempt'].includes(e.type))continue;
      const d=e.data||{};
      if(count(d.turn)===null||count(d.step)===null){if(e.seq<=cutoff)continue;return unknown('HARNESS_CALL_ID_MISSING');}
      const lane=d.turn+':'+d.step,n=attempts.get(lane)||0;attempts.set(lane,n+1);
      if(e.seq<=cutoff)continue;
      const u=d.usage||(d.stream||[]).filter(p=>p.type==='chunk'&&p.chunk?.type==='usage').at(-1)?.chunk?.usage;
      if(!u)return unknown('NO_COMPARABLE_USAGE');
      calls.push(observation(lane+':'+n,u.inputTokens,u.outputTokens,u.cacheReadTokens,u.cacheWriteTokens,u.reasoningTokens,u.totalTokens,false,false));
    }
    return result(calls,'independent-harness-attempt-buckets');
  }
  return unknown('ORACLE_SCHEMA_UNSUPPORTED');
}
async function independent(agent,file,audit){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink())return unknown('SAMPLE_SIZE_OR_LINK');
  if(agent==='opencode'&&/\.db$/i.test(file)){
    const {objects,sampling}=await require('./sqlite-usage-sample').sample(file,audit);
    return {...jsonRows(agent,objects),projection:objects,sampling};
  }
  if(stat.size>64*1024*1024)return unknown('SAMPLE_SIZE_OR_LINK');
  if(/\.(?:db|sqlite)$/i.test(file))return readDatabase(file,audit,db=>{
    if(agent==='workbuddy'){
      const rows=query(db,'SELECT session_id, used FROM session_usage WHERE used IS NOT NULL');
      if(rows.some(r=>count(r.used)===null)||new Set(rows.map(r=>r.session_id)).size!==rows.length)return unknown('INVALID_SESSION_TOTALS');
      return {comparable:rows.length>0,method:'independent-session-total-sum',dimensions:['totalTokens'],expectedTokens:rows.reduce((sum,r)=>sum+r.used,0)};
    }
    if(agent==='cursor')return jsonRows(agent,query(db,'SELECT run_id, agent_id, usage_json FROM runs WHERE usage_json IS NOT NULL').map(r=>({runId:r.run_id,agentId:r.agent_id,usage:JSON.parse(r.usage_json)})));
    if(agent==='zcode')return result(query(db,'SELECT id,input_tokens,output_tokens,reasoning_tokens,cache_creation_input_tokens,cache_read_input_tokens,provider_total_tokens,computed_total_tokens FROM model_usage').map(r=>{
      if(r.computed_total_tokens!==r.input_tokens+r.output_tokens)return null;
      return observation(r.id,r.input_tokens,r.output_tokens,r.cache_read_input_tokens,r.cache_creation_input_tokens,r.reasoning_tokens,r.provider_total_tokens??r.computed_total_tokens,true,false);
    }));
    if(agent==='opencode'||agent==='mimo'){
      const tables=new Set(query(db,"SELECT name FROM sqlite_master WHERE type='table'").map(r=>r.name)),objects=[];
      for(const table of ['message','session_message'])if(tables.has(table))for(const r of query(db,'SELECT id,data'+(table==='session_message'?',type':'')+' FROM '+table)){const d=JSON.parse(r.data);objects.push({...d,id:d.id||r.id,role:d.role||r.type});}
      return jsonRows(agent,objects);
    }
    return unknown('ORACLE_SCHEMA_UNSUPPORTED');
  });
  if(/\.csv$/i.test(file))return unknown('ORACLE_SCHEMA_UNSUPPORTED');
  let bytes=readBytes(file,audit);
  if(/\.zstd$/i.test(file)){
    if(agent!=='deepseek'||typeof zlib.zstdDecompressSync!=='function')return unknown('ORACLE_SCHEMA_UNSUPPORTED');
    const chunks=[];let offset=0,size=0;
    while(offset<bytes.length){
      const end=frameEnd(bytes,offset);if(end===null)return unknown('INCOMPLETE_COMPRESSED_SAMPLE');
      const chunk=zlib.zstdDecompressSync(bytes.subarray(offset,end),{maxOutputLength:64*1024*1024-size});
      size+=chunk.length;if(size>=64*1024*1024)return unknown('SAMPLE_DECOMPRESSED_LIMIT');
      chunks.push(chunk);offset=end;
    }
    bytes=Buffer.concat(chunks);
  }
  const text=bytes.toString('utf8');let rows;
  try{rows=/\.json$/i.test(file)?[JSON.parse(text)]:text.split('\n').filter(line=>line.trim()).map(JSON.parse);}catch{return unknown('INCOMPLETE_OR_INVALID_JSON');}
  return agent==='antigravity'?pairedTranscript(rows,file,audit):jsonRows(agent,rows);
}
function compare(expected,records){
  if(!expected.comparable)return {comparable:false,reason:expected.reason||'NO_COMPARABLE_USAGE'};
  const expectedTokens=expected.expectedTokens??expected.records.reduce((sum,r)=>sum+r.totalTokens,0),actualTokens=records.reduce((sum,r)=>sum+r.totalTokens,0);
  const buckets=rows=>rows.map(r=>JSON.stringify(expected.dimensions.map(f=>r[f]))).sort();
  const matches=expectedTokens===actualTokens&&(!expected.records||JSON.stringify(buckets(expected.records))===JSON.stringify(buckets(records)));
  const fieldCoverage=Object.fromEntries(FIELDS.filter(f=>f!=='totalTokens').map(f=>[f,{expected:expected.records?expected.records.filter(r=>r[f]!=null).length:null,actual:records.filter(r=>r[f]!=null).length}]));
  return {comparable:true,method:expected.method,dimensions:expected.dimensions,expectedTokens,actualTokens,expectedRecords:expected.records?.length??null,actualRecords:records.length,matches,fieldCoverage};
}
module.exports={independent,compare,jsonRows};
