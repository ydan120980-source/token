'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {codex,claude,preview,LIMITS}=require('../../src/m1/transcript');
const at='2026-11-04T00:00:00Z';
const message=(role,text)=>({timestamp:at,type:'response_item',payload:{type:'message',role,content:[{text}]}});

test('bounded initial previews equal full parsing across streamed joins, Unicode and tool output',()=>{
 const image=Buffer.from('synthetic image only').toString('base64');
 for(const chunks of [
  ['short','reply'],
  ['x'.repeat(LIMITS.inline-1),'🙂 joined across the inline boundary'],
  ['x'.repeat(LIMITS.preview-1)+'🙂'+'中文'.repeat(12000),'tail'],
  ['x'.repeat(LIMITS.inline)+'\ud800','tail'],
  ['x'.repeat(LIMITS.spoken-1),'🙂 joined across the spoken boundary'],
  ['x'.repeat(LIMITS.spoken)+'\ud800','tail'],
 ]){
  const output=Array.from({length:40},(_,i)=>'行 '+i+' '+('中文🙂'.repeat(100))).join('\n');
  const codexRows=[message('user','question'),...chunks.map(text=>message('assistant',text)),
   {timestamp:at,type:'response_item',payload:{type:'function_call',name:'shell',call_id:'tool',arguments:'{"command":"synthetic"}'}},
   {timestamp:at,type:'response_item',payload:{type:'function_call_output',call_id:'tool',output}},
   {timestamp:at,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,'+image}]}}];
  const claudeRows=[{type:'user',timestamp:at,message:{content:'question'}},...chunks.map(text=>({type:'assistant',timestamp:at,message:{content:[{type:'text',text}]}})),
   {type:'assistant',timestamp:at,message:{content:[{type:'tool_use',id:'tool',name:'Bash',input:{command:'synthetic'}}]}},
   {type:'user',timestamp:at,message:{content:[{type:'tool_result',tool_use_id:'tool',content:output},{type:'image',source:{type:'base64',media_type:'image/png',data:image}}]}}];
  for(const [full,light] of [[codex(codexRows),codex(codexRows,{previewOnly:true})],[claude(claudeRows),claude(claudeRows,null,{previewOnly:true})]]){
   assert.deepEqual(preview(light),preview(full),'initial preview, lengths and item indices remain identical');
   assert(light.items.every(item=>(item.text?.length??0)<=(item.kind==='user'||item.kind==='assistant'?LIMITS.spoken:LIMITS.inline)+1),'bounded prefixes preserve the current spoken-text limit');
   assert(light.items.filter(item=>item.kind==='image').every(item=>item.image.data===''));
   assert(full.items.find(item=>item.kind==='tool').tool.output.includes('行 39'),'full-text operations retain the original tail');
  }
 }
});
