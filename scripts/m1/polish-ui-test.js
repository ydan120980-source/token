'use strict';
/* global document, requestAnimationFrame, getComputedStyle, innerWidth, PointerEvent */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright'),{settle,until,cleanup,keepVisible,isolatePointer}=require('./ui-settle'),{openSettings,pickSelect}=require('./settings-ui-helpers');
const {Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize'),{fixtures}=require('../../tests/m1/fixtures');
const usageUi=require('./usage-ui-helpers');
const { version } = require('../../package.json');
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-polish-')), results=[],output=process.env.POLISH_EVIDENCE_DIR||'artifacts/polish/source';fs.mkdirSync(output,{recursive:true});
 try{
  const home=path.join(root,'home'),fixture=fixtures(home),usage=path.join(root,'usage'),store=new Store(usage,fixture.roots);
  for(let i=0;i<180;i++){const r=normalize('codex',{input_tokens:200000,output_tokens:1000,cached_input_tokens:160000,reasoning_output_tokens:100,total_tokens:201000},{id:'polish-'+i,time:Date.now()-Math.floor(i/80)*86400000,model:i%6?'synthetic-'+i%36:'gpt-6.1-sol',provider:'openai',entry:'desktop'},'synthetic-salt');store.state.records[r.id]=r;}
  store.state.sequence=1;atomic(path.join(usage,'statistics.json'),store.state);store.setEnabled(false);
  for(const scale of [1,1.5]){
   const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--quota-data-dir',path.join(root,'quota-'+scale),'--usage-data-dir',usage,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
   try{
    const page=await app.firstWindow(),errors=[];await keepVisible(app);await isolatePointer(app);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.waitForLoadState('load');await settle(page);
    assert.equal(await page.locator('#appTitlebar').isVisible(),true);
    // The window opens on the home page 概览, and the title bar names every page.
    assert.equal(await page.locator('#main').getAttribute('data-current-view'),'quota');assert.equal(await page.locator('#windowPage').textContent(),'概览');
    for(const [view,name] of [['cost','费用'],['sessions','会话'],['sources','Agent 管理'],['settings','设置'],['quota','概览'],['usage','用量']]){await page.locator('[data-view="'+view+'"]').click();assert.equal(await page.locator('#windowPage').textContent(),name);}
    await settle(page);
    // Appearance follows the system by default; a chosen appearance holds and is remembered.
    // Playwright pins prefers-color-scheme to light, so the system side is emulated here.
    // The settings page, the sidebar button, the native menu and the system all agree (settings is React since M3).
    await openSettings(page);const settings=page.locator('[data-settings-page]'),appearance=settings.getByRole('combobox',{name:'外观',exact:true});
    assert.match(await appearance.textContent(),/跟随系统/);
    await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.body.classList.contains('dark'));
    await pickSelect(settings,page,'外观','浅色');assert.equal(await page.evaluate(()=>document.body.classList.contains('dark')),false);assert.equal(await page.evaluate(()=>localStorage.getItem('agentusage.theme.v1')),'light');
    await app.evaluate(({Menu,BrowserWindow})=>Menu.getApplicationMenu().getMenuItemById('appearance').submenu.items.find(i=>i.label==='色彩外观').submenu.items[0].click(null,BrowserWindow.getAllWindows()[0]));await page.waitForFunction(()=>document.body.classList.contains('dark'));
    assert.match(await appearance.textContent(),/跟随系统/,'the native menu choice shows on the settings page');
    await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>!document.body.classList.contains('dark'));assert.equal(await page.evaluate(()=>localStorage.getItem('agentusage.theme.v1')),'system');
    // Back to usage through history, so the later back/forward steps see the original sequence.
    await page.locator('#windowBack').click();await until(page,()=>document.getElementById('main').dataset.currentView==='usage');await settle(page);
    // Choosing an Agent never shifts the chip row; changing the page range leaves the 30-day strip still.
    const chips=()=>page.evaluate(()=>[...document.querySelectorAll('[data-usage-agents] button')].map(b=>Math.round(b.getBoundingClientRect().left)+':'+Math.round(b.getBoundingClientRect().width)).join());
    const chipRow=await chips();await page.locator('[data-usage-agents] [data-agent="codex"]').click();await page.waitForTimeout(400);assert.equal(await chips(),chipRow,'chips moved when an Agent was chosen');await page.locator('[data-usage-agents] [data-agent="all"]').click();await settle(page);
    const stripEntries=await page.locator('[data-usage-strip] [data-chart]').getAttribute('data-enter-count');
    await usageUi.period(page,'7');assert.equal(await page.locator('[data-usage-strip] [data-chart]').getAttribute('data-enter-count'),stripEntries,'the 30-day strip replayed on a range change');await usageUi.period(page,'all');
    const nativeMenus=await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.map(i=>i.label));assert.deepEqual(nativeMenus,['统计','外观','关于']);
    // The title bar's one ⋯ button pops up the three application menu groups together (UI-SHELL-20261022.md).
    await app.evaluate(({Menu})=>{globalThis.polishPopup=null;globalThis.polishOriginalPopup=Menu.prototype.popup;Menu.prototype.popup=function(){globalThis.polishPopup=this.items.map(i=>i.type==='separator'?'|':i.label);};});
    await page.locator('#windowMenu').click();for(let i=0;i<60&&!(await app.evaluate(()=>globalThis.polishPopup));i++)await page.waitForTimeout(50);
    const popup=await app.evaluate(({Menu})=>{Menu.prototype.popup=globalThis.polishOriginalPopup;delete globalThis.polishOriginalPopup;return globalThis.polishPopup;});
    assert.deepEqual(popup,['刷新当前页面','导出统计…','|','显示 / 隐藏侧栏','切换深浅外观','色彩外观','|','界面动效','设置','|','关于 QuotaDock']);
    assert.equal(await page.locator('#theme').evaluate(e=>e.closest('#appTitlebar')!==null),true,'the light/dark switch lives in the title bar');
    await assert.rejects(page.evaluate(()=>window.windowBridge.menu('login')),/WINDOW_ACTION_REJECTED/);
    await assert.rejects(page.evaluate(()=>window.windowBridge.theme('red')),/WINDOW_ACTION_REJECTED/);
    await app.evaluate(({ dialog }, expected) => {
      globalThis.polishAboutShown = false;
      dialog.showMessageBox = async (_window, options) => {
        globalThis.polishAboutShown = options.message === expected;
        return { response: 0 };
      };
    }, 'QuotaDock ' + version);
    await page.evaluate(()=>window.windowBridge.menu('about'));assert.equal(await app.evaluate(()=>globalThis.polishAboutShown),true);
    await page.locator('[data-view="usage"]').click();await settle(page);await page.locator('[data-view="sources"]').click();await page.locator('#windowBack').click();assert.equal(await page.locator('#main').getAttribute('data-current-view'),'usage');
    await page.locator('#windowForward').click();assert.equal(await page.locator('#main').getAttribute('data-current-view'),'sources');await page.locator('#windowBack').click();await settle(page);
    // Collapsing leaves an icon rail that still navigates; each item names itself in its tooltip.
    await page.locator('#windowSidebar').click();assert.equal(await page.locator('.topbar').evaluate(e=>e.inert),false);await until(page,()=>Math.round(document.querySelector('.topbar').getBoundingClientRect().width)===60);assert.equal(await page.locator('.topbar [data-view="cost"] .nav-label').isVisible(),false);assert.equal(await page.locator('.topbar [data-view="cost"]').getAttribute('title'),'费用');await page.locator('#windowSidebar').click();await settle(page);
    await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));const savedScroll=await page.evaluate(()=>window.scrollY);
    await page.locator('[data-view="sources"]').click();await page.locator('#windowBack').click();
    await until(page,()=>window.uiDetail.activeCount>0||window.scrollY>=499,3000);await settle(page);
    const restoredScroll=await page.evaluate(()=>window.scrollY);
    if(Math.abs(restoredScroll-savedScroll)>=2)fs.writeFileSync(path.join(output,'history-scroll-failure-'+scale+'.json'),JSON.stringify({savedScroll,restoredScroll},null,2));
    assert(Math.abs(restoredScroll-savedScroll)<2);await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));

    await app.evaluate(({Menu,BrowserWindow})=>Menu.getApplicationMenu().getMenuItemById('statistics').submenu.items[1].click(null,BrowserWindow.getAllWindows()[0]));const exportSheet=page.locator('[data-ui-portal] [role="dialog"]');await exportSheet.waitFor({state:'visible'});assert.match(await exportSheet.textContent(),/导出统计/);await page.keyboard.press('Escape');await until(page,()=>!document.querySelector('[data-ui-portal] [role="dialog"]'));await settle(page);
    // Shared Reveal keeps the hit region and exact upper bound stable during repeated pointer updates.
    const price=page.locator('[data-usage-total-cost] button'),before=await price.evaluate(e=>({font:getComputedStyle(e).fontSize,top:e.offsetTop,height:e.offsetHeight}));
    await usageUi.hover(page,price);
    await page.evaluate(async()=>{const b=document.querySelector('[data-usage-total-cost] button');const start=performance.now();await new Promise(resolve=>{function frame(now){b.dispatchEvent(new PointerEvent('pointerover',{bubbles:true}));if(now-start<900)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});});
    await settle(page);
    const after=await price.evaluate(e=>({font:getComputedStyle(e).fontSize,top:e.offsetTop,height:e.offsetHeight,expanded:e.getAttribute('aria-expanded')==='true'}));
    const tip=page.locator('[data-ui-portal] [role=tooltip]'),tipCount=await tip.count();
    if(tipCount!==1){fs.writeFileSync(path.join(output,'tooltip-ownership-'+scale+'.json'),JSON.stringify(await page.evaluate(()=>({focused:{tag:document.activeElement?.tagName,id:document.activeElement?.id,day:document.activeElement?.getAttribute('data-heat-key')},hovered:[...document.querySelectorAll(':hover')].slice(-8).map(e=>({tag:e.tagName,id:e.id,day:e.getAttribute('data-heat-key')})),tips:[...document.querySelectorAll('[data-ui-portal] [role=tooltip]')].map(e=>({id:e.id,text:e.textContent,opacity:getComputedStyle(e).opacity,owner:e.getAttribute('data-tooltip-owner')}))})),null,2));await page.screenshot({path:path.join(output,'tooltip-ownership-'+scale+'.png')});assert.equal(tipCount,1,'the price range must be the only tooltip');}
    const box=await tip.boundingBox();
    assert.equal(after.font,before.font);assert.equal(after.top,before.top);assert.equal(after.height,before.height);assert(after.expanded);
    assert(box.x>=8&&box.x+box.width<=await page.evaluate(()=>innerWidth)-8,'range runs past its row');
    const upper=Number(await page.locator('[data-usage-total-cost] [data-usage-price-upper]').getAttribute('data-usage-price-upper'));
    assert((await tip.innerText()).includes(await page.evaluate(v=>window.displayValues.usd(v),upper)));
    await page.screenshot({path:path.join(output,'stable-price-'+scale+'.png')});await price.press('Escape');await page.mouse.move(4,80);await settle(page);
    // Figure retargeting is verified against the current kit by render-performance.
    // Scrolling over the short card reaches the page; a long card scrolls inside,
    // and then hands the wheel back to the page at both boundaries.
    await usageUi.select(page,'model','gpt-6.1-sol');await settle(page);await usageUi.calendarCells(page).last().press('Enter');await settle(page);await page.locator('[data-usage-day]').scrollIntoViewIfNeeded();
    const list=page.locator('[data-usage-day] [data-slot=scroll-area-viewport]');await list.hover();const shortStart=await page.evaluate(()=>window.scrollY);await page.mouse.wheel(0,240);await page.waitForFunction(y=>window.scrollY>y+5,shortStart);
    await usageUi.select(page,'model','all');await settle(page);await list.scrollIntoViewIfNeeded();await list.hover();const longBounds=await list.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight}));assert(longBounds.scroll>longBounds.height);
    await page.mouse.wheel(0,180);await page.waitForFunction(()=>document.querySelector('[data-usage-day] [data-slot=scroll-area-viewport]').scrollTop>0);
    // A programmatic scrollTop can stop on a fractional offset at non-integer scale; the
    // first wheel only snaps it to the device-pixel end. Reach the end as a user would.
    await list.evaluate(e=>{e.scrollTop=e.scrollHeight;});await page.mouse.wheel(0,40);await settle(page);await page.waitForFunction(()=>{const e=document.querySelector('[data-usage-day] [data-slot=scroll-area-viewport]');return e.scrollHeight-e.clientHeight-e.scrollTop<1;});const bottomStart=await page.evaluate(()=>window.scrollY);await page.mouse.wheel(0,240);await page.waitForFunction(y=>window.scrollY>y+5,bottomStart);
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
    const overlap=await page.evaluate(()=>({navigation:document.querySelector('.topbar').getBoundingClientRect().bottom,heading:document.querySelector('#quota [data-quota-toolbar] h1').getBoundingClientRect().top}));assert(overlap.heading>overlap.navigation+8,JSON.stringify(overlap));
    await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.body.dataset.motion==='reduced');await page.locator('[data-view="usage"]').click();await usageUi.period(page,'today');assert.equal(await page.evaluate(()=>window.uiDetail.activeCount),0);assert.deepEqual(errors,[]);
    results.push({scale,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),productMenus:nativeMenus,history:true,sidebar:true,stableHoverGeometry:true,shortCardWheel:true,longCardWheel:true,bothBoundaryHandoffs:true,themeAndNativeMaximize:true,narrowHeaderSafeArea:true,reduced:true,noErrors:true,realLogin:false});
   }finally{await app.close();}
  }
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: polish checks at 100/150. '+JSON.stringify(results));
 }finally{await cleanup(root);}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
