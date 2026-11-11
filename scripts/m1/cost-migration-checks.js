'use strict';
/* global document, getComputedStyle, NodeFilter */
// Shared geometry checks for the M8 assertion mapping. Selectors refer to real
// React regions/roles; no legacy DOM, business state or counters are fabricated.
const assert=require('node:assert/strict');
const {until}=require('./ui-settle'),c=require('./cost-ui-helpers');
async function layout(page){
 const geometry=await page.evaluate(()=>{
  const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const order=['[data-cost-hero]','[data-cost-trend]','[data-cost-duo]','[data-cost-table-section]'].map(selector=>box(selector).y);
  const comp=document.querySelector('[data-cost-composition]'),bounds=comp.getBoundingClientRect();
  const clipped=[...comp.querySelectorAll('[data-legend-key] > span,[data-donut-center]')].filter(e=>e.checkVisibility({visibilityProperty:true})).map(e=>e.getBoundingClientRect()).filter(r=>r.width&&(r.left<bounds.left-1||r.right>bounds.right+1));
  // Fluid's invisible weight-measurement copy has layout rectangles too. Count
  // the painted text, preserving the one-line assertion for every real heading.
  const heads=[...document.querySelectorAll('[data-cost-table] thead th')],headLines=Math.max(...heads.map(e=>{const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),rects=[];for(let node=walker.nextNode();node;node=walker.nextNode()){if(!node.parentElement.checkVisibility({visibilityProperty:true}))continue;const range=document.createRange();range.selectNodeContents(node);rects.push(...range.getClientRects());}rects.sort((a,b)=>a.top-b.top);const lines=[];for(const r of rects.filter(r=>r.width)){const line=lines.find(x=>Math.min(x.bottom,r.bottom)>Math.max(x.top,r.top));if(line){line.top=Math.min(line.top,r.top);line.bottom=Math.max(line.bottom,r.bottom);}else lines.push({top:r.top,bottom:r.bottom});}return lines.length;}));
  const pairs=['[data-cost-page] [data-cost-coverage]','[data-cost-cache]'].map(box);
  return{order,months:box('[data-cost-months]'),where:box('[data-pane="where"]'),clipped:clipped.length,headLines,headings:heads.map(e=>e.textContent.replace(/\s*[↓↑]$/,'').trim().replace(/^(.+)\1$/,'$1')),pairs,width:box('[data-cost-page]').width,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
 });
 assert(geometry.order.every((y,i)=>i===0||y>geometry.order[i-1]),'hero, trend, two panes, table keep order');
 assert(geometry.months.y>=geometry.where.y-1&&geometry.months.y<geometry.order[3]);assert.equal(geometry.clipped,0,'ring/legend stay inside panel');
 assert.equal(geometry.headLines,1,'table headings stay on one text line');
 for(const heading of ['Token','占比','估算','每百万','构成','走势'])assert(geometry.headings.includes(heading),'every table column remains reachable: '+heading);
 const[a,b]=geometry.pairs;if(geometry.width>760){assert(b.x>=a.right);assert(Math.abs(a.y-b.y)<2);}else assert(b.y>=a.bottom-1,'summary docking follows original narrow-content stacking');
 assert.equal(geometry.overflow,false);return geometry;
}
async function trend(page){
 const plot=page.locator('[data-cost-trend] [data-chart="line"]');await plot.scrollIntoViewIfNeeded();
 assert(await plot.isVisible());assert.equal(await plot.locator('svg g.text-micro > line').count(),5,'four rows plus top line');
 assert(await plot.locator('svg').evaluate(e=>e.getBoundingClientRect().height>=240));
 assert(await plot.locator('svg').evaluate(e=>Math.abs(e.getBoundingClientRect().width-e.parentElement.getBoundingClientRect().width)<2));
 assert(await page.locator('[data-cost-trend]').evaluate(e=>e.querySelector('[data-cost-trend-legend]').getBoundingClientRect().bottom<=e.querySelector('[data-chart="line"] svg').getBoundingClientRect().top+1));
 assert(await plot.locator('[data-line-series] path:not([data-missing-bridge])').evaluateAll(nodes=>nodes.every(e=>e.getBBox().y>=-1)),'bands remain within frame');
 await c.tab(page,'走势数值','累计');assert(await plot.locator('svg > text').count()<=6);assert.equal(await page.locator('.cost-chart-panel').count(),0);
 await page.getByRole('tablist',{name:'走势数值',exact:true}).getByRole('tab').first().click();return{height:await plot.locator('svg').getAttribute('height'),grid:5};
}
async function detailGeometry(page){
 const detail=c.detail(page),sheet=c.sheet(page);await detail.waitFor();
 const geometry=await detail.evaluate(e=>{
  const sections=[...e.querySelectorAll(':scope > section,:scope > [data-cost-detail-trend]')].map(x=>x.getBoundingClientRect());
  const plot=e.querySelector('[data-cost-detail-trend]'),svg=plot?.querySelector('svg');
  const axis=svg?[...svg.querySelectorAll('g.text-micro > text')]:[];
  const bad=[...e.querySelectorAll('[data-cost-detail-fields] [data-breakdown-row] > span:last-child,[data-cost-detail-metrics] dd,[data-cost-detail-pricing] dd')].filter(node=>{const b=node.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(node);return[...range.getClientRects()].some(r=>r.width&&(r.left<b.left-2||r.right>b.right+2));}).map(node=>node.textContent);
  return{stacked:sections.every((r,i)=>!i||r.top>=sections[i-1].bottom-1),metrics:e.querySelector('[data-cost-detail-metrics]').children.length,chartWidth:svg?svg.getBoundingClientRect().width:0,contentWidth:e.clientWidth,points:svg?.querySelectorAll('[data-line-point]').length||0,labelFonts:axis.map(n=>parseFloat(getComputedStyle(n).fontSize)),axisInside:axis.every(n=>n.getBBox().x>=0),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,clipped:bad};
 });
 assert(geometry.stacked,'detail sections stack');assert.equal(geometry.metrics,6);assert(geometry.points>=1);assert(Math.abs(geometry.chartWidth-geometry.contentWidth)<64);
 assert(geometry.labelFonts.length>0&&geometry.labelFonts.every(size=>size>=10.9));assert(geometry.axisInside);assert.equal(geometry.overflow,false,'detail never widens the document');assert.deepEqual(geometry.clipped,[]);
 assert.equal(await sheet.getAttribute('data-sheet-placement'),'left');return geometry;
}
async function scrollList(page,label){
 const area=c.sheet(page).locator('[data-cost-detail-users]');
 assert.equal(await area.getAttribute('aria-label'),label);
 // fluid's scroll root carries the region label, the viewport owns keyboard scrolling.
 await area.focus();await page.keyboard.press('End');await until(page,()=>[...document.querySelectorAll('[data-cost-detail-users]')].some(e=>e.scrollTop>0));
 return area;
}
async function pageGeometry(page){
 const geometry=await page.evaluate(()=>{
  const overlap=[],clipped=[];
  for(const row of document.querySelectorAll('[data-cost-table] tbody tr,[data-cost-subscription] > div:first-child,[data-cost-cache-row]')){
   const cells=[...row.children].filter(e=>e.checkVisibility()).map(e=>e.getBoundingClientRect());
   for(let i=0;i<cells.length;i++)for(let j=i+1;j<cells.length;j++){
    const a=cells[i],b=cells[j];
    if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)overlap.push(row.getAttribute('data-row-key')||row.parentElement.dataset.costSubscription||'cache');
   }
  }
  // Long model names may ellipsize. Verify their clipping
  // contract separately; unabridged numeric readouts must still fit their cells.
  for(const e of document.querySelectorAll('[data-cost-table] [data-cost-row-name]')){
   if(!e.checkVisibility())continue;
   const style=getComputedStyle(e);
   if(e.scrollWidth>e.clientWidth+2&&!(style.overflow==='hidden'&&style.textOverflow==='ellipsis'&&style.whiteSpace==='nowrap'))clipped.push(e.textContent);
  }
  for(const e of document.querySelectorAll('[data-cost-row-amount],[data-cost-table] tbody td:nth-child(3),[data-cost-month-readout] b')){
   if(!e.checkVisibility())continue;
   const b=e.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(e);
   if([...range.getClientRects()].some(r=>r.width&&(r.left<b.left-2||r.right>b.right+2)))clipped.push(e.textContent);
  }
  return{overlap,clipped,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
 });
 assert.deepEqual(geometry.overlap,[],'numeric cells do not overlap');assert.deepEqual(geometry.clipped,[],'numeric text stays in its cell');assert.equal(geometry.overflow,false);
 return geometry;
}
module.exports={layout,trend,detailGeometry,scrollList,pageGeometry};
