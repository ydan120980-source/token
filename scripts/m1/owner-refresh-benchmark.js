'use strict';
// Real StatisticsService owner path, including native verification, commit and
// the packed response used by Electron. Synthetic sources only; no UI suite.
// OWNER_CHAIN=service preserves the earlier Service.refresh-only timing boundary.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const build=require('./collection-benchmark-fixture');
const baseline=process.argv[2],output=process.argv[3],runs=Number(process.env.OWNER_RUNS||3),files=Number(process.env.OWNER_FILES||2000);
const chain=process.env.OWNER_CHAIN||'owner';
if(!baseline||!output||!Number.isSafeInteger(runs)||runs<1||!Number.isSafeInteger(files)||files<2||!['owner','service'].includes(chain))throw Error('USAGE: baseline-service-module.js output.json');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'usage-owner-benchmark-'));
const targets=[['before',path.resolve(baseline)],['after',path.resolve(__dirname,'../../src/m1/'+(chain==='owner'?'statistics-service.js':'service.js'))]],report={syntheticOnly:true,valid:false,chain,files,runs,runtime:{...process.versions},samples:[]};
const semantic=records=>crypto.createHash('sha256').update(JSON.stringify(Object.values(records).map(r=>[r.agent,r.entry,r.provider,r.model,r.timestamp,r.totalTokens,r.inputUncached,r.output,r.cacheRead,r.cacheWrite,r.reasoning,r.quality,r.usageConflict??false]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
(async()=>{
 try{
  const fixture=build(root,files,20),original=fs.readFileSync(fixture.oneFile),places={home:path.join(root,'home'),appData:null,localAppData:null};
  report.expectedRows=fixture.usageRows;report.modules=targets;
  for(let round=0;round<runs;round++)for(const [target,module]of(round%2?targets.toReversed():targets)){
   fs.writeFileSync(fixture.oneFile,original);
   const usage=path.join(root,target+'-'+round),Constructor=require(module)[chain==='owner'?'StatisticsService':'Service'],started=performance.now();
   const owner=new Constructor(usage,fixture.roots,()=>{},places,...(chain==='owner'?[{offline:true}]:[]));
   try{
    await owner.ready;
    for(const load of ['full','incremental']){
     if(load==='incremental')fs.appendFileSync(fixture.oneFile,JSON.stringify({timestamp:'2026-11-04T00:00:00Z',type:'event_msg',payload:{type:'token_count',info:{model:'gpt-5-codex',total_token_usage:{input_tokens:9000,output_tokens:900},last_token_usage:{input_tokens:90,output_tokens:9,cached_input_tokens:0}}}})+'\n');
     const begin=load==='full'&&chain==='owner'?started:performance.now();let response=await owner.refresh();if(chain==='owner')response=await owner.getPacked();const ms=performance.now()-begin;
     const state=JSON.parse(fs.readFileSync(path.join(usage,'statistics.json'),'utf8')),records=Object.keys(state.records).length,tokens=Object.values(state.records).reduce((sum,r)=>sum+r.totalTokens,0);
     if(!records)report.failedState={error:response?.error,diagnostic:response?.diagnostic,meta:owner.facts?.()};
     assert.equal(records,fixture.usageRows+(load==='incremental'?1:0),'nonempty fixture and appended record must reach ledger');assert.equal(tokens,fixture.usageRows*120+(load==='incremental'?99:0));assert(chain==='owner'?response.snapshotRevision>0:response.snapshot.sequence>0);assert.equal(state.statuses.codex.nativeVerification,'passed');assert.equal(state.statuses.claude.nativeVerification,'passed');
     const row={round,target,load,ms,records,tokens,semanticHash:semantic(state.records),diagnostics:chain==='owner'?await owner.diagnostics():null};report.samples.push(row);console.log(JSON.stringify({round,target,load,ms,records,tokens}));
    }
   }finally{await owner.close();}
  }
  for(const load of ['full','incremental'])assert.equal(new Set(report.samples.filter(r=>r.load===load).map(r=>r.semanticHash)).size,1,'baseline/current saved observations must agree');
  const median=rows=>rows.map(r=>r.ms).toSorted((a,b)=>a-b)[Math.floor(rows.length/2)];report.medians=Object.fromEntries(['full','incremental'].map(load=>[load,Object.fromEntries(targets.map(([target])=>[target,median(report.samples.filter(r=>r.load===load&&r.target===target))]))]));report.valid=true;
 }catch(error){report.failure=error.message;throw error;}
 finally{fs.writeFileSync(path.resolve(output),JSON.stringify(report,null,2));fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
