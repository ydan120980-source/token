'use strict';
/* global document */
// Pricing decisions on the React settings page (M3): explicit aliases, manual rates, Agent rules,
// zero versus blank, failure retry and agreement with the saved query. Synthetic data only.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {Store,atomic}=require('../../src/m1/store');
const {roots}=require('../../src/m1/policy');
const {normalize}=require('../../src/m1/normalize');
const {parse}=require('../../src/m1/runtime-catalog');
const {query}=require('../../src/m1/usage-query');
const {settle,until,cleanup,keepVisible}=require('./ui-settle');
const {dialog,input,openPricing,reloadPricing,openPrice,openNewPrice,field,text,waitText,waitClosed,openBilling}=require('./settings-ui-helpers');
(async()=>{
 for(const scale of [1,1.25,1.5]){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'billing-ui-')),home=path.join(root,'home'),usage=path.join(root,'usage'),quota=path.join(root,'quota'),output=path.join(process.env.BILLING_EVIDENCE_DIR||'artifacts/query/billing-ui',String(scale));fs.mkdirSync(home);fs.mkdirSync(output,{recursive:true});
 const store=new Store(usage,roots(home)),model='claude-3-5-sonnet-20241022',key='route/'+model,target='anthropic/claude-3.5-sonnet-20241022';
 store.installCatalog(parse(JSON.stringify(Object.fromEntries(['anthropic','other'].map(provider=>[provider,{models:{'claude-3.5-sonnet-20241022':{modalities:{output:['text']},cost:{input:3,output:15,cache_read:.3,cache_write:3.75}}}}])))));
 const r={...normalize('codex',{input_tokens:100,output_tokens:20,cached_input_tokens:10,cache_creation_input_tokens:0,reasoning_output_tokens:0},{id:'a',model,time:'2026-10-17T05:00:00Z',session:'one'},'synthetic'),provider:'route'};store.state.records[r.id]=r;store.state.sequence=1;atomic(path.join(usage,'statistics.json'),store.state);store.setEnabled(false);
 const customId='custom-11111111-1111-4111-8111-111111111111',definition={schemaVersion:'CustomSourceV1',name:'合成自定义来源',template:'standard',mode:'per-request'};store.state.customSources={[customId]:{id:customId,name:definition.name,definition,version:1,enabled:false,archived:false,roots:[path.join(root,'custom-unused')],files:{},diagnostics:{}}};atomic(path.join(usage,'statistics.json'),store.state);
 const ledger=fs.readFileSync(path.join(usage,'statistics.json')),billingFile=path.join(usage,'billing.json');
 const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
 try{
  const page=await app.firstWindow(),errors=[];await keepVisible(app);page.on('pageerror',e=>errors.push(e.message));
  await openPricing(page,{gap:true});
  // Alias candidates are offered, never applied.
  await openPrice(page,key);const suggestions=dialog(page).locator('[data-suggestions]');await suggestions.waitFor();assert.match(await suggestions.textContent(),/多个候选/);assert.equal(await suggestions.locator('[data-candidate]').count(),2);assert(!fs.existsSync(billingFile));assert.equal(query(path.join(usage,'statistics.json')).total.estimatedCostUsd,null);
  await reloadPricing(page);await settle(page);assert.equal(await dialog(page).count(),1,'refresh keeps the sheet open');assert.equal(await suggestions.locator('[data-candidate]').count(),2,'refresh keeps the candidates');
  await suggestions.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'alias-suggestions.png')});
  const mappingTrigger=dialog(page).getByRole('button',{name:'计费模型',exact:true});
  await suggestions.locator('[data-candidate="'+target+'"]').getByRole('button',{name:'选择此模型'}).click();assert.match(await mappingTrigger.textContent(),new RegExp(target.replace(/\./g,'\\.')));assert(!fs.existsSync(billingFile),'choosing only fills the draft');
  // A filesystem failure must retain the draft and permit retry.
  fs.mkdirSync(billingFile);await dialog(page).getByRole('button',{name:'按此模型计费'}).click();await waitText(page,'mapping-note',/未保存/);assert.equal(await dialog(page).count(),1);assert.match(await mappingTrigger.textContent(),new RegExp(target.replace(/\./g,'\\.')));fs.rmdirSync(billingFile);
  await dialog(page).getByRole('button',{name:'按此模型计费'}).click();await waitClosed(page);assert.equal(JSON.parse(fs.readFileSync(billingFile)).mappings[key],target);assert(query(path.join(usage,'statistics.json')).total.estimatedCostUsd>0);
  // New custom rates stay editable even before the model appears in usage.
  await openNewPrice(page);await field(page,'服务商标识').fill('customvendor');await field(page,'模型标识').fill('custom-standard');await field(page,'输入（不含缓存）').fill('0');await field(page,'输出（含推理）').fill('2');
  const pricingFile=path.join(usage,'pricing.json');fs.mkdirSync(pricingFile);await dialog(page).getByRole('button',{name:'保存价格'}).click();await waitText(page,'probe',/保存失败/);assert.equal(await field(page,'输出（含推理）').inputValue(),'2');fs.rmdirSync(pricingFile);await dialog(page).getByRole('button',{name:'保存价格'}).click();await waitClosed(page);
  await openPrice(page,'customvendor/custom-standard');assert.equal(await field(page,'输入（不含缓存）').inputValue(),'0');assert.equal(await field(page,'缓存读取').inputValue(),'');assert.equal(JSON.parse(fs.readFileSync(pricingFile))['customvendor/custom-standard'].cacheRead,null,'blank stays unknown, not zero');
  await page.evaluate(async()=>{const pricing=await window.usageBridge.pricing();await window.usageBridge.saveBilling({...pricing.billing,mappings:{...pricing.billing.mappings,'unused/alias':'customvendor/custom-standard'}});});
  const referencedPrice=fs.readFileSync(pricingFile);await dialog(page).getByRole('button',{name:'移除手动价格'}).click();await waitText(page,'probe',/先解除对应规则/);assert.equal(await field(page,'输出（含推理）').inputValue(),'2');assert.deepEqual(fs.readFileSync(pricingFile),referencedPrice);assert(query(path.join(usage,'statistics.json')).total.estimatedCostUsd>0);
  await page.screenshot({path:path.join(output,'referenced-rate-protected.png')});
  await page.evaluate(async()=>{const pricing=await window.usageBridge.pricing();delete pricing.billing.mappings['unused/alias'];await window.usageBridge.saveBilling(pricing.billing);});
  await field(page,'输出（含推理）').fill('-1');await dialog(page).getByRole('button',{name:'保存价格'}).click();await waitText(page,'probe',/非负价格/);
  const retainedPrice=pricingFile+'.retained';fs.renameSync(pricingFile,retainedPrice);fs.mkdirSync(pricingFile);await dialog(page).getByRole('button',{name:'移除手动价格'}).click();await waitText(page,'probe',/撤销未完成/);assert.equal(await field(page,'输出（含推理）').inputValue(),'-1');fs.rmdirSync(pricingFile);fs.renameSync(retainedPrice,pricingFile);await dialog(page).getByRole('button',{name:'移除手动价格'}).click();await waitClosed(page);assert(!JSON.parse(fs.readFileSync(pricingFile))['customvendor/custom-standard']);
  // Agent rules: blank is not zero, zero is explicit, restore needs a save.
  await openBilling(page);const codex=page.locator('[data-billing-agent="codex"]'),multiplier=input(codex,'Codex 倍率');await multiplier.fill('');await page.getByRole('button',{name:'保存规则'}).click();assert.match(await codex.textContent(),/空白不等于 0/);assert(!JSON.parse(fs.readFileSync(billingFile)).defaults.codex);
  assert.equal(await page.locator('[data-billing-agent="'+customId+'"]').count(),1,'dynamic custom sources use the same multiplier editor');
  await multiplier.fill('0');const backup=billingFile+'.retained';fs.renameSync(billingFile,backup);fs.mkdirSync(billingFile);await page.getByRole('button',{name:'保存规则'}).click();await waitText(page,'price-result',/未保存/);assert.equal(await multiplier.inputValue(),'0');fs.rmdirSync(billingFile);fs.renameSync(backup,billingFile);await page.getByRole('button',{name:'保存规则'}).click();await waitText(page,'price-result',/已保存/);assert.equal(JSON.parse(fs.readFileSync(billingFile)).defaults.codex.multiplier,0);assert.equal(query(path.join(usage,'statistics.json')).total.estimatedCostUsd,0);
  await codex.getByRole('button',{name:'恢复默认'}).click();assert.equal(JSON.parse(fs.readFileSync(billingFile)).defaults.codex.multiplier,0,'restore alone does not save');assert.equal(await multiplier.inputValue(),'1');await page.getByRole('button',{name:'保存规则'}).click();await until(page,()=>document.querySelector('[data-price-result]').textContent.startsWith('计费规则已保存'));assert.equal(JSON.parse(fs.readFileSync(billingFile)).defaults.codex.multiplier,1);
  // A save that succeeded is reported even when the following read fails.
  const currentPricing=await page.evaluate(()=>window.usageBridge.pricing());await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('usage:pricing');ipcMain.handle('usage:pricing',()=>{throw new Error('SYNTHETIC_PRICE_READ_FAILURE');});});await reloadPricing(page);await waitText(page,'price-result',/已保存.*暂未刷新/);await app.evaluate(({ipcMain},data)=>{ipcMain.removeHandler('usage:pricing');ipcMain.handle('usage:pricing',()=>data);},currentPricing);
  assert.equal((await text(page,'price-result')).includes('暂未刷新'),true);
  await codex.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'billing-rules.png')});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,650));await settle(page);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),ledger);assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({scale,aliasReview:true,refreshKeepsSuggestions:true,noImplicitMapping:true,mappingFailureRetry:true,customRateFailureRetry:true,customZeroNullEdit:true,removeInvalidDraft:true,dynamicSources:true,multiplierBlankRejected:true,multiplierZero:true,multiplierFailureRetry:true,restoreRequiresSave:true,queryMatchesBilling:true,savedThenReadFailure:true,narrowSafety:true,ledgerUnchanged:true},null,2));console.log('PASS '+scale+': explicit aliases, rate/multiplier add/edit/reset; validation, zero/null, failure retry and saved-query consistency.');
 }finally{await app.close();await cleanup(root);}
 }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
