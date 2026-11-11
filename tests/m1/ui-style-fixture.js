'use strict';
const path=require('node:path'),{Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize');
const {agentFixtures}=require('./agent-fixtures');
function seed(home,usage,{scale=1,agents=['codex','claude','deepseek','antigravity']}={}){
  const fixture=agentFixtures(home),store=new Store(usage,fixture.roots);
  const models=['gpt-6.1-sol','claude-opus-4-6-thinking','deepseek-v4.1-flash','gemini-3.1-pro'];
  for(let day=0;day<64;day++)for(let i=0;i<agents.length;i++){
    const input=(15000+(day%7)*1200+i*2400)*scale,read=input*4,output=(2500+i*400)*scale,write=i===3?undefined:100*scale;
    const record=normalize(agents[i],{input_tokens:input,output_tokens:output,cache_read_input_tokens:i===2&&day%4===0?undefined:read,cache_creation_input_tokens:write,reasoning_output_tokens:400*scale,total_tokens:input+output+read+(write||0)},{id:'style-'+day+'-'+i,session:'session-'+i,model:models[i%models.length],provider:'style-vendor',time:Date.now()-day*86400000,entry:'cli'},store.state.salt,'exclusive');
    store.state.records[record.id]=record;store.state.sessions[record.sessionKey]={id:'style-session-'+i,agent:agents[i],cwd:i===2?'E:\\synthetic-workspace\\实验项目':'E:\\synthetic-workspace\\token'};
  }
  for(let i=0;i<agents.length;i++){const agent=agents[i];store.state.statuses[agent]={agent,status:'unverified',observedRecords:64,errors:[],lastSuccess:new Date().toISOString(),realSampleVerified:false};store.setPrice({provider:'style-vendor',model:models[i%models.length],inputUncached:2,output:10,cacheRead:.2,cacheWrite:2.5});}
  atomic(path.join(usage,'statistics.json'),store.state);store.setEnabled(false);store.saveWorkbench({kind:'budget',period:'monthly',project:'all',limitUsd:100});
  return {fixture,records:Object.keys(store.state.records).length};
}
module.exports={seed};
