'use strict';
/* global document, getComputedStyle */
// Browser plugin not available: native Electron, isolated stores and synthetic home.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright'),{Store,atomic}=require('../../src/m1/store'),{roots}=require('../../src/m1/policy');
const {showView,until,settle,keepVisible,cleanup}=require('./ui-settle');
const {dialog,openPricing,openPrice,field,waitClosed}=require('./settings-ui-helpers');
const output=process.env.GUIDANCE_EVIDENCE_DIR||'artifacts/source-reliability-20261018/guidance-ui';fs.mkdirSync(output,{recursive:true});
(async()=>{
  const results=[];
  for(const scale of [1,1.5]){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unpriced-guidance-')),home=path.join(dir,'home'),usage=path.join(dir,'usage'),quota=path.join(dir,'quota');fs.mkdirSync(home);
    const store=new Store(usage,roots(home)),time=new Date().toISOString();
    const base={sessionKey:null,entry:'cli',provider:'synthetic-vendor',timestamp:time,inputUncached:100,output:20,cacheRead:30,cacheWrite:0,reasoning:null,totalTokens:150,quality:'measured'};
    const records=[{...base,id:'a'.repeat(64),agent:'deepseek',model:'step-5-preview',cacheRead:null,totalTokens:120},{...base,id:'b'.repeat(64),agent:'antigravity',model:'claude-opus-4-6-thinking',cacheWrite:null},{...base,id:'c'.repeat(64),agent:'claude',model:'no-price'},{...base,id:'d'.repeat(64),agent:'claude',model:'conflicting',usageConflict:true}];
    store.state.records=Object.fromEntries(records.map(r=>[r.id,r]));store.state.statuses.deepseek={agent:'deepseek',status:'partial',observedRecords:1,errors:['SOURCE_BUSY']};atomic(path.join(usage,'statistics.json'),store.state);
    for(const model of ['step-5-preview','claude-opus-4-6-thinking','conflicting'])store.setPrice({provider:'synthetic-vendor',model,inputUncached:2,output:8,cacheRead:.5,cacheWrite:3});store.setEnabled(false);
    const facts=fs.readFileSync(path.join(usage,'statistics.json')),app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000}),errors=[];
    try{
      await keepVisible(app);const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await openPricing(page,{gap:true});
      const row=key=>page.locator('[data-price-models] tr[data-row-key="'+key+'"]'),read=row('synthetic-vendor/step-5-preview'),sheet=dialog(page);await read.waitFor();await openPrice(page,'synthetic-vendor/step-5-preview');const help=sheet.locator('[data-gap-help="synthetic-vendor/step-5-preview"]');await help.waitFor();assert((await help.innerText()).includes('补价格无法补齐'));await help.locator('[data-gap-plain]').waitFor();await help.getByRole('button',{name:'查看步骤'}).first().click();await help.getByText('原始文件没有记录的历史字段无法恢复',{exact:false}).waitFor();
      assert(await help.getByText('处理方法',{exact:true}).evaluate(e=>parseFloat(getComputedStyle(e).fontSize)<=14),'the help subheading stays small');await page.waitForTimeout(350);await page.screenshot({path:path.join(output,'guidance-'+scale+'.png'),fullPage:true});await sheet.screenshot({path:path.join(output,'guidance-detail-'+scale+'.png')});await help.getByRole('button',{name:'检查 DeepSeek Harness',exact:true}).click();await until(page,()=>document.getElementById('main').dataset.currentView==='sources');await waitClosed(page);assert.equal(await sheet.count(),0,'leaving for the source closes the sheet');
      await page.locator('[data-source-agent="deepseek"] button[aria-expanded="true"]').waitFor();
      // The reason sits in the read-path disclosure (UI-SOURCES-MANAGE-20261020.md); it is readable once the disclosure has opened.
      await until(page,()=>document.querySelector('[data-source-agent="deepseek"]').innerText.includes('文件正在写入'));
      await page.evaluate(()=>window.sourcesUi.render());await until(page,()=>document.querySelector('[data-source-agent="deepseek"]').innerText.includes('文件正在写入'));await page.screenshot({path:path.join(output,'targeted-source-'+scale+'.png')});
      await showView(page,'cost');await page.locator('[data-cost-page] [data-cost-gap] button').filter({hasText:'处理方法'}).first().click();await sheet.locator('[data-gap-help]').waitFor();assert.equal(await sheet.count(),1,'the cost page opens the same model sheet');await sheet.getByRole('button',{name:'关闭',exact:true}).click();await waitClosed(page);await openPricing(page,{gap:true});
      const write=row('synthetic-vendor/claude-opus-4-6-thinking');await openPrice(page,'synthetic-vendor/claude-opus-4-6-thinking');const writeHelp=sheet.locator('[data-gap-help="synthetic-vendor/claude-opus-4-6-thinking"]');await writeHelp.waitFor();await writeHelp.getByRole('button',{name:'查看步骤'}).first().click();await writeHelp.getByText('只有确认不收费时',{exact:false}).waitFor();await writeHelp.getByRole('button',{name:'核对手动费率'}).click();await field(page,'缓存写入').fill('0');await sheet.getByRole('button',{name:'保存价格'}).click();await waitClosed(page);await until(page,()=>!document.querySelector('[data-price-models] tr[data-row-key="synthetic-vendor/claude-opus-4-6-thinking"]')?.textContent.includes('未计入'));assert.equal(await write.count(),1,'the model stays listed');
      assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts);assert.equal(new Store(usage,{}).records().find(r=>r.id==='b'.repeat(64)).cacheWrite,null);assert.equal(await read.isVisible(),true);assert.match(await read.textContent(),/未计入/,'the other read gap remains');
      await page.evaluate(()=>window.settingsHost.theme.set('dark'));await settle(page);await page.screenshot({path:path.join(output,'guidance-dark-'+scale+'.png')});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));await settle(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));await page.screenshot({path:path.join(output,'guidance-narrow-'+scale+'.png')});
      assert.deepEqual(errors,[]);results.push({scale,visibleNextSteps:true,targetedSource:true,statusRefreshPreserved:true,costToHelp:true,confirmedFreeWriteFee:true,unknownCountUnchanged:true,ledgerBytesUnchanged:true,dark:true,narrow800:true,errors});
    }finally{await app.close();await cleanup(dir);}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: actionable unpriced reasons, targeted sources, fee confirmation and unchanged facts at 100%/150%.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
