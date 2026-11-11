'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const model=require('../../design/desktop-reference/sources-model');
const displayValues=require('../../design/desktop-reference/display-values');
const pricingLabels=require('../../src/m1/pricing-labels');
const state=()=>({discovery:null,statuses:null,stale:false,busy:false,message:'',notice:'',collection:null});
test('sourceLine preserves stopped/stale/known wording and S6 omits unreported observations',()=>{
 const s=state(),m=model.create(s,{});assert.equal(m.sourceLine({enabled:false},{}),'已停用 · 历史统计保留');
 assert.equal(m.sourceLine(null,{observedRecords:0}),'0 条已读取记录');
 assert.equal(m.sourceLine(null,{observedRecords:null}),'');assert.equal(m.sourceLine(null,{}),'');
 assert.equal(m.sourceLine({enabled:true,installed:true,files:4},{observedRecords:9}),'4 个记录文件 · 9 条已读取记录');
 s.stale=true;assert.equal(m.sourceLine(null,{}),'文件信息待重新检查 · 历史统计保留');
});
test('S7 sums only known enabled files and marks the lower bound',()=>{
 const s=state();s.discovery={sources:[{enabled:true,files:4},{enabled:true,files:null},{enabled:false,files:200}],unsupported:[]};
 assert.equal(model.sourceSummary(s,true),'读取 2 / 3 个来源 · 至少 4 个记录文件');
 s.discovery.sources[1].files=0;assert.equal(model.sourceSummary(s,true),'读取 2 / 3 个来源 · 4 个记录文件');
 s.discovery.sources[0].files=null;assert.equal(model.sourceSummary(s,true),'读取 2 / 3 个来源 · 至少 0 个记录文件');
});
test('saved selection preserves discovery facts and keeps a fresh setting even before rediscovery',()=>{
 const s=state();s.discovery={checkedAt:'old',unsupported:[{id:'kiro'}],sources:[{agent:'codex',enabled:true,files:2,paths:[{path:'A',display:'~A',exists:true,files:2,issues:['SOURCE_BUSY']}]}]};
 model.create(s,{}).selection([{agent:'codex',enabled:false,paths:[{path:'A',state:'stopped'},{path:'B',state:'stopped'}]}]);
 assert.equal(s.stale,true);assert.equal(s.discovery.sources[0].enabled,false);assert.equal(s.discovery.sources[0].paths[0].display,'~A');assert.equal(s.discovery.sources[0].paths[1].files,null);assert.equal(s.discovery.checkedAt,'old');
});
test('path projection preserves absent-auto, excluded, unreadable and manual actions',()=>{
 const base={state:'included',origin:'auto',exists:false,kind:'directory',files:null,issues:[]};
 assert.equal(model.path(base,false).meta,'尚未出现，出现后自动读取');assert.deepEqual(model.path(base,false).action,{name:'remove',label:'排除'});
 assert.equal(model.path({...base,exists:true},false).meta,'已纳入读取 · 无法读取');
 assert.equal(model.path({...base,state:'excluded'},false).action.name,'include');assert.equal(model.path({...base,origin:'added'},false).action.label,'移除');
 assert.equal(model.path(base,true).meta,'文件信息待检查');
});
test('installer status/actions retain update, busy, managed and local-maintenance boundaries',()=>{
 assert.equal(model.programStatus({state:'unchecked'}),null);assert.equal(model.programStatus({busy:true,stage:'verifying'}),'核验安装文件');
 assert.equal(model.programStatus({version:'1.0',updateAvailable:true,latest:'2.0'}),'程序 1.0 · 可升级到 2.0');
 const actions=model.installActions({agent:'claude',state:'installed',localMaintenanceRequired:true},false);assert.equal(actions[0].disabled,true);assert.equal(actions.find(a=>a.action==='official').disabled,undefined);assert(!actions.some(a=>a.action==='rollback'));
});
test('management edits keep blank values absent and parse exactly the existing patch shape',()=>{
 assert.deepEqual(model.editPatch({command:'',args:'["--help"]',timeout:'20'}),{args:['--help'],timeout:20});
 assert.throws(()=>model.editPatch({args:'x'}),/JSON 字符串列表/);assert.throws(()=>model.editPatch({name:' '}),/至少一个/);
});
test('custom configuration keeps unknowns in the bridge and validates explicit semantics',()=>{
 assert.deepEqual(model.customConfig({name:' A ',template:'standard',mode:'per-request'}),{schemaVersion:'CustomSourceV1',name:'A',template:'standard',mode:'per-request'});
 const form={name:'mapped',template:'mapped',mode:'per-request',input:'exclusive',reason:'no',time:'ms',mapping:{id:' meta.id ',total:''},filters:'[]'};
 assert.deepEqual(model.customConfig(form).mapping,{id:'meta.id'});assert.equal(model.customConfig(form).outputIncludesReasoning,false);assert.throws(()=>model.customConfig({...form,input:''}),/CUSTOM_CONFIG_INVALID/);
});
test('capabilities are data with T1 multi-Agent text and no HTML; collection diagnostics lead and cannot acknowledge',()=>{
 const s={general:{sources:[{agent:'codex',name:'Codex',formats:['jsonl'],realSampleVerified:false,ruleVersion:1,mixedRules:false,inputSemantics:'exclusive',outputSemantics:'includes-reasoning',quota:true,known:Object.fromEntries(['inputUncached','output','cacheRead','cacheWrite','reasoning'].map(k=>[k,{records:1}])),records:1,totalTokens:2,lower:null,upper:null,sessions:1}],issues:[{id:'u',target:'cost',code:'USAGE_UNPRICED',agent:'codex',evidence:{model:'x',reason:'missing-rate',records:1,tokens:2}}]}};
 const m=model.createInsights(s,{displayValues,pricingLabels,agentCatalog:{agents:{}}},()=>({error:'COLLECTION_FAILED',diagnostic:{stage:'source-scan',reason:'EACCES',category:'os'}}));
 assert.match(m.capability('codex').semantics,/账号额度在“额度”页按 Agent 单独连接读取/);assert.equal(typeof m.capability('codex'),'object');assert.equal(m.attentionItems()[0].scope,'collection');const [what,effect,actions,title]=m.sentence(m.attentionItems()[0]);assert.match(what,/没有访问权限/);assert.match(effect,/已有数据保留/);assert.match(title,/EACCES/);assert.equal(actions[0].action,'retry');assert(!JSON.stringify(actions).includes('<button'));
});

test('installer display keeps known zero progress distinct from missing bytes and preserves the legacy caption gate',()=>{
 const zero=model.installerView({downloadedBytes:0,totalBytes:100,stage:'downloading'});assert.equal(zero.progress,0);assert.equal(zero.percent,null);
 assert.equal(model.installerView({downloadedBytes:20}).progress,null);assert.equal(model.installerView({downloadedBytes:25,totalBytes:100}).percent,'25%');
});
