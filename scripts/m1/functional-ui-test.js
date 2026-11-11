'use strict';
/* global document,  getComputedStyle, innerWidth */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {Store,atomic}=require('../../src/m1/store');
const {normalize}=require('../../src/m1/normalize');
const {fixtures}=require('../../tests/m1/fixtures');
const {settle,until,cleanup,keepVisible}=require('./ui-settle');
const {dialog,input,openSettings,openPricing,openPrice,field,waitClosed,openBilling,pickCombobox,pickSelect}=require('./settings-ui-helpers');
const usageUi=require('./usage-ui-helpers');
const {usageFunctionalChecks}=require('./usage-functional-checks');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'usage-functional-')),output=process.env.FUNCTIONAL_EVIDENCE_DIR||'artifacts/m2-functional/source';fs.mkdirSync(output,{recursive:true});const results=[];
 const home=path.join(root,'home'),fixture=fixtures(home),usage=path.join(root,'usage'),store=new Store(usage,fixture.roots);
 const models=['gpt-6.1-sol','gpt-6-luna','claude-sonnet-5-5','mimo-v2.5-pro','deepseek-v4-flash','gpt-5.4','auto'];
 for(let day=0;day<120;day++)for(let j=0;j<models.length;j++){
  const input=Math.round((1.5+Math.sin(day*.22+j)**2)*1000000),cached=500000,outputTokens=80000+j*1000;
  const record=normalize(j===5?'opencode':'codex',{input_tokens:input,output_tokens:outputTokens,cached_input_tokens:cached,cache_write_tokens:models[j]==='gpt-6.1-sol'?undefined:0,reasoning_output_tokens:10000,total_tokens:input+outputTokens+(j===5?10000:0)},{id:'functional-'+day+'-'+j,time:Date.now()-day*86400000,provider:j===5?'route-demo':'openai',model:models[j],entry:'desktop'},'synthetic-salt');
  store.state.records[record.id]=record;
 }
 store.state.sequence=1;atomic(path.join(usage,'statistics.json'),store.state);store.setEnabled(false);
 try{for(const scale of [1,1.5]){
  const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota-'+scale),'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
  try{
   const page=await app.firstWindow(),errors=[];await keepVisible(app);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.waitForLoadState('load');await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.show();window.focus();});await page.locator('[data-view="usage"]').click();await settle(page);
   const {rest,motion}=await usageFunctionalChecks(page,app,{scale,output,openSettings,pickSelect});
   await openPricing(page);await until(page,()=>document.querySelectorAll('[data-price-models] tr[data-row-key]').length>=7);assert.equal(await page.getByRole('button',{name:'清空统计并暂停',exact:true}).count(),0);
   const rows=page.locator('[data-price-models] tr[data-row-key]'),autoRow=page.locator('[data-price-models] tr[data-row-key="openai/auto"]');
   const autoMapped=Boolean((await page.evaluate(()=>window.usageBridge.pricing())).billing.mappings['openai/auto']);assert.equal((await autoRow.textContent()).includes('未计入'),!autoMapped,'an unmapped route is marked as left out; the second scale pass reuses the first pass mapping');
   // A click anywhere on the row opens its sheet; here the billing-basis cell.
   await autoRow.locator('td').nth(1).click();await dialog(page).waitFor();const mapping=dialog(page).getByRole('button',{name:'计费模型',exact:true});
   if(autoMapped)assert.match(await mapping.textContent(),/openai\/gpt-6\.1-sol/);else await pickCombobox(dialog(page),page,'计费模型','openai/gpt-6.1-sol');
   await dialog(page).getByRole('button',{name:'按此模型计费',exact:true}).click();await waitClosed(page);await until(page,()=>!document.querySelector('[data-price-models]').textContent.includes('未计入'),20000);
   const state=await page.evaluate(()=>window.usageBridge.get());assert(state.snapshot.daily.every(r=>r.pricedTokens===r.totalTokens),JSON.stringify(state.snapshot.daily.filter(r=>r.pricedTokens!==r.totalTokens).slice(0,2)));
   await page.screenshot({path:path.join(output,'mapping-'+scale+'.png')});
   await openBilling(page);const card=page.locator('[data-billing-agent="codex"]');await pickSelect(card,page,'Codex 计费模式','指定默认模型');await card.getByRole('button',{name:'Codex 默认模型',exact:true}).click();
   // The default-model list scrolls inside its popup, which is opaque and readable (fluid surface, no legacy blur).
   const menu=page.locator('[data-ui-portal] [role="menu"]'),menuScroll=menu.locator('[data-slot="scroll-area-viewport"]');await menu.waitFor();await menuScroll.hover();await page.mouse.wheel(0,350);await until(page,()=>document.querySelector('[data-ui-portal] [role="menu"] [data-slot="scroll-area-viewport"]').scrollTop>0);
   assert.equal(await menu.evaluate(e=>{let node=e,color='rgba(0, 0, 0, 0)';while(node&&/rgba\(.*, 0\)$|transparent/.test(color)){color=getComputedStyle(node).backgroundColor;node=node.parentElement;}const m=color.match(/[\d.]+/g).map(Number);return (m[3]??1)>=.99;}),true,'the popup surface is opaque');
   await menu.locator('input').fill('gpt-6.1-sol');await page.screenshot({path:path.join(output,'model-picker-'+scale+'.png')});await menu.getByRole('menuitemradio',{name:'openai/gpt-6.1-sol',exact:true}).click();
   await pickSelect(card,page,'Codex 计费模式','实际记录模型');assert.equal(await card.getByRole('button',{name:'Codex 默认模型',exact:true}).count(),0);
   await input(card,'Codex 倍率').fill('1.5');await page.getByRole('button',{name:'保存规则',exact:true}).click();await until(page,async()=> (await window.usageBridge.pricing()).billing.defaults.codex?.multiplier===1.5);await page.screenshot({path:path.join(output,'billing-'+scale+'.png')});
   const filter=page.getByRole('textbox',{name:'筛选已用模型',exact:true});assert.equal(await rows.count(),7);await filter.fill('mimo-v2.5');await until(page,()=>document.querySelectorAll('[data-price-models] tr[data-row-key]').length===1);
   await filter.fill('');await openPrice(page,'openai/auto');await dialog(page).getByRole('tab',{name:'手动价格',exact:true}).click();
   // The dry run matches the saved estimate exactly and shows it to six decimals.
   const values={};for(const [name,label] of [['inputUncached','输入（不含缓存）'],['output','输出（含推理）'],['cacheRead','缓存读取'],['cacheWrite','缓存写入']])values[name]=await field(page,label).inputValue();
   const probeCheck=await page.evaluate(async values=>{const probe=await window.usageBridge.probePrice(window.uiPricing.entry('openai','auto',values)),state=await window.usageBridge.get(),row=state.snapshot.daily.filter(r=>r.model==='auto').at(-1);return {probe:probe.sample.lower,saved:row.estimatedCostUsd};},values);assert(Math.abs(probeCheck.probe-probeCheck.saved)<1e-12);await page.waitForFunction(value=>document.querySelector('[data-probe]').textContent.includes(value.toFixed(6)),probeCheck.probe);
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-ui-portal] [role="dialog"]')).opacity==='1');await page.screenshot({path:path.join(output,'editor-'+scale+'.png')});
   await field(page,'输入（不含缓存）').fill('1.1');await field(page,'输出（含推理）').fill('2.2');await dialog(page).getByRole('button',{name:'保存价格',exact:true}).click();await until(page,async()=> (await window.usageBridge.pricing()).models.find(r=>r.provider==='openai'&&r.model==='auto').origin==='manual');await waitClosed(page);
   await openPrice(page,'openai/auto');await dialog(page).getByRole('button',{name:'移除手动价格',exact:true}).click();await until(page,async()=> (await window.usageBridge.pricing()).models.find(r=>r.provider==='openai'&&r.model==='auto').origin==='mapped');await waitClosed(page);
   await page.getByRole('button',{name:'立即同步',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-price-result]').textContent.includes('未完成'));assert((await page.evaluate(()=>window.usageBridge.pricing())).models.length>7000);
   await page.locator('[data-pricing-summary]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'pricing-'+scale+'.png')});
   await page.locator('[data-view="usage"]').click();await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.body.dataset.motion==='reduced');assert.equal(await page.locator('body').getAttribute('data-motion'),'reduced');await usageUi.period(page,'all');assert.equal(await page.locator('[data-usage-total-tokens] span.absolute').count(),0,'reduced mode uses direct readouts');
   await page.locator('#theme').click();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));await settle(page);await page.locator('[data-usage-trend]').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'dark-narrow-'+scale+'.png')});
   await openSettings(page,'pricing');await page.locator('[data-pricing-summary]').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'pricing-dark-narrow-'+scale+'.png')});
   assert.deepEqual(errors,[]);results.push({scale,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),rest,allSyntheticModelsPriced:true,manualMapping:true,defaultsPersistent:true,offlineSyncFailurePreservesCache:true,trendAnimationFrames:motion.length,chartReused:true,reducedMotion:true,noHorizontalOverflow:true,errors});fs.writeFileSync(path.join(output,'animation-'+scale+'.json'),JSON.stringify(motion,null,2));
  }finally{await app.close();}
 }}finally{await cleanup(root);}
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: functional usage and original pricing controls. '+JSON.stringify(results));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
