'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {Service}=require('../../src/m1/service');
const {remove}=require('../../tests/m1/temp');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-jsonl-stress-')),input=path.join(root,'input'),usage=path.join(root,'usage');
 fs.mkdirSync(input); const file=path.join(input,'calls.jsonl'), rows=20000;
 const fd=fs.openSync(file,'w');
 try{for(let i=0;i<rows;i++)fs.writeSync(fd,JSON.stringify({schemaVersion:'AgentUsageEventV1',mode:'per-request',id:'call-'+i,timestamp:'2026-10-17T00:00:00Z',model:'fixture-model',inputTokens:100,outputTokens:20,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0})+'\n');}finally{fs.closeSync(fd);}
 const service=new Service(usage,{},()=>{}, {home:path.join(root,'home')});
 try{
  service.store.setEnabled(false);const draft=service.custom.draft();service.custom.choose(draft.token,[input]);
  const start=performance.now(),preview=await service.custom.preview(draft.token,{schemaVersion:'CustomSourceV1',name:'合成压力来源',template:'standard',mode:'per-request'});
  assert.equal(preview.summary.records,rows);assert.equal(preview.summary.totalTokens,rows*120);
  await service.custom.apply(preview.id);
  // The first refresh also initializes the ten built-in source statuses.
  await service.refresh();
  const saved=fs.readFileSync(path.join(usage,'statistics.json')),sequence=service.store.state.sequence;
  for(let i=0;i<3;i++){await service.refresh();assert.equal(service.store.state.sequence,sequence);assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),saved);}
  const audit=service.get().audit;assert.equal(audit.networkAttempts,0);assert.equal(audit.sourceWrites,0);assert.equal(audit.authenticationReads,0);
  const newDraft=service.custom.draft(draft.id),pending=service.custom.preview(newDraft.token,{schemaVersion:'CustomSourceV1',name:'取消预览',template:'standard',mode:'per-request'});
  const canceled=assert.rejects(pending);await service.close();await canceled;assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),saved);
  assert(fs.existsSync(file));
  const result={rows,totalTokens:rows*120,elapsedMs:performance.now()-start,unchangedRefreshes:3,noLedgerRewrite:true,cancelPreservesLedger:true,audit,realSources:false};
  const output=process.env.CUSTOM_STRESS_EVIDENCE || 'artifacts/custom-jsonl/stress.json';fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log('PASS: custom JSONL bounded scan, cancellation and unchanged refreshes; '+rows+' synthetic rows.');
 }finally{await service.close();await remove(root);}
})().catch(error=>{console.error(error);process.exitCode=1;});
