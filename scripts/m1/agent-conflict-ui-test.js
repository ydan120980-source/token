'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {_electron:electron}=require('playwright');
const {Store}=require('../../src/m1/store'),{roots}=require('../../src/m1/policy'),{scanSources}=require('../../src/m1/sources'),{verifyProjection}=require('../../src/m1/native');
const {settle,showView}=require('./ui-settle');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'r3-conflict-ui-')),output=path.resolve(process.env.CONFLICT_EVIDENCE_DIR||'artifacts/m2-agents-r3/conflict-ui');fs.mkdirSync(output,{recursive:true});
 try{
  const home=path.join(temp,'home'),selected=roots(home),usage=path.join(temp,'usage'),store=new Store(usage,selected),time='2026-10-06T00:00:00Z';
  const files=[path.join(selected.claude[0],'a.jsonl'),path.join(selected.claude[1],'b.jsonl')];
  files.forEach((file,i)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({type:'assistant',timestamp:time,sessionId:'s',message:{id:'same',model:'claude-sonnet-4-20250514',usage:{input_tokens:i?90:100,output_tokens:i?30:20,cache_read_input_tokens:0,cache_creation_input_tokens:0}}})+'\n');});
  const hashes=()=>files.map(file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')),before=hashes(),scan=await scanSources(selected,store.state.salt,{reads:0});
  const native=await verifyProjection(scan.claude.records,path.join(temp,'native'));assert.equal(native.status,'passed');assert.equal(native.tokens,120);
  store.setPrice({provider:'anthropic',model:'claude-sonnet-4-20250514',inputUncached:1,output:2,cacheRead:0,cacheWrite:0});store.ingest(scan,native);store.setEnabled(false);store.setBilling({autoSync:false,defaults:{},mappings:{}});
  const results=[];
  for(const scale of [1,1.5]){
   const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',path.join(temp,'quota-'+scale),'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
   try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await showView(page,'usage');await page.locator('#agentPicker').getByRole('button',{name:'Claude Code',exact:true}).click();await settle(page);
    const state=await page.evaluate(()=>window.usageBridge.get()),row=state.snapshot.daily[0];assert.equal(row.totalTokens,120);assert.equal(row.estimatedCostUsd,null);assert.equal(row.inputUncached,null);assert.deepEqual(row.knownUsage,{});assert.equal(await page.locator('#totalCost .cost-value').getAttribute('data-cost-lower'),'');assert((await page.locator('#totalCost .cost-value').getAttribute('aria-label')).includes('未定价'));
    await page.locator('#totalCost').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'usage-'+scale+'.png')});await page.locator('[data-view="sources"]').click();const issue=page.getByText('本次扫描发现计量分类冲突；仍有冲突的记录暂停精确定价',{exact:false}).first();await issue.waitFor();await issue.scrollIntoViewIfNeeded();const bounds=await issue.boundingBox();assert(bounds && bounds.y>=0 && bounds.y<await page.evaluate(()=>window.innerHeight));await page.screenshot({path:path.join(output,'sources-'+scale+'.png')});assert.deepEqual(errors,[]);assert.deepEqual(hashes(),before);
    results.push({scale,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),nativeTokens:native.tokens,visibleConflict:true,diagnosticInViewport:true,unpricedLower:true,unknownBuckets:true,sourceHashesUnchanged:true,errors});
   }finally{await app.close();}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
