'use strict';
// Real Electron preview, synthetic inputs only. The owner approves the screenshots
// before this layout is merged or packaged; no real source directory is read.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright'),{seed}=require('../../tests/m1/ui-style-fixture');
const {Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize');
const {settle,keepVisible,isolatePointer,cleanup}=require('./ui-settle');
const c=require('./cost-ui-helpers'), checks=require('./cost-migration-checks');
const baseline=process.env.COST_LAYOUT_BASELINE==='1',output=process.env.COST_LAYOUT_EVIDENCE_DIR||'artifacts/cost-layout-preview';
fs.mkdirSync(output,{recursive:true});
(async()=>{
  const results=[];
  for(const scale of baseline?[1.25]:[1.25,1,1.5]){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'cost-layout-')),home=path.join(root,'home'),usage=path.join(root,'usage');seed(home,usage);
    const store=new Store(usage),now=new Date();
    for(let month=0;month<6;month++)for(const agent of ['opencode','workbuddy']){
      const model=agent==='opencode'?'gpt-6.1-sol':'deepseek-v4.1-flash',time=new Date(now.getFullYear(),now.getMonth()-month,2,12).getTime();
      const r=normalize(agent,{input_tokens:3500000,output_tokens:750000,cache_read_input_tokens:24000000,cache_creation_input_tokens:10000,reasoning_output_tokens:0},{id:'layout-'+month+'-'+agent,session:'layout-'+agent,time,model,provider:'style-vendor',entry:'cli'},store.state.salt,'exclusive');
      store.state.records[r.id]=r;
    }
    atomic(path.join(usage,'statistics.json'),store.state);store.settings.subscriptions={codex:20,claude:20,workbuddy:15};store.savePreferences();
    const facts=fs.readFileSync(path.join(usage,'statistics.json')),errors=[];
    const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
    try{
      await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
      await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(...size),scale===1.25?[1174,850]:[1468,980]);
      await c.openCost(page);await c.group(page,'agent');
      const ranged=c.table(page).locator('[data-cost-row-amount]').filter({hasText:/\s–\s/}).first();assert(await ranged.count(),'estimated range exists');
      const before=await ranged.textContent();await ranged.hover();await settle(page);const after=await ranged.textContent();
      assert(!after.includes('NaN'));assert.equal(after,before,'hover retains exact bounds');
      const geometry=await checks.layout(page);await checks.trend(page);
      for(const theme of ['light','dark']){
        await page.evaluate(t=>window.settingsHost.theme.set(t),theme);await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:path.join(output,'overview-'+theme+'-'+scale+'.png')});
        for(const part of ['duo','table-section','coverage']){
          const target=page.locator('[data-cost-page] [data-cost-'+part+']').first();await target.scrollIntoViewIfNeeded();
          await page.screenshot({path:path.join(output,part+'-'+theme+'-'+scale+'.png')});
        }
      }
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,650));await settle(page);
      await checks.layout(page);await page.screenshot({path:path.join(output,'narrow-'+scale+'.png')});
      await c.group(page,'model');await c.openDetail(page,(await c.names(page))[0]);await checks.detailGeometry(page);
      assert(!await c.detail(page).textContent().then(t=>t.includes('NaN')));assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts);
      assert.deepEqual(errors,[]);results.push({scale,baseline,rangeBefore:before,rangeAfter:after,...geometry,errors});

    }finally{await app.close();await cleanup(root);}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: '+(baseline?'baseline evidence captured':'section order, unclipped composition, one-line headings, every desktop column, in-place trend, finite hover bounds, paired checks and narrow safety'));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
