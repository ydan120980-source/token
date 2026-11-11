'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {Store,atomic}=require('../../src/m1/store');
const {disableNetwork}=require('../../src/m1/policy');
const {remove}=require('../../tests/m1/temp');
(async()=>{
  const audit={networkAttempts:0};disableNetwork(audit);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-stress-'));
  try{
    const store=new Store(path.join(dir,'usage'),{}),now=new Date().toISOString(),key=value=>crypto.createHash('sha256').update(value).digest('hex');
    for(let i=0;i<20000;i++){
      const id=key('call'+i),sessionKey=i%23===0?null:key('session'+i),agent=i%2?'claude':'codex';
      store.state.records[id]={id,sessionKey,agent,entry:'cli',provider:'private',model:'fixture',timestamp:now,inputUncached:60,output:20,cacheRead:40,cacheWrite:0,reasoning:5,totalTokens:120,quality:'measured'};
      if(sessionKey)store.state.sessions[sessionKey]={agent,id:'synthetic-'+i,cwd:'C:\\synthetic\\project-'+i%500};
    }
    store.state.sequence=1;atomic(path.join(store.dir,'statistics.json'),store.state);const bytes=fs.readFileSync(path.join(store.dir,'statistics.json'));
    store.setPrice({provider:'private',model:'fixture',inputUncached:2,output:8,cacheRead:.5,cacheWrite:0});
    const start=performance.now(),view=store.workbench({period:'total'}),elapsedMs=performance.now()-start;
    assert.equal(view.projects.length,501);assert.equal(view.total.totalTokens,2400000);assert(Math.abs(view.total.lower-6)<1e-10);
    assert.equal(view.projects.reduce((n,p)=>n+p.totalTokens,0),2400000);assert(Math.abs(view.projects.reduce((n,p)=>n+p.lower,0)-6)<1e-10);
    for(let i=0;i<10;i++)assert.equal(store.workbench({period:'total'}),view);
    store.setPrice({provider:'private',model:'fixture',inputUncached:4,output:8,cacheRead:.5,cacheWrite:0});const repriced=store.workbench({period:'total'});assert(Math.abs(repriced.total.lower-8.4)<1e-10);
    assert.deepEqual(fs.readFileSync(path.join(store.dir,'statistics.json')),bytes);assert.equal(audit.networkAttempts,0);
    const result={syntheticOnly:true,records:20000,projectGroups:501,firstProjectionMs:Math.round(elapsedMs),repeatQueriesReuseProjection:true,repricedExpectedUsd:8.4,ledgerBytesUnchanged:true,networkAttempts:audit.networkAttempts};
    fs.mkdirSync('artifacts/workbench-insights-20261018',{recursive:true});fs.writeFileSync('artifacts/workbench-insights-20261018/stress.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await remove(dir);}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
