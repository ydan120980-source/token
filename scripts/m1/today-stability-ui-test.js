'use strict';
/* global document, MutationObserver, requestAnimationFrame */
// M12: real five-second synthetic collection, a stable Today card, and immediate changed values.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {launch}=require('./ui-smoke'),{showView,settle,until}=require('./ui-settle');
const {checkAgentFilter}=require('./agent-filter-checks');
const output=path.resolve(process.env.TODAY_EVIDENCE_DIR||'artifacts/m12/today-stability');
(async()=>{fs.mkdirSync(output,{recursive:true});const run=await launch();const {page}=run;
try{await page.emulateMedia({reducedMotion:'no-preference'});await showView(page,'usage');await page.evaluate(()=>window.uiMotion.setPreference('full'));await settle(page);
 const card=page.locator('[data-usage-today]');await card.scrollIntoViewIfNeeded();await page.mouse.move(0,0);
 await page.evaluate(async()=>{await window.usageBridge.setRefreshInterval(5000);await window.usageBridge.setEnabled(true);});
 await until(page,async()=>{const s=await window.usageBridge.get();return !s.collecting&&Boolean(s.checkedAt);});await settle(page);await page.waitForTimeout(1000);
 await card.evaluate(root=>{window.todayTrace={root,rect:root.getBoundingClientRect(),mutations:0,projects:0,checked:new Set(),maxY:0,maxHeight:0,moving:0,running:true};const t=window.todayTrace;t.observer=new MutationObserver(()=>t.mutations++);t.observer.observe(root,{subtree:true,childList:true,characterData:true});t.performance=new PerformanceObserver(list=>{t.projects+=list.getEntries().filter(e=>e.name==='usage:project').length;});t.performance.observe({entryTypes:['measure']});t.collection=()=>{const s=window.usageData.collection();if(s.checkedAt)t.checked.add(s.checkedAt);};window.addEventListener('usage-collection',t.collection);t.collection();const sample=()=>{if(!t.running)return;const box=root.getBoundingClientRect();t.maxY=Math.max(t.maxY,Math.abs(box.y-t.rect.y));t.maxHeight=Math.max(t.maxHeight,Math.abs(box.height-t.rect.height));t.moving=Math.max(t.moving,root.getAnimations({subtree:true}).filter(a=>a.playState==='running').length);requestAnimationFrame(sample);};sample();});
 await page.waitForTimeout(12000);
 const trace=await page.evaluate(()=>{const t=window.todayTrace;t.running=false;t.observer.disconnect();t.performance.disconnect();window.removeEventListener('usage-collection',t.collection);return{sameNode:t.root===document.querySelector('[data-usage-today]'),mutations:t.mutations,projects:t.projects,checked:[...t.checked],maxY:t.maxY,maxHeight:t.maxHeight,moving:t.moving};});
 assert(trace.sameNode);assert(trace.checked.length>=3,'at least two scheduled collections complete');assert(trace.maxY<1&&trace.maxHeight<1,'Today geometry stays still through real periodic collection');assert.equal(trace.moving,0,'Today never rolls/fades during collection');assert.equal(trace.projects,0,'status-only ticks reuse the statistical projection');
 const sessions=await page.evaluate(async()=>{
  const wait=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),original=window.sessionsUi,before=window.usageHost.get().view;
  for(let i=0;i<5;i++)window.dispatchEvent(new Event('sessions-change'));await wait();
  const sameView=window.usageHost.get().view===before;
  let unknown,zero;
  try{
   window.sessionsUi=Object.freeze({...original,count:()=>null});window.dispatchEvent(new Event('sessions-change'));await wait();unknown=window.usageHost.get().view.today.sessions;
   window.sessionsUi=Object.freeze({...original,count:()=>0});window.dispatchEvent(new Event('sessions-change'));await wait();zero=window.usageHost.get().view.today.sessions;
  }finally{window.sessionsUi=original;window.dispatchEvent(new Event('sessions-change'));await wait();}
  return {sameView,unknown,zero};
 });assert(sessions.sameView,'unrelated session events preserve the statistical view identity');assert.equal(sessions.unknown,null,'unknown session count remains unknown');assert.equal(sessions.zero,0,'a real known-zero response must replace unknown');
 const changed=await page.evaluate(async()=>{const root=document.querySelector('[data-usage-today]'),before=root.textContent;window.usageHost.set({agent:'codex'});await new Promise(resolve=>requestAnimationFrame(resolve));const after=root.textContent,moving=root.getAnimations({subtree:true}).filter(a=>a.playState==='running').length;return{before,after,moving};});assert.notEqual(changed.before,changed.after,'a real filter change updates Today');assert.equal(changed.moving,0,'changed Today readings update without a replay');
 await page.evaluate(()=>window.usageBridge.setEnabled(false));
 await until(page,()=>!window.usageData.collection().enabled);
 const dataChanges=await page.evaluate(async()=>{
  let changes=0;
  const count=()=>changes++,paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  window.addEventListener('usage-data-change',count);
  try{
   window.usageData.view('cost');await paint();
   window.usageData.view('usage');await paint();
   window.usageHost.set({period:'7'});await paint();
   window.usageHost.set({period:'all'});await paint();
   return changes;
  }finally{window.removeEventListener('usage-data-change',count);}
 });
 assert.equal(dataChanges,0,'navigation and usage filters do not publish new statistics to other pages');
 const agentFilter=await checkAgentFilter(page);
 await page.screenshot({path:path.join(output,'today-stable.png')});assert.deepEqual(run.errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),trace,sessions,changed,agentFilter,errors:run.errors,syntheticOnly:true},null,2));console.log('PASS Today: stable periodic facts, real changes and AgentFilter pre-paint geometry / keyboard / motion modes');
}finally{await run.close();}})().catch(e=>{console.error(e);process.exitCode=1});
