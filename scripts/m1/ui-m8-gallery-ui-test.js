'use strict';
/* global document, getComputedStyle, requestAnimationFrame */
// Approved M8 kit extensions, in the existing gallery. Browser plugin not available.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {launch,setTheme,semanticViolations,isolationViolations}=require('./ui-smoke');
const {until,settle}=require('./ui-settle');
const output=process.env.UI_M8_GALLERY_EVIDENCE_DIR||'artifacts/ui-mig/M8/gallery';
fs.mkdirSync(output,{recursive:true});
const sample=(page,name)=>page.locator('[data-m8-case="'+name+'"]');
async function paint(page,selector,property,token){
  return page.evaluate(({selector,property,token})=>{
    const actual=getComputedStyle(document.querySelector(selector))[property];
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),probe=document.createElementNS(svg.namespaceURI,'path');
    probe.style[property]='var('+token+')';svg.append(probe);document.body.append(svg);
    const expected=getComputedStyle(probe)[property];svg.remove();return{actual,expected};
  },{selector,property,token});
}
async function run(page,theme){
  await setTheme(page,theme);await page.evaluate(()=>window.uiMotion.setPreference('off'));
  await page.evaluate(()=>{const host=document.createElement('div');host.id='m8GalleryHost';Object.assign(host.style,{position:'absolute',top:'0',left:'0',width:'100%',zIndex:'25'});document.body.append(host);window.m8Gallery=window.agentUi.mount('kit-gallery',host);});
  await page.locator('[data-m8-gallery]').waitFor();await settle(page);
  assert.equal(await page.locator('[data-legend-share],[data-chart-legend][data-compact]').count(),0);
  const inline=sample(page,'legend').locator('[data-legend-variant="inline"]');
  const a=inline.locator('[data-legend-key="codex"]'),b=inline.locator('[data-legend-key="claude"]');
  await a.click();await b.click();assert.equal(await b.getAttribute('aria-pressed'),'true','last priced legend remains visible');
  await a.press('Home');await a.press('End');assert.equal(await inline.locator('[data-legend-key="unknown"]').evaluate(e=>e===document.activeElement),true);
  assert.equal(await inline.locator('[data-legend-key="unknown"]').getAttribute('aria-disabled'),'true');
  const stack=sample(page,'stack').locator('[data-stack-bar]');await stack.scrollIntoViewIfNeeded();
  const segments=await stack.locator('[data-stack-key]').evaluateAll(nodes=>nodes.map(e=>({x:+e.getAttribute('x'),width:+e.getAttribute('width'),rx:+e.getAttribute('rx')})));
  assert(Math.abs(segments[1].x-segments[0].x-segments[0].width-3)<.01);assert.equal(segments[0].rx,6);
  await stack.locator('[data-stack-key="a"]').focus();assert.match(await page.getByRole('tooltip').textContent(),/a · \$2/);
  // UI-HOVER-20261028 restores the kit TipCard: shared rounded-xl surface,
  // replacing the earlier cost-only capsule. Keep the actual radius checked.
  assert.equal(await page.getByRole('tooltip').evaluate(e=>getComputedStyle(e).borderRadius),'12px');await stack.press('Escape');
  const months=sample(page,'months').getByRole('group',{name:'费用月份选择'});await months.scrollIntoViewIfNeeded();
  assert(await months.locator('svg').evaluate(e=>e.getBoundingClientRect().height>=300),'months use remaining height');
  await months.press('Home');await months.press('Enter');assert.equal(await months.locator('[data-chart-key="sep"]').getAttribute('aria-pressed'),'true');
  assert.equal(await months.locator('[data-chart-key="sep"]').getAttribute('aria-label'),'2026 年 9 月，$2，点选筛选这个月');
  // Prop changes refresh each shared capsule without pointer/focus replay.
  for(const selector of ['[data-m8-case=stack] [data-stack-key=a]',
    '[data-m8-case=months] [data-chart-key=sep]', '[data-m8-case=spark-tooltip] [data-line-point="0"]']){
    const target=page.locator(selector);await target.scrollIntoViewIfNeeded();await page.mouse.move(0,0);
    console.log('live capsule: '+selector);await target.focus();
    await page.locator('#kit-window-chart-tooltip').evaluate(e=>{window.m8LiveTip={tip:e,focus:document.activeElement};});
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='更新费用组件').click());
    await until(page,()=>document.getElementById('kit-window-chart-tooltip')?.textContent.includes('$6'));
    assert(await page.locator('#kit-window-chart-tooltip').evaluate(e=>e===window.m8LiveTip.tip&&document.activeElement===window.m8LiveTip.focus));
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(e=>e.textContent==='更新费用组件').click());
    await until(page,()=>document.getElementById('kit-window-chart-tooltip')?.textContent.includes('$2'));
    await target.press('Escape');
  }
  const days=sample(page,'days');assert.equal(await days.locator('[data-bar-key="zero"]').getAttribute('data-chart-value'),'0');
  assert.equal(await days.locator('[data-bar-key="missing"]').getAttribute('data-chart-value'),'unknown');
  assert.equal(await days.locator('[data-day-today]').count(),1);assert.notEqual(await days.locator('[data-bar-key="missing"] [data-bar-shape]').getAttribute('fill'),'none');
  for(const [selector,property,token]of [
    ['[data-m8-case="rings"] [data-size="mini"] circle','stroke','--fill-strong'],
    ['[data-m8-case="rings"] [data-size="mini"] path','stroke','--good-text'],
    ['[data-m8-case="days"] [data-bar-key="value"] [data-bar-shape]','fill','--series-codex'],
    ['[data-m8-case="days"] [data-bar-key="missing"] [data-bar-shape]','fill','--fill-strong'],
    ['[data-m8-case="line"] svg line','stroke','--cost-chart-grid'],
    ['[data-m8-case="line"] svg text','fill','--cost-chart-caption'],
  ]){const colors=await paint(page,selector,property,token);assert.equal(colors.actual,colors.expected,theme+': '+token);}
  assert.equal(await sample(page,'rings').locator('[data-size="mini"] path').getAttribute('stroke-width'),'5');
  assert.equal(await sample(page,'rings').locator('[data-size="gauge"] [data-gauge="lower"]').count(),0);
  const line=sample(page,'line').getByRole('group',{name:'费用详情坐标'});await line.scrollIntoViewIfNeeded();
  await line.press('End');assert.match(await line.getByRole('tooltip').textContent(),/2026-10-22/);
  assert.equal(await line.locator('[data-detail-end-label]').count(),0);await line.press('Escape');
  assert.equal(await line.locator('[data-detail-end-label]').textContent(),'3 Token');
  assert.equal(await sample(page,'figure').locator('.text-figure-cost-hero').evaluate(e=>getComputedStyle(e).fontSize),'60px');
  const area=sample(page,'cost-stack-gaps'),ownLine=sample(page,'cost-line-gaps');
  assert.deepEqual(await area.locator('[data-line-series=codex] [data-line-run]').evaluateAll(nodes=>nodes.map(e=>e.dataset.lineRun)),['0:1','3:4']);
  assert.equal(await area.locator('[data-missing-bridge]').count(),2);
  assert.equal(await area.locator('[data-missing-area]').count(),2);
  assert.deepEqual(await ownLine.locator('[data-line-series=codex] [data-line-run]').evaluateAll(nodes=>nodes.map(e=>e.dataset.lineRun)),['0','3:4']);
  assert.equal(await ownLine.locator('[data-missing-bridge]').count(),1);
  assert.equal(await ownLine.locator('[data-missing-area]').count(),0);
  const defaults=sample(page,'per-agent-gap');
  assert.deepEqual(await defaults.locator('[data-line-series=codex] [data-line-run]').evaluateAll(nodes=>nodes.map(e=>e.dataset.lineRun)),['0','2']);
  assert.equal(await defaults.locator('[data-missing-bridge]').count(),0,'default palette keeps its existing gap rules');
  await area.scrollIntoViewIfNeeded();await area.locator('[data-chart=line]').press('Home');
  for(const [selector,property,token]of [
    ['[data-m8-case=cost-stack-gaps] [data-partial]','fill','--warn'],
    ['[data-m8-case=cost-stack-gaps] [data-line-cursor] line','stroke','--text'],
  ]){const colors=await paint(page,selector,property,token);assert.equal(colors.actual,colors.expected,theme+': '+token);}
  assert.equal(Number(await area.locator('[data-partial]').getAttribute('opacity')),.85);
  assert.equal(Number(await area.locator('[data-line-cursor] line').getAttribute('stroke-opacity')),.3);
  assert.equal(await area.locator('[data-line-cursor] line').getAttribute('stroke-dasharray'),'3 3');
  await area.locator('[data-chart=line]').press('Escape');
  for(const mode of ['reduced','off']){
    await page.evaluate(v=>window.uiMotion.setPreference(v),mode);
    await page.getByRole('button',{name:'更新费用组件',exact:true}).click();
    await page.getByRole('button',{name:'切换费用圆环形状',exact:true}).click();
    await until(page,()=>Boolean(document.querySelector('[data-m8-case="rings"] svg[data-shape="half"]')));
    const pathBefore=await sample(page,'rings').locator('[data-arc-key="codex"]').getAttribute('d');
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await sample(page,'rings').locator('[data-arc-key="codex"]').getAttribute('d'),pathBefore,mode+': geometry directly final');
    await page.getByRole('button',{name:'切换费用圆环形状',exact:true}).click();
    await page.getByRole('button',{name:'更新费用组件',exact:true}).click();
  }
  assert.deepEqual(await semanticViolations(page),[]);assert.deepEqual(await isolationViolations(page),[]);
  await sample(page,'stack').screenshot({path:path.join(output,theme+'-stack.png')});
  await page.evaluate(()=>{window.m8Gallery.unmount();document.getElementById('m8GalleryHost').remove();});
  assert.equal(await page.locator('#kit-window-chart-tooltip').count(),0);
}
(async()=>{const session=await launch();try{for(const theme of ['light','dark'])await run(session.page,theme);assert.deepEqual(session.errors,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({themes:['light','dark'],errors:session.errors},null,2));console.log('PASS: M8 approved kit interfaces, original colours, keyboard, capsule, unknown/zero and reduced/off.');}finally{await session.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
