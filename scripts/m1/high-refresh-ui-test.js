'use strict';
/* global document, requestAnimationFrame, MutationObserver, PointerEvent */
// Native display/vsync and coalesced chart input, with synthetic saved facts only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {launch}=require('./ui-smoke'),{showView,settle,until}=require('./ui-settle');
const out=path.resolve(process.env.HIGH_REFRESH_EVIDENCE_DIR||'artifacts/m12/high-refresh');
(async()=>{fs.mkdirSync(out,{recursive:true});const scale=Number(process.env.HIGH_REFRESH_SCALE||1);assert([1,1.5].includes(scale));const run=await launch({scale});const {app,page}=run;
try{
 await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>window.uiMotion.setPreference('full'));await showView(page,'usage');
 await until(page,()=>window.usageData.ready());
 const chart=page.locator('[data-usage-calendar] [data-chart=heatmap]');await chart.scrollIntoViewIfNeeded();await settle(page);await page.waitForTimeout(2000);
 const displays=await app.evaluate(({screen})=>screen.getAllDisplays().map(d=>({id:d.id,refreshRate:d.displayFrequency,scale:d.scaleFactor})));
 const frames=await page.evaluate(async()=>{const values=[];let last;for(let i=0;i<181;i++)await new Promise(resolve=>requestAnimationFrame(t=>{if(last!==undefined)values.push(t-last);last=t;resolve();}));const sorted=values.toSorted((a,b)=>a-b);return{samples:values.length,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],maxMs:sorted.at(-1),effectiveHz:1000/sorted[Math.floor(sorted.length/2)]};});
 const target=chart.locator('[data-heat-key]:not([aria-disabled=true])').last();await target.hover();await settle(page);
 const burst=await target.evaluate(async cell=>{const tip=document.getElementById('kit-window-chart-tooltip'),box=cell.getBoundingClientRect();let mutations=0;const observer=new MutationObserver(()=>mutations++);observer.observe(tip,{attributes:true,subtree:true,childList:true,characterData:true});const started=performance.now();for(let i=0;i<1000;i++)cell.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:box.x+4+(i%20),clientY:box.y+4}));const dispatchMs=performance.now()-started;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));observer.disconnect();return{events:1000,mutations,dispatchMs,tip:tip.textContent,connected:tip.isConnected,key:cell.dataset.heatKey,described:cell.getAttribute('aria-describedby')};});
 assert(burst.connected&&burst.described==='kit-window-chart-tooltip');assert(burst.mutations<12,'pointer burst commits at display cadence, not 1000 times');
 // A queued pointer update must not resurrect a tooltip after leaving the chart.
 await target.evaluate(cell=>{cell.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:400,clientY:400}));cell.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,relatedTarget:document.body}));});await page.mouse.move(0,0);await settle(page);assert.equal(await page.locator('#kit-window-chart-tooltip').count(),0);
 await target.focus();assert.equal(await target.getAttribute('aria-describedby'),'kit-window-chart-tooltip');await page.keyboard.press('Escape');await settle(page);assert.equal(await page.locator('#kit-window-chart-tooltip').count(),0,'keyboard Escape remains immediate');
 // Page/visibility cleanup also cancels a new queued pointer tip when no tip
 // has been committed yet; it must not appear on the next animation frame.
 await target.evaluate(cell=>{cell.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:400,clientY:400}));window.dispatchEvent(new Event('ui-view-leave'));});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await settle(page);assert.equal(await page.locator('#kit-window-chart-tooltip').count(),0,'page-leave cancels an uncommitted pointer tooltip');
 const report={packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),scale,displays,frames,burst,frameCap:'native vsync; no fixed 60Hz timer, offscreen frame-rate API or disabled frame limiter',errors:run.errors,syntheticOnly:true};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
 assert.deepEqual(run.errors,[]);assert(frames.medianMs<20,'native animation frames remain responsive');
 if(displays.length===1&&displays[0].refreshRate>=120)assert(frames.effectiveHz>=displays[0].refreshRate*.65,'native high-refresh cadence is delivered on the actual display');
 console.log(JSON.stringify(report));
}finally{await run.close();}})().catch(e=>{console.error(e);process.exitCode=1});
