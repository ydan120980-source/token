'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,atomic}=require('../../src/m1/store');
const workbench=require('../../src/m1/workbench');
const {remove}=require('./temp');
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'workbench-'));t.after(()=>remove(dir));const store=new Store(dir,{});
  const record=(id,agent,model='test')=>({id:id.repeat(64),sessionKey:id.repeat(64),agent,entry:'cli',provider:'private',model,timestamp:new Date().toISOString(),inputUncached:60,output:20,cacheRead:40,cacheWrite:0,reasoning:5,totalTokens:120,quality:'measured'});
  const a=record('a','codex'),b=record('b','claude'),c={...record('c','claude','missing'),sessionKey:null,inputUncached:null,cacheRead:null,totalTokens:40,quality:'partial'};
  store.state.records=Object.fromEntries([a,b,c].map(r=>[r.id,r]));store.state.sequence=1;
  store.state.sessions={[a.sessionKey]:{id:'RAW_SESSION_A',agent:'codex',cwd:'C:\\private-user\\work\\same'},[b.sessionKey]:{id:'RAW_SESSION_B',agent:'claude',cwd:'C:/PRIVATE-USER/work/same/'}};
  atomic(path.join(dir,'statistics.json'),store.state);store.setPrice({provider:'private',model:'test',inputUncached:2,output:8,cacheRead:.5,cacheWrite:2.5});return {store,dir,a,b,c};
}
test('project/source/overall costs share one ledger, preserve unknowns and export no paths or identities',t=>{
  const {store,dir}=fixture(t),view=store.workbench({period:'total'});
  assert.equal(view.total.totalTokens,280);assert(Math.abs(view.total.lower-.0006)<1e-12);assert.equal(view.total.unpricedTokens,40);
  assert.equal(view.projects.length,2);const p=view.projects.find(p=>p.id!=='unknown');assert.equal(p.name,'same');assert.equal(p.sessions,2);assert.equal(p.agents.length,2);
  assert.equal(view.projects.reduce((n,p)=>n+p.totalTokens,0),view.total.totalTokens);assert.equal(view.sources.reduce((n,p)=>n+p.totalTokens,0),280);
  assert.equal(view.total.fields.inputUncached,null);assert.equal(view.sources.find(s=>s.agent==='claude').known.inputUncached.records,1);
  const csv=workbench.csv(view),json=JSON.stringify(view);for(const secret of ['private-user','PRIVATE-USER','RAW_SESSION_A','RAW_SESSION_B',dir]){assert(!csv.includes(secret));assert(!json.includes(secret));}
  assert(!csv.includes(p.id));assert(json.includes('USAGE_UNPRICED'));
  assert.throws(()=>store.workbench({path:dir}),/REQUEST_INVALID/);assert.throws(()=>store.workbench({project:'a'.repeat(64)}),/SCOPE_INVALID/);
});
test('same project names on different directories stay distinct; unknown projects are not guessed',t=>{
  const {store,b}=fixture(t);store.state.sessions[b.sessionKey].cwd='D:\\other\\same';const view=store.workbench({period:'total'});
  assert.equal(view.projects.length,3);const named=view.projects.filter(p=>p.name==='same');assert.equal(named.length,2);assert.notEqual(named[0].id,named[1].id);
  assert.equal(view.projects.find(p=>p.id==='unknown').totalTokens,40);
  const selected=store.workbench({project:named[0].id,period:'total'});assert.equal(selected.projects.length,1);assert.equal(selected.total.totalTokens,120);
});
test('calendar budgets have independent scopes, no false within-budget result for unpriced data and survive restart',t=>{
  const {store}=fixture(t);assert.deepEqual(workbench.range('2026-11-01','weekly'),{from:'2026-10-26',to:'2026-11-01'});assert.deepEqual(workbench.range('2026-01-01','monthly'),{from:'2026-01-01',to:'2026-01-01'});
  store.saveWorkbench({kind:'budget',project:'all',period:'total',limitUsd:.001});assert.equal(store.workbench({period:'total'}).budget.state,'incomplete');
  store.saveWorkbench({kind:'budget',project:'all',period:'daily',limitUsd:.0001});assert.equal(store.workbench({period:'daily'}).budget.state,'exceeded');
  assert.equal(store.workbench({period:'monthly'}).budget.state,'not-set');
  const project=store.workbench({period:'total'}).projects.find(p=>p.id!=='unknown');store.saveWorkbench({kind:'budget',project:project.id,period:'total',limitUsd:.001});
  assert.equal(store.workbench({project:project.id,period:'total'}).budget.state,'observed-below');
  const again=new Store(store.dir,{});assert.equal(again.workbench({period:'total'}).budget.limitUsd,.001);
  again.saveWorkbench({kind:'budget',project:'all',period:'daily',limitUsd:null});assert.equal(again.workbench({period:'daily'}).budget.state,'not-set');assert.equal(again.workbench({period:'total'}).budget.limitUsd,.001);
  assert.throws(()=>store.saveWorkbench({kind:'budget',project:'all',period:'total',limitUsd:0}),/SETTING_INVALID/);
  assert.equal(workbench.budget({records:1,lower:null,upper:null,unpricedRecords:1},10).state,'unpriced');
  assert.equal(workbench.budget({records:1,lower:1,upper:3,unpricedRecords:0},2).state,'possibly-exceeded');
});
test('acknowledgements track evidence and failed local settings writes do not update memory',t=>{
  const {store}=fixture(t),issue=store.workbench({period:'total'}).issues.find(i=>i.code==='USAGE_UNPRICED');
  store.saveWorkbench({kind:'acknowledge',id:issue.id,fingerprint:issue.fingerprint,acknowledged:true,period:'total',project:'all'});
  assert(store.workbench({period:'total'}).issues.find(i=>i.id===issue.id).acknowledged);
  assert(store.workbench({period:'monthly'}).issues.filter(i=>i.code==='USAGE_UNPRICED').every(i=>!i.acknowledged));
  const file=path.join(store.dir,'workbench.json'),bytes=fs.readFileSync(file),old=store.workbenchSettings,rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===file)throw new Error('INJECTED_SAVE_FAILURE');return rename(from,to);};
  try{assert.throws(()=>store.saveWorkbench({kind:'budget',period:'total',project:'all',limitUsd:5}),/SAVE_FAILURE/);}finally{fs.renameSync=rename;}
  assert.equal(store.workbenchSettings,old);assert.deepEqual(fs.readFileSync(file),bytes);
  const r=Object.values(store.state.records).find(r=>r.model==='missing');r.totalTokens=50;store.state.sequence++;
  assert.equal(store.workbench({period:'total'}).issues.find(i=>i.id===issue.id).acknowledged,false);
  assert.throws(()=>store.saveWorkbench({kind:'acknowledge',id:issue.id,fingerprint:issue.fingerprint,acknowledged:true,period:'total'}),/ISSUE_STALE/);
});
test('price changes and explicit repricing update every projection while facts, identities and ledger bytes stay intact',t=>{
  const {store,dir}=fixture(t),file=path.join(dir,'statistics.json'),bytes=fs.readFileSync(file),facts=JSON.stringify(store.state.records),before=store.workbench({period:'total'});
  store.setPrice({provider:'private',model:'test',inputUncached:4,output:8,cacheRead:.5,cacheWrite:2.5});
  const after=store.workbench({period:'total'});assert(Math.abs(after.total.lower-.00084)<1e-12);assert.notEqual(after.priceBasis.overrideSha256,before.priceBasis.overrideSha256);
  const result=store.reprice();assert.equal(result.sequence,1);assert.equal(store.workbench({period:'total'}).total.lower,after.total.lower);
  assert.equal(JSON.stringify(store.state.records),facts);assert.deepEqual(fs.readFileSync(file),bytes);
  assert.equal(store.snapshot().daily.reduce((n,r)=>n+(r.estimatedCostUsd||0),0),after.total.lower);
  assert(workbench.csv(after).includes('0.00084'));
});
test('budget and project dates use the requested local timezone, not UTC date slicing',t=>{
  const {store,a}=fixture(t);a.timestamp='2026-10-18T00:30:00Z';store.state.records={[a.id]:a};
  const get=store.snapshot.bind(store);store.snapshot=()=>({...get(),today:'2026-10-18',timezone:'America/Los_Angeles'});
  const today=store.workbench({period:'daily'});assert.equal(today.total.records,0);assert.equal(today.budget.state,'not-set');
  const month=store.workbench({period:'monthly'});assert.equal(month.total.records,1);
});
test('explicit free usage stays zero, empty scopes stay unknown, formula names are escaped and malformed settings are recoverable',t=>{
  const {store,dir,a}=fixture(t);store.state.records={[a.id]:a};store.state.sessions[a.sessionKey].cwd='C:\\private\\=SUM(1,2)';
  store.setPrice({provider:'private',model:'test',inputUncached:0,output:0,cacheRead:0,cacheWrite:0});
  const view=store.workbench({period:'total'});assert.equal(view.total.lower,0);assert.equal(view.total.pricedRecords,1);assert(workbench.csv(view).includes("'=SUM(1,2)"));assert(!workbench.csv(view).includes('C:\\private'));
  fs.writeFileSync(path.join(dir,'workbench.json'),JSON.stringify({version:1,budgets:{bad:1},acknowledged:{}}));
  const again=new Store(dir,{});assert.deepEqual(again.workbenchSettings,workbench.emptySettings());assert(again.recovered.some(r=>r.file==='workbench.json'));assert.equal(again.records().length,3);
});
