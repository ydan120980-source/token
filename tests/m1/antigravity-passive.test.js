'use strict';
require('./experimental-on');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {projectAntigravity}=require('../../src/quota/antigravity-passive'),{ProviderQuotaService,installProviderQuota}=require('../../src/quota/provider-service');
const {writeSnapshot,readSnapshot}=require('../../src/quota/claude-passive'),{capabilities}=require('../../src/quota/provider-catalog'),{projectConnections}=require('../../src/quota/connection-state'),{remove}=require('./temp');
const at='2026-10-20T02:00:00.000Z',NOW=Date.parse(at),payload=()=>({product:'antigravity',version:'1.2.11',email:'PRIVATE_EMAIL',cwd:'PRIVATE_PATH',conversation_id:'PRIVATE_SESSION',context_window:{used_percentage:99},quota:{'PRIVATE_BUCKET':{remaining_fraction:0.75,reset_time:'2026-10-21T02:00:00Z',reset_in_seconds:86400}}});
test('all ten built-ins expose an explicit route; Antigravity passive contract never enables active CLI querying',()=>{
  const rows=capabilities().filter(row=>row.mode!=='planned');assert.equal(rows.length,10);assert(rows.every(row=>row.provider==='codex'||row.adapters.length>0));assert.equal(rows.find(row=>row.provider==='antigravity').mode,'passive');
  assert.equal(require('../../src/quota/antigravity-command').commandPlan('C:\\fixture\\agy.exe').liveEnabled,false);
  const quota=projectAntigravity(payload(),at),value=quota.pools[0].windows[0];assert.equal(value.remainingPercent,75);assert.equal(value.resetsAt,'2026-10-21T02:00:00.000Z');assert.equal(quota.incomplete,true);assert.equal(quota.provenance.kind,'passive');assert.equal(quota.entitlement.plan,null);assert(!JSON.stringify(quota).includes('PRIVATE_'));
  const first={product:'antigravity',quota:{b:{remaining_fraction:0},a:{remaining_fraction:1}}},reordered={...first,quota:{a:first.quota.a,b:first.quota.b}};assert.deepEqual(projectAntigravity(first,at),projectAntigravity(reordered,at));
  const unknown=payload();unknown.quota.PRIVATE_BUCKET={remaining_fraction:2,reset_time:'not-a-time',reset_in_seconds:10};const bad=projectAntigravity(unknown,at).pools[0].windows[0];assert.equal(bad.remainingPercent,null);assert.equal(bad.resetsAt,null);assert(bad.issues.includes('INVALID_PERCENT'));assert(bad.issues.includes('INVALID_TIME'));
  assert.equal(projectAntigravity({product:'antigravity',version:'bad-secret',context_window:{remaining_percentage:99}},at).pools.length,0);
  assert.throws(()=>projectAntigravity({quota:{}},at),/RESPONSE_INVALID/);assert.throws(()=>projectAntigravity({product:'antigravity',quota:[]},at),/RESPONSE_INVALID/);
  assert.throws(()=>projectAntigravity({product:'antigravity',quota:Object.fromEntries(Array.from({length:201},(_,i)=>[i,{}]))},at),/OUTPUT_LIMIT/);
});
test('passive observations bind to their adapter, stay local, preserve age, clear absent quota and survive restart',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'antigravity 额度 '));t.after(()=>remove(root));let now=NOW;
  const service=new ProviderQuotaService(root,{now:()=>now,fixture:true,run:()=>assert.fail('NO_NETWORK_OR_CLI')});t.after(()=>service.close());
  await service.connect({adapter:'antigravity-statusline',alias:'Synthetic',credential:null});await service.tail;const id=service.rows[0].id;assert.equal(service.state().accounts[0].status,'waiting');
  writeSnapshot(root,id,payload(),now);await service.refresh(id);const good=service.state().accounts[0];assert.equal(good.quota.pools[0].windows[0].remainingPercent,75);assert.equal(good.credentialReady,true);assert.equal(service.secrets.size,0);
  const encoded=JSON.stringify(good);assert(!encoded.includes('PRIVATE_'));assert.throws(()=>readSnapshot(root,id),/RESPONSE_INVALID/);assert.equal(readSnapshot(root,id,'antigravity').provider,'antigravity');
  const file=path.join(root,'incoming',id+'.json'),before=fs.readFileSync(file);now+=20*60000;writeSnapshot(root,id,payload(),now);assert.deepEqual(fs.readFileSync(file),before);await service.refresh(id);assert.equal(service.state().accounts[0].quota.pools[0].windows[0].freshness.state,'stale');
  const view=projectConnections({catalog:{antigravity:{name:'Antigravity'}},quota:{accounts:[],providerAccounts:service.state().accounts,providerCapabilities:capabilities()},now});assert.equal(view.rows[0].quota.connections,1);assert.equal(view.rows[0].quota.freshness.stale,1);
  writeSnapshot(root,id,{product:'antigravity'},now+1);await service.refresh(id);assert.equal(service.state().accounts[0].quota.hasMeasurements,false);assert.equal(service.state().accounts[0].quota.pools.length,0);
  const restarted=new ProviderQuotaService(root,{fixture:true,run:()=>assert.fail('NO_STARTUP_NETWORK')});await restarted.close();
  service.remove(id);assert.throws(()=>writeSnapshot(root,id,payload(),now),/ACTION_INVALID/);
});
test('passive guide IPC accepts only existing passive connections and keeps the sender guard',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agy-ipc-'));t.after(()=>remove(root));const service=new ProviderQuotaService(root,{fixture:true});t.after(()=>service.close());const handlers=new Map(),copied=[];
  installProviderQuota({handle:(key,fn)=>handlers.set(key,fn)},event=>event.allowed,service,()=>assert.fail('NO_BROWSER'),id=>copied.push(id));
  await service.connect({adapter:'antigravity-statusline',alias:'Fixture',credential:null});await service.tail;const id=service.rows[0].id;
  await assert.rejects(handlers.get('quota:providerPassiveGuide')({allowed:false},id),/SENDER_REJECTED/);assert.equal((await handlers.get('quota:providerPassiveGuide')({allowed:true},id)).ok,true);assert.deepEqual(copied,[id]);
});
