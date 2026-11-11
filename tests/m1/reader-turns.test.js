'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../ui/src/pages/sessions/turns.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,reader={};vm.runInNewContext(code,{exports:reader});
const item=(kind,extra={})=>({kind,time:null,text:'synthetic',...extra}),plain=value=>JSON.parse(JSON.stringify(value));
test('turn boundaries preserve injected context, consecutive questions, sub-agents, compactions, failures and known zero',()=>{
 const items=[item('context'),item('assistant'),item('user',{usage:0}),item('user'),item('image',{from:'user'}),item('context'),item('compact'),item('assistant',{usage:10}),item('tool',{usage:2,tool:{name:'Read',error:true}}),item('assistant',{side:'child',usage:3}),item('user'),item('assistant',{usage:0})];
 const turns=reader.buildTurns(items);
 assert.deepEqual(plain(turns),[
  {index:0,number:0,compacts:[],question:[],process:[0],final:1,failures:[],steps:1,tools:0,failed:0,from:0,to:1,tokens:null},
  {index:1,number:1,compacts:[6],question:[2,3,4],process:[5,7,8,9],final:null,failures:[8],steps:3,tools:1,failed:1,from:2,to:9,tokens:15},
  {index:2,number:2,compacts:[],question:[10],process:[],final:11,failures:[],steps:0,tools:0,failed:0,from:10,to:11,tokens:0},
 ]);
 assert.equal(reader.turnWeight(items,turns[1]),80+60+4*'synthetic'.length);
 assert.equal(reader.turnWeight(items,turns[2]),80+2*'synthetic'.length);
 assert.deepEqual(plain(reader.buildTurns([])),[]);assert.equal(reader.buildTurns([item('user')])[0].to,0);
});
test('one supported 500000-item turn keeps its full span without exceeding the JavaScript argument limit',()=>{
 const items=Array.from({length:500000},(_,i)=>item(i===0?'user':i===499999?'assistant':'thinking',i===1?{usage:0}:{}));
 const turns=reader.buildTurns(items);assert.equal(turns.length,1);const turn=turns[0];
 assert.equal(turn.from,0);assert.equal(turn.to,499999);assert.equal(turn.final,499999);assert.equal(turn.process.length,499998);assert.equal(turn.steps,499998);assert.equal(turn.tokens,0);assert.equal(turn.tools,0);
 assert.equal(reader.turnWeight(items,turn),80+60+2*'synthetic'.length);
});
test('file expansion opens the same segments and tool/subagent runs across turns without quadratic rescans',()=>{
 const items=[item('user')];
 for(let i=0;i<600;i++){
  if(i===300)items.push(item('assistant'),item('user'));
  if(i%50===49)items.push(item('assistant'));
  items.push(item('tool',{...(i%20<5?{side:'synthetic-child'}:{}),tool:{name:i%20<10?'Read':'Edit',error:i===45}}));
 }
 const turns=reader.buildTurns(items),turnOf=new Int32Array(items.length);
 for(const turn of turns)turnOf.fill(turn.index,turn.from,turn.to+1);
 const indices=items.flatMap((item,index)=>item.kind==='tool'?[index]:[]);
 const expectedProcesses=new Set(),expectedRuns=new Set();
 for(const index of indices){const turn=turns[turnOf[index]],segment=reader.segmentOf(items,turn,index);if(segment)expectedProcesses.add(segment.key);const run=reader.processParts(items,turn).find(part=>part.kind!=='item'&&part.indices.includes(index));if(run)expectedRuns.add(run.key);}
 let reads=0;
 const counted=new Proxy(items,{get(target,key){if(typeof key==='string'&&/^\d+$/.test(key))reads++;return target[key];}});
 const result=reader.processExpansion(counted,turns,turnOf,indices);
 assert.deepEqual([...result.processes].sort((a,b)=>a-b),[...expectedProcesses].sort((a,b)=>a-b));
 assert.deepEqual([...result.runs].sort(),[...expectedRuns].sort());
 assert(reads<items.length*20,'each affected turn must be scanned a bounded number of times, not once per edit');
 assert.deepEqual(plain(reader.processExpansion(items,turns,turnOf,[])),{processes:[],runs:[]});
});
