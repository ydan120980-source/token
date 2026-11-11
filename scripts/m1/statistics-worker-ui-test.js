'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const usageUi=require('./usage-ui-helpers');
const {seed}=require('./performance-benchmark');
const {until,showView,keepVisible,isolatePointer,cleanup}=require('./ui-settle');
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'statistics-worker-ui-')),output=process.env.STATISTICS_EVIDENCE_DIR||'artifacts/statistics-worker-ui';fs.mkdirSync(output,{recursive:true});
  const {home,usage}=seed(root,20000),ledger=fs.readFileSync(path.join(usage,'statistics.json'));
  const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home],timeout:60000});
  try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await keepVisible(app);await isolatePointer(app);
    // M10's default home widgets do not request sessions. Warm the saved list through its
    // actual page before proving that navigating from home to usage reuses it without reads.
    await showView(page,'sessions');await until(page,()=>window.sessionsUi.loaded===true);await showView(page,'quota');
    const savedList=await page.evaluateHandle(()=>window.sessionsUi.list());
    await app.evaluate(({ipcMain})=>{const handler=ipcMain._invokeHandlers.get('usage:sessions');if(!handler)throw Error('SESSION_HANDLER_MISSING');globalThis.statisticsSessionReads=0;ipcMain._invokeHandlers.set('usage:sessions',(...args)=>{globalThis.statisticsSessionReads++;return handler(...args);});});
    await showView(page,'usage');
    await until(page,()=>window.usageData.ready());await usageUi.waitValue(page,'totalTokens','2,000,000');
    assert.equal(await app.evaluate(()=>globalThis.statisticsSessionReads),0,'usage must not reread the full session list');
    assert.equal(await savedList.evaluate(list=>window.sessionsUi.list()===list),true,'usage reuses the previously loaded session list');await savedList.dispose();
    const first=await page.evaluate(async()=>{const s=await window.usageBridge.get();return {revision:s.snapshotRevision,sequence:s.snapshot.sequence};});
    const guard=await app.evaluate(async({ipcMain})=>{try{await ipcMain._invokeHandlers.get('usage:getPacked')({sender:null,senderFrame:null});return false;}catch(e){return e.message==='IPC_SENDER_REJECTED';}});assert(guard);
    // Capture this synthetic app's existing facade, without a product fault hook.
    await app.evaluate(({BrowserWindow})=>{const m=Object.values(process.mainModule.require('node:module')._cache).find(m=>/[/\\]src[/\\]m1[/\\]statistics-service\.js$/.test(m.filename)),proto=m.exports.StatisticsService.prototype,original=proto.call;proto.call=function(...args){globalThis.statisticsFixture=this;return original.apply(this,args);};BrowserWindow.getAllWindows()[0].webContents.send('usage:update');});
    await page.evaluate(async()=>{const s=await window.usageBridge.get();return s.snapshotRevision;});
    assert(await app.evaluate(()=>globalThis.statisticsFixture.store===undefined&&globalThis.statisticsFixture.facts().records===undefined));
    const diagnostics=await page.evaluate(()=>window.usageBridge.statisticsDiagnostics());
    assert(diagnostics.owner.storage.stages.projection.count>0);
    assert(!/statistics\.json|salt|deviceId|sessionKey/.test(JSON.stringify(diagnostics)));
    await app.evaluate(async()=>{await globalThis.statisticsFixture.worker.terminate();});
    await until(page,async()=>{const s=await window.usageBridge.get();return s.snapshotRevision>1&&s.snapshot.daily.reduce((n,r)=>n+r.totalTokens,0)===2000000;});
    const restored=await page.evaluate(async()=>{const s=await window.usageBridge.get();return {revision:s.snapshotRevision,sequence:s.snapshot.sequence};});assert(restored.revision>first.revision);assert.equal(restored.sequence,first.sequence);
    await page.evaluate(()=>{window.statisticsReprice=window.usageBridge.reprice();});await showView(page,'cost');assert.equal(await page.locator('#cost').isVisible(),true);await page.evaluate(()=>window.statisticsReprice);await showView(page,'usage');
    await page.screenshot({path:path.join(output,'worker-recovered.png')});assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),ledger);assert.deepEqual(errors,[]);
    // A separate enabled phase may collect only the same synthetic fixture. A
    // replacement owner must resume its schedule without a renderer refresh.
    await page.evaluate(async()=>{await window.usageBridge.setEnabled(true);});
    await app.evaluate(async()=>{await globalThis.statisticsFixture.worker.terminate();});
    await until(page,async()=>{const s=await window.usageBridge.get();return s.enabled&&Boolean(s.checkedAt)&&!s.collecting&&!s.error;});
    await page.evaluate(()=>window.usageBridge.setRefreshInterval(0));
    const current=await page.evaluate(async()=>{const s=await window.usageBridge.get();return{revision:s.snapshotRevision,total:s.snapshot.daily.reduce((n,r)=>n+r.totalTokens,0)};});
    const quiet=await page.evaluate(revision=>window.usageBridge.refresh(revision).then(s=>({snapshot:s.snapshot,revision:s.snapshotRevision})),current.revision);
    assert.equal(quiet.snapshot,null,'a known-revision refresh returns metadata without decoding unchanged tables');assert.equal(quiet.revision,current.revision);
    const changedFile=path.join(require('../../src/m1/policy').roots(home).claude[0],'project','session.jsonl');fs.appendFileSync(changedFile,JSON.stringify({type:'assistant',uuid:'worker-refresh-synthetic',timestamp:new Date().toISOString(),message:{id:'worker-refresh-synthetic',model:'synthetic-refresh-model',usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:0,cache_creation_input_tokens:0}}})+'\n');
    const changed=await page.evaluate(revision=>window.usageBridge.refresh(revision).then(s=>({revision:s.snapshotRevision,total:s.snapshot?.daily.reduce((n,r)=>n+r.totalTokens,0)})),current.revision);
    assert(changed.revision>current.revision);assert.equal(changed.total,current.total+120,'a real changed synthetic observation still returns the full new facts');
    assert.deepEqual(errors,[]);
    const result={packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),senderGuard:true,usageReusesHomeSessions:true,noLedgerInMain:true,workerRestartPreservesTotals:true,enabledRestartResumesCollection:true,knownRefreshSkipsUnchangedTables:true,changedRefreshReturnsFacts:true,repriceNavigation:true,noRendererErrors:true,ledgerUnchangedBeforeEnabledPhase:true,realAccountRequests:0};fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally{await app.close();await cleanup(root);}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
