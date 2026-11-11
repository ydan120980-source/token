'use strict';
/* global document, requestAnimationFrame */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {showView,settle,until}=require('./ui-settle'),{CHANGE_PATH}=require('../../tests/m1/multi-reader-memory-fixture');
async function run({page,app,report,sample,profile,longFiles,longIds,ledgerBytes,usage,out}){
 const phase=name=>(report.phases??=[]).push({name,at:Date.now()});phase('default-idle');
 await page.evaluate(()=>{window.__memoryFrames=[];let last=performance.now();const tick=now=>{if(window.__memoryFrames){if(window.__memoryFrames.length<20000)window.__memoryFrames.push(now-last);last=now;requestAnimationFrame(tick);}};requestAnimationFrame(tick);});
 await page.waitForTimeout(5000);await sample('default-window-idle');
 await app.evaluate(({ipcMain})=>{globalThis.memoryReaderReads=[];for(const channel of ['usage:transcript','usage:transcriptFacts','usage:transcriptFileHistory','usage:sessions']){const original=ipcMain._invokeHandlers.get(channel);ipcMain._invokeHandlers.set(channel,async(...args)=>{const began=performance.now();try{return await original(...args);}finally{globalThis.memoryReaderReads.push({channel,ms:performance.now()-began});}});}});
 await page.evaluate(()=>{window.__memoryListLoad={start:performance.now(),tasks:[]};window.__memoryListObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries())window.__memoryListLoad.tasks.push({start:entry.startTime,ms:entry.duration});});window.__memoryListObserver.observe({entryTypes:['longtask']});});
 phase('all-session-list');await showView(page,'sessions');await page.getByRole('tablist',{name:'会话时间范围',exact:true}).getByRole('tab',{name:'全部',exact:true}).click();await until(page,()=>!!window.sessionsHost.get().list&&!window.sessionsHost.get().loading);
 report.sessionListLoad=await page.evaluate(()=>{const end=performance.now(),{start,tasks}=window.__memoryListLoad;window.__memoryListObserver.disconnect();delete window.__memoryListObserver;delete window.__memoryListLoad;return{measurement:'sessions navigation and all-range content ready, including owner IPC, decoding and page rendering; observed long tasks, not precise INP',ms:end-start,longTaskMs:tasks.filter(task=>task.start>=start&&task.start<end).map(task=>task.ms)};});
 report.savedListSessions=await page.evaluate(()=>window.sessionsHost.get().list.sessions.length);assert(report.savedListSessions>=20000);
 const keys=await page.evaluate(ids=>ids.map(id=>window.sessionsHost.get().list.sessions.find(s=>s.id===id)?.key),longIds);assert(keys.every(Boolean));report.fixture={longRecords:3,turnsPerRecord:300,fileBytes:longFiles.map(f=>fs.statSync(f).size),savedSessions:report.savedListSessions,missingBulkRecordFiles:true};
 await sample('all-session-list-loaded');
 if(profile==='list'){
  phase('hold-all-and-quick-switch');
  await page.evaluate(()=>{window.__releaseMemoryHold=window.sessionsHost.holdAll();});await until(page,()=>!!window.sessionsHost.get().all);report.heldAllSessions=await page.evaluate(()=>window.sessionsHost.get().all.sessions.length);assert(report.heldAllSessions>=20000);await sample('hold-all-20000');
  await page.keyboard.press('Control+k');await settle(page);await sample('quick-switch-with-all');await page.keyboard.press('Escape');await page.evaluate(()=>{window.__releaseMemoryHold();delete window.__releaseMemoryHold;});await sample('hold-all-released');
 }else{
  const panes=profile==='two'?2:profile==='three'||profile==='drag'?3:1;
  phase('open-'+panes+'-readers');
  await page.evaluate(([keys,count])=>{const host=window.sessionsHost,sessions=host.get().list.sessions;host.read(sessions.find(s=>s.key===keys[0]));for(let i=1;i<count;i++)host.readAlso(sessions.find(s=>s.key===keys[i]));},[keys,panes]);
  await page.locator('[data-reader-panes="'+panes+'"]').waitFor();await until(page,()=>document.querySelectorAll('[data-reader-page] [data-reader-turn]').length>0);await page.waitForFunction(n=>[...document.querySelectorAll('[data-reader-page]')].filter(p=>p.querySelectorAll('[data-rail-mark]').length===300).length===n,panes,{timeout:90000});await settle(page);await sample(panes+'-panes-initial');
  if(profile==='two'||profile==='three'||profile==='drag'){
   phase('navigate-long-readers');
   for(let i=0;i<panes;i++){
    const pane=page.locator('[data-reader-page]').nth(i);
    // The window's left column follows the pane in use, so going to a pane fills it with that pane's outline.
    await pane.locator('[data-reader-scroll]').click({position:{x:4,y:4}});const nav=page.locator('[data-reader-nav-toggle] button');if(!await page.locator('[data-reader-nav]').count())await nav.click();await page.locator('[data-reader-nav-tabs]').getByRole('tab',{name:'目录'}).click();await page.locator('[data-reader-outline]').waitFor();
    const outline=page.locator('[data-reader-outline] [data-outline-item="299"]');await outline.waitFor({timeout:10000});await outline.click();
    if(await page.locator('[data-reader-side]').count()){await page.locator('[data-reader-side-toggle] button').click();await page.locator('[data-reader-side]').waitFor({state:'detached'});}
    await pane.locator('[data-reader-scroll]').hover({position:{x:30,y:90}});await page.mouse.wheel(0,1000000);await page.waitForTimeout(1800);await settle(page);
   }
   // A real wheel scroll to the end also exercises progressive mounting; do not set a test-only turn cap.
   for(let attempt=0;attempt<30;attempt++){
    const counts=await page.locator('[data-reader-page]').evaluateAll(panes=>panes.map(p=>p.querySelectorAll('[data-reader-turn-frame]').length||p.querySelectorAll('[data-reader-turn]').length));if(counts.every(n=>n===300))break;
    for(const pane of await page.locator('[data-reader-page]').all()){await pane.locator('[data-reader-scroll]').hover();await page.mouse.wheel(0,1000000);}await page.waitForTimeout(200);
   }
   report.turnFrames=await page.locator('[data-reader-page]').evaluateAll(panes=>panes.map(p=>p.querySelectorAll('[data-reader-turn-frame]').length||p.querySelectorAll('[data-reader-turn]').length));report.drawnTurnBodies=await page.locator('[data-reader-page]').evaluateAll(panes=>panes.map(p=>p.querySelectorAll('[data-reader-turn]').length));assert(report.turnFrames.every(n=>n===300));await sample(panes+'-panes-near-end');
   // A retiring popup stays in the DOM for its exit spring. Target the open
   // menu, then require the pane's real follow state before continuing.
   phase('follow-updates');for(const pane of await page.locator('[data-reader-page]').all()){await pane.locator('[data-reader-more] button').click();await page.locator('[role="menu"][data-state="open"]').getByRole('menuitem',{name:'跟随',exact:true}).click();await pane.getByRole('button',{name:'跟随中',exact:true}).waitFor();await page.locator('[role="menu"]').waitFor({state:'detached'});}
   for(let round=1;round<=2;round++){
    for(let i=0;i<panes;i++){const timestamp=new Date().toISOString();fs.appendFileSync(longFiles[i],[{timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'合成并排跟随问题 '+round}]}},{timestamp,type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'合成并排跟随回复 '+round}]}}].map(row=>JSON.stringify(row)).join('\n')+'\n');}
    await page.waitForFunction(([n,turns])=>[...document.querySelectorAll('[data-reader-page]')].filter(p=>p.querySelectorAll('[data-rail-mark]').length===turns).length===n,[panes,300+round],{timeout:90000});await settle(page);await sample(panes+'-panes-follow-'+round);
   }
   for(const pane of await page.locator('[data-reader-page]').all())await pane.getByRole('button',{name:'跟随中',exact:true}).click();
   if(profile==='drag'){
    phase('drag-three-readers');
    const head=await page.locator('[data-reader-header]').first().boundingBox(),target=await page.locator('[data-pane-cell]').last().boundingBox();assert(head&&target);
    await page.mouse.move(head.x+5,head.y+5);await page.mouse.down();await page.locator('[data-pane-cell][data-lifted]').waitFor();await page.waitForTimeout(400);await sample('three-panes-real-drag-lifted');
    await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:24});await page.locator('[data-pane-zone]').waitFor();await page.waitForTimeout(400);await sample('three-panes-real-drag-target');
    await page.keyboard.press('Escape');await page.mouse.up();await settle(page);assert.equal(await page.locator('[data-reader-page]').count(),3);assert.equal(await page.locator('[data-pane-cell][data-lifted]').count(),0);await sample('three-panes-real-drag-canceled');report.realDrag={panes:3,lifted:true,target:true,canceled:true};
   }
  }else if(profile==='compare'){
   phase('compare-three-records');
   await page.evaluate(keys=>window.sessionsHost.compare(keys.slice(1)),keys);await page.locator('[data-compare-row="turns"]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-compare-row="turns"]')?.textContent.match(/300/g)?.length===3,null,{timeout:90000});await settle(page);await sample('three-long-comparison-loaded');
  }else{
   phase('file-history-first-batch');
   const pane=page.locator('[data-reader-side]');if(!await pane.count())await page.locator('[data-reader-side-toggle] button').click();await pane.waitFor();await pane.getByRole('tab',{name:'文件',exact:true}).click();await pane.locator('[data-reader-side-list="files"] [data-outline-item]').first().click();await page.locator('[data-reader-file-history] button').click();await until(page,()=>document.querySelector('[data-file-history]')?.dataset.state==='ready');await sample('file-history-first-real-batch');report.fileHistoryText=await page.locator('[data-file-history-status]').textContent();report.scannedPath=CHANGE_PATH;
  }
  await page.screenshot({path:path.join(out,'workload.png')});report.heldAllSessions=await page.evaluate(()=>window.sessionsHost.get().all?.sessions.length??null);phase('close-readers-and-show-usage');await page.evaluate(()=>window.sessionsHost.read(null));await showView(page,'usage');await sample('after-reader-close');
 }
 assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),ledgerBytes,'reading/follow never persist conversation into saved statistics');
 report.longReader.actualReads=await app.evaluate(()=>globalThis.memoryReaderReads);report.frameIntervals=await page.evaluate(()=>{const data=window.__memoryFrames;window.__memoryFrames=null;return data;});
 phase('usage-idle');const begin=Date.now();for(let i=1;i<=2;i++){await page.waitForTimeout(15000);await sample('usage-idle',Date.now()-begin);}
}
module.exports={run};
