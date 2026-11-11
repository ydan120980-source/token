'use strict';
const fs = require('node:fs'), path = require('node:path');
const {roots} = require('../../src/m1/policy');
const PRIVATE = 'BATCH1_PRIVATE_PROMPT_TOOL_CREDENTIAL_SENTINEL';
const time = '2026-11-01T01:00:00.000Z', later = '2026-11-02T02:00:00.000Z';
function write(file, rows, json = false) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,json ? JSON.stringify(rows) : rows.map(row => JSON.stringify(row)).join('\n')+'\n');
}
function shutdown(id, timestamp = time, input = 100, output = 20, sessionModel = 'gpt-4.1') {
  return {type:'session.shutdown',id,timestamp,data:{modelMetrics:{[sessionModel]:{usage:{inputTokens:input,outputTokens:output,cacheReadTokens:20,cacheWriteTokens:0,reasoningTokens:3},requests:{count:1,cost:999}}},privatePrompt:PRIVATE,totalNanoAiu:999}};
}
function piMessage(id = 'pi-call', input = 60) {
  return {type:'message',id,parentId:null,timestamp:time,message:{role:'assistant',model:'gpt-4.1',provider:'openai',timestamp:Date.parse(time),usage:{input,output:20,cacheRead:40,cacheWrite:10,reasoning:3,totalTokens:input+70,cost:{total:999}},content:PRIVATE}};
}
function otel(id = 'response', session = 'copilot-session') {
  return {type:'span',traceId:'trace',spanId:'span',startTime:[Date.parse(time)/1000,0],endTime:[Date.parse(time)/1000+1,0],attributes:{'gen_ai.operation.name':'chat','gen_ai.response.id':id,'gen_ai.conversation.id':session,'gen_ai.response.model':'gpt-4.1','gen_ai.usage.input_tokens':100,'gen_ai.usage.output_tokens':20,'gen_ai.usage.cache_read.input_tokens':20,'gen_ai.usage.cache_write.input_tokens':0,'gen_ai.usage.reasoning_tokens':3,'secret.prompt':PRIVATE},body:PRIVATE};
}
function batch1Fixtures(home) {
  const selected = roots(home), cpFile = path.join(selected.copilot[0],'copilot-session','events.jsonl');
  const cp = [shutdown('first'),shutdown('second',later,150,30)]; write(cpFile,cp);
  const clineFile = path.join(selected.cline[0],'cline-task','ui_messages.json');
  const cline = [{type:'say',say:'text',text:PRIVATE,ts:Date.parse(time)},
    {type:'say',say:'api_req_started',ts:Date.parse(time),modelInfo:{modelId:'gpt-4.1',providerId:'openai'},text:JSON.stringify({tokensIn:60,tokensOut:20,cacheReads:40,cacheWrites:10,cost:999,request:PRIVATE})}];
  write(clineFile,cline,true);
  const piFile = path.join(selected.pi[0],'project','session.jsonl');
  const pi = [{type:'session',version:3,id:'pi-session',timestamp:time,cwd:path.join(home,'synthetic-project')},piMessage()]; write(piFile,pi);
  return {roots:selected,cpFile,cp,clineFile,cline,piFile,pi,expected:{copilot:180,cline:130,pi:130},total:440};
}
module.exports = {batch1Fixtures,write,shutdown,piMessage,otel,PRIVATE,time,later};
