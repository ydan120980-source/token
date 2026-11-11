'use strict';
// Synthetic only. Each size is measured in a fresh process; timings are evidence,
// not CI performance thresholds. The fixture never contains source/credential data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {spawnSync}=require('node:child_process');
const moduleRoot=process.env.QUERY_BENCHMARK_MODULE_ROOT||path.resolve(__dirname,'../..');
const {Store,atomic}=require(path.join(moduleRoot,'src/m1/store'));
const saved=require(path.join(moduleRoot,'src/m1/read-snapshot')),readSavedModel=saved.readSavedModel||saved.readSavedStore;
const {query}=require(path.join(moduleRoot,'src/m1/usage-query'));
const {remove}=require('../../tests/m1/temp');
function measure(file,count){
  const {disableNetwork}=require(path.join(moduleRoot,'src/m1/policy')),audit={networkAttempts:0};disableNetwork(audit);
  global.gc?.();const start=performance.now(),model=readSavedModel(file),readMs=performance.now()-start;
  const projectStart=performance.now();const snapshot=model.snapshot(),projectionMs=performance.now()-projectStart;
  const times=[];let result;
  for(let i=0;i<3;i++){const began=performance.now();result=query(file,{groupBy:['model']});times.push(performance.now()-began);}
  assert.equal(result.total.totalTokens,count*120);assert.equal(result.total.records,count);assert(Math.abs(result.total.estimatedCostUsd-count*.0003)<1e-7);assert.equal(audit.networkAttempts,0);
  const ms=value=>Math.round(value*10)/10;
  return {records:count,bytes:fs.statSync(file).size,dailyRows:snapshot.daily.length,hourlyRows:snapshot.hourly.length,readMs:ms(readMs),projectionMs:ms(projectionMs),queryMs:times.map(ms),queryMedianMs:ms([...times].sort((a,b)=>a-b)[1]),heapUsedMiB:ms(process.memoryUsage().heapUsed/1048576),peakRssMiB:ms(process.resourceUsage().maxRSS/1024),networkAttempts:audit.networkAttempts};
}
async function main(){
 if(process.argv[2]==='--measure'){console.log(JSON.stringify(measure(process.argv[3],Number(process.argv[4]))));return;}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'query-benchmark-'));
 try{
  const results=[];
  for(const count of [10000,50000,100000]){
   const dir=path.join(root,String(count)),store=new Store(dir,{});
   for(let i=0;i<20;i++)store.setPrice({provider:'synthetic',model:'model-'+i,inputUncached:2,output:8,cacheRead:.5,cacheWrite:0});
   for(let i=0;i<count;i++)store.state.records['r'+i]={id:'r'+i,sessionKey:'s'+Math.floor(i/3),agent:i%2?'claude':'codex',entry:'cli',provider:'synthetic',model:'model-'+i%20,timestamp:new Date(Date.UTC(2026,0,1+i%200,i%24)).toISOString(),inputUncached:60,output:20,cacheRead:40,cacheWrite:0,reasoning:5,totalTokens:120,quality:'measured'};
   store.state.sequence=1;const file=path.join(dir,'statistics.json');atomic(file,store.state);const before=fs.readFileSync(file);
   const child=spawnSync(process.execPath,['--expose-gc',__filename,'--measure',file,String(count)],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:1024*1024});assert.equal(child.status,0,child.stderr);assert.deepEqual(fs.readFileSync(file),before);results.push(JSON.parse(child.stdout));
  }
  const output=process.env.QUERY_BENCHMARK_OUTPUT||'artifacts/backend-consistency-20261019/benchmark.json';fs.mkdirSync(path.dirname(output),{recursive:true});const result={syntheticOnly:true,implementation:process.env.QUERY_BENCHMARK_LABEL||'working-tree',runtime:process.version,measuredAt:new Date().toISOString(),results,ledgerUnchanged:true};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await remove(root);}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
