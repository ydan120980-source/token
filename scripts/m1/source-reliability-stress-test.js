'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {Service}=require('../../src/m1/service'),{Store}=require('../../src/m1/store'),{remove}=require('../../tests/m1/temp');
const format=require('../../tests/m1/public-agent-formats')[0];
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'source-reliability-')),home=path.join(dir,'home'),input=path.join(dir,'input'),usage=path.join(dir,'usage');fs.mkdirSync(home);fs.mkdirSync(input);
  let service=new Service(usage,{},()=>{}, {home,appData:null,localAppData:null});const file=path.join(input,'calls.jsonl'),line=r=>JSON.stringify(r)+'\n';const start=performance.now(),memoryStart=process.memoryUsage().heapUsed;
  try{
    service.store.setEnabled(false);fs.writeFileSync(file,line(format.record));let draft=service.custom.draft();service.custom.choose(draft.token,[input]);let preview=await service.custom.preview(draft.token,format.definition);await service.custom.apply(preview.id);await service.refresh();
    let saved=fs.readFileSync(path.join(usage,'statistics.json')),sequence=service.store.state.sequence;
    for(let i=0;i<60;i++){await service.refresh();assert.equal(service.store.state.sequence,sequence);assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),saved);assert.equal(service.store.workbench({period:'total'}).total.totalTokens,127);}
    fs.appendFileSync(file,'{"unfinished":');await service.refresh();assert.equal(service.store.records().length,1);assert.equal(service.store.records()[0].totalTokens,127);
    fs.writeFileSync(file,line(format.record)+line({...format.record,id:'next-call'}));await service.refresh();assert.equal(service.store.records().length,2);
    saved=fs.readFileSync(path.join(usage,'statistics.json'));sequence=service.store.state.sequence;fs.appendFileSync(file,line({...format.record,id:'after-failure'}));
    const rename=fs.renameSync;fs.renameSync=(from,to)=>{if(to===path.join(usage,'statistics.json'))throw Object.assign(new Error('INJECTED_SAVE'),{code:'EACCES'});return rename(from,to);};
    try{await service.refresh();}finally{fs.renameSync=rename;}
    assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),saved);assert.equal(service.store.state.sequence,sequence);assert.equal(service.store.records().length,2);
    await service.refresh();assert.equal(service.store.records().length,3);assert.equal(service.store.records().reduce((n,r)=>n+r.totalTokens,0),381);await service.close();assert.equal(new Store(usage,{}).records().length,3);
    service=new Service(usage,{},()=>{}, {home,appData:null,localAppData:null});await service.refresh();assert.equal(service.store.records().length,3);draft=service.custom.draft(Object.keys(service.store.state.customSources)[0]);preview=service.custom.preview(draft.token,format.definition);const canceled=assert.rejects(preview);await service.close();await canceled;assert.equal(new Store(usage,{}).records().length,3);
    const result={unchangedRefreshes:60,appendAndTailRecovery:true,failedWritePreservesMemoryAndDisk:true,restartNoDuplicates:true,cancelPreservesHistory:true,elapsedMs:performance.now()-start,heapGrowthBytes:process.memoryUsage().heapUsed-memoryStart,realSources:false};
    const output=process.env.RELIABILITY_EVIDENCE||'artifacts/source-reliability-20261018/stability.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log('PASS: 60 unchanged refreshes, tail recovery, injected save failure, restart and cancellation.');
  }finally{await service.close();await remove(dir);}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
