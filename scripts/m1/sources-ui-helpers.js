'use strict';
/* global document */
// M4 helpers mirror settings-ui-helpers: accessible controls and page-owned data hooks only.
const {showView,until}=require('./ui-settle');
const {pickSelect,dialog,waitClosed}=require('./settings-ui-helpers');
const sources=page=>page.locator('[data-sources-page]');
const source=(page,agent)=>page.locator('[data-source-agent="'+agent+'"]');
const installAction=(scope,action)=>scope.locator('[data-source-install-action="'+action+'"] button');
const setupAction=(scope,action)=>scope.locator('[data-source-setup-action="'+action+'"] button');
async function openSources(page){await showView(page,'sources');await until(page,()=>document.querySelector('[data-sources-page]')?.dataset.ready==='true');}
async function openSource(page,agent){await openSources(page);const trigger=source(page,agent).locator('[data-source-paths] button');if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();return source(page,agent);}
async function openSetup(page,agent){await openSources(page);await source(page,agent).getByRole('button',{name:/^管理 /}).click();await until(page,()=>Boolean(window.sourcesHost.setup().current)&&!window.sourcesHost.setup().busy);return dialog(page);}
async function setRead(page,agent,enabled){const control=source(page,agent).getByRole('switch');if((await control.getAttribute('aria-checked')==='true')!==enabled)await control.click();}
const config=page=>page.locator('[data-config-center]');
const custom=page=>dialog(page);
async function closeSourceSheet(page){await dialog(page).getByRole('button',{name:'关闭',exact:true}).click();await waitClosed(page);}
// The directory form is a browser demo only. Exercise that real route in an owned,
// in-memory window without preload; it cannot call a native picker or account bridge.
async function demoDirectoryChecks(app,output,suffix){
 const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');fs.mkdirSync(output,{recursive:true});
 const url=new URL((await app.firstWindow()).url());url.searchParams.set('demo','1');const opened=app.waitForEvent('window');
 const id=await app.evaluate(({BrowserWindow},url)=>{const window=new BrowserWindow({width:1000,height:750,show:true,webPreferences:{contextIsolation:true,sandbox:true,backgroundThrottling:false,partition:'m4-demo-'+Date.now()}});void window.loadURL(url);return window.id;},url.href);
 const page=await opened;
 try{await page.waitForURL(/^file:/);await page.waitForLoadState('load');await until(page,()=>Boolean(window.sourcesHost?.demo));await openSource(page,'codex');assert.equal(await page.evaluate(()=>window.usageBridge===undefined),true);const saved=await page.evaluate(()=>JSON.stringify(window.sourcesHost.get().discovery));
  for(const theme of ['light','dark']){await page.evaluate(value=>window.settingsHost.theme.set(value),theme);const trigger=source(page,'codex').getByRole('button',{name:'添加目录',exact:true});await trigger.click();await dialog(page).waitFor();await page.screenshot({path:path.join(output,'source-demo-'+theme+'-'+suffix+'.png')});await dialog(page).getByRole('button',{name:'关闭',exact:true}).click();await until(page,()=>!document.querySelector('[data-ui-portal] [role=dialog]'));assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
   await trigger.click();const field=dialog(page).getByRole('textbox',{name:'演示目录名称',exact:true});await field.fill('');await dialog(page).getByRole('button',{name:'应用演示选择',exact:true}).click();assert.equal(await field.evaluate(e=>e.checkValidity()),false);assert.equal(await field.evaluate(e=>e.validationMessage),'请输入演示目录名称');await field.fill('合成目录名称');await dialog(page).getByRole('button',{name:'应用演示选择',exact:true}).click();await until(page,()=>!document.querySelector('[data-ui-portal] [role=dialog]'));assert.equal(await page.evaluate(()=>JSON.stringify(window.sourcesHost.get().discovery)),saved,'demo form does not save or read a machine path');
  }
  return {openAfterClose:await dialog(page).count()!==0,synthetic:true,nativeBridge:false};
 }finally{await app.evaluate(({BrowserWindow},id)=>BrowserWindow.fromId(id)?.close(),id);}
}
module.exports={demoDirectoryChecks,sources,source,installAction,setupAction,openSources,openSource,openSetup,setRead,config,custom,dialog,closeSourceSheet,pickSelect};
