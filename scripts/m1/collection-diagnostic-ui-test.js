'use strict';
/* global document */
// Failed-collection diagnostics in the Sources page's 需要处理 list (UI-COLLECTION-DIAGNOSTIC-20261022.md).
// Synthetic stores only. The main process keeps its real usage:get handler; the test merges a
// sanitized {error, diagnostic} pair into its result, the same shape Service.get() returns.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {Store,atomic}=require('../../src/m1/store');
const {roots}=require('../../src/m1/policy');
const {showView,until,settle,keepVisible,isolatePointer,cleanup}=require('./ui-settle');
const output=process.env.COLLECTION_DIAGNOSTIC_EVIDENCE_DIR||'artifacts/collection-diagnostic-ui-20261022';
fs.mkdirSync(output,{recursive:true});
function seed(usage,home){
  const store=new Store(usage,roots(home)),now=new Date().toISOString();
  const r={id:'a'.repeat(64),sessionKey:'a'.repeat(64),agent:'codex',entry:'cli',provider:'private',model:'fixture',timestamp:now,inputUncached:100,output:20,cacheRead:0,cacheWrite:0,reasoning:0,totalTokens:120,quality:'measured'};
  store.state.records[r.id]=r;store.state.sequence=1;atomic(path.join(usage,'statistics.json'),store.state);
  store.setPrice({provider:'private',model:'fixture',inputUncached:1,output:1,cacheRead:0,cacheWrite:0});store.setEnabled(false);
}
const CASES=[
  {name:'os',inject:{error:'COLLECTION_FAILED',diagnostic:{stage:'source-scan',category:'os',reason:'EACCES'}},what:'没有访问权限',effect:['扫描来源文件','检查该位置的访问权限'],title:['COLLECTION_FAILED','EACCES']},
  {name:'native',inject:{error:'NATIVE_BINARY_MISMATCH',diagnostic:{stage:'native-verification',category:'native',reason:'NATIVE_BINARY_MISMATCH'}},what:'统计组件校验不一致',effect:['统计组件核对','重新安装本应用'],title:['NATIVE_BINARY_MISMATCH']},
  {name:'controlled',inject:{error:'SOURCE_PATH_REJECTED',diagnostic:{stage:'source-scan',category:'contract',reason:'CONTROLLED_ERROR'}},what:'读取位置不被允许',effect:['扫描来源文件'],title:['SOURCE_PATH_REJECTED'],notTitle:'CONTROLLED_ERROR'},
  {name:'timeout',inject:{error:'COLLECTION_TIMEOUT',diagnostic:{stage:'worker',category:'contract',reason:'COLLECTION_TIMEOUT'}},what:'采集超时',effect:['采集进程','稍后重试'],title:['COLLECTION_TIMEOUT']},
  {name:'unknown',inject:{error:'COLLECTION_FAILED',diagnostic:{stage:'collection',category:'unknown',reason:'UNKNOWN'}},what:'原因未知',effect:['出错环节：采集'],title:['COLLECTION_FAILED'],notTitle:'UNKNOWN'},
  {name:'unreported',inject:{error:'COLLECTION_FAILED',diagnostic:null},what:'原因未报告',effect:['已有数据保留不变'],title:['COLLECTION_FAILED'],notEffect:'出错环节'}
];
async function inject(app,value){
  await app.evaluate(({ipcMain,BrowserWindow},next)=>{
    const handlers=ipcMain._invokeHandlers;if(!handlers?.get)throw new Error('ipcMain invoke handlers are not reachable');
    if(!globalThis.__usageGets){globalThis.__usageGets=new Map();for(const name of ['usage:get','usage:getPacked']){const get=handlers.get(name);if(get){globalThis.__usageGets.set(name,get);handlers.set(name,async(...args)=>{const state=await get(...args);return globalThis.__collection?{...state,...globalThis.__collection}:state;});}}}
    globalThis.__collection=next;BrowserWindow.getAllWindows()[0].webContents.send('usage:update');
  },value);
}
(async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'collection-diagnostic-ui-')),home=path.join(root,'home'),usage=path.join(root,'usage'),quota=path.join(root,'quota');fs.mkdirSync(home);seed(usage,home);
  const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',home],timeout:60000});
  const errors=[],evidence={cases:[]};
  try{
    await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow();
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await showView(page,'sources');await until(page,()=>!document.querySelector('[data-source-attention]').textContent.includes('正在读取诊断'));
    assert.equal(await page.locator('[data-attention-collection]').count(),0,'no item while collection has no error');
    assert.equal(await page.locator('#dataBadge').isVisible(),false);
    for(const c of CASES){
      await inject(app,c.inject);
      await until(page,'Boolean(document.querySelector("[data-attention-collection] [data-attention-what]")?.textContent.includes('+JSON.stringify(c.what)+'))');
      const item=page.locator('[data-attention-collection]'),strong=item.locator('[data-attention-what]'),effect=await item.locator('[data-attention-effect]').textContent(),title=await strong.getAttribute('title')||'';
      assert.equal(await item.count(),1);assert.equal(await item.getAttribute('data-attention-item'),'sources');
      assert.match(await strong.textContent(),/^最近一次采集没有完成：/);
      for(const text of c.effect)assert(effect.includes(text),c.name+' effect lacks '+text+': '+effect);
      for(const text of c.title)assert(title.includes(text),c.name+' title lacks '+text+': '+title);
      if(c.notTitle)assert(!title.includes(c.notTitle),c.name+' title must not show '+c.notTitle);
      if(c.notEffect)assert(!effect.includes(c.notEffect),c.name+' effect must not claim '+c.notEffect);
      assert.equal(await item.getByRole('button',{name:/已知悉|恢复待办/}).count(),0,'a live collection failure cannot be acknowledged');
      assert.equal(await item.getByRole('button',{name:'重新检查',exact:true}).count(),1);
      assert.equal(await page.locator('[data-source-attention] [data-attention-item]').first().getAttribute('data-attention-id'),'collection','the live failure leads the list');
      assert.equal(await page.locator('#dataBadge').isVisible(),true);assert.equal(await page.locator('#dataBadge [data-attention-open="sources"]').textContent(),'查看原因');
      evidence.cases.push({name:c.name,what:await strong.textContent(),effect,title});
    }
    // The first case again, for screenshots, focus and navigation.
    await inject(app,CASES[0].inject);await until(page,()=>document.querySelector('[data-attention-collection] [data-attention-what]')?.textContent.includes('没有访问权限'));await settle(page);
    await page.locator('[data-source-attention]').screenshot({path:path.join(output,'attention-light.png')});
    await page.screenshot({path:path.join(output,'window-light.png')});
    await page.locator('#dataBadge').screenshot({path:path.join(output,'badge-light.png')});
    await page.emulateMedia({colorScheme:'dark'});await settle(page);
    await page.locator('[data-source-attention]').screenshot({path:path.join(output,'attention-dark.png')});
    await page.locator('#dataBadge').screenshot({path:path.join(output,'badge-dark.png')});
    await page.emulateMedia({colorScheme:'light'});
    // The badge link survives periodic updates with the same failure (keyboard focus stays).
    await showView(page,'usage');await page.locator('#dataBadge [data-attention-open]').focus();
    await inject(app,CASES[0].inject);await settle(page);
    assert.equal(await page.evaluate(()=>document.activeElement?.matches('#dataBadge [data-attention-open]')),true,'focused 查看原因 survives an unchanged update');
    await page.keyboard.press('Enter');
    await until(page,()=>!document.getElementById('sources').hidden&&document.activeElement?.hasAttribute('data-attention-heading'));
    assert.equal(await page.locator('[data-attention-collection]').isVisible(),true);evidence.badgeOpensList=true;
    // 重新检查 runs the Sources page's own check.
    await page.evaluate(()=>{window.__retry=0;window.addEventListener('sources-refresh-request',()=>window.__retry++);});
    await page.locator('[data-attention-collection]').getByRole('button',{name:'重新检查',exact:true}).click();assert.equal(await page.evaluate(()=>window.__retry),1);evidence.retryUsesSourceRefresh=true;
    await until(page,()=>!window.sourcesHost.get().busy);
    // A completed collection clears the item and the badge.
    await inject(app,{error:null,diagnostic:null});
    await until(page,()=>!document.querySelector('[data-attention-collection]'));
    assert.equal(await page.locator('#dataBadge').isVisible(),false);evidence.clears=true;
    assert.deepEqual(errors,[]);evidence.noPageErrors=true;
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
  }finally{await app.close();await cleanup(root);}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
