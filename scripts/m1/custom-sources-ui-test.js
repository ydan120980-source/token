'use strict';
/* global document, innerWidth */
// Browser plugin not available. Native Electron is exercised with the repository's
// Playwright runtime, isolated homes and synthetic usage/quota stores only.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const { _electron:electron }=require('playwright');
const {Store}=require('../../src/m1/store');
const {roots}=require('../../src/m1/policy');
const {showView,settle,until,cleanup,keepVisible,isolatePointer}=require('./ui-settle');
const {openSettings,openBilling,waitText,pickSelect}=require('./settings-ui-helpers');
const {openSource,source}=require('./sources-ui-helpers');
const output=process.env.CUSTOM_EVIDENCE_DIR || 'artifacts/custom-jsonl/source';
fs.mkdirSync(output,{recursive:true});
async function next(page) {const before=await page.evaluate(()=>window.sourcesHost.custom().step);await page.locator('[data-ui-portal] [role=dialog]').getByRole('button',{name:/^(下一步|生成完整预览|保存并启用)$/}).click();await until(page,new Function('const value=window.sourcesHost.custom();return !value.busy&&(!value.draft||value.step!=='+before+'||Boolean(value.message));'));const message=await page.evaluate(()=>window.sourcesHost.custom().message);assert.equal(message,'','valid wizard action completes without error');await settle(page);}
async function mapField(page,key,value){try{
const label=await page.evaluate(k=>window.sourcesModel.labels[k],key),scope=page.locator('[data-ui-portal] [role=dialog]');await scope.getByRole('button',{name:label,exact:true}).click();const menu=page.getByRole('menu',{name:label,exact:true});await menu.locator('input').fill(value);await menu.getByRole('menuitemradio',{name:new RegExp('^'+value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?: · |$)')}).click();await menu.waitFor({state:'hidden'});
}catch(error){await page.screenshot({path:path.join(output,'mapping-failure-'+key+'.png')});fs.writeFileSync(path.join(output,'mapping-failure-'+key+'.json'),JSON.stringify(await page.evaluate(()=>({mapping:window.sourcesHost.custom().form.mapping,bodyScroll:document.querySelector('[data-sheet-body]')?.scrollTop,active:document.activeElement?.outerHTML,menus:[...document.querySelectorAll('[role=menu]')].map(e=>({name:e.getAttribute('aria-labelledby'),state:e.dataset.state,rect:e.getBoundingClientRect().toJSON(),text:e.textContent}))})),null,2));throw error;}}
const usageUi = require('./usage-ui-helpers');
(async()=>{
 const evidence=[];
 for(const scale of [1,1.5]) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'custom-jsonl-ui-')), home=path.join(root,'fixture-home'), input=path.join(root,'private-agent'), usage=path.join(root,'usage'),quota=path.join(root,'quota');
  fs.mkdirSync(home);fs.mkdirSync(input);
  const now=new Date().toISOString(), sentinel='PRIVATE-BODY-MUST-NOT-LEAVE';
  const event={schemaVersion:'AgentUsageEventV1',mode:'per-request',id:'private-id',sessionId:'private-session',timestamp:now,model:'gpt-5',provider:'openai',inputTokens:100,outputTokens:20,cacheReadTokens:40,cacheWriteTokens:0,reasoningTokens:0,totalTokens:120,content:sentinel};
  const file=path.join(input,'events.jsonl');fs.writeFileSync(file,JSON.stringify(event)+'\n');
  const store=new Store(usage,roots(home));store.setEnabled(false);
  const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--quota-data-dir',quota,'--usage-data-dir',usage,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
  const errors=[];
  try{
   await app.evaluate(({app,BrowserWindow})=>{
    app.on('before-quit',()=>console.error('TEST_APP_BEFORE_QUIT'));
    for(const win of BrowserWindow.getAllWindows()) {
     win.on('close',()=>console.error('TEST_WINDOW_CLOSE'));
     win.webContents.on('render-process-gone',(_event,details)=>console.error('TEST_RENDER_GONE '+JSON.stringify(details)));
    }
   });
   const page=await app.firstWindow();await keepVisible(app);await isolatePointer(app);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
   await showView(page,'sources');await page.locator('[data-sources-page] button:has-text("添加我的 Agent")').waitFor();
   await app.evaluate(({dialog},input)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[input]});},input);
   await page.locator('[data-sources-page] button:has-text("添加我的 Agent")').click();await page.locator('[data-ui-portal] input[required]').fill('我的测试 Agent');
   // IME candidates must not dismiss the sheet.
   await page.locator('[data-ui-portal] input[required]').dispatchEvent('compositionstart');await page.locator('[data-ui-portal] input[required]').press('Escape');
   assert(await page.locator('[data-ui-portal] [role="dialog"]').evaluate(e=>e.getAttribute('role')==='dialog'));
   await page.locator('[data-ui-portal] input[required]').dispatchEvent('compositionend');await page.locator('[data-ui-portal] input[required]').press('ArrowRight');
   await page.locator('[data-ui-portal] button:has-text("选择本地用量目录")').click();await page.locator('[data-custom-location]').filter({hasText:'已确认'}).waitFor();
   await next(page);await next(page);await next(page);
   assert((await page.locator('[data-custom-preview]').innerText()).includes('120'));
   await page.screenshot({path:path.join(output,'preview-'+scale+'.png')});
   await next(page);await next(page);await page.locator('[data-ui-portal] [role="dialog"]').waitFor({state:'hidden'});
   await until(page,async()=>{const value=await window.usageBridge.get();return value.snapshot.daily.reduce((n,r)=>n+r.totalTokens,0)===120;});
   const state=await page.evaluate(()=>window.usageBridge.get()), id=state.snapshot.daily[0].agent;
   assert(state.snapshot.sourceCatalog[id]);assert(!JSON.stringify(state.snapshot).includes(sentinel));assert(!JSON.stringify(state.snapshot).includes(input));assert(!JSON.stringify(state.snapshot).includes('private-id'));
   await openSource(page,id);await source(page,id).getByRole('button',{name:'编辑规则',exact:true}).scrollIntoViewIfNeeded();await settle(page);await page.screenshot({path:path.join(output,'sources-'+scale+'.png')});
   await showView(page,'usage');await page.locator('[data-usage-agents] [data-agent="'+id+'"]').click();await settle(page);assert.equal(await page.evaluate(()=>window.usageHost.filters().agent),id);
   assert.equal(Number((await usageUi.value(page,'totalTokens')).replaceAll(',','')),120);
   await showView(page,'sessions');await page.getByRole('radiogroup',{name:'会话 Agent 筛选',exact:true}).locator('[data-agent="'+id+'"]').click();await settle(page);
   const sessions=await page.evaluate(()=>window.usageBridge.sessions());assert(sessions.sessions.some(s=>s.agent===id));assert(!JSON.stringify(sessions).includes('private-session'));
   await showView(page,'cost');await settle(page);
   await page.screenshot({path:path.join(output,'cost-'+scale+'.png')});
   await openSettings(page,'pricing');await openBilling(page);
   await page.locator('[data-billing-agent="'+id+'"]').waitFor();
   await page.getByRole('button',{name:'保存规则',exact:true}).click();await waitText(page,'price-result',/已保存/);assert.equal((await page.evaluate(()=>window.usageBridge.pricing())).billing.defaults[id].multiplier,1);
   await showView(page,'sources');await source(page,id).getByRole('switch').click();
   await until(page,async()=>{const d=await window.usageBridge.sources();return d.custom.find(s=>s.agent.startsWith('custom-'))?.enabled===false;});
   assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),120);
   // Rename applies a transactional preview without changing call identity or totals.
   await source(page,id).getByRole('button',{name:'编辑规则',exact:true}).click();await page.locator('[data-ui-portal] input[required]').fill('更名后的 Agent');
   await next(page);await next(page);await next(page);await next(page);await next(page);
   await page.locator('[data-ui-portal] [role="dialog"]').waitFor({state:'hidden'});
   await until(page,async()=>Object.values((await window.usageBridge.get()).snapshot.sourceCatalog).some(a=>a.name==='更名后的 Agent'));
   assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),120);
   // Export/import configuration has no selected location and cannot auto-enable.
   const exported=path.join(root,'parser-export.json');
   await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},exported);
   await openSource(page,id);await source(page,id).getByRole('button',{name:'导出配置',exact:true}).click();
   await until(page,async()=>{await window.usageBridge.get();return true;});
   for(let n=0;n<40 && !fs.existsSync(exported);n++)await new Promise(resolve=>setTimeout(resolve,50));
   const config=JSON.parse(fs.readFileSync(exported,'utf8'));assert(!JSON.stringify(config).includes(input));assert(!JSON.stringify(config).includes(sentinel));
   await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},exported);
   await page.locator('[data-sources-page] button:has-text("添加我的 Agent")').click();await page.locator('[data-ui-portal] button:has-text("导入配置文件")').click();await page.locator('[data-ui-portal] [role="dialog"]').waitFor();await until(page,()=>document.querySelector('[data-ui-portal] input[required]').value==='更名后的 Agent');
   assert((await page.locator('[data-custom-location]').innerText()).includes('尚未选择'));
   await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();
   await source(page,id).getByRole('button',{name:'回退上一版',exact:true}).click();
   await until(page,async()=>Object.values((await window.usageBridge.get()).snapshot.sourceCatalog).some(a=>a.name==='我的测试 Agent'));
   assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),120);
   // New mapped source is configured entirely through visible field controls.
   const mappedDir=path.join(root,'mapped-agent');fs.mkdirSync(mappedDir);
   fs.writeFileSync(path.join(mappedDir,'calls.ndjson'),JSON.stringify({call:'b',at:now,usage:{input:70,output:30,read:0,write:0,reason:0},text:sentinel})+'\n');
   await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]});},mappedDir);
   await page.locator('[data-sources-page] button:has-text("添加我的 Agent")').click();await page.locator('[data-ui-portal] input[required]').fill('映射 Agent');await pickSelect(page.locator('[data-ui-portal] [role=dialog]'),page,'记录格式','自定义字段映射');
   await page.locator('[data-ui-portal] button:has-text("选择本地用量目录")').click();await page.locator('[data-custom-location]').filter({hasText:'已确认'}).waitFor();await next(page);
   await page.locator('[data-ui-portal] button:has-text("读取字段结构")').click();await page.locator('[data-custom-sample-info]').filter({hasText:'已检查'}).waitFor();assert(!(await page.locator('[data-ui-portal] [role="dialog"]').innerText()).includes(sentinel));
   for(const [key,value] of Object.entries({id:'call',time:'at',input:'usage.input',output:'usage.output',cacheRead:'usage.read',cacheWrite:'usage.write',reasoning:'usage.reason'}))await mapField(page,key,value);
   await next(page);await pickSelect(page.locator('[data-ui-portal] [role=dialog]'),page,'输入 Token 是否包含缓存？','已经包含缓存读取和写入');await pickSelect(page.locator('[data-ui-portal] [role=dialog]'),page,'输出 Token 是否包含推理？','已经包含推理');
   await next(page);assert((await page.locator('[data-custom-preview]').innerText()).includes('100'));await next(page);await next(page);
   await page.locator('[data-ui-portal] [role="dialog"]').waitFor({state:'hidden'});
   await until(page,async()=>(await window.usageBridge.get()).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0)===220);
   const claudeDir=path.join(root,'claude-compatible');fs.mkdirSync(claudeDir);
   fs.writeFileSync(path.join(claudeDir,'claude.jsonl'),JSON.stringify({type:'assistant',sessionId:'claude-private-session',timestamp:now,message:{id:'claude-call',model:'claude-opus-4',content:sentinel,usage:{input_tokens:70,output_tokens:20,cache_read_input_tokens:10,cache_creation_input_tokens:5,reasoning_output_tokens:0}}})+'\n');
   await app.evaluate(({dialog},dir)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dir]});},claudeDir);
   await page.locator('[data-sources-page] button:has-text("添加我的 Agent")').click();await page.locator('[data-ui-portal] input[required]').fill('兼容 Claude 的 Agent');await pickSelect(page.locator('[data-ui-portal] [role=dialog]'),page,'记录格式','Claude JSONL 格式');
   await page.locator('[data-ui-portal] button:has-text("选择本地用量目录")').click();await page.locator('[data-custom-location]').filter({hasText:'已确认'}).waitFor();
   await next(page);await next(page);await next(page);assert((await page.locator('[data-custom-preview]').innerText()).includes('105'));await next(page);await next(page);
   await page.locator('[data-ui-portal] [role="dialog"]').waitFor({state:'hidden'});
   await until(page,async()=>(await window.usageBridge.get()).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0)===325);
   // One contextual bulk button: with a source stopped it offers 全部读取 first, then 全部停用.
   if(await page.locator('[data-sources-page]').getByRole('button',{name:'全部停用',exact:true}).isHidden()){await page.locator('[data-sources-page]').getByRole('button',{name:'全部读取',exact:true}).click();await page.locator('[data-sources-page]').getByRole('button',{name:'全部停用',exact:true}).waitFor();}
   await page.locator('[data-sources-page]').getByRole('button',{name:'全部停用',exact:true}).click();await until(page,async()=>(await window.usageBridge.sources()).sources.every(s=>!s.enabled));
   assert.equal((await page.evaluate(()=>window.usageBridge.get())).snapshot.daily.reduce((n,r)=>n+r.totalTokens,0),325);
   await page.locator('[data-sources-page]').getByRole('button',{name:'全部读取',exact:true}).click();await until(page,async()=>(await window.usageBridge.sources()).sources.filter(s=>s.custom).every(s=>s.enabled));
   // Native sheet cancellation and narrow viewport preserve accessible controls.
   await page.locator('[data-sources-page] button:has-text("添加我的 Agent")').click();await page.locator('[data-ui-portal] input[required]').press('Escape');await page.locator('[data-ui-portal] [role="dialog"]').waitFor({state:'hidden'});
   await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].setSize(800,600);});
   await page.locator('[data-sources-page] button:has-text("添加我的 Agent")').click();await settle(page);await page.screenshot({path:path.join(output,'narrow-'+scale+'.png')});
   assert(await page.getByRole('dialog').getByRole('button',{name:'下一步',exact:true}).isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await showView(page,'usage');
   assert.equal(errors.length,0,errors.join('\n'));
   evidence.push({scale,identity:await page.title(),standardWizard:true,mappingWizard:true,claudeWizard:true,sourceRollback:true,imeEscapeProtected:true,dynamicFilter:true,billing:true,rename:true,disableRetainsHistory:true,exportImport:true,narrow800:true,consoleErrors:errors});
  }finally{await app.close();await cleanup(root);}
 }
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(evidence,null,2));console.log('PASS: custom JSONL source wizard, mapping, registry, pricing, history and private-data guards at 100%/150%.');
})().catch(error=>{console.error(error);process.exitCode=1;});
