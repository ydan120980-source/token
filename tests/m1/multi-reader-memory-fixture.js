'use strict';
const fs=require('node:fs'),path=require('node:path');
const {seed,CODEX_ID}=require('./sessions-reader-fixture');
const {Store,atomic}=require('../../src/m1/store'),{roots}=require('../../src/m1/policy'),{scanSources}=require('../../src/m1/sources'),{normalize}=require('../../src/m1/normalize');
const CHANGE_PATH='C:/synthetic/memory-shared.js';
async function seedMemory(root){
 const seeded=await seed(root),{home,usage,codexFile}=seeded,now=Date.now(),longIds=[CODEX_ID,CODEX_ID.replace(/13$/,'14'),CODEX_ID.replace(/13$/,'15')];
 const longFiles=longIds.map(id=>codexFile.replace(CODEX_ID,id)),reply='```js\n'+Array.from({length:40},(_,i)=>'const item'+i+' = '+i+';').join('\n')+'\n```\n\n'+'合成内存测量段落。'.repeat(3000);
 for(let k=0;k<longIds.length;k++){
  const id=longIds[k],rows=[{timestamp:new Date(now-600000).toISOString(),type:'session_meta',payload:{id,cwd:'C:/synthetic/memory',originator:'codex_cli_rs'}},{type:'turn_context',payload:{model:'gpt-4.1'}}];
  for(let i=0;i<300;i++){const timestamp=new Date(now-600000+i*1000+k).toISOString();rows.push({timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'合成长会话 '+k+' 问题 '+i}]}},{timestamp,type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:reply}]}},{timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:(i+1)*100,output_tokens:(i+1)*20,total_tokens:(i+1)*120},last_token_usage:{input_tokens:100,output_tokens:20,total_tokens:120}}}});
   if(i===0)rows.push({timestamp,type:'response_item',payload:{type:'function_call',name:'apply_patch',call_id:'memory-edit',arguments:'*** Begin Patch\n*** Update File: '+CHANGE_PATH+'\n@@\n-before\n+after\n*** End Patch'}},{timestamp,type:'response_item',payload:{type:'function_call_output',call_id:'memory-edit',output:'Success. Updated: '+CHANGE_PATH}});
  }
  fs.writeFileSync(longFiles[k],rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
 }
 const producer=new Store(usage,roots(home));producer.ingest(await scanSources(roots(home),producer.state.salt,{reads:0}),{status:'not-run'});producer.setEnabled(false);
 for(let i=0;i<64000;i++){const row=normalize('codex',{input_tokens:80,output_tokens:20,cached_input_tokens:0,total_tokens:100},{id:'multi-memory-'+i,session:'saved-bulk-session-'+i%20000,time:now-Math.floor(i/320)*86400000,model:'synthetic-'+i%100,entry:'cli'},producer.state.salt);producer.state.records[row.id]=row;}
 producer.state.sequence++;atomic(path.join(usage,'statistics.json'),producer.state);
 return {...seeded,longIds,longFiles,changePath:CHANGE_PATH,savedSyntheticSessions:20000};
}
module.exports={seedMemory,CHANGE_PATH};
