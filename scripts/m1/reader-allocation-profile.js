'use strict';
// Allocation sampling only, never a heap snapshot/forced collection. Diagnostic
// runs have profiler overhead and cannot be used for resident-memory acceptance.
const fs=require('node:fs'),path=require('node:path');
async function start(app,page,cdp,sourceRoot,out){
 await cdp.send('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
 const availability=await app.evaluate(async(_electron,root)=>{
  const require=process.getBuiltinModule('module').createRequire(root+'/package.json');
  const inspector=require('node:inspector'),session=new inspector.Session();session.connect();
  const post=(name,params)=>new Promise((resolve,reject)=>session.post(name,params,(error,result)=>error?reject(error):resolve(result)));
  await post('HeapProfiler.startSampling',{samplingInterval:32768,includeObjectsCollectedByMajorGC:true,includeObjectsCollectedByMinorGC:true});
  const prototype=require(require('node:path').join(root,'src/m1/statistics-service.js')).StatisticsService.prototype,original=prototype.diagnostics;
  const state=globalThis.readerAllocationDiagnostic={session,post,prototype,original,owner:null,starting:null,available:null};
  prototype.diagnostics=async function(...args){
   if(state.available===null){state.available=typeof this.worker?.startHeapProfile==='function';if(state.available)state.starting=this.worker.startHeapProfile().then(handle=>{state.owner=handle;});}
   if(state.starting)await state.starting;
   return original.apply(this,args);
  };
  return {main:true,owner:'checked on first diagnostic'};
 },sourceRoot);
 await page.evaluate(()=>window.usageBridge.statisticsDiagnostics());
 let stopped=false;
 return {availability,async stop(){
  if(stopped)return;stopped=true;
  const renderer=await cdp.send('HeapProfiler.stopSampling');fs.writeFileSync(path.join(out,'renderer-allocation.json'),JSON.stringify(renderer.profile));
  const result=await app.evaluate(async()=>{
   const state=globalThis.readerAllocationDiagnostic;if(!state)return null;state.prototype.diagnostics=state.original;
   try{return {main:(await state.post('HeapProfiler.stopSampling',{})).profile,owner:state.owner?await state.owner.stop():null,ownerAvailable:state.available};}
   finally{state.session.disconnect();delete globalThis.readerAllocationDiagnostic;}
  });
  fs.writeFileSync(path.join(out,'application-allocation.json'),JSON.stringify(result));
 }};
}
module.exports={start};
