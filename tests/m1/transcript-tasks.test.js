'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TranscriptTasks}=require('../../src/m1/transcript-tasks'),direct=require('../../src/m1/transcript');
test('request-local reader workers preserve previews, full parts, changed-file errors and one-parser ownership without source writes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-tasks-')),file=path.join(root,'own-session.jsonl'),tasks=new TranscriptTasks();
 const data=JSON.stringify({type:'session_meta',payload:{id:'own-session'}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{text:'own question'}]}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{text:'中文字🙂'.repeat(60000)+'TAIL'}]}})+'\n';fs.writeFileSync(file,data);
 try{
  const [preview,facts]=await Promise.all([tasks.run('transcript',['codex','own-session',[root]]),tasks.run('facts',['codex','own-session',[root]])]);assert.deepEqual(preview,await direct.transcript('codex','own-session',[root]));assert.equal(facts.turns,1);
  const request={stamp:preview.stamp,index:1,field:'text',offset:0};assert.deepEqual(await tasks.run('part',['codex','own-session',[root],request]),await direct.part('codex','own-session',[root],request));assert.equal(fs.readFileSync(file,'utf8'),data);
  fs.appendFileSync(file,'\n');await assert.rejects(tasks.run('part',['codex','own-session',[root],request]),/TRANSCRIPT_CHANGED/);await assert.rejects(tasks.run('constructor',[]),/TRANSCRIPT_PART_INVALID/);
  assert.deepEqual(tasks.metrics(),{started:4,completed:3,failed:1,maxActive:1,workers:1,reused:3,released:0,active:0,pending:0,warm:true,record:'codex/own-session',ending:0});
 }finally{await tasks.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('closing reader work cancels the active request and queued reads before reporting shutdown',async()=>{
 const tasks=new TranscriptTasks(),first=tasks.run('transcript',['codex','missing',[]]),second=tasks.run('facts',['codex','missing',[]]);const all=Promise.allSettled([first,second]);await tasks.close();assert((await all).every(x=>x.status==='rejected'));assert.equal(tasks.metrics().active,0);assert.equal(tasks.metrics().pending,0);assert.equal(tasks.metrics().warm,false);await assert.rejects(tasks.run('facts',[]),/TRANSCRIPT_UNREADABLE/);
});
test('an idle parser is ended instead of holding its heap, and the next request starts a new one',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-idle-')),file=path.join(root,'own-session.jsonl'),tasks=new TranscriptTasks({idleMs:120});
 fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:'own-session'}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{text:'hello'}]}})+'\n');
 try{
  const first=await tasks.run('transcript',['codex','own-session',[root]]);assert.equal(tasks.metrics().warm,true);
  await new Promise(resolve=>setTimeout(resolve,400));
  assert.equal(tasks.metrics().warm,false);
  const second=await tasks.run('transcript',['codex','own-session',[root]]);assert.deepEqual(second,first);assert.equal(tasks.metrics().workers,2);assert.equal(tasks.metrics().reused,0);
 }finally{await tasks.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('another conversation ends the parser first, so two parse states are never held at once',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-record-')),tasks=new TranscriptTasks({idleMs:60000});
 const line=(id,text)=>JSON.stringify({type:'session_meta',payload:{id}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{text}]}})+'\n';
 fs.writeFileSync(path.join(root,'one.jsonl'),line('one','first record'));fs.writeFileSync(path.join(root,'two.jsonl'),line('two','second record'));
 try{
  await tasks.run('transcript',['codex','one',[root]]);
  assert.equal(tasks.metrics().record,'codex/one');
  await tasks.run('transcript',['codex','one',[root]]);assert.equal(tasks.metrics().reused,1);
  await tasks.run('transcript',['codex','two',[root]]);
  const metrics=tasks.metrics();
  assert.equal(metrics.workers,2,'the second record starts its own parser');assert.equal(metrics.reused,1,'the first record was the only reuse');assert.equal(metrics.released,1);assert.equal(metrics.record,'codex/two');
 }finally{await tasks.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('a parser that reports a heap over the budget is ended instead of kept warm',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-budget-')),tasks=new TranscriptTasks({idleMs:60000,heapBudget:1});
 fs.writeFileSync(path.join(root,'own-session.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'own-session'}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{text:'hello'}]}})+'\n');
 try{
  const first=await tasks.run('transcript',['codex','own-session',[root]]);
  assert.equal(tasks.metrics().released,1,'any reported heap is over a one-byte budget');
  const second=await tasks.run('transcript',['codex','own-session',[root]]);
  assert.deepEqual(second,first);
  assert.equal(tasks.metrics().workers,2);assert.equal(tasks.metrics().reused,0);
 }finally{await tasks.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('a timed-out request ends its parser, and the next request is answered by a fresh one',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-timeout-')),tasks=new TranscriptTasks({idleMs:60000,requestMs:1});
 fs.writeFileSync(path.join(root,'own-session.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'own-session'}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{text:'hello after a timeout'}]}})+'\n');
 try{
  // The one-millisecond budget cannot be met by any worker, so this request is guaranteed to time
  // out before its answer is posted back.
  await assert.rejects(tasks.run('transcript',['codex','own-session',[root]]),/TRANSCRIPT_UNREADABLE/);
  assert.equal(tasks.metrics().warm,false,'the timed-out parser is not left in the reusable slot');
  assert.equal(tasks.metrics().released,1);
  // The next request must not be posted to the worker that is being terminated: it starts its own.
  tasks.requestMs=90000;
  const value=await tasks.run('transcript',['codex','own-session',[root]]);
  assert.deepEqual(value,await direct.transcript('codex','own-session',[root]));
  const metrics=tasks.metrics();
  assert.equal(metrics.workers,2,'the request after a timeout starts its own parser');
  assert.equal(metrics.reused,0);
  assert.equal(metrics.failed,1);assert.equal(metrics.completed,1);
  assert.equal(metrics.ending,0,'the terminated parser is accounted for by the time the next answer lands');
 }finally{await tasks.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('closing while a parser is being retired waits for that termination too',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-close-racing-')),tasks=new TranscriptTasks({idleMs:60000});
 const line=(id,text)=>JSON.stringify({type:'session_meta',payload:{id}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{text}]}})+'\n';
 fs.writeFileSync(path.join(root,'one.jsonl'),line('one','first record'));fs.writeFileSync(path.join(root,'two.jsonl'),line('two','second record'));
 try{
  await tasks.run('transcript',['codex','one',[root]]);
  // Reading a second record retires the first parser; closing right away must still wait for it.
  const second=tasks.run('transcript',['codex','two',[root]]);
  await tasks.close();
  await assert.rejects(second,/TRANSCRIPT_UNREADABLE/);
  assert.equal(tasks.metrics().ending,0,'no worker is left terminating after close reports');
  assert.equal(tasks.metrics().warm,false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a sweep neither inherits a warm parser nor leaves one behind',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-sweep-')),tasks=new TranscriptTasks({idleMs:60000});
 const line=(id,text)=>JSON.stringify({type:'session_meta',payload:{id}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'assistant',content:[{text}]}})+'\n';
 const one='11111111-2222-4333-8444-000000000001',two='11111111-2222-4333-8444-000000000002';
 fs.writeFileSync(path.join(root,'rollout-2026-11-02T00-00-00-'+one+'.jsonl'),line(one,'the first record mentions a shared phrase'));
 fs.writeFileSync(path.join(root,'rollout-2026-11-02T00-00-00-'+two+'.jsonl'),line(two,'the second record mentions a shared phrase'));
 const entries=[{key:'a'.repeat(64),agent:'codex',id:one},{key:'b'.repeat(64),agent:'codex',id:two}];
 try{
  await tasks.run('transcript',['codex',one,[root]]);
  assert.equal(tasks.metrics().warm,true);
  const sweep=await tasks.run('search',[entries,{codex:[root]},'shared phrase']);
  assert.equal(sweep.results.length,2);
  assert.equal(tasks.metrics().workers,2,'the sweep starts from an empty parser');
  assert.equal(tasks.metrics().warm,false,'nothing read by a sweep is kept warm');
  assert.equal(tasks.metrics().record,null);
  await tasks.run('transcript',['codex',two,[root]]);
  const metrics=tasks.metrics();
  assert.equal(metrics.workers,3,'the request after a sweep starts its own parser');
  assert.equal(metrics.reused,0);
 }finally{await tasks.close();fs.rmSync(root,{recursive:true,force:true});}
});
