'use strict';
/* global document, innerWidth, IntersectionObserver */
// Browser plugin absent: exercise the actual Electron UI with isolated synthetic data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize'),{fixtures}=require('../../tests/m1/fixtures');
const {settle,cleanup,keepVisible,showView,isolatePointer}=require('./ui-settle');
const usageUi=require('./usage-ui-helpers');
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
   const page=await app.firstWindow(),errors=[];await keepVisible(app);await isolatePointer(app);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await showView(page,'quota');await page.locator('#quotaCards .quota-fill').first().waitFor();
   // The approved home overview precedes the cards. Exercise actual viewport
   // entry so IntersectionObserver's replay/cooldown is tested on a visible bar.
   await page.locator('#quotaCards .quota-card').first().scrollIntoViewIfNeeded();await settle(page);
   // Owner 2026-11-02: the Agent cards and the widgets above them stand on the same columns, at every window width.
   for(const width of [1180,1480,1920]){await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setContentSize(size,900),width);await settle(page);
    const line=await page.evaluate(()=>{const flow=document.querySelector('.ff-home-columns'),grid=document.querySelector('#quotaCards'),box=flow.getBoundingClientRect(),gridBox=grid.getBoundingClientRect(),style=window.getComputedStyle(flow),tracks=window.getComputedStyle(grid).gridTemplateColumns.split(' ').map(parseFloat),first=[...flow.children].find(child=>child.getBoundingClientRect().width>0)?.getBoundingClientRect();return{left:[box.left,gridBox.left],right:[box.right,gridBox.right],tracks,card:document.querySelector('#quotaCards .quota-card').getBoundingClientRect().width,column:first?.width,count:flow.children.length,flowGap:style.columnGap,gridGap:window.getComputedStyle(grid).columnGap};});
    assert(Math.abs(line.left[0]-line.left[1])<=1&&Math.abs(line.right[0]-line.right[1])<=1,'same outer edges at '+width+' '+JSON.stringify(line));assert.equal(line.flowGap,line.gridGap,'same gap at '+width);assert(!line.column||Math.abs(line.column-line.tracks[0])<=1,'same column width at '+width+' '+JSON.stringify(line));assert(Math.abs(line.tracks.reduce((a,b)=>a+b,0)+(line.tracks.length-1)*parseFloat(line.gridGap)-(line.right[1]-line.left[1]))<=1,'columns fill the width at '+width);}
   await keepVisible(app);await settle(page);await page.locator('#quotaCards .quota-card').first().scrollIntoViewIfNeeded();await settle(page);
   await page.locator('[data-view="usage"]').click();await settle(page);
   const before=await usageUi.value(page,'totalTokens');
   await page.locator('[data-usage-agents] [data-agent="codex"]').click();await settle(page);
   assert.match(await page.locator('[data-usage-hero] [role=status]').first().textContent(),/Codex · 累计/);assert.notEqual(await usageUi.value(page,'totalTokens'),before);
   assert.equal(await page.locator('[data-usage-today] [data-usage-client]').count(),1);assert.match(await page.locator('[data-usage-today] [data-usage-client]').textContent(),/Codex/);
   assert.equal(await page.locator('#activeDays,#availableSources').count(),0);assert.equal(await page.locator('[data-usage-hero]').isVisible(),true);
   assert.equal(await page.locator('[data-usage-strip] [data-chart-key]').count(),30);assert(await page.locator('[data-usage-strip] [data-state=unobserved]').count()>0);
   await page.getByRole('button',{name:'查看全部',exact:true}).click();await settle(page);assert.equal(await usageUi.value(page,'totalTokens'),before);assert.equal(await page.locator('[data-usage-today] [data-usage-client]').count(),2);
   await page.mouse.move(5,80);await page.screenshot({path:path.join(output,'overview-light-'+scale+'.png')});
   const date=await page.locator('[data-usage-strip] [data-chart-key]').last().getAttribute('data-chart-key');
   await page.locator('[data-usage-strip] [data-chart-key]').last().click();await settle(page);await page.locator('[data-usage-day]').scrollIntoViewIfNeeded();
   assert.equal(await page.locator('[data-usage-day] [data-usage-client-model]').filter({hasText:'模型未记录'}).count(),0);
   // No synthetic source records cache writes: a structural fact, not a gap, and never zero.
   assert.equal(await page.locator('[data-usage-day] [data-usage-category][data-category-state=unknown]').count(),0);assert.equal(await page.locator('[data-usage-day] [data-usage-category][data-category-state=not-recorded]').textContent(),'缓存写入来源不记录');assert.equal(await page.locator('[data-usage-day] [data-usage-categories] [data-state=unobserved]').count(),0);
   const ledger=JSON.parse(fs.readFileSync(path.join(usage,'statistics.json'),'utf8'));assert.equal(ledger.records[empty.id].totalTokens,0);assert.equal(ledger.records[empty.id].cacheWrite,null);
   await page.screenshot({path:path.join(output,'day-detail-'+scale+'.png')});
   await page.getByRole('button',{name:'关闭当日明细',exact:true}).click();await page.locator('[data-usage-strip] [data-chart-key="'+require('../../src/m1/usage-math').shift(date,-1)+'"]').click();await settle(page);
   assert.equal(await page.locator('[data-usage-day] [data-usage-client-model]').filter({hasText:'模型未记录'}).count(),1);await page.getByRole('button',{name:'关闭当日明细',exact:true}).click();
   const chart=await usageUi.readyChart(page,'trend'),points=chart.locator('[data-line-point]');
   const point=points.nth(Math.floor(await points.count()/2));await usageUi.hover(page,point);
   const tooltip=page.locator(usageUi.hooks.tip);await tooltip.waitFor();
   const tip=await tooltip.boundingBox(),hit={x:tip.x+tip.width/2,y:tip.y+tip.height/2};
   assert.equal(await page.evaluate(p=>!!document.elementFromPoint(p.x,p.y).closest('[data-chart=line]'),hit),true);
   await page.mouse.move(hit.x,hit.y);await page.mouse.down();await page.mouse.move(hit.x+60,hit.y,{steps:8});await page.mouse.up();
   assert.equal(await page.locator('[data-usage-day]').isVisible(),false,'scrubbing must not open a day detail on mouse release');
   await chart.scrollIntoViewIfNeeded();await settle(page);
   const currentPoint=points.nth(Math.floor(await points.count()/2));await usageUi.hover(page,currentPoint);await tooltip.waitFor();
   const tip2=await tooltip.boundingBox();await page.mouse.move(tip2.x+30,tip2.y+30);const scrollBefore=await page.evaluate(()=>window.scrollY);await page.mouse.wheel(0,-300);await page.waitForFunction(y=>window.scrollY<y,scrollBefore);
   await chart.scrollIntoViewIfNeeded();await settle(page);await page.mouse.move(5,80);await page.screenshot({path:path.join(output,'trend-light-'+scale+'.png')});
   // Same unchanged confirmed quota: fast reentry stays still, expired cooldown replays.
   await page.locator('[data-view="quota"]').click();await page.locator('#quotaCards .quota-card').first().scrollIntoViewIfNeeded();await settle(page);assert.equal(await page.locator('#quotaCards .quota-fill').first().evaluate(l=>l.getAnimations().length),0);
   await page.locator('[data-view="usage"]').click();await page.waitForFunction(()=>!document.querySelector('#quotaCards .quota-fill').getClientRects().length);
   await page.locator('[data-view="quota"]').click();
   // Navigation can scroll past the now-lower cards, briefly enter them, then
   // cancel their animation on exit. Stage a real, stable viewport exit first;
   // advance the existing cooldown clock only before the entry under test.
   await page.evaluate(async()=>{window.scrollTo({top:0,behavior:'instant'});await new Promise(resolve=>{const observer=new IntersectionObserver(entries=>{if(entries.some(e=>!e.isIntersecting)){observer.disconnect();resolve();}});observer.observe(document.querySelector('#quotaCards .quota-segments'));});const original=Date.now;window.overviewRestoreClock=()=>{Date.now=original;};Date.now=()=>original()+61000;});
   await page.locator('#quotaCards .quota-card').first().scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('#quotaCards .quota-fill').getAnimations().length>0);
   assert.equal(await page.locator('#quotaCards .quota-segments').first().getAttribute('aria-valuenow'),'24');
   await page.evaluate(()=>window.overviewRestoreClock());await settle(page);
   await page.emulateMedia({reducedMotion:'reduce'});await page.locator('[data-view="usage"]').click();await settle(page);await page.evaluate(()=>{const original=Date.now;window.overviewRestoreClock=()=>{Date.now=original;};Date.now=()=>original()+122000;});await page.locator('[data-view="quota"]').click();await page.locator('#quotaCards .quota-card').first().scrollIntoViewIfNeeded();await settle(page);assert.equal(await page.locator('#quotaCards .quota-fill').first().evaluate(l=>l.getAnimations().length),0);await page.evaluate(()=>window.overviewRestoreClock());
   await page.locator('[data-view="usage"]').click();await page.locator('#theme').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));await page.evaluate(()=>window.scrollTo(0,0));await settle(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'overview-dark-narrow-'+scale+'.png')});
   assert.deepEqual(errors,[]);assert.equal(fs.existsSync(path.join(quota,'codex-homes')),false);results.push({scale,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),sharedScope:true,transparentTooltipAndWheel:true,unknownValuesPreserved:true,emptyModelHidden:true,nonemptyUnknownRetained:true,reentryCooldown:true,reducedMotion:true,errors});
  }finally{await app.close();}
 }}finally{await cleanup(root);}
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: overview scope, honest day detail, tooltip pointer/wheel pass-through, quota cooldown at 100%/150%.');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
