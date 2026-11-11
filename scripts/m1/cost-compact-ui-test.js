'use strict';
// Browser-only tooling cannot inspect the native Electron app. Use the repository
// Playwright runtime with disposable stores, synthetic homes and no real inputs.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright'),{seed}=require('../../tests/m1/ui-style-fixture');
const {Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize');
const {settle,keepVisible,isolatePointer,cleanup}=require('./ui-settle');
const c=require('./cost-ui-helpers'), checks=require('./cost-migration-checks');
const output=process.env.COST_COMPACT_EVIDENCE_DIR||'artifacts/cost-compact-preview';
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const evidence=[],longModel='personal-agent-with-a-long-model-name-'+ 'x'.repeat(120);
 for(const scale of [1,1.25,1.5]){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cost-compact-')),home=path.join(root,'home'),usage=path.join(root,'usage');seed(home,usage);
  const store=new Store(usage),allAgents=['codex','claude','opencode','workbuddy','mimo','gemini','cursor','zcode','deepseek','antigravity'];
  const add=(agent,model,id)=>{const r=normalize(agent,{input_tokens:50000,output_tokens:10000,cache_read_input_tokens:300000,cache_creation_input_tokens:200,reasoning_output_tokens:0},{id,time:Date.now(),model,provider:'style-vendor',entry:'cli'},store.state.salt,'exclusive');store.state.records[r.id]=r;store.setPrice({provider:'style-vendor',model,inputUncached:2,output:10,cacheRead:.2,cacheWrite:2.5});};
  for(const agent of allAgents)add(agent,'gpt-6.1-sol','compact-agent-'+agent);
  for(let i=0;i<24;i++)add('codex',i===23?longModel:'extra-model-'+i,'compact-model-'+i);
  atomic(path.join(usage,'statistics.json'),store.state);const facts=fs.readFileSync(path.join(usage,'statistics.json')),errors=[];
  const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
  try{
   await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1174,850));await c.openCost(page);
   const plot=page.locator('[data-cost-trend] [data-chart=line]');await plot.scrollIntoViewIfNeeded();await plot.focus();await page.keyboard.press('End');
   assert.equal(await page.locator('[data-series-value]').evaluateAll(ns=>ns.filter(n=>n.textContent!=='—').length),10);
   assert(await page.locator('[data-cost-trend-legend]').evaluate(e=>e.getBoundingClientRect().bottom<=e.nextElementSibling.getBoundingClientRect().top+1),'ten-Agent readout above plot');
   await page.screenshot({path:path.join(output,'ten-agent-hover-'+scale+'.png')});await page.mouse.move(0,0);
   for(const [by,name]of [['agent','Codex'],['model','gpt-6.1-sol'],['model',longModel]]){
    await c.group(page,by);const detail=await c.openDetail(page,name);const geometry=await checks.detailGeometry(page);
    await c.sheet(page).screenshot({path:path.join(output,'drawer-'+by+'-'+(name===longModel?'long':'normal')+'-'+scale+'.png')});
    if(by==='agent'){
      assert.equal(await detail.locator('[data-cost-detail-users] > [data-label-row]').count(),25);await checks.scrollList(page,'Agent 的全部模型费用');
    }else{
      assert.equal(await detail.locator('[data-cost-detail-fields] [data-breakdown-row]:not([data-breakdown-row=range])').count(),4);
      assert.equal(await detail.locator('[data-cost-detail-pricing] dd').count(),4);
      assert.equal(await c.sheet(page).getByRole('button',{name:/在用量页查看|复制模型标识/}).count(),2);
      if(name==='gpt-6.1-sol')assert.equal(await detail.locator('[data-cost-detail-users] > [data-label-row]').count(),10);
      else assert.equal(await c.sheet(page).getByRole('heading',{name:longModel,exact:true}).getAttribute('title'),longModel);
    }
    const point=detail.locator('[data-line-point]').last();await point.hover();
    const label=await page.evaluate(()=>window.costHost.get().view.detail.series.at(-1).key);assert((await detail.getByRole('tooltip').textContent()).includes(label));
    evidence.push({scale,by,longModel:name===longModel,...geometry});await c.closeDetail(page);
   }
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,650));await settle(page);
   await c.openDetail(page,longModel);await checks.detailGeometry(page);
   assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts);assert.deepEqual(errors,[]);

    }finally{await app.close();await cleanup(root);}
 }
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2));console.log('PASS: A drawer (25 models, 10 users, bounded model lists), full titles, readable trends and point readout at 100/125/150; narrow stacking and ledger unchanged.');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
