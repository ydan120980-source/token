'use strict';
const fs = require('node:fs'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const transcript = require('../../../../src/m1/transcript');
const root = process.argv[2], id = 'fixture-session', fixed = new Date('2026-11-02T12:00:00.000Z'), ms = +fixed;
const storage = [];
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  fs.utimesSync(file, fixed, fixed);
};
const save = (name, agent, roots) => storage.push({ name, agent, roots, id });
const tool = { type:'tool', tool:'Edit', callID:'edit', state:{status:'completed', input:{filePath:'src/fixture.js',oldString:'previous',newString:'needle'}, output:'visible needle'} };
const parts = [{ type:'text', text:'assistant needle' }, {type:'text', text:'injected', synthetic:true}, { type:'reasoning', text:'thought' }, tool,
  {type:'subtask', description:'synthetic', prompt:'question', agent:'fixture'}, {type:'retry', error:{'message':'no'}}, {type:'unknown-part', data:0}];
const response = { role:'assistant', tokens:{input:10, output:3, cache:{read:0,write:0}}, error:{data:{message:'a harmless failure'}} };
const request = { role:'user', time:{created:ms} };
for (const [agent, file] of [['opencode','opencode.db'],['mimo','mimocode.db'],['zcode','db.sqlite'],['kilo','kilo.db']]) {
  const dir = path.join(root, agent);
  fs.mkdirSync(dir);
  const dbFile = path.join(dir, file), db = new DatabaseSync(dbFile);
  if (agent === 'mimo') {
    db.exec('CREATE TABLE session_message(session_id TEXT, type TEXT, seq INTEGER, data TEXT);');
    const add = db.prepare('INSERT INTO session_message VALUES (?,?,?,?)');
    add.run(id, 'assistant', 20, JSON.stringify({content:parts,tokens:response.tokens,error:response.error}));
    add.run(id, 'user', 10, JSON.stringify({text:'Mimo needle',content:'prefer text'}));
    add.run(id, 'system', 0, JSON.stringify({text:'message before user'}));
    add.run(id, 'user', 2, 'malformed');
  } else {
    db.exec('CREATE TABLE session(id TEXT,parent_id TEXT); CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); CREATE TABLE part(id TEXT,message_id TEXT,session_id TEXT,time_created INTEGER,data TEXT);');
    const msg = db.prepare('INSERT INTO message VALUES (?,?,?,?)'), part = db.prepare('INSERT INTO part VALUES (?,?,?,?,?)');
    msg.run('response',id,ms+3000,JSON.stringify(response));
    msg.run('request',id,ms,JSON.stringify(request));
    msg.run('child-reply','child',ms+1500,JSON.stringify(response));
    msg.run('other-reply','unrelated',ms+100,JSON.stringify(request));
    db.prepare('INSERT INTO session VALUES (?,?)').run('child',id);
    part.run('question','request',id,ms,JSON.stringify({type:'text',text:'问 needle'}));
    part.run('child','child-reply','child',ms+1500,JSON.stringify({type:'text',text:'子 Agent needle'}));
    part.run('private','other-reply','unrelated',ms+100,JSON.stringify({type:'text',text:'do not expose'}));
    parts.forEach((value,index) => part.run('part-'+index,'response',id,ms+3000+index,JSON.stringify(value)));
  }
  db.close();
  fs.utimesSync(dbFile, fixed, fixed);
  save(agent, agent, [dbFile]);
}
for (const [name, agent, old] of [['legacy-open','opencode',false],['legacy-mimo','mimo',true]]) {
  const dir = path.join(root,name), base = old ? path.join(dir,'project','synthetic','storage','session') : path.join(dir,'storage');
  const partRoot = old ? path.join(base,'part',id) : path.join(base,'part');
  write(path.join(base,'message',id,'m1.json'), { ...request });
  write(path.join(base,'message',id,'m2.json'), { ...response, time:{created:ms+1000} });
  write(path.join(partRoot,'m1','p1.json'), { type:'text',text:'legacy needle' });
  parts.forEach((part,index) => write(path.join(partRoot,'m2','p'+index+'.json'),part));
  save(name,agent,[dir]);
}
const history = [
  { role:'user', ts:ms, content:[{type:'text',text:'<environment_details>\nsynthetic\n</environment_details>\n<task>add needle</task>'}] },
  { role:'assistant',ts:ms+1000,content:[{type:'text',text:'reply'},{type:'tool_use',id:'edit',name:'Edit',input:{file_path:'src/fixture.js',old_string:'old',new_string:'needle'}}], metrics:{inputTokens:10,outputTokens:2,cacheReadTokens:0} },
  { role:'user',ts:ms+2000,content:[{type:'tool_result',tool_use_id:'edit',content:[{type:'text',text:'done'}],is_error:true}] }
];
for (const agent of ['cline','kilo']) {
  const dir = path.join(root,agent+'-ide','tasks');
  write(path.join(dir,id,'api_conversation_history.json'),history);
  save(agent+'-ide',agent,[dir]);
}
const cline = path.join(root,'cline-cli');
write(path.join(cline,id,id+'.messages.json'),{sessionId:id,messages:history});
save('cline-cli','cline',[cline]);
const cont = path.join(root,'continue');
write(path.join(cont,'sessions',id+'.json'),{history:[
  {message:{role:'user',content:'问 needle'}},
  {message:{role:'assistant',content:'回答',toolCalls:[{id:'call',function:{name:'Read',arguments:'{"path":"fixture.txt"}'}}]},
    reasoning:{text:'先想'}, toolCallStates:[{toolCallId:'call',status:'errored',output:[{content:'失败'}]}]}
]});
write(path.join(cont,'sessions','config.json'), {history:[{message:{role:'user',content:'private'}}]});
fs.mkdirSync(path.join(cont,'dev_data'));
save('continue','continue',[path.join(cont,'dev_data','devdata.sqlite')]);
const gem = path.join(root,'gemini');
const gemMessages = [
  {id:'one',type:'user',content:[{text:'问 needle'}],timestamp:fixed},
  {id:'two',type:'gemini',content:'回答',thoughts:[{subject:'先做',description:'思考'}],toolCalls:[{name:'Edit',args:{filePath:'src/fixture.js',oldString:'old',newString:'needle'},status:'success',resultDisplay:{fileDiff:'plain diff'}}],tokens:{input:10,output:2,total:12}},
  {id:'warn',type:'warning',content:'a warning'}
];
write(path.join(gem,'project','chats','session-demo.json'), {sessionId:id,messages:gemMessages});
save('gemini','gemini',[gem]);
const writeLog = (file, rows, zip = false) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  if (zip) {
    const { zstdCompressSync } = require('node:zlib');
    const half = text.length >> 1;
    const partial = zstdCompressSync(Buffer.from('{"type":"unfinished"}\n'));
    fs.writeFileSync(file, Buffer.concat([zstdCompressSync(text.subarray(0,half)),zstdCompressSync(text.subarray(half)),partial.subarray(0,7)]));
  } else fs.writeFileSync(file,text);
  fs.utimesSync(file,fixed,fixed);
};
const gemLog = path.join(root,'gemini-log','project','chats');
write(path.join(gemLog,'session-old.json'),{sessionId:id,messages:[{type:'user',content:'legacy must lose'}]});
writeLog(path.join(gemLog,'session-log.jsonl'),[
  {sessionId:id,messages:[{id:'old',type:'user',content:'before checkpoint'}]},
  {'$set':{messages:gemMessages}},
  {...gemMessages[1],content:'rewritten needle'}, {'$rewindTo':'warn'},
  {id:'new',type:'gemini',content:'last needle',timestamp:fixed}
]);
save('gemini-log','gemini',[path.join(root,'gemini-log')]);
const pi = path.join(root,'pi');
writeLog(path.join(pi,'project','date_'+id+'.jsonl'),[
  {type:'session',id,version:3},
  {type:'message',id:'root',message:{role:'user',content:'Pi needle',timestamp:ms}},
  {type:'message',id:'abandoned',parentId:'root',message:{role:'assistant',content:'Do not include',timestamp:ms+2000}},
  {type:'message',id:'chosen',parentId:'root',message:{role:'assistant',timestamp:ms+3000,content:[
    {type:'text',text:'reply needle'},{type:'thinking',thinking:'thought'},{type:'toolCall',id:'call',name:'Edit',arguments:{file_path:'src/fixture.js',old_string:'before',new_string:'needle'}}
  ],usage:{input:11,output:2,cacheRead:1,cacheWrite:0,totalTokens:14}}},
  {type:'message',id:'result',parentId:'chosen',message:{role:'toolResult',toolCallId:'call',content:[{type:'text',text:'needle'}]}},
  {type:'compaction',id:'compact',parentId:'result',tokensBefore:10,timestamp:fixed,summary:'summary'}
]);
save('pi','pi',[pi]);
const qwen = path.join(root,'qwen');
const q = (type, uuid, parentUuid, parts, extra = {}) => ({type,uuid,parentUuid,timestamp:fixed,sessionId:id,message:{parts},...extra});
writeLog(path.join(qwen,'project','chats',id+'.jsonl'),[
  q('user','root',null,[{text:'needle question'}]),
  q('assistant','archived','root',[{text:'Do not include'}]),
  q('assistant','side','archived',[{text:'side needle'}],{isSidechain:true,agentId:'synthetic-agent'}),
  q('assistant','answer','root',[{text:'thinking',thought:true},{text:'needle reply'},{functionCall:{id:'tool',name:'Read',args:{path:'fixture.txt'}}}],
    {usageMetadata:{promptTokenCount:11,candidatesTokenCount:2,totalTokenCount:13,cachedContentTokenCount:1}}),
  q('tool_result','result','answer',[{functionResponse:{id:'tool',response:{output:'needle result'}}}]),
  q('system','comp','result',[],{subtype:'chat_compression'})
]);
save('qwen','qwen',[qwen]);
const deep = path.join(root,'deepseek');
const deepRow = (type,data,extra={}) => ({type,data,time:fixed,...extra});
const deepRows = [
  {type:'session',id}, deepRow('user/message',{id:'user',content:'needle from DeepSeek'}),
  deepRow('user/message',{id:'injection',source:{kind:'system'},content:'implicit context'}),
  deepRow('assistant/message',{message:{id:'assistant',content:[{type:'reasoning',text:'thought'},{type:'text',text:'needle reply'},
    {type:'tool-call',id:'edit',name:'write',arguments:{file_path:'src/fixture.js',content:'needle'}}]},usage:{input_tokens:3,output_tokens:2,total_tokens:5}}),
  deepRow('assistant/message',{message:{id:'assistant',content:'duplicate'}}),
  deepRow('assistant/message',{message:{id:'replacement',content:'not visible'}},{surfaceOp:{op:'replace'}}),
  deepRow('tool/result',{message:{id:'tool',toolCallId:'edit',content:[{type:'text',text:'needle result'}],isError:true}}),
  deepRow('session/end-seed',{inherited:true}),
  deepRow('assistant/attempt',{stream:[{type:'chunk',chunk:{type:'usage',usage:{input_tokens:4,output_tokens:1,total_tokens:5}}}]})
];
writeLog(path.join(deep,id,'session.jsonl'),[deepRow('user/message',{id:'stale',content:'do not read old generation'})]);
writeLog(path.join(deep,id,'session.v2.jsonl.zstd'),deepRows,true);
save('deepseek-compressed','deepseek',[deep]);
const deepPlain = path.join(root,'deepseek-plain');
writeLog(path.join(deepPlain,'renamed','session.jsonl'),deepRows);
save('deepseek-header','deepseek',[deepPlain]);
const kimi = path.join(root,'kimi');
const k = (type,payload) => ({timestamp:ms/1000,message:{type,payload}});
writeLog(path.join(kimi,'workspace',id,'agents','main','wire.jsonl'),[
  k('TurnBegin',{user_input:'Kimi needle'}),
  k('ContentPart',{type:'think',think:'thought'}), k('ContentPart',{type:'text',text:'answer'}),
  k('ToolCall',{id:'edit',function:{name:'Edit',arguments:'{"file_pa'}}),
  k('ToolCallPart',{arguments_part:'th":"src/fixture.js","old_string":"a",'}),
  k('ToolCallPart',{arguments_part:'"new_string":"needle"}'}),
  k('ToolResult',{tool_call_id:'edit',return_value:{output:'needle result',is_error:false}}),
  k('SubagentEvent',{agent_id:'child',event:{type:'ContentPart',payload:{type:'text',text:'child needle'}}}),
  k('Notification',{content:'note'}), k('StatusUpdate',{message_id:'token',token_usage:{input_other:3,output:2,input_cache_read:1}}),
  k('ToolCall',{id:'pending',function:{name:'Read',arguments:'{"path":"file.txt"}'}})
]);
writeLog(path.join(kimi,'workspace',id,'agents','minor','wire.jsonl'),[k('TurnBegin',{user_input:'Wrong branch'})]);
save('kimi','kimi',[kimi]);
const agy = path.join(root,'antigravity','brain'), artifact = path.join(agy,id,'.system_generated','logs');
const a = (step_index,type,content,extra={}) => ({step_index,type,content,created_at:fixed,...extra});
writeLog(path.join(artifact,'transcript.jsonl'),[a(1,'USER_INPUT','do not include older file')]);
writeLog(path.join(artifact,'transcript_full.jsonl'),[
  a(1,'USER_INPUT','context <USER_REQUEST>needle request</USER_REQUEST>'),
  a(4,'RUN_COMMAND','stale message'),
  a(2,'PLANNER_RESPONSE','answer',{thinking:'thought',input_tokens:5,output_tokens:2,tool_calls:[
    {name:'write_to_file',args:{TargetFile:'E:/Synthetic/fixture.txt',CodeContent:'needle created'}},
    {name:'run_command',args:{CommandLine:'echo synthetic'}},{name:'not_finished',args:{Query:'needle'}}
  ]}),
  a(3,'CODE_ACTION','Created file file:///E:/Synthetic/fixture.txt with requested content.'),
  a(4,'RUN_COMMAND','The command failed with exit code: 1'),
  a(5,'SOME_TYPE','')
]);
save('antigravity','antigravity',[agy]);
async function run() {
  const cases = [];
  for (const entry of storage) {
    const {agent,id,roots} = entry;
    const preview = await transcript.transcript(agent,id,roots);
    const findRequest = {stamp:preview.stamp,query:'needle'};
    const facts = await transcript.facts(agent,id,roots);
    const find = await transcript.find(agent,id,roots,findRequest);
    const stamp = await transcript.stampNow(agent,id,roots);
    const mdRequest = {stamp:preview.stamp,from:0,to:preview.items.length-1};
    const markdown = await transcript.markdown(agent,id,roots,mdRequest);
    const parts = [];
    for (const [index,item] of preview.items.entries()) {
      for (const field of item.kind === 'tool' ? [...(item.tool.output !== null ? ['output'] : []), ...(item.tool.change ? ['diff'] : [])] : item.kind === 'image' ? ['image'] : ['text']) {
        const request = {index,field,stamp:preview.stamp};
        parts.push({request,value:await transcript.part(agent,id,roots,request)});
      }
    }
    const entries = [{agent,id,key:'a'.repeat(64),cwd:'E:/Synthetic/project'}];
    const sweeps = [{ query: 'needle', value: await transcript.search(entries, () => roots, 'needle') }];
    if (agent === 'gemini') {
      sweeps.push({ query: '**先做**', value: await transcript.search(entries, () => roots, '**先做**') });
    }
    cases.push({ ...entry, preview,facts,find,stamp,markdown,parts,sweeps });
  }
  process.stdout.write(JSON.stringify(cases));
}
run().catch(error => { console.error(error); process.exitCode = 1; });
