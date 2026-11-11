'use strict';
/* global document, getComputedStyle */
const assert=require('node:assert/strict');
const {runPageSmoke}=require('./ui-page-smoke-template');
const {until}=require('./ui-settle');
const cost=require('./cost-ui-helpers');
(async()=>{
 await runPageSmoke({view:'cost',ready:'[data-cost-page]',output:process.env.COST_SMOKE_EVIDENCE_DIR||'artifacts/ui-mig/M8/smoke',
  dialogs:[
   {trigger:'[data-cost-page] button[aria-label="用日历选择范围"]',dialog:'[role=dialog][data-cost-range-sheet]'},
   {trigger:'[data-cost-table] tr[data-row-key]:first-child button',dialog:'[role=dialog]:has([data-cost-detail])'},
  ],
  assertPage:async page=>{
   const snapshot=await page.evaluate(()=>({lower:window.costHost.get().view.comp.lower,host:typeof window.costHost.get,ui:typeof window.costUi.locate}));
   assert.equal(snapshot.host,'function');assert.equal(snapshot.ui,'function');assert(snapshot.lower>0);
   assert.equal(await page.locator('[data-island-host=cost-summary]').count(),0);
   assert.equal(await page.locator('#costDialog').count(),0);
   assert.equal(await page.evaluate(()=>window.uiDetail.activeCount),0);
   const coverage=await page.locator('[data-cost-coverage] [data-ring-key=coverage]').evaluate(element=>{
    const probe=document.createElement('span');document.body.append(probe);
    probe.style.color='var(--good-text)';const on=getComputedStyle(probe).color;
    probe.style.color='var(--fill)';const track=getComputedStyle(probe).color;probe.remove();
    return {on,track,actualOn:getComputedStyle(element.children[1]).stroke,
     actualTrack:getComputedStyle(element.children[0]).stroke};
   });
   assert.equal(coverage.actualOn,coverage.on,'coverage ring keeps main good-text colour');
   assert.equal(coverage.actualTrack,coverage.track,'coverage ring keeps main fill track');
   assert(await cost.root(page).getByRole('heading',{name:'费用',exact:true}).evaluate(e=>{
    const h=e.getBoundingClientRect(),r=e.closest('[data-cost-page]').getBoundingClientRect();
    const n=document.querySelector('.topbar nav').getBoundingClientRect();
    return h.left>=r.left&&h.right<=r.right&&h.top>=r.top&&h.left>n.right+8;
   }),'heading stays in content clear of navigation');

   await cost.section(page,'projects');await until(page,()=>Boolean(window.insightsHost.get().view));
   assert(!/仅本机估算，不控制 Agent|按项目查看用量，并为自然周期设置本机预算提醒|按公开价目，不是账单/.test(await cost.root(page).textContent()),'no explanatory small print on the cost page (owner 2026-10-27/28)');
   assert(await cost.root(page).getByRole('heading',{name:'预算提醒',exact:true}).isVisible());
   assert(await cost.root(page).getByRole('button',{name:'保存预算',exact:true}).isEnabled(),'budget submit is available');
   // The reference styling is retired (UI-COST-KIT-20261028.md): no ff-ref classes, no reference stylesheet.
   assert.equal(await page.locator('[class*="ff-ref-"],[data-cost-reference]').count(),0,'no reference styling remains');
   await cost.section(page,'analysis');
  }
 });console.log('PASS: M8 cost smoke from page template, both themes, isolated layers, data semantics and sheet focus.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});

