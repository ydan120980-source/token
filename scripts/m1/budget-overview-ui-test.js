'use strict';
const cost=require('./cost-ui-helpers');
/* global document */
// Browser plugin not available; exercise actual Electron IPC with isolated stores.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {Store,atomic}=require('../../src/m1/store');
const {roots}=require('../../src/m1/policy');
const {showView,until,settle,keepVisible,isolatePointer,cleanup}=require('./ui-settle');
const output=process.env.BUDGET_OVERVIEW_EVIDENCE_DIR||'artifacts/budget-overview-ui-20261020';
fs.mkdirSync(output,{recursive:true});
function seed(usage,home,edge=false){
  const store=new Store(usage,roots(home)),now=new Date().toISOString();
  const record=(id,cwd,model='fixture',timestamp=now)=>{
    const r={id:id.repeat(64),sessionKey:id.repeat(64),agent:'claude',entry:'cli',provider:'private',model,timestamp,inputUncached:1000000,output:0,cacheRead:0,cacheWrite:0,reasoning:0,totalTokens:1000000,quality:'measured'};
    store.state.records[r.id]=r;store.state.sessions[r.sessionKey]={agent:r.agent,id:'RAW_PRIVATE_'+id,cwd};
  };
  record('a',edge?'C:/synthetic-private/first/同名':'C:/synthetic-private/项目A');
  record('b',edge?'D:/synthetic-private/second/同名':'D:/synthetic-private/项目B',edge?'free':'fixture');
  if(edge){record('c','C:/synthetic-private/未知价格','missing');record('d','C:/synthetic-private/旧项目','fixture',new Date(Date.now()-60*86400000).toISOString());}
  store.state.sequence=1;atomic(path.join(usage,'statistics.json'),store.state);
  store.setPrice({provider:'private',model:'fixture',inputUncached:1,output:0,cacheRead:0,cacheWrite:0});
  store.setPrice({provider:'private',model:'free',inputUncached:0,output:0,cacheRead:0,cacheWrite:0});store.setEnabled(false);
  const view=store.workbench(),projectB=view.projectOptions.find(p=>p.name==='项目B');
  store.workbenchSettings={version:1,budgets:edge?Object.fromEntries([...view.projectOptions.map(p=>[p.id+':daily',10]),['f'.repeat(64)+':total',10]]):{'all:monthly':100,'all:daily':1,[projectB.id+':daily']:.5},acknowledged:{}};
  atomic(path.join(usage,'workbench.json'),store.workbenchSettings);return {projectB:projectB?.id};
}
async function scenario(scale,edge){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'budget-overview-ui-')),home=path.join(root,'home'),usage=path.join(root,'usage'),quota=path.join(root,'quota');fs.mkdirSync(home);
  const {projectB}=seed(usage,home,edge),tag=(edge?'edge-':'basic-')+scale;
  const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',quota,'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
  const errors=[];
  try{
    await keepVisible(app);await isolatePointer(app);const page=await app.firstWindow();
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await cost.openCost(page);await cost.section(page,'projects');
    await until(page,()=>document.querySelector('[data-cost-budget-state]').textContent.includes('预算'));
    assert.equal(new URL(page.url()).protocol,'file:');assert((await page.title()).startsWith('Agent Usage'));
    assert.equal(await page.locator('#main').getAttribute('data-current-view'),'cost');
    await page.screenshot({path:path.join(output,tag+'-projects.png'),fullPage:true});
    assert.equal(await page.locator('[data-cost-budgets] button[aria-expanded]').count(),edge?5:3,'the global budget list must include unselected saved scopes');
    const json=await page.evaluate(()=>window.usageBridge.workbench({period:'monthly',project:'all'}));
    const ledger=fs.readFileSync(path.join(usage,'statistics.json'));
    if(!edge){
      assert.equal(json.budget.state,'observed-below');assert.equal(json.issues.filter(i=>i.target==='workbench').length,0);
      assert.match(await page.locator('[data-cost-budget-state]').textContent(),/低于预算/);assert.equal(await page.locator('[data-cost-notice="budget"]').isVisible(),false,'selected-budget hint stays scoped');
      await showView(page,'sources');await until(page,()=>document.querySelectorAll('[data-attention-item="budget"]').length===2);
      assert.equal(await page.locator('[data-attention-item="budget"]').count(),2);
      assert.deepEqual(await page.locator('[data-attention-item="budget"]').evaluateAll(rows=>rows.map(row=>row.dataset.attentionId).sort()),json.budgetOverview.issues.map(issue=>issue.id).sort());
      const projectIssue=json.budgetOverview.issues.find(i=>i.evidence.scope===projectB),allIssue=json.budgetOverview.issues.find(i=>i.evidence.scope==='all');
      await page.locator('[data-attention-id="'+projectIssue.id+'"]').getByRole('button',{name:'已知悉',exact:true}).click();
      await until(page,async()=>{const v=await window.usageBridge.workbench();return v.budgetOverview.issues.filter(i=>i.acknowledged).length===1;});
      const acknowledged=JSON.parse(fs.readFileSync(path.join(usage,'workbench.json'))).acknowledged;assert.equal(acknowledged[projectIssue.id],projectIssue.fingerprint);assert.equal(acknowledged[allIssue.id],undefined);
      await page.getByRole('switch',{name:'显示已知悉',exact:true}).click();await page.locator('[data-attention-id="'+projectIssue.id+'"]').getByRole('button',{name:'恢复待办',exact:true}).waitFor();
      await page.locator('[data-attention-id="'+projectIssue.id+'"]').getByRole('button',{name:'恢复待办',exact:true}).click();await until(page,async()=>{const v=await window.usageBridge.workbench();return v.budgetOverview.issues.every(i=>!i.acknowledged);});
      await page.locator('[data-attention-id="'+projectIssue.id+'"]').getByRole('button',{name:'查看预算',exact:true}).click();
      await until(page,()=>window.insightsHost.get().period==='daily'&&window.insightsHost.get().project!=='all');
      assert.equal(await page.evaluate(()=>window.insightsHost.get().project),projectB);assert.equal(await page.locator('[data-cost-budgets] button[aria-expanded]').count(),3,'the global list does not shrink with the editor selection');
      await showView(page,'sources');await page.locator('[data-attention-id="'+allIssue.id+'"]').getByRole('button',{name:'已知悉',exact:true}).click();
      await until(page,async()=>{const v=await window.usageBridge.workbench();return v.budgetOverview.issues.find(i=>i.evidence.scope==='all').acknowledged;});
      assert.equal(JSON.parse(fs.readFileSync(path.join(usage,'workbench.json'))).acknowledged[allIssue.id],allIssue.fingerprint);
      await page.locator('[data-attention-id="'+allIssue.id+'"]').getByRole('button',{name:'恢复待办',exact:true}).click();
      await until(page,async()=>{const v=await window.usageBridge.workbench();return v.budgetOverview.issues.every(i=>!i.acknowledged);});
      // Repricing invalidates an acknowledgement and refreshes all global rows.
      await page.locator('[data-attention-id="'+projectIssue.id+'"]').getByRole('button',{name:'已知悉',exact:true}).click();
      await until(page,async()=>{const v=await window.usageBridge.workbench();return v.budgetOverview.issues.some(i=>i.acknowledged);});
      await page.evaluate(()=>window.usageBridge.savePrice({provider:'private',model:'fixture',inputUncached:2,output:0,cacheRead:0,cacheWrite:0}));
      await until(page,async()=>{const v=await window.usageBridge.workbench();return v.budgetOverview.issues.every(i=>!i.acknowledged);});
      await until(page,()=>[...document.querySelectorAll('[data-attention-item="budget"]')].every(e=>!e.hasAttribute('data-acknowledged')));
      await page.screenshot({path:path.join(output,tag+'-attention.png')});
      // Inject only synthetic projection counts to prove the two fields stay independent.
      await app.evaluate(({ipcMain})=>{const handlers=ipcMain._invokeHandlers;globalThis.budgetUiOriginal=new Map();for(const name of ['usage:workbench','usage:attention']){const original=handlers.get(name);globalThis.budgetUiOriginal.set(name,original);handlers.set(name,async(...args)=>{const v=await original(...args);return {...v,omittedIssues:7,budgetOverview:{...v.budgetOverview,omittedIssues:11,issues:v.budgetOverview.issues.map(i=>({...i,acknowledged:Boolean(globalThis.budgetUiOmittedAck)||i.acknowledged}))}};});}});
      await cost.openCost(page);await page.getByRole('button',{name:'刷新项目',exact:true}).click();await showView(page,'sources');
      await page.locator('[data-attention-omitted="general"]').filter({hasText:'7'}).waitFor();await page.locator('[data-attention-omitted="budget"]').filter({hasText:'11'}).waitFor();
      await page.screenshot({path:path.join(output,tag+'-omitted.png'),fullPage:true});
      await page.getByRole('switch',{name:'显示已知悉',exact:true}).click();await app.evaluate(()=>{globalThis.budgetUiOmittedAck=true;});
      await cost.openCost(page);await page.getByRole('button',{name:'刷新项目',exact:true}).click();await showView(page,'sources');
      await page.locator('[data-source-attention]').filter({hasText:'不能确认全部状态'}).waitFor();assert.equal(await page.locator('[data-attention-item="budget"]').count(),0);
      await app.evaluate(({ipcMain})=>{for(const [name,original] of globalThis.budgetUiOriginal)ipcMain._invokeHandlers.set(name,original);delete globalThis.budgetUiOriginal;delete globalThis.budgetUiOmittedAck;});
    }else{
      const labels=await page.locator('[data-cost-budgets] button[aria-expanded]').allTextContents();assert.equal(labels.filter(label=>label.includes('同名')).length,2);assert(labels.some(label=>label.includes('项目 1'))&&labels.some(label=>label.includes('项目 2')));
      assert.equal(await page.locator('[data-cost-budgets] [data-budget-state="unpriced"]:not([aria-hidden="true"] *)').count(),1);assert.equal(await page.locator('[data-cost-budgets] [data-budget-state="no-data"]:not([aria-hidden="true"] *)').count(),1);assert.equal(await page.locator('[data-cost-budgets] [data-budget-state="scope-missing"]:not([aria-hidden="true"] *)').count(),1);
      await showView(page,'sources');const lost=json.budgetOverview.issues.find(i=>i.code==='BUDGET_SCOPE_MISSING');
      await page.locator('[data-attention-id="'+lost.id+'"]').getByRole('button',{name:'已知悉',exact:true}).click();await until(page,async()=>{const v=await window.usageBridge.workbench();return v.budgetOverview.issues.find(i=>i.code==='BUDGET_SCOPE_MISSING').acknowledged;});
      await page.getByRole('switch',{name:'显示已知悉',exact:true}).click();await page.locator('[data-attention-id="'+lost.id+'"]').getByRole('button',{name:'恢复待办',exact:true}).click();
      await until(page,async()=>{const v=await window.usageBridge.workbench();return !v.budgetOverview.issues.find(i=>i.code==='BUDGET_SCOPE_MISSING').acknowledged;});
      await page.locator('[data-attention-id="'+lost.id+'"]').getByRole('button',{name:'查看预算',exact:true}).click();await until(page,()=>window.insightsHost.get().period==='total');
      assert.equal(await page.evaluate(()=>window.insightsHost.get().project),'all');await page.locator('[data-budget-state="scope-missing"]:not([aria-hidden="true"] *)').filter({hasText:'无法判断'}).waitFor();
    }
    await cost.openCost(page);await cost.section(page,'projects');await page.locator('#theme').click();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(800,600));await settle(page);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true);
    await page.locator('[data-cost-budgets]').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,tag+'-narrow-dark.png')});
    assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),ledger);assert.deepEqual(errors,[]);
    const text=await page.locator('[data-cost-projects]').innerText();assert(!text.includes('synthetic-private'));assert(!text.includes('RAW_PRIVATE'));
    return {scale,edge,syntheticOnly:true,sourceMode:!process.env.QUOTA_PACKAGED_EXE,globalBudgets:true,ownScopeAcknowledgement:true,restore:true,unknownsPreserved:true,narrow800:true,noPageErrors:true};
  }catch(error){const page=await app.firstWindow();await page.screenshot({path:path.join(output,tag+'-failure.png'),fullPage:true}).catch(()=>{});throw error;}
  finally{await app.close();await cleanup(root);}
}
(async()=>{const results=[];for(const scale of [1,1.5]){results.push(await scenario(scale,false));results.push(await scenario(scale,true));}fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log('PASS: global saved budgets, independent issues/omission counts, own-scope acknowledge/restore, unknown states and narrow dark UI at 100%/150%.');})().catch(error=>{console.error(error);process.exitCode=1;});
