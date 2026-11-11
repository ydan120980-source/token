'use strict';
/* global document */
// Whole-page release captures: synthetic usage + injected quota fixtures, no login.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {seed}=require('../../tests/m1/ui-style-fixture'),{fixture}=require('../../tests/m1/quota-hero-fixture');
const {keepVisible,isolatePointer,showView,settle,until,cleanup}=require('./ui-settle');
const {freezeFixtureTimes,installSourceClock}=require('./ui-pixel-clock');
(async()=>{
 const label=process.argv[2]||'after',out=path.resolve(process.env.RELEASE_SCREENSHOT_DIR||'artifacts/handoff-20261102/screenshots',label),root=fs.mkdtempSync(path.join(os.tmpdir(),'ui-pixel-gate-release-full-')),home=path.join(root,'home'),usage=path.join(root,'usage');fs.mkdirSync(out,{recursive:true});
 const fixedTime=process.env.RELEASE_CAPTURE_TIME?Date.parse(process.env.RELEASE_CAPTURE_TIME):null;
 if(fixedTime!==null&&!Number.isFinite(fixedTime))throw Error('INVALID_CAPTURE_TIME');
 const NativeDate=Date;if(fixedTime!==null)global.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixedTime]));}static now(){return fixedTime;}};
 try{seed(home,usage);}finally{global.Date=NativeDate;}
 const fixtureClock=fixedTime===null?null:freezeFixtureTimes(home,root,fixedTime),appRoot=path.resolve(process.env.RELEASE_APP_ROOT||'.');
 let app;const errors=[],captures=[];
 try{
  app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:[path.join(appRoot,'src/quota/main.js')]),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home,'--force-device-scale-factor=1'],timeout:60000});await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  if(fixedTime!==null){await page.addInitScript(ms=>{const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[ms]));}static now(){return ms;}};},fixedTime);await app.evaluate(installSourceClock,fixedTime);await page.reload({waitUntil:'load'});}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1480,960));await page.setViewportSize({width:1480,height:960});
  await app.evaluate(({ipcMain,BrowserWindow},data)=>{for(const [channel,edit]of[['quota:providers',s=>s.accounts=data.providers],['quota:getV2',s=>s.accounts=[data.v2]],['quota:get',s=>s.accounts=[data.v1]]]){const original=ipcMain._invokeHandlers.get(channel);ipcMain._invokeHandlers.set(channel,async(...args)=>{const r=await original(...args);if(r?.ok)edit(r.state);return r;});}for(const win of BrowserWindow.getAllWindows()){win.webContents.send('quota:update');win.webContents.send('quota:providerUpdate');}},fixture(fixedTime??Date.now()));
  await showView(page,'quota');await until(page,()=>document.querySelectorAll('#quotaCards .quota-card').length===5);await until(page,()=>window.usageData.ready());await settle(page);
  await page.locator('[data-widget="quota.windows"]').getByRole('button',{name:'在标题栏显示',exact:true}).click();
  await page.evaluate(()=>window.settingsHost.collection.setEnabled(true));await until(page,async()=>{const s=await window.usageBridge.get();return !s.collecting&&Boolean(s.checkedAt);});await page.evaluate(()=>window.usageBridge.setRefreshInterval(0));
  for(const theme of ['light','dark']){
   await page.evaluate(value=>window.settingsHost.theme.set(value),theme);await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>window.uiMotion.setPreference('full'));
   for(const view of ['quota','usage','cost','sessions','sources','settings']){
    await showView(page,view);if(view==='sessions')await until(page,()=>Boolean(window.sessionsHost.get().list)&&!window.sessionsHost.get().loading);await page.mouse.move(0,0);await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await settle(page);await page.waitForTimeout(600);await page.evaluate(()=>document.fonts.ready);
    const windowFile=theme+'-'+view+'-window.png';await page.screenshot({path:path.join(out,windowFile)});
    // Electron's fullPage capture alone does not expand viewport-sized surfaces
    // or enter offscreen charts. Render the whole page in an actual tall viewport.
    let height=await page.evaluate(()=>Math.min(16000,Math.max(window.innerHeight,document.documentElement.scrollHeight)+64));
    for(let pass=0;pass<3;pass++){await page.setViewportSize({width:1480,height});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));await page.waitForTimeout(600);await settle(page);const actual=await page.evaluate(()=>document.documentElement.scrollHeight);if(actual<=height)break;height=Math.min(16000,actual+64);}
    assert(await page.evaluate(()=>document.documentElement.scrollHeight<=window.innerHeight),'the full page fits its capture viewport');
    const file=theme+'-'+view+'.png';await page.screenshot({path:path.join(out,file)});captures.push({theme,view,file,windowFile,viewport:page.viewportSize(),dimensions:await page.evaluate(()=>({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}))});
    await page.setViewportSize({width:1480,height:960});
   }
  }
  const proofFile=process.env.QUOTA_PACKAGED_EXE?path.join(path.dirname(process.env.QUOTA_PACKAGED_EXE),'resources/app.asar'):path.join(appRoot,'design/desktop-reference/ui/agent-ui.js');
  const productByteProof={kind:process.env.QUOTA_PACKAGED_EXE?'asar':'historical compiled React bundle',sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(proofFile)).digest('hex')};
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({label,executable:process.env.QUOTA_PACKAGED_EXE||'source',appRoot,productByteProof,captureTime:fixedTime===null?null:new Date(fixedTime).toISOString(),fixtureClock,captures,errors,syntheticOnly:true,mode:'full motion, Date-only clock when requested; native performance and collector clock retained; settled window and actual tall viewport'},null,2));if(errors.length)throw Error('RENDERER_ERRORS');console.log('PASS complete screenshots: '+out);
 }finally{if(app)await app.close();await cleanup(root);}
})().catch(e=>{console.error(e);process.exitCode=1});
