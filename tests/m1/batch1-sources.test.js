'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const {batch1Fixtures,write,shutdown,piMessage,otel,PRIVATE,time,later} = require('./batch1-fixtures');
const {scanSources,sourceStamp} = require('../../src/m1/sources');
const parsers = require('../../src/m1/batch1-sources');
const {allowedFile,roots} = require('../../src/m1/policy');
const {Store} = require('../../src/m1/store');
const {selectSnapshot} = require('../../src/m1/local-snapshot');
const {Service} = require('../../src/m1/service');
const {remove} = require('./temp');
const total = records => records.reduce((n,row) => n+row.totalTokens,0);
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'usage-batch1-')), home = path.join(dir,'home');
  t.after(() => remove(dir));
  return {dir,home,f:batch1Fixtures(home)};
}
function hashes(root) {
  const result = {};
  for (const entry of fs.readdirSync(root,{withFileTypes:true})) {
    const file = path.join(root,entry.name);
    if (entry.isDirectory()) Object.assign(result,hashes(file));
    else result[file] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return result;
}
test('batch1 source files -> normalized ledger -> safe projection -> restart, with no source mutation or private content', async t => {
  const {dir,home,f} = setup(t), before = hashes(home), scan = await scanSources(f.roots,'fixture-salt',{reads:0});
  for (const [agent,expected] of Object.entries(f.expected)) { assert.deepEqual(scan[agent].errors,[],agent); assert.equal(total(scan[agent].records),expected,agent); }
  assert.equal(scan.copilot.records[1].totalTokens,60); assert.equal(scan.cline.records[0].inputUncached,60);
  assert.equal(scan.pi.records[0].reasoning,3); assert.equal(scan.pi.records[0].totalTokens,130);
  const store = new Store(path.join(dir,'app'),f.roots); store.ingestCollection(scan,{status:'passed'},{});
  const count = store.records().length, facts = JSON.stringify(store.state.records);
  store.ingestCollection(scan,{status:'passed'},{});
  assert.equal(store.records().length,count); assert.equal(JSON.stringify(store.state.records),facts);
  const reopened = new Store(store.dir,f.roots), safe = selectSnapshot(reopened.snapshot());
  assert.equal(total(safe.daily),f.total); assert(!JSON.stringify(safe).includes(home));
  assert(!JSON.stringify(safe).includes('copilotCumulative')); assert(!JSON.stringify(reopened.state).includes(PRIVATE));
  assert.deepEqual(hashes(home),before);
});
test('Pi v3 copied/forked entries dedupe, unused text and model changes do not create billed requests', async t => {
  const {f} = setup(t);
  write(path.join(f.roots.pi[0],'other','fork.jsonl'),[{...f.pi[0],id:'pi-child',parentSession:f.piFile},f.pi[1],{type:'model_change',modelId:'other',provider:'other'},piMessage('child-call',10)]);
  const rows = (await scanSources(f.roots,'salt',{reads:0})).pi.records;
  assert.equal(rows.length,2); assert.equal(total(rows),210);
  const a = parsers.pi(f.pi,'salt')[0], b = parsers.pi([f.pi[0],{...f.pi[1],message:{...f.pi[1].message,model:undefined}}],'salt')[0];
  assert.equal(a.id,b.id,'identity survives missing/model-enriched snapshots');
  const future = parsers.pi([{...f.pi[0],version:4},f.pi[1]],'salt'); assert.equal(future.length,0); assert.deepEqual(future.warnings,['SOURCE_FORMAT_UNSUPPORTED']);
});
test('Cline IDE disjoint buckets and CLI inclusive metrics are separate, no manifest/prompt model inference', () => {
  const cli = parsers.cline([{sessionId:'cli-session',messages:[{id:'call',role:'assistant',ts:Date.parse(time),modelInfo:{id:'gpt-4.1',provider:'openai'},metrics:{inputTokens:100,outputTokens:20,cacheReadTokens:30,cacheWriteTokens:10,cost:999},content:PRIVATE}]}],'salt',path.join('cli-session','cli-session.messages.json'));
  assert.equal(total(cli),120); assert.equal(cli[0].inputUncached,60); assert.equal(cli[0].entry,'cli');
  const old = parsers.cline([[{type:'say',say:'api_req_started',ts:Date.parse(time),text:JSON.stringify({tokensIn:100,tokensOut:20,request:PRIVATE})}]],'salt',path.join('tasks','task','ui_messages.json'));
  assert.equal(old[0].model,'unknown'); assert.equal(old[0].cacheRead,null); assert.equal(total(old),120); assert(!JSON.stringify(old).includes(PRIVATE));
});
test('invalid/missing counters stay unknown, malformed usage is diagnosed and reasoning is never counted twice', () => {
  const header = {type:'session',version:3,id:'s',timestamp:time};
  const missing = piMessage(); missing.message.usage = {input:100,output:20};
  const record = parsers.pi([header,missing],'salt')[0]; assert.equal(record.cacheRead,null); assert.equal(record.reasoning,null);
  const invalid = piMessage(); invalid.message.usage.input = -1;
  const rows = parsers.pi([header,invalid],'salt'); assert.equal(rows[0].inputUncached,null); assert.equal(rows[0].quality,'partial'); assert(rows.warnings.includes('SOURCE_ROW_INVALID'));
  const badId = {...piMessage(),id:undefined}; assert.equal(parsers.pi([header,badId],'salt').length,0);
});
test('Copilot snapshots are time-sorted and duplicate archives do not change per-resume intervals', () => {
  const file = path.join('session-state','s','events.jsonl'), first = shutdown('a'), second = shutdown('b',later,150,30);
  const intervals = rows => parsers.copilotIntervals(parsers.copilotState(rows,'salt',file));
  assert.deepEqual(intervals([second,first,first]),intervals([first,second]));
  assert.deepEqual(intervals([first,second]).map(r=>r.totalTokens),[120,60]);
  const reset = intervals([first,shutdown('reset',later,10,2)]); assert.equal(total(reset),120); assert(reset.warnings.includes('SOURCE_USAGE_REGRESSION'));
});
test('Copilot saved cumulative baselines survive missing prefixes, late older imports, retry and restart', async t => {
  const {dir,f} = setup(t), app = path.join(dir,'app');
  // Observe only the last shutdown first. An older checkpoint imported later
  // must redistribute the same total across dates, rather than add spend.
  write(f.cpFile,[f.cp[1]]);
  let store = new Store(app,f.roots); store.ingestCollection(await scanSources(f.roots,store.state.salt,{reads:0}),{status:'passed'},{});
  assert.equal(total(store.records().filter(r=>r.agent==='copilot')),180);
  write(f.cpFile,f.cp);
  store.ingestCollection(await scanSources(f.roots,store.state.salt,{reads:0}),{status:'passed'},{});
  assert.deepEqual(store.records().filter(r=>r.agent==='copilot').map(r=>r.totalTokens),[120,60]);
  store = new Store(app,f.roots); write(f.cpFile,[f.cp[1]]);
  store.ingestCollection(await scanSources(f.roots,store.state.salt,{reads:0}),{status:'passed'},{});
  assert.equal(total(store.records().filter(r=>r.agent==='copilot')),180);
  assert.equal(store.records().filter(r=>r.agent==='copilot').length,2);
});
test('Copilot model and session cumulative baselines are independent', () => {
  const s1 = parsers.copilotState([shutdown('a'),shutdown('b',later,150,30)],'salt',path.join('session-state','s1','events.jsonl'));
  const s2 = parsers.copilotState([shutdown('a')],'salt',path.join('session-state','s2','events.jsonl'));
  assert.equal(total(parsers.copilotIntervals([...s1,...s2])),300);
});
test('Copilot OTel counts chat calls only, dedupes response copies, refuses unknown identities and exposes unknown cache', async t => {
  const {f,dir} = setup(t), file = path.join(dir,'otel','trace.jsonl'), span = otel();
  write(file,[span,{...span,spanId:'other'}, {...span,attributes:{...span.attributes,'gen_ai.operation.name':'invoke_agent'}}, {type:'metric',attributes:span.attributes,body:PRIVATE}]);
  const scan = await scanSources({...f.roots,copilot:[file]},'salt',{reads:0});
  assert.equal(scan.copilot.records.length,1); assert.equal(total(scan.copilot.records),120); assert.equal(scan.copilot.records[0].entry,'otel');
  const noSession = otel(); delete noSession.attributes['gen_ai.conversation.id']; assert.equal(parsers.copilotOtel([noSession],'salt').length,0);
  const noCache = otel(); delete noCache.attributes['gen_ai.usage.cache_read.input_tokens']; assert.equal(parsers.copilotOtel([noCache],'salt')[0].cacheRead,null);
  assert(!JSON.stringify(scan).includes(PRIVATE));
});
test('Copilot session-state / OTel overlap is blocked in one scan and against saved history after restart', async t => {
  const {dir,f} = setup(t), file = path.join(dir,'otel','trace.jsonl'); write(file,[otel()]);
  const mixed = await scanSources({...f.roots,copilot:[...f.roots.copilot,file]},'salt',{reads:0});
  assert.equal(mixed.copilot.records.length,0); assert(mixed.copilot.errors.includes('COPILOT_SOURCE_MODE_CONFLICT'));
  const store = new Store(path.join(dir,'app'),f.roots); store.ingestCollection(await scanSources(f.roots,store.state.salt,{reads:0}),{status:'passed'},{});
  const reopened = new Store(store.dir,f.roots); reopened.ingestCollection(await scanSources({...f.roots,copilot:[file]},store.state.salt,{reads:0}),{status:'passed'},{});
  assert.equal(total(reopened.records().filter(r=>r.agent==='copilot')),180);
  assert(reopened.state.statuses.copilot.errors.includes('COPILOT_SOURCE_MODE_CONFLICT'));
});
test('batch1 strict file whitelist, synthetic roots and stamps never read manifests/auth/source databases', t => {
  const {home,f} = setup(t);
  for (const agent of ['copilot','cline','pi']) for (const base of ['auth.json','credentials.json','config.json','tokens.json','settings.json','session-store.db']) assert.equal(allowedFile(agent,path.join(home,base)),false,agent+base);
  assert.equal(allowedFile('copilot',path.join('session-state','id','events.jsonl')),true);
  assert.equal(allowedFile('copilot',path.join('other','events.jsonl')),false);
  assert.equal(allowedFile('cline',path.join('tasks','id','api_conversation_history.json')),false);
  assert.equal(allowedFile('cline',path.join('id','id.json')),false);
  assert.equal(roots(home).cline[0].startsWith(home),true);
  const initial = sourceStamp(f.roots,'salt',{reads:0}); write(f.piFile,[...f.pi,piMessage('second-call')]);
  assert.notEqual(sourceStamp(f.roots,'salt',{reads:0}),initial);
});
test('collection service integrates batch1 with native statistics-only verification using a synthetic home', async t => {
  const {dir,home,f} = setup(t), service = new Service(path.join(dir,'app'),f.roots,()=>{},{home,appData:path.join(home,'AppData','Roaming'),localAppData:path.join(home,'AppData','Local')});
  t.after(()=>service.close());
  const value = await service.refresh(); assert.equal(total(value.snapshot.daily),f.total);
  assert.equal(value.audit.sourceWrites,0); assert.equal(value.audit.authenticationReads,0); assert.equal(value.audit.networkAttempts,0);
  assert.equal(service.store.state.statuses.pi.nativeVerification,'passed');
  const bytes = fs.readFileSync(path.join(service.store.dir,'statistics.json'));
  await service.refresh(); assert.deepEqual(fs.readFileSync(path.join(service.store.dir,'statistics.json')),bytes,'unchanged collection skips persistence');
});
test('usage-only registration exposes no quota login or installation authority', () => {
  const {agents} = require('../../src/m1/agent-catalog'), quota = require('../../src/quota/provider-catalog').capabilities();
  const setup = require('../../src/quota/agent-setup-catalog'), {plans} = require('../../src/quota/agent-install-plans');
  for (const agent of ['copilot','cline','pi']) {
    assert.equal(agents[agent].usageOnly,true); assert.equal(agents[agent].quota,false);
    assert(!quota.some(row=>row.provider===agent&&(row.mode!=='planned'||row.adapters.length))); assert(!Object.hasOwn(setup,agent)); assert(!Object.hasOwn(plans,agent));
  }
});
test('failed Copilot interval correction is atomic and never exposes an unpersisted redistribution', async t => {
  const {dir,f} = setup(t), store = new Store(path.join(dir,'app'),f.roots);
  write(f.cpFile,[f.cp[1]]); store.ingestCollection(await scanSources(f.roots,store.state.salt,{reads:0}),{status:'passed'},{});
  const saved = fs.readFileSync(path.join(store.dir,'statistics.json')), facts = JSON.stringify(store.state), persist = store.collectionWrite;
  write(f.cpFile,f.cp);
  store.collectionWrite = file => { if (file === path.join(store.dir,'statistics.json')) throw Error('synthetic-save-failed'); };
  const scan = await scanSources(f.roots,store.state.salt,{reads:0});
  assert.throws(()=>store.ingestCollection(scan,{status:'passed'},{}),/synthetic-save-failed/);
  assert.equal(JSON.stringify(store.state),facts); assert.deepEqual(fs.readFileSync(path.join(store.dir,'statistics.json')),saved);
  store.collectionWrite = persist; store.ingestCollection(scan,{status:'passed'},{});
  assert.equal(total(store.records().filter(r=>r.agent==='copilot')),180);
});
