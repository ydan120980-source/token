'use strict';
/* global document, getComputedStyle */
// Browser plugin not available: native Electron/Playwright, own synthetic homes only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {SOURCES}=require('../../src/m1/policy'),{Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize'),{fixtures}=require('../../tests/m1/fixtures');
const {settle,cleanup,keepVisible,showView}=require('./ui-settle');
const q=require('./quota-ui-helpers');
const {usageContinuityChecks}=require('./usage-continuity-checks');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-continuity-')),output=process.env.CONTINUITY_EVIDENCE_DIR||'artifacts/m2-motion/continuity-source',evidence=[];fs.mkdirSync(output,{recursive:true});
 try{
  const home=path.join(root,'home'),fixture=fixtures(home),usage=path.join(root,'usage'),store=new Store(usage,fixture.roots);
  const keys=['codex','claude','opencode','workbuddy','mimo'];
  for(let day=0;day<90;day++){
   if(day%9>=2&&day%9<=5)continue;
   const time=Date.now()-(89-day)*86400000,peak=day%13===0?8:1,base=Math.round((.8+Math.abs(Math.sin(day*.31)))*peak*10000000);
   for(const agent of keys){const r=normalize(agent,{input_tokens:base,output_tokens:Math.round(base/10),cache_read_input_tokens:Math.floor(base*.85),cache_creation_input_tokens:0,reasoning_output_tokens:0},{id:agent+'-'+day,time,model:'gpt-5.4',provider:'openai'},'continuity-salt');store.state.records[r.id]=r;}
  }
  // One observed date has unknown costs/fields; it must remain a hard gap.
  const last=Object.values(store.state.records).filter(r=>r.timestamp.slice(0,10)===new Date(Date.now()-2*86400000).toISOString().slice(0,10));
  for(const r of last){r.model='synthetic-unpriced';r.cacheWrite=null;}
  store.state.sequence=1;atomic(path.join(usage,'statistics.json'),store.state);store.setEnabled(false);
  for(const scale of [1,1.5]){
   const quota=path.join(root,'quota-'+scale);fs.mkdirSync(quota);const id='11111111-1111-4111-8111-111111111111';
   atomic(path.join(quota,'quota-cache.json'),{accounts:[{id,provider:'codex',alias:'合成动效验收',plan:'plus',quota:{schemaVersion:'AccountQuotaV1',fetchedAt:new Date().toISOString(),windows:[{bucket:'codex',name:'codex',kind:'primary',durationMins:300,usedPercent:22,remainingPercent:78,resetsAt:null},{bucket:'codex',name:'codex',kind:'secondary',durationMins:10080,usedPercent:76,remainingPercent:24,resetsAt:null}],resetCredits:null}}]});
   const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
   try{
    const page=await app.firstWindow(),errors=[];await keepVisible(app);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await showView(page,'quota');await page.locator('#quotaCards .quota-card').waitFor();await settle(page);await page.emulateMedia({reducedMotion:'no-preference'});
    // Obtain the real renderer animation after a synthetic main-process quota read.
    await app.evaluate(()=>{
     const req=process.mainModule.require.bind(process.mainModule),module=Object.values(req('node:module')._cache).find(m=>/[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename)),{EventEmitter}=req('node:events');
     const fixture=module.exports.QuotaService.prototype.motionFixture={used:55};
     module.exports.QuotaService.prototype.client=async function(id){fixture.service=this;const rpc=new EventEmitter();rpc.close=()=>{};rpc.request=async method=>method==='account/read'?{account:{type:'chatgpt',planType:'plus'}}:{rateLimits:{primary:{usedPercent:fixture.used,windowDurationMins:300},secondary:{usedPercent:76,windowDurationMins:10080}}};this.clients.set(id,rpc);return rpc;};
    });
    await page.locator('#quotaCards [data-quota-refresh]').click();
    // The approved overview pushes cards below the fold. Clicking refresh scrolls a
    // card in and can start its entrance before the synthetic read has returned.
    // Sample the confirmed refresh target, never that earlier entrance animation.
    await page.waitForFunction(()=>{const l=document.querySelectorAll('#quotaCards .quota-fill')[1];return l.parentElement.getAttribute('aria-valuenow')==='45'&&l.getAnimations().some(a=>a.effect.getTiming().duration===820);});
    const frames=[];
    for(const time of [0,100,200,410,620,720,800]){
     frames.push(await page.evaluate(time=>{const layer=document.querySelectorAll('#quotaCards .quota-fill')[1],a=layer.getAnimations()[0];a.pause();a.currentTime=time;return {time,clip:getComputedStyle(layer).clipPath,aria:layer.parentElement.getAttribute('aria-valuenow'),easing:a.effect.getTiming().easing};},time));
     if([0,200,620,800].includes(time))await page.screenshot({path:path.join(output,'quota-'+scale+'-'+time+'.png')});
    }
    assert(new Set(frames.map(f=>f.clip)).size>5);assert(frames.every(f=>f.aria==='45'));assert.equal(frames[0].easing,'cubic-bezier(0.42, 0, 0.2, 1)');
    // Interrupt at an intermediate presentation value and reverse the target.
    const interrupted=await page.evaluate(()=>{const l=document.querySelectorAll('#quotaCards .quota-fill')[1],a=l.getAnimations()[0];a.currentTime=410;return getComputedStyle(l).clipPath;});
    await app.evaluate(()=>{const req=process.mainModule.require.bind(process.mainModule);Object.values(req('node:module')._cache).find(m=>/[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename)).exports.QuotaService.prototype.motionFixture.used=10;});
    await page.locator('#quotaCards [data-quota-refresh]').click();
    await page.waitForFunction(()=>document.querySelectorAll('#quotaCards .quota-segments')[1].getAttribute('aria-valuenow')==='90');
    const redirected=await page.evaluate(()=>{const l=document.querySelectorAll('#quotaCards .quota-fill')[1],a=l.getAnimations()[0];a.pause();a.currentTime=0;return getComputedStyle(l).clipPath;});assert.equal(redirected,interrupted);
    await page.evaluate(()=>document.querySelectorAll('#quotaCards .quota-fill')[1].getAnimations().forEach(a=>a.finish()));await settle(page);
    assert.equal(await page.locator('#quotaCards .quota-fill').nth(1).evaluate(l=>getComputedStyle(l).clipPath),'inset(0px 10% 0px 0px)');
    const layerHandle=await page.locator('#quotaCards .quota-fill').nth(1).elementHandle();await page.evaluate(()=>window.dispatchEvent(new Event('ui-motion-change')));assert.equal(await layerHandle.evaluate(l=>l.getAnimations().length),0);await layerHandle.dispose();
    await q.choose(page,'额度自动刷新','每分钟');const cadence=await page.evaluate(()=>window.quotaBridge.get());assert.equal(cadence.state.autoRefresh,'1min');assert(Date.parse(cadence.state.nextAutoAt)-Date.now()<=60000);
    await q.choose(page,'额度自动刷新','关闭');
    async function capture(name, run) {
     if(!process.env.CONTINUITY_CAPTURE || scale!==1){await run();return;}
     const folder=path.join(output,name+'-frames');fs.mkdirSync(folder,{recursive:true});const session=await page.context().newCDPSession(page),frames=[];
     session.on('Page.screencastFrame',async event=>{const file=String(frames.length).padStart(5,'0')+'.jpg';fs.writeFileSync(path.join(folder,file),Buffer.from(event.data,'base64'));frames.push({file,time:event.metadata.timestamp});await session.send('Page.screencastFrameAck',{sessionId:event.sessionId});});
     await session.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1180,maxHeight:850,everyNthFrame:1});
     await run();await session.send('Page.stopScreencast');await session.detach();fs.writeFileSync(path.join(folder,'frames.json'),JSON.stringify(frames,null,2));assert(frames.length>15);
    }
    await capture('quota-motion',async()=>{
     await app.evaluate(()=>{const req=process.mainModule.require.bind(process.mainModule);Object.values(req('node:module')._cache).find(m=>/[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename)).exports.QuotaService.prototype.motionFixture.used=35;});
     await page.locator('#quotaCards [data-quota-refresh]').click();await page.waitForFunction(()=>document.querySelectorAll('#quotaCards .quota-segments')[1].getAttribute('aria-valuenow')==='65');await settle(page);
    });
    const {continuity,logos}=await usageContinuityChecks(page,app,{SOURCES,keys,output,scale,capture});
    await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-view="quota"]').click();
    await app.evaluate(()=>{const req=process.mainModule.require.bind(process.mainModule);Object.values(req('node:module')._cache).find(m=>/[/\\]src[/\\]quota[/\\]service\.js$/.test(m.filename)).exports.QuotaService.prototype.motionFixture.used=100;});
    await page.locator('#quotaCards [data-quota-refresh]').click();await page.waitForFunction(()=>document.querySelectorAll('#quotaCards .quota-segments')[1].getAttribute('aria-valuenow')==='0');await settle(page);assert.equal(await page.locator('#quotaCards .quota-fill').nth(1).evaluate(l=>l.getAnimations().length),0);assert.equal(await page.locator('#quotaCards .quota-segments').nth(1).getAttribute('aria-valuenow'),'0');
    await page.screenshot({path:path.join(output,'quota-dark-narrow-'+scale+'.png')});assert.deepEqual(errors,[]);assert.equal(fs.existsSync(path.join(quota,'codex-homes')),false);
    evidence.push({scale,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),frames,redirectedFromPresentation:true,oneMinuteCadence:true,continuity,unrecordedTooltip:true,agentLogos:logos,allAgentAndKeyboardFilters:true,reducedMotion:true,noOverflow:true,errors});
   }finally{await app.close();}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2));console.log('PASS: quota acceleration/retarget, minute cadence, honest gap connections and logo filters at 100%/150%.');
 }finally{await cleanup(root);}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
