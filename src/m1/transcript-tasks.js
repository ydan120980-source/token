'use strict';
// One parser worker at a time, reused for the rest of one conversation and then ended.
// Reuse is bounded three ways, because a worker thread's parse heap lives in the process that
// started it: a request for a different record ends the worker first, a sweep (search, file
// history) neither inherits nor leaves a warm one, and a worker that reports a heap over
// HEAP_BUDGET after answering is ended rather than kept. An idle window ends it too.
// A worker is only taken out of service once its termination has completed: a terminated worker
// still answers nothing, and posting the next request to it would fail that request too.
// No ledger, transcript cache, persistent index or source writes: the worker only ever holds the
// record it is parsing, and its termination releases that heap.
const {Worker}=require('node:worker_threads');
const OPERATIONS=new Set(['transcript','part','find','markdown','facts','search','fileHistory','toolUse']);
const IDLE_MS=15000;
// A worker is kept only while its own parse heap is small enough that holding it is cheaper than
// starting another. A long conversation parses to tens of MiB and is dropped at once instead of
// being laid under the next request; a short one stays warm across its own part and find.
const HEAP_BUDGET=32*1024*1024;
const REQUEST_MS=90000;
// The record a request reads, so a read of another conversation does not reuse the parse state of
// the one before it. Search, file history and tool use sweep many records and are never a reuse target.
function recordOf(operation,args){
 if(operation==='search'||operation==='fileHistory'||operation==='toolUse')return null;
 const [agent,id]=Array.isArray(args)?args:[];
 return typeof agent==='string'&&typeof id==='string'?agent+'/'+id:null;
}
class TranscriptTasks{
 constructor({idleMs=IDLE_MS,heapBudget=HEAP_BUDGET,requestMs=REQUEST_MS}={}){this.queue=[];this.active=null;this.worker=null;this.closed=false;this.idleMs=idleMs;this.heapBudget=heapBudget;this.requestMs=requestMs;this.record=null;this.serial=0;this.idle=null;this.ending=new Set();this.counts={started:0,completed:0,failed:0,maxActive:0,workers:0,reused:0,released:0};}
 metrics(){return {...this.counts,active:this.active?1:0,pending:this.queue.length,warm:Boolean(this.worker),record:this.record,ending:this.ending.size};}
 // A worker is made for the first request and kept for the rest of that record; the idle timer,
 // the record change and the heap budget each end it.
 parser(){
  if(this.worker)return this.worker;
  const worker=new Worker(require.resolve('./transcript-task-worker'),{stdout:true,stderr:true});
  worker.stdout.resume();worker.stderr.resume();
  worker.once('exit',()=>{if(this.worker===worker)this.worker=null;});
  this.counts.workers++;
  this.worker=worker;
  return worker;
 }
 // End the current worker and release its heap. The worker leaves the reusable slot immediately so
 // nothing is posted to it again, and its termination is tracked so shutdown can wait for it.
 retire(reason,worker=this.worker){
  if(!worker)return Promise.resolve();
  this.worker=null;this.record=null;this.counts.released++;
  this.lastRelease=reason;
  let ending;try{ending=Promise.resolve(worker.terminate());}catch{ending=Promise.resolve();}
  const tracked=ending.catch(()=>{}).then(()=>{this.ending.delete(tracked);});
  this.ending.add(tracked);
  return tracked;
 }
 run(operation,args){
  if(!OPERATIONS.has(operation)||!Array.isArray(args))return Promise.reject(Error('TRANSCRIPT_PART_INVALID'));
  if(this.closed)return Promise.reject(Error('TRANSCRIPT_UNREADABLE'));
  return new Promise((resolve,reject)=>{this.queue.push({operation,args,resolve,reject});this.next();});
 }
 next(){
  if(this.active||this.closed)return;
  const item=this.queue.shift();if(!item)return this.rest();
  clearTimeout(this.idle);this.idle=null;
  const record=recordOf(item.operation,item.args);
  // A different conversation: the previous record's parse state is not reused. A sweep (search, file
  // history) reads many records one after another, so it starts from an empty worker and never lays
  // its own heap on top of a conversation that is already parsed.
  let retiring=null;
  if(this.worker&&record===null)retiring=this.retire('sweep');
  else if(this.worker&&this.record!==null&&record!==null&&record!==this.record)retiring=this.retire('record');
  let worker;try{const warm=Boolean(this.worker);worker=this.parser();if(warm)this.counts.reused++;}catch{item.reject(Error('TRANSCRIPT_UNREADABLE'));this.counts.failed++;this.next();return;}
  if(record!==null)this.record=record;
  this.counts.started++;this.counts.maxActive=1;
  const id=++this.serial;
  let finished=false,resolveDone;const done=new Promise(resolve=>{resolveDone=resolve;});
  const detach=()=>{worker.off('message',onMessage);worker.off('error',onError);worker.off('exit',onExit);clearTimeout(timer);};
  const settle=async(error,value,heap,broken=false)=>{
   if(finished)return;finished=true;
   detach();
   this.active=null;
   // Whatever a sweep read is not kept warm: its heap is the largest a parser ever holds, and the
   // next request is usually a conversation the person opened, which wants a clean one.
   if(!error&&record===null&&this.worker===worker)await this.retire('sweep',worker);
   // A worker over its budget after answering is ended now rather than kept for the next request.
   else if(!error&&Number.isFinite(heap)&&heap>this.heapBudget&&this.worker===worker)await this.retire('heap',worker);
   // A request that timed out, crashed or could not be posted leaves a thread that must not answer
   // the next one. It leaves the reusable slot first, and the queue only advances once its
   // termination has completed, so no later request is ever posted to a worker that is going away.
   // A worker that answered with an error of its own is still healthy and is kept.
   else if(broken&&this.worker===worker)await this.retire('failed',worker);
   if(error){this.counts.failed++;item.reject(error);}else{this.counts.completed++;item.resolve(value);}resolveDone();this.next();
  };
  const onMessage=message=>{if(message&&message.id!==id)return;if(message?.error)void settle(Error(message.error),null,message.heap);else if(message&&Object.hasOwn(message,'value'))void settle(null,message.value,message.heap);else void settle(Error('TRANSCRIPT_UNREADABLE'),null,undefined,true);};
  const onError=()=>void settle(Error('TRANSCRIPT_UNREADABLE'),null,undefined,true);
  // A worker that dies takes its request with it; the next request starts a new one.
  const onExit=()=>void settle(Error('TRANSCRIPT_UNREADABLE'),null,undefined,true);
  const timer=setTimeout(()=>{void settle(Error('TRANSCRIPT_UNREADABLE'),null,undefined,true);},this.requestMs);
  this.active={done,cancel:()=>{void settle(Error('TRANSCRIPT_UNREADABLE'),null,undefined,true);}};
  worker.on('message',onMessage);worker.once('error',onError);worker.once('exit',onExit);
  try{worker.postMessage({id,operation:item.operation,args:item.args});}
  catch{void settle(Error('TRANSCRIPT_UNREADABLE'),null,undefined,true);}
  // A worker that is being retired has already left the reusable slot, so the request just posted
  // went to the live one; its termination is waited for by close(), not by the queue.
  if(retiring)void retiring;
 }
 // Nothing queued: end the parser after its idle window instead of holding a heap forever.
 rest(){
  if(!this.worker)return;
  clearTimeout(this.idle);
  this.idle=setTimeout(()=>{void this.retire('idle');},this.idleMs);
  if(this.idle.unref)this.idle.unref();
 }
 async close(){
  this.closed=true;clearTimeout(this.idle);this.idle=null;
  for(const item of this.queue.splice(0))item.reject(Error('TRANSCRIPT_UNREADABLE'));
  const active=this.active;if(active){active.cancel();await active.done;}
  await this.retire('close');
  // Every worker this service ever ended, including the ones retired by a record change, a sweep,
  // the heap budget or a timeout, is waited for before shutdown reports success.
  while(this.ending.size)await Promise.all([...this.ending]);
 }
}
const owned=new TranscriptTasks();
module.exports={TranscriptTasks,run:(...args)=>owned.run(...args),metrics:()=>owned.metrics(),close:()=>owned.close()};
