'use strict';
/* global document, getComputedStyle, innerWidth */
// Browser plugin unavailable: actual Electron pointer/keyboard paths, disposable synthetic homes.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright'),{seed}=require('../../tests/m1/ui-style-fixture');
const {Store,atomic}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize');
const {showView,settle,keepVisible,isolatePointer,cleanup,until}=require('./ui-settle');

const output=process.env.COST_COMPOSITION_EVIDENCE_DIR||'artifacts/cost-motion-20261024';fs.mkdirSync(output,{recursive:true});
async function gapTrace(page,selector,paint=''){
  const buttons=page.locator(selector);await buttons.first().scrollIntoViewIfNeeded();await page.waitForTimeout(1400);
  const pair=await buttons.evaluateAll(nodes=>{for(let i=0;i<nodes.length-1;i++){const a=nodes[i].getBoundingClientRect();if(!a.width||a.y<60)continue;for(let j=i+1;j<nodes.length;j++){const b=nodes[j].getBoundingClientRect();if(Math.abs(a.y-b.y)<1&&b.left>a.right+1&&b.left-a.right<16)return {a:{x:a.x,y:a.y,width:a.width,height:a.height},b:{x:b.x},index:i};}}return null;});assert(pair,'the chart has a real gap to cross: '+selector);
  const sample=buttons.nth((pair.index+8)%await buttons.count()),trace=[];
  const rest=await sample.evaluate(e=>({opacity:getComputedStyle(e).opacity,fillOpacity:getComputedStyle(e).fillOpacity}));
  for(let i=0;i<8;i++){
    const gap=i%2,x=gap?(pair.a.x+pair.a.width+pair.b.x)/2:pair.a.x+pair.a.width/2,y=pair.a.y+pair.a.height/2;
    await page.mouse.move(x,y);await page.waitForTimeout(220);
    trace.push({gap:Boolean(gap),opacity:await sample.evaluate((e,paint)=>getComputedStyle(paint?e.querySelector(paint):e).opacity,paint),hit:await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName,{x,y}),fillOpacity:await sample.evaluate(e=>getComputedStyle(e).fillOpacity),tip:await page.locator('#kit-window-chart-tooltip').count()});
  }
  assert(trace.every(row=>row.opacity===rest.opacity&&row.fillOpacity===rest.fillOpacity),'crossing cell gaps must never pulse other cells: '+selector+' '+JSON.stringify(trace));
  await page.mouse.move(0,80);return {selector,trace};
}
(async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cost-composition-')),home=path.join(root,'home'),usage=path.join(root,'usage');seed(home,usage);
 const store=new Store(usage),now=new Date(),ids=['workbuddy','opencode','mimo','zcode','gemini','cursor'];
 for(let m=0;m<8;m++)for(const [i,agent]of ids.entries()){
   const r=normalize(agent,{input_tokens:1000000*(m+1),output_tokens:200000,cache_read_input_tokens:400000,cache_creation_input_tokens:0},{id:'composition-'+m+'-'+i,time:new Date(now.getFullYear(),now.getMonth()-m,Math.min(10,now.getDate()),12).getTime(),model:i===5?'unknown-price':'gpt-6.1-sol',provider:'style-vendor',session:'composition-'+i},store.state.salt,'exclusive');store.state.records[r.id]=r;
 }
 store.settings.subscriptions={codex:20,claude:20};store.savePreferences();atomic(path.join(usage,'statistics.json'),store.state);const facts=fs.readFileSync(path.join(usage,'statistics.json'));
 const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home],timeout:60000});
 try{
  await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.stack));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1468,1000));await showView(page,'usage');
  const traces=[];traces.push(await gapTrace(page,'[data-usage-strip] [data-bar-shape]'));traces.push(await gapTrace(page,'[data-usage-calendar] [data-heat-key]'));traces.push(await gapTrace(page,'[data-usage-week-hour] [data-heat-key]'));
  await page.locator('[data-usage-calendar] [data-level="4"], [data-usage-calendar] [data-level="3"]').last().click();
  if(await page.locator('[data-usage-hours] [data-bar-shape]').count())traces.push(await gapTrace(page,'[data-usage-hours] [data-bar-shape]'));
  const c=require('./cost-ui-helpers');await c.openCost(page);
  assert.equal(await page.locator('[data-cost-range-sheet]').count(),0);
  const range=c.root(page).getByRole('button',{name:'用日历选择范围',exact:true});await range.hover();
  assert.equal(await range.evaluate(e=>getComputedStyle(e).opacity),'1');
  await range.click();
  for(const label of ['累计','30 天','7 天','今日'])assert.equal(await page.locator('[data-cost-range-sheet]').getByRole('tab',{name:label,exact:true}).count(),1);
  await page.keyboard.press('Escape');await until(page,()=>!document.querySelector('[data-cost-range-sheet]'));
  await c.openRange(page);await page.keyboard.press('Escape');await until(page,()=>!document.querySelector('[data-cost-range-sheet]'));
  const comp=page.locator('[data-cost-composition]');await comp.scrollIntoViewIfNeeded();
  assert(await comp.locator('[data-chart=ring] svg').evaluate(e=>e.getBoundingClientRect().width>=160));
  const legend=await comp.locator('[data-legend-variant=tiles]').evaluate(e=>({rows:e.children.length,clipped:[...e.querySelectorAll('[data-legend-key] span')].filter(n=>n.scrollWidth>n.clientWidth+1).length}));
  assert(legend.rows>=6);assert.equal(legend.clipped,0);
  await c.tab(page,'圆环形状','半环');await settle(page);
  assert(await comp.locator('[data-chart=ring] svg').evaluate(e=>{const r=e.parentElement.getBoundingClientRect();return r.width/r.height>1.7&&r.width/r.height<2.1;}));
  await comp.locator('[data-legend-key]').first().hover();assert(await comp.locator('[data-arc-key]').evaluateAll(ns=>ns.every(n=>Number(getComputedStyle(n).opacity)===1)));
  await c.tab(page,'圆环形状','圆环');await c.tab(page,'月度柱图布局','分组');await settle(page);
  const bars=page.locator('[data-cost-months] [data-chart=bar]');assert.equal(await bars.getAttribute('data-layout'),'grouped');
  const grouped=await bars.locator('[data-month-key]').first().locator('[data-month-series]').evaluateAll(ns=>ns.map(e=>e.getBBox().x));
  assert(new Set(grouped).size>1);await c.tab(page,'月度柱图布局','堆叠');await settle(page);
  const stacked=await bars.locator('[data-month-key]').first().locator('[data-month-series]').evaluateAll(ns=>ns.map(e=>e.getBBox().x));assert.equal(new Set(stacked).size,1);
  await bars.press('End');const month=await bars.getAttribute('data-active');assert.match(await page.locator('[data-cost-month-readout]').textContent(),new RegExp(Number(month.slice(5))+' 月'));
  assert(await bars.locator('[data-month-key]').evaluateAll(ns=>ns.every(n=>Number(getComputedStyle(n).opacity)===1)));
  await page.getByRole('button',{name:'把花在哪放大到整行',exact:true}).click();
  assert(await page.locator('[data-pane=months]').evaluate(e=>Boolean(e.querySelector('[inert]'))));
  await page.getByRole('button',{name:'恢复两栏',exact:true}).click();
  await page.getByRole('button',{name:'把按月放大到整行',exact:true}).click();
  assert(await page.locator('[data-pane=where]').evaluate(e=>Boolean(e.querySelector('[inert]'))));
  await page.getByRole('button',{name:'恢复两栏',exact:true}).click();
  await c.tab(page,'花在哪视图','订阅对照');const fee=c.root(page).getByRole('textbox',{name:'Codex 的订阅月费（美元）',exact:true});
  await fee.fill('25');await fee.press('Enter');await until(page,async()=>(await window.usageBridge.get()).subscriptions.codex===25);
  await c.tab(page,'花在哪视图','费用构成');await page.locator('[data-cost-agents]').getByRole('radio',{name:'Claude Code',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>[...window.costHost.state().agents]),['claude']);await page.locator('[data-cost-agents]').getByRole('radio',{name:'全部',exact:true}).click();
  await c.tab(page,'图表样式','折线');assert.equal(await page.locator('[data-cost-trend] [data-line-run] path[fill="currentColor"]').count(),0);
  await c.tab(page,'图表样式','面积');await c.tab(page,'走势时间粒度','周');assert.equal(await page.getByRole('tablist',{name:'走势数值',exact:true}).getByRole('tab',{name:'每周',exact:true}).count(),1);
  await c.tab(page,'走势时间粒度','月');assert.equal(await page.getByRole('tablist',{name:'走势数值',exact:true}).getByRole('tab',{name:'每月',exact:true}).count(),1);
  await c.tab(page,'走势时间粒度','日');const plot=page.locator('[data-cost-trend] [data-chart=line]');await plot.scrollIntoViewIfNeeded();
  await plot.focus();await page.keyboard.press('End');await page.keyboard.press(' ');const pinned=await page.locator('[data-cost-trend-readout]').textContent();const box=await plot.locator('svg').boundingBox();
  await page.mouse.move(box.x+60,box.y+80);assert.equal(await page.locator('[data-cost-trend-readout]').textContent(),pinned);
  await page.keyboard.press('Escape');assert.equal(await plot.locator('[data-line-cursor]').count(),0);
  await page.mouse.move(box.x+box.width*.25,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5,{steps:16});await page.mouse.up();await settle(page);
  const selected=await page.evaluate(()=>window.costHost.state().custom);assert(selected&&selected.from<selected.to);
  await c.choosePeriod(page,'all');await plot.focus();await page.keyboard.press('Home');await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Enter');
  assert(await page.evaluate(()=>window.costHost.state().custom.from!==window.costHost.state().custom.to));await c.choosePeriod(page,'all');
  const hero=page.locator('[data-cost-hero]');await hero.scrollIntoViewIfNeeded();const carousel=hero.locator('[data-carousel]');
  assert.equal(await carousel.getAttribute('data-index'),'0');
  assert.equal(await hero.getByRole('tab',{name:'累计',exact:true}).getAttribute('aria-selected'),'true');
  await hero.getByRole('button',{name:'下一页',exact:true}).click();assert.equal(await carousel.getAttribute('data-index'),'1');
  assert(await hero.locator('[data-carousel-slide=range]').evaluate(e=>e.inert));
  const days=await hero.locator('[data-bar-key]').evaluateAll(ns=>ns.map(n=>({state:n.dataset.state,value:n.dataset.chartValue})));
  assert(days.length>=28&&days.filter(d=>d.state==='unobserved'||d.state==='future').every(d=>d.value==='unknown'));
  await hero.locator('[data-height=days] [data-state=value] [data-chart-key]').first().hover();assert(await hero.locator('[data-cost-month-sub]').textContent());
  await hero.getByRole('button',{name:'本月',exact:true}).focus();await page.keyboard.press('ArrowLeft');assert.equal(await carousel.getAttribute('data-index'),'0');
  const vp=await hero.locator('[data-carousel-slide=range]').boundingBox();await page.mouse.move(vp.x+vp.width*.75,vp.y+12);await page.mouse.down();await page.mouse.move(vp.x+vp.width*.25,vp.y+15,{steps:10});await page.mouse.up();await settle(page);assert.equal(await carousel.getAttribute('data-index'),'1');
  await hero.getByRole('button',{name:'上一页',exact:true}).click();await hero.getByRole('tab',{name:'30 天',exact:true}).click();assert.equal(await page.evaluate(()=>window.costHost.state().period),'30');await c.choosePeriod(page,'all');
  for(const width of [1468,1000,800])for(const theme of ['light','dark']){
   await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setSize(w,950),width);await page.evaluate(t=>window.settingsHost.theme.set(t),theme);await settle(page);
   await page.locator('[data-cost-duo]').scrollIntoViewIfNeeded();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(output,'panels-'+width+'-'+theme+'.png')});
  }
  await page.emulateMedia({reducedMotion:'reduce'});await c.tab(page,'圆环形状','半环');await c.tab(page,'月度柱图布局','分组');await settle(page);
  assert.equal(await comp.locator('[data-arc-key]').first().evaluate(e=>e.getAnimations().filter(a=>a.playState==='running').length),0);
  await page.evaluate(()=>window.uiMotion.setPreference('off'));await settle(page);assert(await page.locator('[data-pane=where]').evaluate(e=>e.getAnimations().every(a=>a.playState!=='running')));await require('./cost-reference-cases').run(page,output,1);
  assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),facts);const audit=await page.evaluate(()=>window.usageBridge.get());assert.equal(audit.enabled,false);if(audit.audit){assert.equal(audit.audit.authenticationReads,0);assert.equal(audit.audit.sourceWrites,0);assert.equal(audit.audit.networkAttempts,0);}assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'composition-results.json'),JSON.stringify({packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),traces,legend,dragRange:selected,views:[1468,1000,800],themes:['light','dark'],errors},null,2));console.log('PASS: actual gap paths, large full/semi ring, grouped/stacked morph, integrated subscriptions, coordinated panels, icon picker, hover range edge, pointer/keyboard brush, pinned readout, dark/narrow/reduced/off and unchanged usage facts');
 }finally{await app.close();await cleanup(root);}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
