'use strict';
/* global document, requestAnimationFrame */
// Owner-approved two-line vendor correction, using the existing gallery only.
// The Browser plugin is unavailable; use the repository's isolated Electron harness.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {launch,setTheme}=require('./ui-smoke'),{settle,until}=require('./ui-settle');
const output=process.env.UI_DISCLOSURE_EVIDENCE_DIR||'artifacts/ui-disclosure-motion';fs.mkdirSync(output,{recursive:true});
const frames=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
(async()=>{const session=await launch(),{page,errors}=session,results=[];try{
 await page.evaluate(()=>{const host=document.createElement('div');host.id='disclosureReview';Object.assign(host.style,{position:'absolute',top:'0',left:'0',width:'100%',zIndex:'20'});document.body.appendChild(host);window.__disclosureReview=window.agentUi.mount('kit-gallery',host);});
 const trigger=page.getByRole('button',{name:'展开合成详情',exact:true});await trigger.waitFor();await page.evaluate(()=>document.fonts.ready);
 // A force-mounted closed panel has not been measured yet. Warm its existing
 // layout once, so the full-motion assertion observes a height spring rather
 // than the vendor's initial measurement hand-off (which deliberately snaps).
 await page.evaluate(()=>window.uiMotion.setPreference('off'));await frames(page);await trigger.click();await settle(page);await trigger.click();await settle(page);
 for(const theme of ['light','dark']){await setTheme(page,theme);
  for(const mode of ['system-reduced','reduced','off']){
   await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>window.uiMotion.setPreference('system'));await frames(page);await settle(page);
   // Establish a real full-motion height transition before switching the same mounted component.
   const full=await trigger.evaluate(async button=>{const panel=document.getElementById(button.getAttribute('aria-controls'));window.__disclosureNode=panel.firstElementChild;const samples=[],start=performance.now();button.focus();button.click();await new Promise(resolve=>{const tick=()=>{samples.push(panel.getBoundingClientRect().height);if(performance.now()-start<650)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});return {samples,full:panel.scrollHeight};});
   assert(full.samples.some(height=>height>1&&height<full.full-1),'full keeps a real intermediate height '+JSON.stringify({theme,mode,...full}));await settle(page);await trigger.press('Enter');await settle(page);await until(page,()=>window.__disclosureNode.parentElement.hidden);
   if(mode==='system-reduced')await page.emulateMedia({reducedMotion:'reduce'});else await page.evaluate(value=>window.uiMotion.setPreference(value),mode);await frames(page);
   await trigger.press('Enter');const opened=await trigger.evaluate(async button=>{const panel=document.getElementById(button.getAttribute('aria-controls'));await new Promise(requestAnimationFrame);return {mode:document.body.dataset.motion,height:panel.getBoundingClientRect().height,full:panel.scrollHeight,same:window.__disclosureNode===panel.firstElementChild,focused:document.activeElement===button,expanded:button.getAttribute('aria-expanded')};});
   assert.equal(opened.mode,mode==='system-reduced'?'reduced':mode);assert.equal(opened.expanded,'true');assert.equal(opened.same,true,'mode changes preserve content identity');assert.equal(opened.focused,true);assert(Math.abs(opened.height-opened.full)<1,'direct open by the next frame: '+JSON.stringify(opened));
   await page.screenshot({path:path.join(output,mode+'-'+theme+'.png')});
   await trigger.press('Enter');const closed=await trigger.evaluate(async button=>{const panel=document.getElementById(button.getAttribute('aria-controls'));await new Promise(requestAnimationFrame);return {height:panel.getBoundingClientRect().height,expanded:button.getAttribute('aria-expanded'),focused:document.activeElement===button};});
   assert.equal(closed.expanded,'false');assert.equal(closed.height,0,'direct close by the next frame');assert.equal(closed.focused,true);await settle(page);results.push({theme,mode,full,opened,closed});
  }
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({synthetic:true,results,errors},null,2));console.log('PASS: same mounted Disclosure, full intermediate height, dynamic system/app reduced and off next-frame open/close, both themes, keyboard/focus/node identity.');
}finally{await session.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
