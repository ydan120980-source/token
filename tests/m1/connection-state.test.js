'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectConnections,quotaFreshness,quotaDescription,FRESH_MS}=require('../../src/quota/connection-state');
const {agents}=require('../../src/m1/agent-catalog');
const now=Date.parse('2026-10-19T02:00:00Z'),iso=time=>new Date(time).toISOString();
const account=changes=>({provider:'codex',status:'ready',quota:{fetchedAt:iso(now-60000),windows:[{remainingPercent:0,resetsAt:iso(now+60000)}]},...changes});
test('capability is independent of usage, discovery and account connection; unknown never becomes zero',()=>{
 const unknown=projectConnections({catalog:agents,now});const codex=unknown.rows.find(r=>r.agent==='codex');assert.equal(codex.usage.state,'unknown');assert.equal(codex.quota.capability,'supported');assert.equal(codex.quota.connections,null);assert.equal(codex.quota.connectionState,'unknown');
 assert(unknown.rows.filter(r=>r.agent!=='codex').every(r=>r.quota.capability==='not-integrated'&&r.quota.connections===null));
 const checked=projectConnections({catalog:agents,quota:{accounts:[],executableAvailable:false},now});assert.equal(checked.rows[0].quota.connections,0);assert.match(quotaDescription(checked.rows[0].quota),/选择官方 Codex CLI/);
 const one=projectConnections({catalog:agents,collection:{enabled:false},quota:{accounts:[account()]},now}).rows[0];assert.equal(one.usage.state,'paused');assert.equal(one.quota.connectionState,'connected');assert.equal(one.quota.freshness.fresh,1);
});
test('restart-retained errors and damaged connection cache remain actionable without leaking recovery paths',()=>{
 const cached=projectConnections({catalog:agents,quota:{accounts:[account({status:'cached',errorCode:'RATE_LIMITED'})],executableAvailable:false},now}).rows[0].quota;
 assert.equal(cached.failed,1);assert.equal(cached.connectionState,'attention');assert.match(quotaDescription(cached),/读取失败.*官方 Codex CLI 未就绪/);
 const recovered=projectConnections({catalog:agents,quota:{accounts:[],recovered:{quarantined:'PRIVATE_RECOVERY_PATH'}},now});assert.match(quotaDescription(recovered.rows[0].quota),/缓存已重置/);assert(!JSON.stringify(recovered).includes('PRIVATE_RECOVERY_PATH'));
});
test('freshness handles TTL, reset expiry, cached restart, auth failure, busy and future timestamps',()=>{
 assert.equal(quotaFreshness(account(),now).state,'fresh');
 assert.equal(quotaFreshness(account({quota:{fetchedAt:iso(now-FRESH_MS-1),windows:[{}]}}),now).state,'stale');
 assert.equal(quotaFreshness(account({quota:{fetchedAt:iso(now),windows:[{resetsAt:iso(now-1)}]}}),now).reason,'reset-passed');
 assert.equal(quotaFreshness(account({status:'cached'}),now).state,'cached');
 assert.equal(quotaFreshness(account({status:'login-required',errorCode:'LOGIN_REQUIRED'}),now).state,'cached');
 assert.equal(quotaFreshness(account({busy:true}),now).state,'cached');
 assert.equal(quotaFreshness(account({quota:{fetchedAt:iso(now+60001),windows:[{}]}}),now).reason,'invalid-time');
 assert.equal(quotaFreshness(account({quota:{fetchedAt:'C:/PRIVATE_TIME',windows:[{}]}}),now).fetchedAt,null);
 assert.equal(quotaFreshness(account({quota:{fetchedAt:iso(now),windows:[]}}),now).reason,'no-windows');
 assert.equal(quotaFreshness(account({quota:null}),now).state,'missing');
});
test('mixed accounts preserve per-connection coverage without summing quotas, and return no identities or account metadata',()=>{
 const accounts=[account({id:'PRIVATE_ID',alias:'PRIVATE_ALIAS',plan:'PRIVATE_PLAN',token:'PRIVATE_TOKEN'}),account({status:'cached'}),account({status:'error',errorCode:'RATE_LIMITED',quota:{fetchedAt:iso(now-3600000),windows:[{}]}}),account({status:'login-required',errorCode:'LOGIN_REQUIRED',quota:null,duplicateKnown:true})];
 const result=projectConnections({catalog:agents,quota:{accounts},now}),q=result.rows[0].quota;
 assert.deepEqual(q.freshness,{fresh:1,stale:1,cached:1,missing:1});assert.equal(q.connections,4);assert.equal(q.loginRequired,1);assert.equal(q.failed,1);assert.equal(q.duplicates,1);assert.equal(q.connectionState,'attention');
 assert.match(quotaDescription(q),/1 个已更新.*1 个缓存已过期.*1 个缓存待验证.*1 个额度未知/);
 assert.equal(q.latestSuccess,iso(now-60000));assert.equal(q.oldestSuccess,iso(now-3600000));
 for(const value of ['PRIVATE_ID','PRIVATE_ALIAS','PRIVATE_PLAN','PRIVATE_TOKEN','remainingPercent','usedPercent','windows'])assert(!JSON.stringify(result).includes(value));
});
test('custom/archived sources remain usage-only; source pause/error and account health do not overwrite each other',()=>{
 const id='custom-11111111-1111-4111-8111-111111111111',catalog={...agents,[id]:{name:'Personal source',custom:true,archived:true}};
 const rows=projectConnections({catalog,statuses:{codex:{status:'partial',observedRecords:3,lastSuccess:iso(now-1000)},claude:{status:'error'}},disabled:['codex'],custom:{[id]:{enabled:false}},discovered:[{agent:'gemini',installed:false}],quota:{accounts:[account()]},now}).rows;
 assert.equal(rows.find(r=>r.agent===id).quota.capability,'usage-only');assert.equal(rows.find(r=>r.agent===id).usage.state,'paused');
 assert.equal(rows[0].usage.state,'paused');assert.equal(rows[0].usage.lastState,'partial');assert.equal(rows[0].quota.freshness.fresh,1);
 assert.equal(rows.find(r=>r.agent==='claude').usage.state,'error');assert.equal(rows.find(r=>r.agent==='gemini').usage.state,'not-detected');
});
