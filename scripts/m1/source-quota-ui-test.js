'use strict';
/* global document */
// Browser plugin not available. Flow: source/quota capability -> navigation ->
// independent pause/refresh/remove -> failed status read/retry -> narrow layout.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {Store,atomic}=require('../../src/m1/store');
const {roots}=require('../../src/m1/policy');
const {normalize}=require('../../src/m1/normalize');
const {showView,settle,until,keepVisible,cleanup}=require('./ui-settle');
const q=require('./quota-ui-helpers');
const output=process.env.SOURCE_QUOTA_EVIDENCE_DIR||'artifacts/source-quota-20261019/ui';
function seed(root){
 const home=path.join(root,'home'),usage=path.join(root,'usage'),quota=path.join(root,'quota');fs.mkdirSync(home);fs.mkdirSync(quota);
 const store=new Store(usage,roots(home)),now=Date.now(),customId='custom-11111111-1111-4111-8111-111111111111';
 const record=normalize('codex',{input_tokens:100,output_tokens:20,cached_input_tokens:0,cache_creation_input_tokens:0,reasoning_output_tokens:0},{id:'synthetic-request',model:'gpt-4.1',session:'synthetic-session',time:new Date(now).toISOString()},'synthetic');
 store.state.records[record.id]=record;store.state.statuses.codex={agent:'codex',status:'partial',observedRecords:1,lastSuccess:new Date(now-120000).toISOString(),errors:[]};
 const definition={schemaVersion:'CustomSourceV1',name:'个人来源 · 合成',template:'standard',mode:'per-request'};
 store.state.customSources={[customId]:{id:customId,name:definition.name,definition,version:1,enabled:false,archived:false,roots:[path.join(root,'custom')],files:{},diagnostics:{}}};store.state.sequence=1;atomic(path.join(usage,'statistics.json'),store.state);store.setEnabled(false);
 const accounts=['33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'].map((id,i)=>({id,provider:'codex',alias:'PRIVATE_ACCOUNT_ALIAS_'+i,plan:'plus',quota:{schemaVersion:'AccountQuotaV1',fetchedAt:new Date(now-(i?1800000:60000)).toISOString(),resetCredits:null,windows:[{bucket:'codex',name:'codex',kind:'primary',usedPercent:36,remainingPercent:64,durationMins:300,resetsAt:new Date(now+3600000).toISOString()}]}}));
 atomic(path.join(quota,'quota-cache.json'),{accounts});return {home,usage,quota,customId,accounts};
}
function fixtureControl(app,mode){return app.evaluate((_electron,value)=>{const modules=Object.values(process.mainModule.require('node:module')._cache).filter(m=>/[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename));if(modules.length!==1)throw new Error('FIXTURE_MODULE_UNAVAILABLE');modules[0].exports.QuotaService.prototype.alignmentFixture.mode=value;},mode);}
(async()=>{
 const results=[];
 for(const scale of [1,1.25,1.5]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-quota-ui-')),f=seed(root),dir=path.join(output,String(scale));fs.mkdirSync(dir,{recursive:true});
  const ledger=fs.readFileSync(path.join(f.usage,'statistics.json')),quotaBefore=fs.readFileSync(path.join(f.quota,'quota-cache.json'));
  const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',f.usage,'--quota-data-dir',f.quota,'--m1-fixture-root',f.home,'--force-device-scale-factor='+scale],timeout:60000});
  try{
   const page=await app.firstWindow(),errors=[];await keepVisible(app);page.on('pageerror',e=>errors.push(e.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
   await showView(page,'sources');await until(page,()=>document.querySelectorAll('[data-source-rows] [data-source-connection]').length===11);
   const initial=await page.evaluate(()=>window.usageBridge.connections());assert.equal(initial.rows.length,18,'seven usage-only sources have a row but show no quota line');
   const setupInitial=await page.evaluate(()=>window.quotaBridge.antigravitySetup());assert.equal(setupInitial.state.reason,'scan-required');
   await app.evaluate(electron=>{electron.shell.setupFixture={opened:[],copied:[],failOpen:false,failCopy:false};electron.shell.openExternal=async url=>{const fixture=electron.shell.setupFixture;if(fixture.failOpen)throw new Error('PRIVATE_BROWSER');fixture.opened.push(url);};electron.clipboard.writeText=text=>{const fixture=electron.shell.setupFixture;if(fixture.failCopy)throw new Error('PRIVATE_CLIPBOARD');fixture.copied.push(text);};});
   const runtimeDirectory=path.join(f.home,'AppData/Local/agy/bin');fs.mkdirSync(runtimeDirectory,{recursive:true});const runtimeFile=path.join(runtimeDirectory,'agy.exe'),runtimeBytes=Buffer.from('SYNTHETIC_METADATA_ONLY');fs.writeFileSync(runtimeFile,runtimeBytes);
   const foundRuntime=await page.evaluate(()=>window.quotaBridge.discoverAntigravity());assert.equal(foundRuntime.ok,true);assert.equal(foundRuntime.discovery.selection.executable,runtimeFile);assert.equal(foundRuntime.discovery.selection.verificationRequired,true);assert.equal(foundRuntime.discovery.effects.executedCli,false);assert.deepEqual(fs.readFileSync(runtimeFile),runtimeBytes);assert(!fs.existsSync(path.join(f.quota,'codex-homes')));
   fs.unlinkSync(runtimeFile);const missingRuntime=await page.evaluate(()=>window.quotaBridge.discoverAntigravity());assert.equal(missingRuntime.discovery.status,'not-found');assert.equal(missingRuntime.discovery.selection.executable,null);assert.deepEqual(fs.readFileSync(path.join(f.quota,'quota-cache.json')),quotaBefore);
   const setupAction=id=>page.evaluate(async actionId=>{const {state}=await window.quotaBridge.antigravitySetup();return window.quotaBridge.antigravitySetupAction({actionId,revision:state.revision});},id);
   assert.equal((await page.evaluate(()=>window.quotaBridge.antigravitySetup())).state.reason,'cli-missing');
   const invalidSetup=await page.evaluate(async()=>{const {state}=await window.quotaBridge.antigravitySetup();return window.quotaBridge.antigravitySetupAction({actionId:'installation-guide',revision:state.revision,url:'https://evil.example'});});assert.equal(invalidSetup.errorCode,'AGY_SETUP_ARGUMENTS_REJECTED');
   await app.evaluate(electron=>{electron.shell.setupFixture.failCopy=true;});assert.equal((await setupAction('copy-install-command')).errorCode,'AGY_SETUP_COPY_FAILED');
   await app.evaluate(electron=>{electron.shell.setupFixture.failCopy=false;});assert.equal((await setupAction('copy-install-command')).outcome,'command-copied');
   await app.evaluate(electron=>{electron.shell.setupFixture.failOpen=true;});assert.equal((await setupAction('installation-guide')).errorCode,'AGY_SETUP_GUIDE_FAILED');
   await app.evaluate(electron=>{electron.shell.setupFixture.failOpen=false;});assert.equal((await setupAction('installation-guide')).outcome,'guide-opened');
   fs.writeFileSync(runtimeFile,runtimeBytes);const staleInstall=await setupAction('copy-install-command');assert.equal(staleInstall.errorCode,'AGY_SETUP_ACTION_UNAVAILABLE');assert.equal(staleInstall.state.reason,'verification-required');assert.equal(staleInstall.state.quota.ready,false);
   const setupEffects=await app.evaluate(electron=>electron.shell.setupFixture);assert.deepEqual(setupEffects.copied,['irm https://antigravity.google/cli/install.ps1 | iex']);assert.deepEqual(setupEffects.opened,['https://antigravity.google/docs/getting-started']);assert.deepEqual(fs.readFileSync(runtimeFile),runtimeBytes);fs.unlinkSync(runtimeFile);
   assert.equal((await setupAction('rescan')).state.reason,'cli-missing');assert.deepEqual(fs.readFileSync(path.join(f.quota,'quota-cache.json')),quotaBefore);
   const codex=()=>page.locator('[data-source-rows] [data-source-connection="codex"]');assert.match(await codex().textContent(),/2 个连接.*1 个缓存已过期.*1 个缓存待验证/);
   const described=agent=>page.evaluate(async id=>{const row=(await window.usageBridge.connections()).rows.find(value=>value.agent===id);return window.connectionState.quotaDescription(row.quota);},agent);
   const personal=page.locator('[data-source-rows] [data-source-agent="'+f.customId+'"]').first();assert.match(await personal.textContent(),/仅接入用量/);assert.equal(await personal.locator('[data-source-quota]').count(),0);assert.match(await page.locator('[data-source-rows] [data-source-connection="claude"]').textContent(),/支持账号额度.*尚未连接账号/);
   for(const secret of ['PRIVATE_ACCOUNT_ALIAS',...f.accounts.map(a=>a.id),'remainingPercent','usedPercent','windows'])assert(!JSON.stringify(initial).includes(secret));
   assert(!fs.existsSync(path.join(f.quota,'codex-homes')));assert.deepEqual(fs.readFileSync(path.join(f.quota,'quota-cache.json')),quotaBefore);
   await until(page,()=>!document.getElementById('sources').hidden&&document.querySelector('[data-source-rows] [data-source-connection="codex"]'));
   const source=page.locator('[data-source-rows] [data-source-agent="codex"]').first();assert.match(await source.locator('[data-source-connection]').textContent(),/2 个连接/);
   await source.getByRole('switch').click();await until(page,()=>document.querySelector('[data-source-rows] [data-source-agent="codex"]').hasAttribute('data-stopped'));
   assert.equal((await page.evaluate(()=>window.quotaBridge.get())).state.accounts.length,2);assert.deepEqual(fs.readFileSync(path.join(f.quota,'quota-cache.json')),quotaBefore);assert.deepEqual(fs.readFileSync(path.join(f.usage,'statistics.json')),ledger);
   await source.locator('[data-source-quota]').click();await until(page,()=>!document.getElementById('quota').hidden);assert.equal(await q.codexLogin(page).count(),0,'navigation does not start authentication');
   await app.evaluate(({dialog})=>{
    const modules=Object.values(process.mainModule.require('node:module')._cache).filter(m=>/[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename));if(modules.length!==1)throw new Error('FIXTURE_MODULE_UNAVAILABLE');const Class=modules[0].exports.QuotaService;
    const fixture=Class.prototype.alignmentFixture={mode:'ok',calls:0};dialog.showMessageBox=async()=>({response:1});
    Class.prototype.client=async function(id){fixture.service=this;if(this.clients.has(id))return this.clients.get(id);const rpc={close:()=>{},request:async method=>{fixture.calls++;if(fixture.mode==='login')throw new Error('LOGIN_REQUIRED');if(method==='account/read')return {account:{type:'chatgpt',planType:'plus',email:'PRIVATE_EMAIL'}};if(method==='account/rateLimits/read')return {rateLimits:{primary:{usedPercent:25,windowDurationMins:300,resetsAt:Math.floor(Date.now()/1000)+3600}},token:'PRIVATE_SECRET'};return {};}};this.clients.set(id,rpc);return rpc;};
   });
   await page.locator('#quotaCards [data-quota-refresh]').first().click();await until(page,async()=>{const row=(await window.usageBridge.connections()).rows.find(value=>value.agent==='codex');return window.connectionState.quotaDescription(row.quota).includes('1 个已更新');});
   await fixtureControl(app,'login');await page.locator('#quotaCards [data-quota-refresh]').first().click();await until(page,async()=>{const row=(await window.usageBridge.connections()).rows.find(value=>value.agent==='codex');return window.connectionState.quotaDescription(row.quota).includes('1 个需重新登录');});
   assert.match(await described('codex'),/1 个缓存待验证/);assert(!JSON.stringify(await page.evaluate(()=>window.usageBridge.connections())).includes('PRIVATE_'));
   await fixtureControl(app,'ok');await page.locator('#quotaCards [data-quota-details]').first().click();await q.details(page).locator('[data-quota-remove] button').first().click();await page.keyboard.press('Escape');await until(page,async()=>{const row=(await window.usageBridge.connections()).rows.find(value=>value.agent==='codex');return document.querySelectorAll('#quotaCards article').length===1&&window.connectionState.quotaDescription(row.quota).includes('1 个连接');});
   assert.deepEqual(fs.readFileSync(path.join(f.usage,'statistics.json')),ledger);assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.records,0),1);
   await showView(page,'sources');await until(page,()=>/1 个连接/.test(document.querySelector('[data-source-rows] [data-source-connection="codex"]')?.textContent||''));const saved=await page.evaluate(()=>window.usageBridge.connections());await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('usage:connections');ipcMain.handle('usage:connections',()=>{throw new Error('PRIVATE_ENDPOINT_FAILURE');});});await page.evaluate(()=>window.sourceConnectionsUi.reload());await until(page,()=>document.querySelector('[data-source-rows] [data-source-connection="codex"]').textContent.includes('上次状态'));assert.match(await codex().textContent(),/1 个连接/);assert(!await codex().textContent().then(t=>t.includes('PRIVATE_')));
   await app.evaluate(({ipcMain},value)=>{ipcMain.removeHandler('usage:connections');ipcMain.handle('usage:connections',()=>value);},saved);await page.evaluate(()=>window.sourceConnectionsUi.reload());await until(page,()=>!document.querySelector('[data-source-rows] [data-source-connection="codex"]').textContent.includes('上次状态'));
   await showView(page,'quota');await page.locator('#quotaCards').scrollIntoViewIfNeeded();await settle(page);await page.screenshot({path:path.join(dir,'quota-source-alignment.png')});
   await showView(page,'sources');await until(page,()=>!document.getElementById('sources').hidden);await page.locator('[data-source-rows] [data-source-connection="codex"]').scrollIntoViewIfNeeded();await settle(page);await page.screenshot({path:path.join(dir,'source-quota-alignment.png')});
   await page.locator('#theme').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,650));await settle(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));await page.screenshot({path:path.join(dir,'sources-dark-narrow.png')});await showView(page,'quota');await page.locator('#quota').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));await page.screenshot({path:path.join(dir,'quota-dark-narrow.png')});
   assert.deepEqual(errors,[]);results.push({scale,capabilityMatrix:true,customUsageOnly:true,mixedFreshness:true,summaryPrivacy:true,automaticRuntimeDiscovery:true,runtimeDiscoveryMetadataOnly:true,fixtureRuntimeScope:true,guidedSetupIPC:true,fixedSetupActions:true,setupFailuresAccurate:true,newRuntimeBlocksInstallAdvice:true,navigationWithoutLogin:true,pauseKeepsAccount:true,removeKeepsUsage:true,loginFailureRetainsCache:true,statusFailureRetainsView:true,retry:true,narrowDark:true,ledgerUnchanged:true,errors});fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results.at(-1),null,2));
   console.log('PASS '+scale+': source/quota capability, freshness, independent lifecycle, privacy, status retry and narrow UI.');
  }finally{await app.close();await cleanup(root);}
 }
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
