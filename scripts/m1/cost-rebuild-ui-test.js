'use strict';
/* global document */

// Browser plugin not available. Real Electron, isolated synthetic ledger only.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright'),{seed}=require('../../tests/m1/ui-style-fixture');
const {Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize');
const {keepVisible,isolatePointer,cleanup}=require('./ui-settle');
const c=require('./cost-ui-helpers'), checks=require('./cost-migration-checks');
const output=process.env.COST_REBUILD_EVIDENCE_DIR||'artifacts/cost-rebuild-20261018/final',baseline=process.env.COST_REBUILD_BASELINE==='1',chartOnly=process.env.COST_REBUILD_CHART_ONLY==='1';
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const results=[];
  for(const scale of baseline?[1]:[1,1.5]){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'cost-rebuild-')),home=path.join(root,'home'),usage=path.join(root,'usage'),quota=path.join(root,'quota');seed(home,usage);
    const store=new Store(usage),model='personal-agent-with-a-very-long-model-name-and-provider-routing-context-2026-10-preview-thinking';
    for(let i=0;i<14;i++){const name=i===0?model:'synthetic-model-'+i,r=normalize('claude',{input_tokens:8000000,output_tokens:4000000,cache_read_input_tokens:2000000,cache_creation_input_tokens:0},{id:'rebuild-'+i,time:Date.now(),model:name,provider:'synthetic-local',session:'rebuild'},store.state.salt,'exclusive');store.state.records[r.id]=r;store.setPrice({provider:'synthetic-local',model:name,inputUncached:30,output:60,cacheRead:3,cacheWrite:0});}
    for(let i=1;i<14;i++){const d=new Date(),r=normalize('claude',{input_tokens:100,output_tokens:10,cache_read_input_tokens:0,cache_creation_input_tokens:0},{id:'old-month-'+i,time:new Date(d.getFullYear(),d.getMonth()-i,15,12).getTime(),model,provider:'synthetic-local',session:'rebuild'},store.state.salt,'exclusive');store.state.records[r.id]=r;}atomic(path.join(usage,'statistics.json'),store.state);
    const facts=fs.readFileSync(path.join(usage,'statistics.json')),errors=[],app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
    try{
      await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await c.openCost(page);
      for(const width of chartOnly?[1280]:[1600,1280,1000,800]){
        await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,900),width);
        for(const theme of ['light','dark']){
          await page.evaluate(t=>window.settingsHost.theme.set(t),theme);await c.group(page,'model');await c.choosePeriod(page,'all');
          await c.openDetail(page,model);const geometry=await checks.detailGeometry(page);
          assert.equal(await c.detail(page).locator('[data-cost-detail-pricing] dd').first().textContent(),'$30.00');
          assert((await c.sheet(page).getByRole('heading',{name:model,exact:true}).textContent()).includes(model));
          const suffix=width+'-'+theme+'-'+scale;await c.sheet(page).screenshot({path:path.join(output,'detail-'+suffix+'.png')});await c.closeDetail(page);
          await checks.layout(page);await checks.pageGeometry(page);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:path.join(output,'full-'+suffix+'.png'),fullPage:true});
          for(const part of ['composition','months','subscriptions','table-section','coverage','cache']){
            if(part==='subscriptions')await c.tab(page,'花在哪视图','订阅对照');
            else if(part==='composition')await c.tab(page,'花在哪视图','费用构成');
            await page.locator('[data-cost-page] [data-cost-'+part+']').screenshot({path:path.join(output,part+'-'+suffix+'.png')});
          }
          await c.tab(page,'花在哪视图','费用构成');results.push({width,theme,scale,...geometry});
        }
      }
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,1600));await c.openDetail(page,model);
      await c.sheet(page).screenshot({path:path.join(output,'expanded-detail-'+scale+'.png')});await c.closeDetail(page);
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,900));await checks.trend(page);
      assert.equal(await page.locator('[data-cost-cache-row]').count(),18);
      { const list=page.locator('[data-cost-cache-list]');if(await list.evaluate(e=>e.scrollHeight>e.clientHeight)){await list.focus();await page.keyboard.press('End');await require('./ui-settle').until(page,()=>document.querySelector('[data-cost-cache-list]').scrollTop>0);} }
      await c.root(page).getByRole('button',{name:/显示全部 .* 个月/}).click();assert.equal(await page.locator('[data-cost-months] [data-chart-key]').count(),14);
      await c.root(page).getByRole('button',{name:'只看最近 12 个月',exact:true}).click();assert.equal(await page.locator('[data-cost-months] [data-chart-key]').count(),12);
      await require('./cost-reference-cases').run(page,output,scale);
      await c.choosePeriod(page,'7');await c.group(page,'agent');await c.openDetail(page,(await c.names(page))[0]);assert(await c.detail(page).isVisible());await c.closeDetail(page);
      await c.section(page,'projects');await c.pickPeriod(page,'weekly');assert.equal(await page.evaluate(()=>window.insightsHost.get().period),'weekly');
      assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts);assert.deepEqual(errors,[]);

    }finally{await app.close();await cleanup(root);}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: '+(baseline?'baseline captured':chartOnly?'chart pointer/keyboard, full-history disclosures, expanded detail, unknown/zero and unchanged facts at 100/150':'whole cost page, expanded rows, 4 widths, light/dark, 100/150 and unchanged facts'));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
