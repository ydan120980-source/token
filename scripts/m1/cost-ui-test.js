'use strict';
/* global document, getComputedStyle, requestAnimationFrame */
// M8 semantic/behaviour/privacy assertions. Repeat runs copy one seed byte for byte.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright'),{Store,atomic}=require('../../src/m1/store');
const {normalize}=require('../../src/m1/normalize'),{fixtures}=require('../../tests/m1/fixtures');
const {settle,until,showView,keepVisible,isolatePointer,cleanup}=require('./ui-settle');
const {dialog,waitClosed}=require('./settings-ui-helpers'),{checkTextContrast}=require('./chart-hover-check');
const c=require('./cost-ui-helpers');
const FIXED_TIME=Date.parse('2026-10-26T11:51:00Z');
function ledger(dir) {
  const home = path.join(dir, 'home'), usage = path.join(dir, 'usage'), store = new Store(usage, fixtures(home).roots);
  const add = (agent, model, day, tokens, usage) => {
    const record = normalize(agent, usage(tokens), { id: 'cost-' + agent + '-' + model + '-' + day, time: FIXED_TIME - day * 86400000, model, entry: 'cli', session: 'cost-' + agent + '-' + day }, 'synthetic-salt');
    store.state.records[record.id] = record;
  };
  const full = tokens => ({ input_tokens: tokens, output_tokens: Math.round(tokens / 10), cached_input_tokens: Math.round(tokens / 2), cache_creation_input_tokens: 0, reasoning_output_tokens: 100, total_tokens: tokens + Math.round(tokens / 10) });
  const noCache = tokens => ({ input_tokens: tokens, output_tokens: Math.round(tokens / 10) });
  for (let day = 0; day < 10; day++) {
    add('codex', 'gpt-6.1-sol', day, 300000, full);
    add('codex', 'synthetic-unpriced', day, 260000, full);
    add('claude', 'claude-sonnet-5-5', day, 200000, full);
    if (day < 5) add('opencode', 'claude-sonnet-5-5', day, 100000, noCache);
    ['a', 'b', 'c', 'd', 'e'].forEach((name, i) => add('codex', 'synthetic-' + name, day, 100000 - i * 10000, full));
  }
  // History from 65 days ago makes the 30-day window comparable (its previous window is recorded).
  add('codex', 'gpt-6.1-sol', 65, 300000, full);
  store.state.sequence = 1; atomic(path.join(usage, 'statistics.json'), store.state); store.setEnabled(false);
  return { home, usage };
}
async function scenario(base,seed,run,seedHash){
 const root=path.join(base,'run-'+run);fs.mkdirSync(root);
 const usage=path.join(root,'usage'),quota=path.join(root,'quota'),saved=path.join(root,'cost export.csv');fs.cpSync(seed.usage,usage,{recursive:true});
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(usage,'statistics.json'))).digest('hex'),seedHash);
 const output=path.join(process.env.COST_EVIDENCE_DIR||'artifacts/ui-mig/M8/cost',String(run));fs.mkdirSync(output,{recursive:true});
 const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',seed.home],timeout:60000});
 const errors=[],checks=[];const mark=name=>checks.push(name);
 try{
  await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await app.context().addInitScript(now=>{const Native=Date;class FixedDate extends Native{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}window.Date=FixedDate;},FIXED_TIME);
  await page.reload();await showView(page,'usage');await page.getByRole('button',{name:'查看费用明细',exact:true}).click();await c.openCost(page);
  assert.equal(await page.locator('#main').getAttribute('data-current-view'),'cost');assert.equal(await page.locator('#windowPage').textContent(),'费用');
  assert.equal(await page.getByRole('tablist',{name:'按什么分组'}).getByRole('tab',{name:/^模型 /}).getAttribute('aria-selected'),'true');
  assert.equal(await c.table(page).getAttribute('data-compare'),'false');assert.equal(await c.root(page).getByRole('tablist',{name:'费用时间范围',exact:true}).getByRole('tab',{name:'累计',exact:true}).getAttribute('aria-selected'),'true');
  assert.deepEqual(await c.names(page),['gpt-6.1-sol','synthetic-unpriced','claude-sonnet-5-5','synthetic-a','synthetic-b','synthetic-c','其他 2 个模型']);
  assert.equal(await c.row(page,'synthetic-unpriced').locator('[data-cost-row-amount]').textContent(),'未计入');
  assert.match(await c.row(page,'synthetic-unpriced').textContent(),/没有价格/);
  assert.match(await c.row(page,'claude-sonnet-5-5').textContent(),/已计入 80\.0%/);mark('defaults-and-unknown');
  await c.openDetail(page,'claude-sonnet-5-5');assert.match(await c.detail(page).locator('[data-cost-detail-gaps]').textContent(),/来源没有单独报告推理 Token/);
  assert.equal(await c.detail(page).getByRole('button',{name:'查看来源',exact:true}).count(),1);
  const cacheRow=c.detail(page).locator('[data-breakdown-row=cacheRead]');
  // Breakdown opens on actual keyboard focus (:focus-visible), rather than a
  // programmatic focus immediately after a pointer-opened sheet.
  for(let at=0;at<32&&!await cacheRow.evaluate(node=>node===document.activeElement);at++)await page.keyboard.press('Tab');
  assert(await cacheRow.evaluate(node=>node===document.activeElement),'cache-read row is reachable by keyboard');
  await page.getByRole('tooltip').filter({hasText:'缓存读取'}).waitFor();
  assert.match(await page.getByRole('tooltip').textContent(),/（部分未报告）/);await c.closeDetail(page);
  await c.openDetail(page,'gpt-6.1-sol');const sol=await page.evaluate(()=>window.costTable.table(window.usageData.rows()).find(i=>i.model==='gpt-6.1-sol'));
  if(sol.spread>0)assert.match(await c.detail(page).locator('[data-cost-detail-fields]').textContent(),/估算区间.*(缓存写入未报告|上下文长度未报告|推理数量未报告|按时段计价)/);
  assert.equal(await c.detail(page).count(),1);await c.closeDetail(page);mark('partial-fields-and-range');
  await c.table(page).getByRole('button',{name:/^展开全部，/}).click();assert.equal((await c.names(page)).length,8);
  assert.equal(await c.root(page).getByRole('button',{name:'收起，只看前 6 个',exact:true}).count(),1);
  await c.root(page).getByRole('button',{name:'收起，只看前 6 个',exact:true}).click();assert.equal((await c.names(page)).length,7);
  await c.tab(page,'费用明细排序','估算 ↓');const sorted=await c.names(page);assert(['gpt-6.1-sol','claude-sonnet-5-5'].includes(sorted[0]));assert.equal(sorted.at(-1),'其他 2 个模型');
  await c.tab(page,'费用明细排序','Token ↓');mark('fold-and-sort');
  await c.openDetail(page,'synthetic-unpriced');await c.detail(page).getByRole('button',{name:'设置计费',exact:true}).click();
  await dialog(page).waitFor();assert.equal(await dialog(page).count(),1);assert.equal(await dialog(page).getByRole('heading').first().textContent(),'synthetic-unpriced');
  assert.equal(await c.detail(page).count(),0);await dialog(page).getByRole('button',{name:'关闭',exact:true}).click();await waitClosed(page);mark('pricing-handoff');
  await c.choosePeriod(page,'30');assert.equal(await c.table(page).getAttribute('data-compare'),'true');assert.equal(await page.evaluate(()=>window.usageHost.filters().period),'all');
  await c.choosePeriod(page,'all');const comp=page.locator('[data-cost-composition]');
  assert.match(await comp.locator('[data-chart="ring"]').getAttribute('aria-label'),/^已计价 \$/);assert.equal(await comp.locator('[data-legend-key]').count(),3);
  const center=()=>comp.locator('[data-donut-center]').textContent();
  const waitTotal=()=>until(page,()=>{
   const host=window.costHost,view=host.get().view,read=host.model.donutReadout(view.composition);
   return document.querySelector('[data-cost-composition] [data-chart="ring"]').dataset.active===''&&
    document.querySelector('[data-cost-composition] [data-donut-center] b').textContent===(read.value??'未计入');
  });
  await page.mouse.move(0,0);await waitTotal();const whole=await center();
  await comp.locator('[data-legend-key]').first().hover();await until(page,()=>document.querySelector('[data-cost-composition] [data-chart="ring"]').dataset.active!=='');
  assert.notEqual(await center(),whole);await page.mouse.move(0,0);await waitTotal();assert.equal(await center(),whole);
  await c.tab(page,'按什么看','类型');assert.deepEqual(await comp.locator('[data-legend-key] [data-legend-label]').allTextContents(),['输入','输出','缓存读取','缓存写入']);
  await c.tab(page,'按什么看','Agent');mark('own-range-and-composition');
  const current='2026-10';assert.equal(await page.locator('[data-cost-months] [data-chart-key]').last().getAttribute('data-chart-key'),current);
  assert.match(await page.locator('[data-cost-months] [data-chart-key="'+current+'"]').getAttribute('aria-label'),/推算整月 \$/);
  await page.locator('[data-cost-months] [data-chart-key="'+current+'"]').click();assert.equal(await page.evaluate(()=>window.costHost.state().month),current);
  assert.equal(await page.locator('[data-cost-hero] [role=tablist][aria-label="费用时间范围"] [role=tab][aria-selected="true"]').count(),0);mark('month-selection-and-projection');
  await c.openRange(page);
  // The range sheet uses the kit Segmented (a tablist); choosing 累计 replaces the selected month.
  const rangeTabs=page.locator('[data-cost-range-sheet] [role=tablist][aria-label="费用日期快捷范围"]');
  await rangeTabs.getByRole('tab',{name:'累计',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.costHost.state().month),null,'range replaces month');
  assert.equal(await rangeTabs.getByRole('tab',{name:'累计',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('Escape');await until(page,()=>!document.querySelector('[data-cost-range-sheet]'));
  await page.locator('[data-cost-months] [data-chart-key="'+current+'"]').click();
  await c.tab(page,'花在哪视图','订阅对照');const subs=page.locator('[data-cost-subscriptions]'),fee=subs.getByRole('textbox',{name:'Codex 的订阅月费（美元）',exact:true});
  assert.equal(await subs.evaluate(e=>getComputedStyle(e).boxShadow),'none');await fee.fill('20');await fee.press('Enter');
  await until(page,async()=>(await window.usageBridge.get()).subscriptions.codex===20);await until(page,()=>/×/.test(document.querySelector('[data-cost-subscription="codex"]').textContent));
  await fee.fill('abc');await fee.press('Enter');await until(page,()=>document.getElementById('toast').textContent.includes('月费请填'));assert.equal(await fee.inputValue(),'20');
  await c.choosePeriod(page,'all');await c.tab(page,'花在哪视图','费用构成');assert.equal(await c.root(page).getByRole('tablist',{name:'费用时间范围',exact:true}).getByRole('tab',{name:'累计',exact:true}).getAttribute('aria-selected'),'true');
  assert.match(await page.locator('[data-cost-page] [data-cost-coverage]').textContent(),/没有价格/);assert(await page.locator('[data-cost-page] [data-cost-coverage]').getByRole('button',{name:/设置计费|核实价格/}).count()>0);
  assert.match(await page.locator('[data-cost-cache]').textContent(),/约省下/);mark('subscription-coverage-cache');
  await c.choosePeriod(page,'30');await c.group(page,'agent');assert.deepEqual(await c.names(page),['Codex','Claude Code','OpenCode']);
  await page.evaluate(()=>{window.m8FirstCostRow=document.querySelector('[data-cost-table] tr[data-row-key]');window.costHost.invalidate();});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert(await page.evaluate(()=>window.m8FirstCostRow===document.querySelector('[data-cost-table] tr[data-row-key]')));
  await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saved);await c.root(page).getByRole('button',{name:'导出费用 CSV',exact:true}).click();
  await until(page,()=>document.getElementById('toast').textContent.includes('费用已导出'));
  const csv=fs.readFileSync(saved,'utf8'),lines=csv.slice(1).trim().split('\r\n');assert(csv.startsWith('\ufeff范围,分组,名称,'));assert.equal(lines.length,4);assert.match(lines[1],/,Agent,Codex,,/);assert.match(csv,/价格目录中没有此模型/);mark('agent-refresh-and-csv');
  await c.group(page,'model');await c.choosePeriod(page,'all');
  const viewport=page.locator('[data-cost-cache-list]');
  const cache=await viewport.evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight}));assert(cache.height>=256,'the list fills its card');
  // Keyboard scrolling with more models than fit is checked in cost-rebuild-ui-test.js.
  await viewport.focus();assert.equal(await viewport.evaluate(e=>e===document.activeElement),true,'the list takes focus');
  mark('bounded-keyboard-cache');
  await c.openDetail(page,'gpt-6.1-sol');const geometry=await c.sheet(page).evaluate(e=>({left:e.getBoundingClientRect().left,width:e.getBoundingClientRect().width,placement:e.dataset.sheetPlacement}));
  // M10 approved 440px floating detail cards (UI-POLISH-M10-20261029.md section 2).
  assert.equal(geometry.left,16);assert.equal(geometry.width,440);assert.equal(geometry.placement,'left');assert.equal(await c.detail(page).locator('[data-cost-detail-metrics] > div').count(),6);
  await c.sheet(page).screenshot({path:path.join(output,'cost-drawer-light.png')});
  for(let i=0;i<9;i++){await page.keyboard.press('Tab');assert(await c.sheet(page).evaluate(e=>e.contains(document.activeElement)));}
  await c.detail(page).locator('[data-line-point]').first().focus();await page.keyboard.press('Escape');await until(page,()=>!document.querySelector('[role=dialog] [data-cost-detail]'));
  assert(await c.row(page,'gpt-6.1-sol').getByRole('button',{name:'gpt-6.1-sol 的费用详情',exact:true}).evaluate(e=>e===document.activeElement));
  await c.openDetail(page,'gpt-6.1-sol');const grab=await c.sheet(page).locator('[data-sheet-drag]').boundingBox();
  await page.mouse.move(grab.x+grab.width/2,grab.y+grab.height/2);await page.mouse.down();await page.mouse.move(grab.x-200,grab.y+grab.height/2,{steps:12});await page.mouse.up();await until(page,()=>!document.querySelector('[role=dialog] [data-cost-detail]'));
  await c.openDetail(page,'gpt-6.1-sol');const box=await c.sheet(page).boundingBox();await page.mouse.click(box.x+box.width+30,box.y+40);await until(page,()=>!document.querySelector('[role=dialog] [data-cost-detail]'));mark('sheet-focus-drag-backdrop');
  for(const mode of ['reduced','off']){await page.evaluate(v=>window.uiMotion.setPreference(v),mode);await c.openDetail(page,'gpt-6.1-sol');await settle(page);assert.equal(await c.sheet(page).evaluate(e=>e.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&a.timeline===document.timeline).length),0);await c.closeDetail(page);}
  const layouts=[],contrast=[];
  for(const width of [1180,999,800])for(const theme of ['light','dark']){
   await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setSize(w,850),width);await page.evaluate(t=>{window.settingsHost.theme.set(t);window.scrollTo(0,0);},theme);await settle(page);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));assert(!(await c.root(page).innerText()).includes('NaN'));
   await c.openRange(page);const rangeSheet=page.getByRole('dialog',{name:'日期范围',exact:true});assert.equal(await rangeSheet.evaluate(e=>getComputedStyle(e).overflowY),'auto');assert.equal(await rangeSheet.evaluate(e=>getComputedStyle(e).position),'fixed');await page.keyboard.press('Escape');await until(page,()=>!document.querySelector('[data-cost-range-sheet]'));
   await page.locator('[data-cost-hero]').getByRole('button',{name:'下一页',exact:true}).click();
   const monthContrast=await checkTextContrast(page,['[data-cost-hero] [data-carousel-slide][aria-hidden="false"] p','[data-cost-hero] [data-carousel-slide][aria-hidden="false"] :is([data-cost-hero-number],[data-cost-month-number])']);
   await page.locator('[data-cost-hero]').getByRole('button',{name:'上一页',exact:true}).click();
   contrast.push({width,theme,monthReadings:monthContrast,readings:await checkTextContrast(page,['[data-cost-page] h2','[data-cost-hero] [data-carousel-slide][aria-hidden="false"] p','[data-cost-hero] [data-carousel-slide][aria-hidden="false"] :is([data-cost-hero-number],[data-cost-month-number])','[data-cost-page] [data-cost-coverage] strong','[data-cost-cache] [data-cost-cache-row] small'])});
   await page.screenshot({path:path.join(output,'viewport-'+width+'-'+theme+'.png')});layouts.push({width,theme,overflow:false});
  }mark('themes-widths-motion-contrast');
  await c.openDetail(page,'gpt-6.1-sol');await checkTextContrast(page,['[role=dialog] [data-cost-detail] dt','[role=dialog] [data-cost-detail] dd','[role=dialog] [data-cost-detail] p']);await c.sheet(page).screenshot({path:path.join(output,'cost-drawer-dark.png')});await c.closeDetail(page);
  assert.deepEqual(errors,[]);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(usage,'statistics.json'))).digest('hex'),seedHash);
  const result={run,seedHash,clock:FIXED_TIME,checks,cache,layouts,contrast,errors};fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));console.log('PASS cost-ui run '+run+' seed '+seedHash);return result;
 }catch(error){const page=await app.firstWindow();await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});console.error('Renderer errors:',errors);throw error;}
 finally{await app.close();}
}
(async()=>{
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'m8-cost-ui-')),seedRoot=path.join(base,'seed');fs.mkdirSync(seedRoot);
 try{const seed=ledger(seedRoot),seedHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(seed.usage,'statistics.json'))).digest('hex'),repeat=Number(process.env.COST_REPEAT||1),results=[];
  assert(Number.isInteger(repeat)&&repeat>=1&&repeat<=3);for(let run=1;run<=repeat;run++)results.push(await scenario(base,seed,run,seedHash));
  fs.writeFileSync(path.join(process.env.COST_EVIDENCE_DIR||'artifacts/ui-mig/M8/cost','repeat-results.json'),JSON.stringify({seedHash,repeat,results},null,2));
 }finally{await cleanup(base);}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
