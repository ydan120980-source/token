'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Store,atomic}=require('../../src/m1/store');
const workbench=require('../../src/m1/workbench');
const {remove}=require('./temp');
const key=value=>crypto.createHash('sha256').update(value).digest('hex');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'budget-overview-')),store=new Store(dir,{});t.after(()=>remove(dir));
  const record=(id,cwd,timestamp='2026-10-20T04:00:00Z',model='fixture')=>{
    const r={id:key(id),sessionKey:key('session:'+id),agent:'claude',entry:'cli',provider:'private',model,timestamp,inputUncached:1000000,output:0,cacheRead:0,cacheWrite:0,reasoning:0,totalTokens:1000000,quality:'measured'};
    store.state.records[r.id]=r;store.state.sessions[r.sessionKey]={agent:r.agent,id:'RAW_'+id,cwd};return r;
  };
  store.setPrice({provider:'private',model:'fixture',inputUncached:1,output:0,cacheRead:0,cacheWrite:0});
  const original=store.snapshot.bind(store);let today='2026-10-20',timezone='Asia/Shanghai';
  store.snapshot=()=>({...original(),today,timezone});
  const clock=(date,zone)=>{today=date;timezone=zone;};
  const save=budgets=>{store.workbenchSettings=workbench.settings({version:1,budgets,acknowledged:{}});};
  return {store,dir,record,save,clock};
}
test('all saved scopes/periods report independently of selection and keep existing issue identities',t=>{
  const f=fixture(t);f.record('A','C:/synthetic/A');f.record('B','D:/synthetic/B');
  const b=f.store.workbench({period:'total'}).projectOptions.find(p=>p.name==='B');
  f.save({'all:monthly':100,'all:daily':1,[b.id+':daily']:.5});
  const selected=f.store.workbench({period:'monthly'}),overview=selected.budgetOverview;
  assert.equal(selected.budget.state,'observed-below');assert.equal(selected.issues.filter(i=>i.target==='workbench').length,0);
  assert.equal(overview.budgets.length,3);assert.equal(overview.issues.length,2);assert.equal(overview.omittedIssues,0);
  const project=overview.budgets.find(row=>row.scope===b.id);assert.equal(project.projectName,'B');assert.equal(project.total.lower,1);assert.equal(project.state,'exceeded');
  for(const issue of overview.issues){
    const {scope,period}=issue.evidence,local=f.store.workbench({project:scope,period});
    assert.deepEqual(local.issues.find(i=>i.target==='workbench'),issue);
    assert.deepEqual(overview.budgets.find(row=>row.scope===scope&&row.period===period).total,local.total);
    assert.throws(()=>f.store.saveWorkbench({kind:'acknowledge',id:issue.id,fingerprint:issue.fingerprint,acknowledged:true,project:'all',period:'monthly'}),/ISSUE_STALE/);
    f.store.saveWorkbench({kind:'acknowledge',id:issue.id,fingerprint:issue.fingerprint,acknowledged:true,project:scope,period});
    assert(f.store.workbench().budgetOverview.issues.find(i=>i.id===issue.id).acknowledged);
  }
  assert(f.store.workbench().budgetOverview.issues.every(i=>i.acknowledged));
  assert.equal(f.store.workbench().budget.state,'observed-below');
});
test('unknown prices, empty periods, lost projects and same names are explicit without exposing paths',t=>{
  const f=fixture(t);f.record('A','C:/synthetic/same');f.record('B','D:/synthetic/same',undefined,'missing');f.record('old','E:/synthetic/old','2026-09-01T04:00:00Z');
  const options=f.store.workbench({period:'total'}).projectOptions,a=options.filter(p=>p.name==='same'),old=options.find(p=>p.name==='old'),lost=key('lost');
  f.save(Object.fromEntries([...a.map(p=>[p.id+':daily',10]),[old.id+':daily',10],[lost+':total',10],['unknown:daily',10]]));
  const overview=f.store.workbench().budgetOverview,same=overview.budgets.filter(row=>row.projectName==='same');
  assert.equal(new Set(same.map(row=>row.scope)).size,2);assert.equal(new Set(same.map(row=>row.projectLabel)).size,2);
  assert.deepEqual(same.map(row=>row.state).sort(),['observed-below','unpriced']);
  for(const row of overview.budgets.filter(row=>['scope-missing','no-data'].includes(row.state))){
    assert.equal(row.total.lower,null);assert.equal(row.total.upper,null);assert.equal(row.remainingUsd,null);
  }
  assert.equal(overview.budgets.find(row=>row.scope===lost).projectName,null);
  assert.equal(overview.budgets.find(row=>row.scope===old.id).state,'no-data');
  for(const row of overview.budgets.filter(row=>row.state==='scope-missing'))assert(overview.issues.some(i=>i.code==='BUDGET_SCOPE_MISSING'&&i.evidence.scope===row.scope));
  assert(overview.issues.some(i=>i.code==='BUDGET_NO_DATA'));
  const issue=overview.issues.find(i=>i.evidence.scope===lost);
  f.store.saveWorkbench({kind:'acknowledge',id:issue.id,fingerprint:issue.fingerprint,acknowledged:true,project:lost,period:'total'});
  assert(f.store.workbench().budgetOverview.issues.find(i=>i.id===issue.id).acknowledged);
  f.store.saveWorkbench({kind:'budget',project:lost,period:'total',limitUsd:null});
  assert(!f.store.workbench().budgetOverview.budgets.some(row=>row.scope===lost));
  const json=JSON.stringify(overview);for(const secret of ['C:/synthetic','D:/synthetic','E:/synthetic','RAW_',f.dir])assert(!json.includes(secret));
});
test('daily/weekly/monthly/total use one timezone, ignore future dates and keep historical project names',t=>{
  const f=fixture(t);f.record('prev','C:/synthetic/A','2026-01-01T00:30:00Z');f.record('today','C:/synthetic/A','2026-01-01T09:00:00Z');f.record('older','C:/synthetic/A','2025-12-01T09:00:00Z');f.record('future','C:/synthetic/A','2026-01-02T09:00:00Z');
  f.clock('2026-01-01','America/Los_Angeles');f.save(Object.fromEntries(workbench.PERIODS.map(period=>['all:'+period,100])));
  let overview=f.store.workbench().budgetOverview;
  assert.deepEqual(Object.fromEntries(overview.budgets.map(row=>[row.period,row.total.records])),{daily:1,monthly:1,total:3,weekly:2});
  assert.deepEqual(overview.budgets.find(row=>row.period==='weekly').range,{from:'2025-12-29',to:'2026-01-01'});
  f.clock('2026-01-01','Asia/Shanghai');overview=f.store.workbench().budgetOverview;
  assert.equal(overview.budgets.find(row=>row.period==='daily').total.records,2);
  f.clock('2026-01-02','Asia/Shanghai');overview=f.store.workbench().budgetOverview;
  assert.equal(overview.budgets.find(row=>row.period==='total').total.records,4);
});
test('overview preserves bounded costs, mixed unpriced records, observed free usage and unattributed scope',t=>{
  const f=fixture(t),r=f.record('bounded','C:/synthetic/A',undefined,'bounded');
  r.agent='antigravity';r.provider='anthropic';r.cacheWrite=null;f.store.state.sessions[r.sessionKey].agent=r.agent;
  f.store.setPrice({provider:'anthropic',model:'bounded',inputUncached:1,output:0,cacheRead:0,cacheWrite:2});
  f.save({'all:daily':1.5});let view=f.store.workbench(),row=view.budgetOverview.budgets[0];
  assert.equal(row.state,'possibly-exceeded');assert.equal(row.total.lower,1);assert.equal(row.total.upper,2);assert.equal(row.remainingUsd,-.5);assert.equal(row.remainingUpperUsd,.5);
  assert.equal(view.budgetOverview.issues[0].code,'BUDGET_POSSIBLY_EXCEEDED');
  f.record('missing',null,undefined,'missing');f.store.state.sequence++;f.save({'all:daily':10,'unknown:daily':10});
  view=f.store.workbench();row=view.budgetOverview.budgets.find(row=>row.scope==='all');assert.equal(row.state,'incomplete');assert.equal(row.total.unpricedRecords,1);assert.equal(row.total.unpricedTokens,1000000);
  const unknown=view.budgetOverview.budgets.find(row=>row.scope==='unknown');assert.equal(unknown.projectName,'未知项目');assert.equal(unknown.state,'unpriced');assert.equal(unknown.total.lower,null);
  f.store.setPrice({provider:'anthropic',model:'bounded',inputUncached:0,output:0,cacheRead:0,cacheWrite:0});
  const project=view.projectOptions.find(p=>p.name==='A');f.save({[project.id+':daily']:10});
  row=f.store.workbench().budgetOverview.budgets[0];assert.equal(row.state,'observed-below');assert.equal(row.total.lower,0);assert.equal(row.total.upper,0);assert.equal(row.total.pricedRecords,1);
});
test('repricing and fact changes invalidate overview acknowledgements without changing ledger bytes',t=>{
  const f=fixture(t),record=f.record('A','C:/synthetic/A');f.save({'all:daily':.5});
  atomic(path.join(f.dir,'statistics.json'),f.store.state);const bytes=fs.readFileSync(path.join(f.dir,'statistics.json'));
  const issue=f.store.workbench().budgetOverview.issues[0],ack={kind:'acknowledge',id:issue.id,fingerprint:issue.fingerprint,acknowledged:true,project:'all',period:'daily'};
  f.store.saveWorkbench(ack);assert(f.store.workbench().budgetOverview.issues[0].acknowledged);
  f.store.setPrice({provider:'private',model:'fixture',inputUncached:2,output:0,cacheRead:0,cacheWrite:0});
  let next=f.store.workbench().budgetOverview.issues[0];assert.equal(next.id,issue.id);assert.notEqual(next.fingerprint,issue.fingerprint);assert(!next.acknowledged);
  assert.throws(()=>f.store.saveWorkbench(ack),/ISSUE_STALE/);
  f.store.reprice();assert.equal(f.store.workbench().budgetOverview.budgets[0].total.lower,2);
  record.totalTokens=2000000;record.inputUncached=2000000;f.store.state.sequence++;
  next=f.store.workbench().budgetOverview.issues[0];assert.equal(next.evidence.lower,4);
  assert.deepEqual(fs.readFileSync(path.join(f.dir,'statistics.json')),bytes);
});
test('1000 budgets share one estimate per record, cap independently, and omitted issues can be acknowledged',t=>{
  const f=fixture(t);
  for(let i=0;i<1000;i++)f.record('call'+i,'C:/synthetic/project-'+i%250);
  const options=f.store.workbench({period:'total'}).projectOptions;
  f.save(Object.fromEntries(options.flatMap(p=>workbench.PERIODS.map(period=>[p.id+':'+period,.01]))));
  // Snapshot cost calculation is an existing separate projection; measure workbench itself.
  const snapshot=f.store.snapshot();f.store.snapshot=()=>snapshot;const estimate=f.store.estimate.bind(f.store);let estimates=0;
  f.store.estimate=record=>{estimates++;return estimate(record);};
  const before=JSON.stringify(f.store.state),view=f.store.workbench({period:'monthly'});
  assert.equal(estimates,1000);assert.equal(view.budgetOverview.budgets.length,1000);assert.equal(view.budgetOverview.issues.length,500);assert.equal(view.budgetOverview.omittedIssues,500);
  assert.equal(view.omittedIssues,0);assert.equal(JSON.stringify(f.store.state),before);
  const row=view.budgetOverview.budgets[999],local=f.store.workbench({project:row.scope,period:row.period}),issue=local.issues.find(i=>i.target==='workbench');
  assert(!view.budgetOverview.issues.some(i=>i.id===issue.id));
  f.store.saveWorkbench({kind:'acknowledge',id:issue.id,fingerprint:issue.fingerprint,acknowledged:true,project:row.scope,period:row.period});
  assert(f.store.workbench({project:row.scope,period:row.period}).issues.find(i=>i.id===issue.id).acknowledged);
});
