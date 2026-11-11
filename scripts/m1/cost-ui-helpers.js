'use strict';
/* global document */
// The cost page on the shared kit (UI-COST-KIT-20261028.md): segmented controls are tablists,
// the table is a kit DataTable and both sheets are kit Sheets (role=dialog).
const {until,settle,showView}=require('./ui-settle');
const root=page=>page.locator('[data-cost-page]');
const detail=page=>page.locator('[role=dialog] [data-cost-detail]');
const sheet=page=>page.locator('[role=dialog]:has([data-cost-detail])');
const table=page=>page.locator('[data-cost-table]');
const row=(page,name)=>table(page).locator('tr[data-row-key]').filter({has:page.getByRole('button',{name:name+' 的费用详情',exact:true})});
const names=page=>page.locator('[data-cost-table] [data-cost-row-name]').allTextContents();
const budgetField=page=>root(page).getByRole('textbox',{name:'预算 USD',exact:true});
async function openCost(page){
  await page.evaluate(()=>window.uiMotion.setPreference('off'));await showView(page,'cost');
  await root(page).waitFor();
}
async function section(page,name){
  await root(page).getByRole('tab',{name:name==='projects'?'项目与预算':'费用分析',exact:true}).click();
  if(name==='projects')await until(page,()=>Boolean(window.insightsHost.get().view)&&!window.insightsHost.get().busy);
}
async function group(page,by){
  await root(page).getByRole('tablist',{name:'按什么分组',exact:true}).getByRole('tab',{name:by==='agent'?/^Agent \d+$/:/^模型 \d+$/}).click();
}
async function openDetail(page,name){
  if(await detail(page).count())await closeDetail(page);
  let button=row(page,name).getByRole('button',{name:name+' 的费用详情',exact:true});
  if(!await button.count()){
    const other=table(page).getByRole('button',{name:/^展开全部，/});if(await other.count())await other.click();
    button=row(page,name).getByRole('button',{name:name+' 的费用详情',exact:true});
  }
  await button.click();await detail(page).waitFor();await settle(page);return detail(page);
}
async function closeDetail(page){
  await sheet(page).getByRole('button',{name:'关闭',exact:true}).click();
  await until(page,()=>!document.querySelector('[role=dialog] [data-cost-detail]'));
}
async function openRange(page){
  if(await page.locator('[data-cost-range-sheet]').count())return;
  await root(page).getByRole('button',{name:'用日历选择范围',exact:true}).click();
  await page.locator('[data-cost-range-sheet]').waitFor();
}
async function choosePeriod(page,key){
  await openRange(page);
  const label={all:'累计','30':'30 天','7':'7 天',today:'今日'}[key];
  await page.locator('[data-cost-range-sheet]').getByRole('tab',{name:label,exact:true}).click();
  await page.keyboard.press('Escape');await until(page,()=>!document.querySelector('[data-cost-range-sheet]'));
}
async function pickSelect(page,name,option){
  await root(page).getByRole('combobox',{name,exact:true}).click();
  await page.getByRole('option',{name:option,exact:true}).click();
  await until(page,()=>!window.insightsHost.get().busy);
}
async function pickPeriod(page,key){await pickSelect(page,'项目预算自然周期',{daily:'今日',weekly:'本周',monthly:'本月',total:'累计'}[key]);}
async function pickProject(page,id){
  const label=id==='all'?'全部项目':await page.evaluate(id=>window.insightsHost.get().view.projectOptions.find(p=>p.id===id).label,id);
  await pickSelect(page,'费用项目',label);
}
async function tab(page,label,name){
  if(label==='费用明细排序'){
    await table(page).getByRole('tab',{name:name.replace(/ ↓$/,''),exact:true}).click();return;
  }
  await root(page).getByRole('tablist',{name:label,exact:true}).getByRole('tab',{name,exact:true}).click();
}
module.exports={root,detail,sheet,table,row,names,budgetField,openCost,section,group,openDetail,closeDetail,openRange,choosePeriod,pickPeriod,pickProject,tab};
