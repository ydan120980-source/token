'use strict';
/* global document, requestAnimationFrame */
// Browser plugin not available. Reprice only the disposable synthetic store.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {launch}=require('./ui-smoke'),{until}=require('./ui-settle'),c=require('./cost-ui-helpers');
const output=process.env.COST_LIVE_EVIDENCE_DIR||'artifacts/ui-mig/M8/live-readout';
(async()=>{
 const session=await launch();fs.mkdirSync(output,{recursive:true});
 try{
  const {page}=session,ledgerFile=path.join(session.root,'usage','statistics.json'),ledger=fs.readFileSync(ledgerFile);
  await c.openCost(page);
  const quotaOnly=await page.evaluate(()=>{const before=window.costHost.get(),version=window.costHost.version();window.dispatchEvent(new Event('quota-change'));return{sameFacts:window.costHost.get().view===before.view,notified:window.costHost.version()>version};});
  assert.deepEqual(quotaOnly,{sameFacts:true,notified:true},'quota notification keeps cost facts and still updates consumers');
  const row=c.row(page,'gpt-6.1-sol');await row.scrollIntoViewIfNeeded();
  const segment=row.locator('[data-stack-key]').first();await row.getByRole('button',{name:'gpt-6.1-sol 的费用详情',exact:true}).focus();await segment.hover();
  await segment.evaluate(element=>{window.liveReadoutSegment=element;});
  const before=await page.evaluate(async()=>{
   const tip=document.getElementById('kit-window-chart-tooltip'),s=await window.usageBridge.get();
   window.liveReadoutProbe={tip,text:tip.textContent,focus:document.activeElement,key:window.liveReadoutSegment.dataset.stackKey};
   return{text:tip.textContent,sequence:s.snapshot.sequence,revision:s.snapshotRevision};
  });
  await page.evaluate(async()=>{
   const s=await window.usageBridge.get(),row=s.snapshot.daily.find(r=>r.model==='gpt-6.1-sol');
   await window.usageBridge.savePrice({provider:row.provider,model:row.model,inputUncached:17,output:29,cacheRead:2,cacheWrite:3});
  });
  // No pointer movement or focus replay is allowed between the update and assertion.
  await until(page,()=>{
   const probe=window.liveReadoutProbe,tip=document.getElementById('kit-window-chart-tooltip');
   const row=window.costHost.get().view.table.find(r=>r.name==='gpt-6.1-sol');
   return tip===probe.tip&&tip.textContent!==probe.text&&row&&[...tip.querySelectorAll('[data-tip-row]')].map(e=>e.textContent.replace(/\s/g,'')).join('|')===row.mix.map(p=>p.label.replace(/\s/g,'')).join('|');
  });
  const after=await page.evaluate(async()=>{
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const s=await window.usageBridge.get(),p=window.liveReadoutProbe,tip=document.getElementById('kit-window-chart-tooltip');
   return{text:tip.textContent,sameNode:tip===p.tip,sameFocus:document.activeElement===p.focus,
    sameKey:window.liveReadoutSegment.isConnected&&window.liveReadoutSegment.dataset.stackKey===p.key,sequence:s.snapshot.sequence,revision:s.snapshotRevision};
  });
  assert.notEqual(after.text,before.text);assert(after.sameNode&&after.sameFocus&&after.sameKey);
  assert.equal(after.sequence,before.sequence);assert(after.revision>before.revision);
  await page.evaluate(async()=>{
   const s=await window.usageBridge.get(),row=s.snapshot.daily.find(r=>r.model==='gpt-6.1-sol');
   await window.usageBridge.savePrice({provider:row.provider,model:row.model,inputUncached:0,output:0,cacheRead:0,cacheWrite:0});
  });
  await until(page,()=>!document.getElementById('kit-window-chart-tooltip'));
  assert.deepEqual(fs.readFileSync(ledgerFile),ledger);assert.deepEqual(session.errors,[]);
  await page.screenshot({path:path.join(output,'open-capsule-after-reprice.png')});
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({before,after,quotaOnly,removedKeyClears:true,ledgerUnchanged:true,errors:session.errors},null,2));
  console.log('PASS: real cost capsule refreshes during synthetic repricing, same node/key/focus and ledger unchanged.');
 }finally{await session.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
