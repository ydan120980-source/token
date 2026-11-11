'use strict';
const {parentPort}=require('node:worker_threads');
require('./policy').disableNetwork({networkAttempts:0});
const transcript=require('./transcript'),{requestError}=require('./statistics-errors');
const operations=new Set(['transcript','part','find','markdown','facts','search','fileHistory','toolUse']);
// One request at a time on the same parser, so a conversation read for the first item is still
// there for the next part or find. The host ends this worker after its idle window, when the record
// changes, or when the heap it reports passes the host's budget.
parentPort.on('message',async message=>{
 const {id,operation,args}=message||{};
 try{
  if(!operations.has(operation)||!Array.isArray(args))throw Error('TRANSCRIPT_PART_INVALID');
  const value=operation==='search'||operation==='fileHistory'||operation==='toolUse'?await transcript[operation](args[0],agent=>args[1][agent]||[],args[2]):await transcript[operation](...args);
  parentPort.postMessage({id,value,heap:process.memoryUsage().heapUsed});
 }catch(error){parentPort.postMessage({id,error:requestError(error),heap:process.memoryUsage().heapUsed});}
});
