'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {codex,claude,LIMITS}=require('../../src/m1/transcript');
// The private metadata projection must preserve item boundaries, attribution,
// usage and file deltas. Only bodies and tool output/diff strings are discarded.
function metadata(value){return {...value,items:value.items.map(item=>{
 const next={...item};if(typeof next.text==='string')next.text='';
 if(next.tool){next.tool={...next.tool};if(next.tool.output!==null)next.tool.output='';if(next.tool.change)next.tool.change={...next.tool.change,diff:''};}
 return next;
})};}
test('facts projection preserves streamed merge boundaries, clipping, errors and patch counts',()=>{
 const response=payload=>({type:'response_item',timestamp:'2026-11-03T00:00:00Z',payload}),message=(role,text)=>response({type:'message',role,content:[{text}]}),patch='*** Begin Patch\n*** Update File: src/中文.js\n@@\n-old\n+new\n*** End Patch';
 const rows=[message('user','question'),message('assistant','a'.repeat(LIMITS.item-2)),message('assistant','b'),message('assistant','c'),response({type:'custom_tool_call',name:'apply_patch',call_id:'p',input:patch}),response({type:'custom_tool_call_output',call_id:'p',output:'done'}),response({type:'function_call',name:'exec_command',call_id:'s',arguments:JSON.stringify({cmd:'exit 1'})}),response({type:'function_call_output',call_id:'s',output:'Process exited with code 1\nfailed'}),message('assistant','z'.repeat(LIMITS.item+2)),{type:'event_msg',payload:{type:'token_count',info:{last_token_usage:{input_tokens:5,output_tokens:2,total_tokens:7}}}}];
 assert.deepEqual(codex(rows,{factsOnly:true}),metadata(codex(rows)));
});
test('Claude metadata preserves sidechain, repeated usage, commands and failed outputs',()=>{
 const rows=[{type:'user',message:{content:'question'}},{type:'assistant',agentId:'agent-a',isSidechain:true,message:{id:'m',usage:{input_tokens:5,output_tokens:2},content:[{type:'text',text:'reply'},{type:'thinking',thinking:'think'},{type:'tool_use',id:'t',name:'Bash',input:{command:'false'}}]}},{type:'user',agentId:'agent-a',isSidechain:true,message:{content:[{type:'tool_result',tool_use_id:'t',content:'failed',is_error:true}]}},{type:'system',subtype:'compact_boundary',compactMetadata:{trigger:'auto',preTokens:300}}];
 assert.deepEqual(claude(rows,null,{factsOnly:true}),metadata(claude(rows)));
});
