'use strict';
/* global document, Chart, innerWidth */
// Browser plugin absent: exercise the actual Electron UI with isolated synthetic data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize'),{fixtures}=require('../../tests/m1/fixtures');
const {settle}=require('./ui-settle');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-overview-')),output=process.env.OVERVIEW_EVIDENCE_DIR||'artifacts/m2-overview/source',results=[];fs.mkdirSync(output,{recursive:true});
 try { for(const scale of [1,1.5]) {
  const home=path.join(root,'home-'+scale),f=fixtures(home),usage=path.join(root,'usage-'+scale),quota=path.join(root,'quota-'+scale),store=new Store(usage,f.roots);
  for(let offset=0;offset<45;offset++){
   if(offset===3||offset%7===4)continue;
   for(const agent of ['codex','claude']){
    const input=Math.round((.5+Math.abs(Math.sin(offset*.4)))*1000000);
    const row=normalize(agent,{input_tokens:input,output_tokens:10000,cache_read_input_tokens:Math.round(input*.8),reasoning_output_tokens:2000,total_tokens:input+10000},{id:agent+'-'+offset,time:Date.now()-offset*86400000,entry:'desktop',model:'gpt-5.4',provider:'openai'},'overview');store.state.records[row.id]=row;
   }
  }
  const empty=normalize('codex',{input_tokens:0,output_tokens:0,cache_read_input_tokens:0,reasoning_output_tokens:0,total_tokens:0},{id:'unknown-zero',time:Date.now(),entry:'desktop'},'overview');store.state.records[empty.id]=empty;
  const nonempty={...empty,id:'unknown-nonzero',timestamp:new Date(Date.now()-86400000).toISOString(),totalTokens:12,inputUncached:12};store.state.records[nonempty.id]=nonempty;
  store.state.sequence=1;atomic(path.join(usage,'statistics.json'),store.state);store.setEnabled(false);
  fs.mkdirSync(quota,{recursive:true});const id='11111111-1111-4111-8111-111111111111';
  atomic(path.join(quota,'quota-cache.json'),{accounts:[{id,provider:'codex',alias:'合成额度',plan:'plus',quota:{schemaVersion:'AccountQuotaV1',fetchedAt:new Date().toISOString(),windows:[{bucket:'codex',name:'codex',kind:'primary',durationMins:300,usedPercent:22,remainingPercent:78,resetsAt:null},{bucket:'codex',name:'codex',kind:'secondary',durationMins:10080,usedPercent:76,remainingPercent:24,resetsAt:null}],resetCredits:null}}]});
  const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
  try{
   const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.locator('#quotaCards .quota-fill').first().waitFor();await settle(page);
   await page.locator('[data-view="usage"]').click();await settle(page);
   const before=await page.locator('#totalTokens').textContent();
   await page.locator('#agentPicker [data-agent="codex"]').click();await settle(page);
   assert.match(await page.locator('#scopeContext').textContent(),/Codex · 累计/);assert.notEqual(await page.locator('#totalTokens').textContent(),before);
   assert.equal(await page.locator('#todayClients .client-name').count(),1);assert.match(await page.locator('#todayClients .client-name').textContent(),/Codex/);
   assert.equal(await page.locator('#activeDays,#availableSources').count(),0);assert.equal(await page.locator('#recordCount').isVisible(),true);
   assert.equal(await page.locator('#overviewWeek button').count(),7);assert(await page.locator('#overviewWeek .is-unrecorded').count()>0);
   await page.locator('#resetUsageScope').click();await settle(page);assert.equal(await page.locator('#totalTokens').textContent(),before);assert.equal(await page.locator('#todayClients .client-name').count(),2);
   await page.mouse.move(5,80);await page.screenshot({path:path.join(output,'overview-light-'+scale+'.png')});
   const date=await page.locator('#overviewWeek .is-today').getAttribute('data-habit-date');
   await page.locator('#overviewWeek .is-today').click();await settle(page);await page.locator('#dayDetail').scrollIntoViewIfNeeded();
   assert.equal(await page.locator('#dayDetail .model-name').filter({hasText:'模型未记录'}).count(),0);
   assert.equal(await page.locator('#dayDetail .day-categories').getByText('缓存写入',{exact:true}).count(),0);assert.match(await page.locator('#dayDetail .mix-unreported').textContent(),/缓存写入/);
   const ledger=JSON.parse(fs.readFileSync(path.join(usage,'statistics.json'),'utf8'));assert.equal(ledger.records[empty.id].totalTokens,0);assert.equal(ledger.records[empty.id].cacheWrite,null);
   await page.screenshot({path:path.join(output,'day-detail-'+scale+'.png')});
   await page.locator('#closeDay').click();await page.locator('#overviewWeek [data-habit-date="'+require('../../design/desktop-reference/usage-math').shift(date,-1)+'"]').click();await settle(page);
   assert.equal(await page.locator('#dayDetail .model-name').filter({hasText:'模型未记录'}).count(),1);await page.locator('#closeDay').click();
   await page.locator('#trend').scrollIntoViewIfNeeded();await settle(page);await page.waitForFunction(()=>Chart.getChart(document.getElementById('trendCanvas')).$reveal===1);
   const box=await page.locator('#trendCanvas').boundingBox();
   const point=await page.evaluate(()=>{const c=Chart.getChart(document.getElementById('trendCanvas'));return{x:c.scales.x.getPixelForValue(Math.floor(c.data.labels.length/2)),y:c.chartArea.top+80};});
   await page.mouse.move(box.x+point.x,box.y+point.y);await page.locator('#trendTooltip').waitFor();
   const tip=await page.locator('#trendTooltip').boundingBox(),hit={x:tip.x+tip.width/2,y:tip.y+tip.height/2};
   assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y).id,hit),'trendCanvas');
   await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.mouse.move(hit.x+60,hit.y,{steps:8});await page.mouse.up();
   assert.equal(await page.locator('#dayDetail').isVisible(),false,'scrubbing must not open a day detail on mouse release');
   await page.locator('#trend').scrollIntoViewIfNeeded();await settle(page);
   const box2=await page.locator('#trendCanvas').boundingBox();await page.mouse.move(box2.x+point.x,box2.y+point.y);await page.locator('#trendTooltip').waitFor();
   const tip2=await page.locator('#trendTooltip').boundingBox();await page.mouse.move(tip2.x+30,tip2.y+30);const scrollBefore=await page.evaluate(()=>window.scrollY);await page.mouse.wheel(0,300);await page.waitForFunction(y=>window.scrollY>y,scrollBefore);
   await page.locator('#trend').scrollIntoViewIfNeeded();await settle(page);await page.mouse.move(5,80);await page.screenshot({path:path.join(output,'trend-light-'+scale+'.png')});
   // Same unchanged confirmed quota: fast reentry stays still, expired cooldown replays.
   await page.locator('[data-view="quota"]').click();await settle(page);assert.equal(await page.locator('#quotaCards .quota-fill').first().evaluate(l=>l.getAnimations().length),0);
   await page.locator('[data-view="usage"]').click();await page.waitForFunction(()=>!document.querySelector('#quotaCards .quota-fill').getClientRects().length);
   await page.evaluate(()=>{const original=Date.now;window.overviewRestoreClock=()=>{Date.now=original;};Date.now=()=>original()+61000;});
   await page.locator('[data-view="quota"]').click();await page.waitForFunction(()=>document.querySelector('#quotaCards .quota-fill').getAnimations().length>0);
   assert.equal(await page.locator('#quotaCards .quota-segments').first().getAttribute('aria-valuenow'),'78');
   await page.evaluate(()=>window.overviewRestoreClock());await settle(page);
   await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-view="usage"]').click();await settle(page);await page.evaluate(()=>{const original=Date.now;window.overviewRestoreClock=()=>{Date.now=original;};Date.now=()=>original()+122000;});await page.locator('[data-view="quota"]').click();await settle(page);assert.equal(await page.locator('#quotaCards .quota-fill').first().evaluate(l=>l.getAnimations().length),0);await page.evaluate(()=>window.overviewRestoreClock());
   await page.locator('[data-view="usage"]').click();await page.locator('#theme').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));await page.evaluate(()=>window.scrollTo(0,0));await settle(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'overview-dark-narrow-'+scale+'.png')});
   assert.deepEqual(errors,[]);assert.equal(fs.existsSync(path.join(quota,'codex-homes')),false);results.push({scale,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),sharedScope:true,transparentTooltipAndWheel:true,unknownValuesPreserved:true,emptyModelHidden:true,nonemptyUnknownRetained:true,reentryCooldown:true,reducedMotion:true,errors});
  }finally{await app.close();}
 }}finally{fs.rmSync(root,{recursive:true,force:true});}
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: overview scope, honest day detail, tooltip pointer/wheel pass-through, quota cooldown at 100%/150%.');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
