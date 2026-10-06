'use strict';
/* global document, requestAnimationFrame, getComputedStyle, innerWidth, PointerEvent, DOMMatrixReadOnly */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright'),{settle,until}=require('./ui-settle');
const {Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize'),{fixtures}=require('../../tests/m1/fixtures');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-polish-')), results=[],output=process.env.POLISH_EVIDENCE_DIR||'artifacts/polish/source';fs.mkdirSync(output,{recursive:true});
 try{
  const home=path.join(root,'home'),fixture=fixtures(home),usage=path.join(root,'usage'),store=new Store(usage,fixture.roots);
  for(let i=0;i<180;i++){const r=normalize('codex',{input_tokens:200000,output_tokens:1000,cached_input_tokens:160000,reasoning_output_tokens:100,total_tokens:201000},{id:'polish-'+i,time:Date.now()-Math.floor(i/80)*86400000,model:i%6?'synthetic-'+i%36:'gpt-6.1-sol',provider:'openai',entry:'desktop'},'synthetic-salt');store.state.records[r.id]=r;}
  store.state.sequence=1;atomic(path.join(usage,'statistics.json'),store.state);store.setEnabled(false);
  for(const scale of [1,1.5]){
   const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--quota-data-dir',path.join(root,'quota-'+scale),'--usage-data-dir',usage,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
   try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.waitForLoadState('load');await settle(page);
    assert.equal(await page.locator('#appTitlebar').isVisible(),true);
    const nativeMenus=await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.map(i=>i.label));assert.deepEqual(nativeMenus,['统计','外观','关于']);
    await page.locator('[data-window-menu="statistics"]').click();await app.evaluate(({Menu,BrowserWindow})=>Menu.getApplicationMenu().getMenuItemById('statistics').submenu.closePopup(BrowserWindow.getAllWindows()[0].id));
    await assert.rejects(page.evaluate(()=>window.windowBridge.menu('login')),/WINDOW_ACTION_REJECTED/);
    await assert.rejects(page.evaluate(()=>window.windowBridge.theme('red')),/WINDOW_ACTION_REJECTED/);
    await app.evaluate(({dialog})=>{globalThis.polishAboutShown=false;dialog.showMessageBox=async(_w,options)=>{globalThis.polishAboutShown=options.message==='Agent Usage 0.1.0';return {response:0};};});
    await page.evaluate(()=>window.windowBridge.menu('about'));assert.equal(await app.evaluate(()=>globalThis.polishAboutShown),true);
    await page.locator('[data-view="usage"]').click();await settle(page);await page.locator('[data-view="sources"]').click();await page.locator('#windowBack').click();assert.equal(await page.locator('#main').getAttribute('data-current-view'),'usage');
    await page.locator('#windowForward').click();assert.equal(await page.locator('#main').getAttribute('data-current-view'),'sources');await page.locator('#windowBack').click();await settle(page);
    await page.locator('#windowSidebar').click();assert.equal(await page.locator('.topbar').evaluate(e=>e.inert),true);await page.locator('#windowSidebar').click();await settle(page);
    await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));const savedScroll=await page.evaluate(()=>window.scrollY);await page.locator('[data-view="sources"]').click();await page.locator('#windowBack').click();await settle(page);assert(Math.abs(await page.evaluate(()=>window.scrollY)-savedScroll)<2);await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    await app.evaluate(({Menu,BrowserWindow})=>Menu.getApplicationMenu().getMenuItemById('statistics').submenu.items[1].click(null,BrowserWindow.getAllWindows()[0]));await page.locator('#exportDialog').waitFor({state:'visible'});await page.locator('#exportDialog').press('Escape');await settle(page);
    // The desktop functional refinement enlarges rest and scales the visual
    // range on hover. Layout/hit geometry stays stable; upper value never restarts.
    const price=page.locator('#totalCost .cost-value'),before=await price.evaluate(e=>({font:getComputedStyle(e).fontSize,top:e.offsetTop,height:e.offsetHeight}));
    await price.hover();
    await page.evaluate(async()=>{const b=document.querySelector('#totalCost .cost-value');const start=performance.now();await new Promise(resolve=>{function frame(now){b.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));if(now-start<900)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});});
    await settle(page);const after=await price.evaluate(e=>({font:getComputedStyle(e).fontSize,top:e.offsetTop,height:e.offsetHeight,expanded:e.classList.contains('cost-expanded'),upper:e.querySelector('.cost-upper').textContent,scale:new DOMMatrixReadOnly(getComputedStyle(e).transform).a}));assert.equal(after.font,before.font);assert.equal(after.top,before.top);assert.equal(after.height,before.height);assert(after.expanded);assert(after.scale<1);assert.equal(after.upper,await page.evaluate(v=>window.displayValues.usd(v),Number(await price.getAttribute('data-cost-upper'))));
    await page.screenshot({path:path.join(output,'stable-price-'+scale+'.png')});await page.mouse.move(4,80);await settle(page);
    // Repeated same-target updates should complete, rather than restart every frame.
    const repeated=await page.evaluate(async()=>{const e=document.createElement('span');document.body.append(e);window.uiDetail.number(e,'repeated-test',0,v=>String(Math.round(v)));const start=performance.now();let middle;
      await new Promise(resolve=>{function frame(now){window.uiDetail.number(e,'repeated-test',100,v=>String(Math.round(v)));if(now-start>=400&&!middle)middle=e.textContent;if(now-start<900)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});const result={middle,final:e.textContent,active:window.uiDetail.activeCount};e.remove();return result;});assert.equal(repeated.final,'100');assert(Number(repeated.middle)>10&&Number(repeated.middle)<90);assert.equal(repeated.active,0);
    // Scrolling over the short card reaches the page; a long card scrolls inside,
    // and then hands the wheel back to the page at both boundaries.
    await page.locator('#modelFilter').selectOption('gpt-6.1-sol');await settle(page);await page.locator('#heatmap button[data-tokens]').last().press('Enter');await settle(page);await page.locator('#dayDetail').scrollIntoViewIfNeeded();
    const list=page.locator('.day-agent-list');await list.hover();const shortStart=await page.evaluate(()=>window.scrollY);await page.mouse.wheel(0,240);await page.waitForFunction(y=>window.scrollY>y+5,shortStart);
    await page.locator('#modelFilter').selectOption('all');await settle(page);await list.scrollIntoViewIfNeeded();await list.hover();const longBounds=await list.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight}));assert(longBounds.scroll>longBounds.height);
    await page.mouse.wheel(0,180);await page.waitForFunction(()=>document.querySelector('.day-agent-list').scrollTop>0);
    await list.evaluate(e=>{e.scrollTop=e.scrollHeight;});const bottomStart=await page.evaluate(()=>window.scrollY);await page.mouse.wheel(0,240);await page.waitForFunction(y=>window.scrollY>y+5,bottomStart);
    await list.scrollIntoViewIfNeeded();await list.evaluate(e=>{e.scrollTop=0;});await list.hover();const topStart=await page.evaluate(()=>window.scrollY);await page.mouse.wheel(0,-180);await page.waitForFunction(y=>window.scrollY<y-5,topStart);
    await app.evaluate(({Menu,BrowserWindow})=>Menu.getApplicationMenu().getMenuItemById('appearance').submenu.items.find(i=>i.label==='切换深浅外观').click(null,BrowserWindow.getAllWindows()[0]));await page.waitForFunction(()=>document.body.classList.contains('dark'));await settle(page);
    await page.locator('#windowBack').click();await settle(page);await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.maximize();});await until(page,async()=> (await window.windowBridge.state()).maximized);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize());
    await until(page,async()=> !(await window.windowBridge.state()).maximized);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));await page.waitForFunction(()=>innerWidth===800);await settle(page);
    // Read native resize geometry and CSS layout in the same rendering frame.
    const geometry=await page.evaluate(()=>({header:document.querySelector('.app-titlebar-inner').getBoundingClientRect().toJSON(),width:innerWidth,area:window.navigator.windowControlsOverlay?.getTitlebarAreaRect().toJSON()}));
    if(geometry.header.right>geometry.width-100){fs.writeFileSync(path.join(output,'header-failure-'+scale+'.json'),JSON.stringify(geometry,null,2));await page.screenshot({path:path.join(output,'header-failure-'+scale+'.png')});}
    assert(geometry.header.right<=geometry.width-100);assert.equal(await page.locator('#appTitlebar').evaluate(e=>getComputedStyle(e).getPropertyValue('app-region')),'drag');assert.equal(await page.locator('#windowSidebar').evaluate(e=>getComputedStyle(e).getPropertyValue('app-region')),'no-drag');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(output,'dark-titlebar-'+scale+'.png')});
    const overlap=await page.evaluate(()=>({navigation:document.querySelector('.topbar').getBoundingClientRect().bottom,heading:document.querySelector('#quota .page-heading').getBoundingClientRect().top}));assert(overlap.heading>overlap.navigation+8);
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.body.dataset.motion==='reduced');await page.locator('[data-view="usage"]').click();await page.locator('[data-period="today"]').click();assert.equal(await page.evaluate(()=>window.uiDetail.activeCount),0);assert.deepEqual(errors,[]);
    results.push({scale,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),productMenus:nativeMenus,history:true,sidebar:true,stableHoverGeometry:true,continuousTarget:repeated,shortCardWheel:true,longCardWheel:true,bothBoundaryHandoffs:true,themeAndNativeMaximize:true,narrowHeaderSafeArea:true,reduced:true,noErrors:true,realLogin:false});
   }finally{await app.close();}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
