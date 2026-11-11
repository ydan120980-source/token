'use strict';
/* global document, getComputedStyle, requestAnimationFrame */
// Formal synthetic font and visible-window acceptance; --font-only omits collection and gestures.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {seed}=require('../../tests/m1/ui-style-fixture');
const {fixture}=require('../../tests/m1/quota-hero-fixture');
const {keepVisible,isolatePointer,showView,settle,until,cleanup}=require('./ui-settle');
(async()=>{
 const label=process.argv[2]||'source',fontOnly=process.argv.includes('--font-only'),out=path.resolve(process.env.RELEASE_WINDOW_EVIDENCE_DIR||'artifacts/release-m11/window',label);fs.mkdirSync(out,{recursive:true});
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'release-visible-')),home=path.join(root,'home'),usage=path.join(root,'usage'),quota=path.join(root,'quota');seed(home,usage);
 let app;const errors=[];
 try{
  app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',home],timeout:60000});
  await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
  const fontResponses=[];page.on('response',response=>{if(/NotoSansSC\.woff2/.test(response.url()))fontResponses.push({url:response.url(),status:response.status()});});
  await page.setViewportSize({width:1280,height:900});await page.emulateMedia({reducedMotion:'no-preference'});
  await app.evaluate(({ipcMain,BrowserWindow},data)=>{
   for(const [channel,edit] of [['quota:providers',s=>s.accounts=data.providers],['quota:getV2',s=>s.accounts=[data.v2]],['quota:get',s=>s.accounts=[data.v1]]]){const original=ipcMain._invokeHandlers.get(channel);ipcMain._invokeHandlers.set(channel,async(...args)=>{const r=await original(...args);if(r?.ok)edit(r.state);return r;});}
   for(const win of BrowserWindow.getAllWindows()){win.webContents.send('quota:update');win.webContents.send('quota:providerUpdate');}
  },fixture(Date.now()));
  // Observe the file response on a fresh navigation; Electron may omit file: entries from Resource Timing.
  await page.reload({waitUntil:'load'});
  await showView(page,'quota');await until(page,()=>document.querySelectorAll('#quotaCards .quota-card').length===5);await settle(page);
  if(!fontOnly){
   await page.locator('[data-widget="quota.windows"]').getByRole('button',{name:'在标题栏显示',exact:true}).click();
   await page.evaluate(()=>window.settingsHost.collection.setEnabled(true));
   await until(page,async()=>!(await window.usageBridge.get()).collecting);await until(page,()=>/已采集/.test(document.getElementById('collectionStatus')?.textContent||''));
  }
  await settle(page);
  const fonts=await page.evaluate(async()=>{await document.fonts.load('500 16px "Noto Sans SC"','概览已采集');await document.fonts.ready;return {check:document.fonts.check('500 16px "Noto Sans SC"','概览已采集'),faces:[...document.fonts].map(f=>({family:f.family,status:f.status})),resources:performance.getEntriesByType('resource').filter(r=>/NotoSansSC\.woff2/.test(r.name)).map(r=>({name:r.name,duration:r.duration}))};});
  const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');const dom=await cdp.send('DOM.getDocument');const node=await cdp.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#quota h1'});fonts.platform=await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId});
  fonts.responses=fontResponses;fs.writeFileSync(path.join(out,'font-proof.json'),JSON.stringify(fonts,null,2));
  assert(fonts.check&&fonts.faces.some(f=>/Noto Sans SC/.test(f.family)&&f.status==='loaded'));assert(fontResponses.some(r=>r.status===200));assert(fonts.platform.fonts.some(f=>f.isCustomFont&&/Noto/.test(f.familyName)&&f.glyphCount>0));
  const states=[],visualIssues=[];
  for(const dark of fontOnly?[]:[false,true]){
   await page.evaluate(v=>window.settingsHost.theme.set(v?'dark':'light'),dark);await page.mouse.move(0,0);await settle(page);await page.waitForTimeout(350);
   const alignment=await page.evaluate(()=>{const readout=document.querySelector('.titlebar-readout'),status=document.querySelector('#collectionStatus'),a=readout.getBoundingClientRect(),b=status.getBoundingClientRect();const textBox=el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{y:r.y,height:r.height,font:s.fontFamily,size:s.fontSize,lineHeight:s.lineHeight};};const quotaText=textBox(readout.querySelector('[data-title-readout] > span')),collectionText=textBox(status.querySelector('span'));return{quota:{text:readout.textContent,y:a.y,height:a.height},collection:{text:status.textContent,y:b.y,height:b.height},quotaText,collectionText,centerDelta:Math.abs(a.y+a.height/2-b.y-b.height/2),textCenterDelta:Math.abs(quotaText.y+quotaText.height/2-collectionText.y-collectionText.height/2)};});assert.match(alignment.collection.text,/已采集/);assert(alignment.quota.text.trim());assert(alignment.centerDelta<=1);
   if(alignment.textCenterDelta>1)visualIssues.push({name:'titlebar-text',dark,expected:'quota readout and collected text align',textCenterDelta:alignment.textCenterDelta,owner:'Codex repair required'});
   const feedback=[];
   for(const [name,selector] of [['widget','[data-widget="quota.windows"]'],['agent','#quotaCards [data-provider-row="codex"]']]){
    const target=page.locator(selector);await target.scrollIntoViewIfNeeded();await page.mouse.move(0,0);await page.waitForTimeout(350);
    const read=()=>target.evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return{shadow:s.boxShadow,popShadow:s.getPropertyValue('--pop-shadow'),hovered:el.matches(':hover'),transform:s.transform,width:r.width,height:r.height};});
    const idle=await read();await page.screenshot({path:path.join(out,(dark?'dark':'light')+'-'+name+'-idle.png')});
    await target.hover({position:{x:18,y:18}});await page.waitForTimeout(350);const hover=await read();assert.equal(hover.hovered,true,'pointer reaches '+name);
    await page.screenshot({path:path.join(out,(dark?'dark':'light')+'-'+name+'-hover.png')});
    if(hover.shadow===idle.shadow)visualIssues.push({name,dark,expected:'hover deepens shadow',idle:idle.shadow,hover:hover.shadow,owner:'Codex repair required'});
    await page.mouse.down();await page.waitForTimeout(100);const pressed=await read();await page.mouse.move(0,0);await page.mouse.up();
    const rebound=await target.evaluate(async el=>{const start=performance.now(),samples=[];while(performance.now()-start<650){const r=el.getBoundingClientRect();samples.push({ms:performance.now()-start,width:r.width,height:r.height,transform:getComputedStyle(el).transform,scale:getComputedStyle(el).scale});await new Promise(resolve=>requestAnimationFrame(resolve));}return samples;});
    await page.waitForTimeout(350);const release=await read();
    assert(pressed.width<idle.width-.01,'press visibly gives: '+name);assert(Math.abs(release.width-idle.width)<1,'release returns to rest: '+name);
    assert(new Set(rebound.map(r=>r.width.toFixed(3))).size>2,'release passes through multiple rendered states: '+name);
    feedback.push({name,idle,hover,pressed,rebound,release});await page.screenshot({path:path.join(out,(dark?'dark':'light')+'-'+name+'-released.png')});
   }
   await page.locator('#quota h1').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,(dark?'dark':'light')+'-titlebar.png')});states.push({dark,alignment,feedback});
  }
  if(!fontOnly)await page.evaluate(()=>window.settingsHost.collection.setEnabled(false));
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({label,fontOnly,executable:process.env.QUOTA_PACKAGED_EXE||'source',fonts,states,visualIssues,errors,syntheticOnly:true,physicalHandFeel:fontOnly?'not run':'automated visible-window trajectories; subjective physical feel not measured'},null,2));
  if(visualIssues.length)throw Error('VISUAL_REVIEW_REQUIRED: '+JSON.stringify(visualIssues));
  console.log('PASS '+(fontOnly?'Noto glyph rendering':'visible-window observations and Noto glyph rendering')+': '+out);
 }finally{if(app)await app.close();await cleanup(root);}
})().catch(e=>{console.error(e);process.exitCode=1});
