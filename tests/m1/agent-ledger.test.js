'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), zlib = require('node:zlib');
const {DatabaseSync} = require('node:sqlite');
const {Store,atomic} = require('../../src/m1/store');
const {normalize,digest} = require('../../src/m1/normalize');
const {scanSources} = require('../../src/m1/sources');
const {roots} = require('../../src/m1/policy');
const extended = require('../../src/m1/extended-sources');
const time = '2026-10-05T12:00:00Z';
function workspace(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(),'agent-ledger-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir; }
function total(store) { return store.snapshot().daily.reduce((s,r)=>s+r.totalTokens,0); }
async function empty() { return scanSources({},'salt',{reads:0}); }
function call(agent,salt,id='same-call',output=20) { return normalize(agent,{input:60,output,reasoning:2,cache:{read:40,write:0}},{id,session:'s',model:'gpt-4.1',time,entry:'cli'},salt,'exclusive'); }

test('R9: whole cross-Agent recovery clears obsolete flags, retains first owner and survives source changes/restart',async t=>{
  for(const first of ['opencode','mimo'])for(const mode of ['cross-agent','same-agent'])for(const reverse of [false,true]) {
    const dir=workspace(t),selected=roots(path.join(dir,'home'));let store=new Store(path.join(dir,'app'),selected);
    const folder=path.join(selected.opencode[0],'storage/message'),mimoFile=path.join(selected.mimo[0],'mimocode.db');
    const obj=(input,output)=>({role:'assistant',id:'recovery',modelID:'gpt-4.1',time:{created:Date.parse(time)},tokens:{input,output,reasoning:0,cache:{read:0,write:0}}});
    const putOpen=(name,row)=>{fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,name+'.json'),JSON.stringify(row));};
    const putMimo=row=>{fs.mkdirSync(path.dirname(mimoFile),{recursive:true});const db=new DatabaseSync(mimoFile);db.exec('CREATE TABLE IF NOT EXISTS message(id TEXT,session_id TEXT,data TEXT)');db.exec('DELETE FROM message');db.prepare('INSERT INTO message VALUES(?,?,?)').run('recovery','s',JSON.stringify(row));db.close();};
    store.setPrice({provider:'openai',model:'gpt-4.1',inputUncached:1,output:2,cacheRead:0,cacheWrite:0});
    if(first==='opencode')putOpen('a',obj(100,20));else putMimo(obj(100,20));
    store.ingest(await scanSources(selected,store.state.salt,{reads:0}),{status:'passed'});const owner=store.records()[0],identity=[owner.id,owner.agent,owner.entry,owner.sessionKey];
    putOpen('a',obj(reverse?90:100,reverse?30:20));putOpen('b',obj(reverse?100:90,reverse?20:30));
    if(mode==='cross-agent')putMimo(obj(100,40));else putOpen('c',obj(100,40));
    const scan=await scanSources(selected,store.state.salt,{reads:0}),record=scan.opencode.records[0];
    assert.equal(record.totalTokens,140);assert.equal(record.quality,'measured');assert(!Object.hasOwn(record,'usageConflict'));assert(!Object.hasOwn(record,'measurementQuality'));
    // Source diagnostics describe conflict observations during this scan, while
    // the final whole record and its price can already have recovered.
    assert(scan.opencode.errors.includes('SOURCE_USAGE_CONFLICT'));
    store.ingest(scan,{status:'passed'});
    for(const selection of [selected,{mimo:selected.mimo},{opencode:selected.opencode},{}]) {
      store=new Store(store.dir,selected);const saved=store.records()[0],row=store.snapshot().daily[0];
      assert.deepEqual([saved.id,saved.agent,saved.entry,saved.sessionKey],identity);assert.equal(total(store),140);assert.equal(saved.quality,'measured');assert(!Object.hasOwn(saved,'usageConflict'));assert(!Object.hasOwn(saved,'measurementQuality'));
      assert.deepEqual(row.knownUsage,{inputUncached:100,output:40,cacheRead:0,cacheWrite:0,reasoning:0,outputPlain:40});assert(Math.abs(row.estimatedCostUsd-.00018)<1e-12);
      store.ingest(await scanSources(selection,store.state.salt,{reads:0}),{status:'passed'});
    }
    // A newly contradictory 140-token snapshot must still fail closed after
    // recovery; a later 160-token complete observation can recover again.
    fs.rmSync(folder,{recursive:true,force:true});putOpen('a',obj(100,40));putMimo(obj(90,50));
    store.ingest(await scanSources(selected,store.state.salt,{reads:0}),{status:'passed'});assert.equal(total(store),140);assert(store.records()[0].usageConflict);assert.equal(store.snapshot().daily[0].estimatedCostUsd,null);
    putMimo(obj(100,60));store.ingest(await scanSources(selected,store.state.salt,{reads:0}),{status:'passed'});store=new Store(store.dir,selected);assert.equal(total(store),160);assert(!store.records()[0].usageConflict);assert(Math.abs(store.snapshot().daily[0].estimatedCostUsd-.00022)<1e-12);
  }
});

test('R1/R3: persistent cross-Agent copies preserve first attribution, price, growth, absent sources and restart in either order',async t=>{
  for (const order of [['mimo','opencode'],['opencode','mimo']]) {
    const dir = workspace(t), selected = roots(path.join(dir,'home')); let store = new Store(path.join(dir,'app'),selected);
    const salt = store.state.salt, a = call(order[0],salt), b = call(order[1],salt);
    store.setPrice({provider:'openai',model:'gpt-4.1',inputUncached:1,output:2,cacheRead:1,cacheWrite:0});
    for (const record of [a,b,a]) { const scan = await empty(); scan[record.agent].records=[record]; store.ingest(scan,{status:'passed'}); store = new Store(store.dir,selected); assert.equal(total(store),122); assert.equal(store.snapshot().daily.length,1); assert.equal(store.snapshot().daily[0].agent,order[0]); assert(Math.abs(store.snapshot().daily[0].estimatedCostUsd-0.000144)<1e-12); }
    const growth = call(order[1],salt,'same-call',30), scan = await empty(); scan[growth.agent].records=[growth]; store.ingest(scan,{status:'passed'}); assert.equal(total(store),132);
    store.ingest(await empty(),{status:'passed'}); assert.equal(total(store),132); assert.equal(store.records().length,1); assert.equal(Object.keys(store.state.records).length,2);
    const reordered = normalize('mimo',{cache:{write:0,read:40},reasoning:2,output:20,input:60,unrelated:'private'},{id:'same-call',model:'gpt-4.1',time},salt,'exclusive');
    assert.equal(a.sharedKey,reordered.sharedKey); assert.notEqual(a.sharedKey,call('mimo',salt,'other-call').sharedKey);
  }
});
test('R1/R3: old HMAC IDs migrate despite different raw serialization, retain records and recoverable backup',async t=>{
  const dir = workspace(t), selected = roots(path.join(dir,'home')), store = new Store(path.join(dir,'app'),selected), salt = store.state.salt;
  const a = call('opencode',salt), b = call('mimo',salt);
  for (const [r,value] of [[a,'old-a'],[b,'old-b']]) { r.sharedKey=digest(salt,value); delete r.sharedRecordIds; store.state.records[r.id]=r; }
  atomic(path.join(store.dir,'statistics.json'),store.state);
  const reopened = new Store(store.dir,selected), scan = await empty(); scan.opencode.records=[call('opencode',salt)]; reopened.ingest(scan,{status:'passed'});
  assert.equal(total(reopened),122); assert.equal(Object.keys(reopened.state.records).length,2); assert(fs.readdirSync(path.join(store.dir,'backups')).length>0); assert.equal(total(new Store(store.dir,selected)),122);
});
test('R2: whole persistent snapshots never regress, improve partial quality, diagnose equal-total bucket conflict across restart',async t=>{
  for (const agent of ['claude','gemini','cursor']) {
    const dir=workspace(t), selected=roots(path.join(dir,'home')); let store=new Store(path.join(dir,'app'),selected);
    const make=(out,read=0)=>normalize(agent,{input_tokens:100,output_tokens:out,cache_read_input_tokens:read,cache_creation_input_tokens:0,reasoning:0},{id:'stream',model:'gpt-4.1',time,entry:agent==='cursor'?'sdk':'cli'},store.state.salt,'inclusive');
    for (const out of [20,10,30]) { const scan=await empty(); scan[agent].records=[make(out)]; store.ingest(scan,{status:'passed'}); if(out===10){assert.equal(total(store),120);assert(store.state.statuses[agent].errors.includes('SOURCE_USAGE_REGRESSION'));} store=new Store(store.dir,selected); }
    assert.equal(total(store),130); const conflict=await empty(); conflict[agent].records=[make(30,10)]; store.ingest(conflict,{status:'passed'}); assert.equal(store.records()[0].cacheRead,0); assert(store.state.statuses[agent].errors.includes('SOURCE_USAGE_CONFLICT'));
    const partial={...make(30),quality:'partial',reasoning:null}, bad=await empty(); bad[agent].records=[partial]; store.ingest(bad,{status:'passed'}); assert.equal(store.records()[0].quality,'usage-conflict'); assert(store.records()[0].usageConflict);
  }
  const dir=workspace(t), store=new Store(path.join(dir,'app'),roots(path.join(dir,'home'))), partial={...call('cursor',store.state.salt),entry:'sdk',quality:'partial',reasoning:null};
  const scan=await empty(); scan.cursor.records=[partial]; store.ingest(scan,{status:'passed'}); scan.cursor.records=[{...partial,quality:'measured',reasoning:2}]; store.ingest(scan,{status:'passed'}); assert.equal(store.records()[0].quality,'measured');
});
test('R4: equivalent full CSV exports preserve duplicate multiplicity and old ledger IDs',async t=>{
  const dir=workspace(t), selected=roots(path.join(dir,'home')); let store=new Store(path.join(dir,'app'),selected);
  const base='Date,Model,Input Tokens,Cache Read Tokens,Cache Write Tokens,Output Tokens', line=time+',gpt-4.1,60,40,10,20';
  const first=extended.cursorCsv(base+',Total Tokens\n'+line+',130\n'+line+',130\n',store.state.salt);
  // Model a pre-fix ledger with unknown raw CSV signatures.
  first.forEach((r,i)=>{r.id=digest(store.state.salt,'legacy-csv-'+i);delete r.csvIdentity;store.state.records[r.id]=r;}); atomic(path.join(store.dir,'statistics.json'),store.state);
  store=new Store(store.dir,selected);
  for (const value of [base+'\n'+line+'\n'+line+'\n',base+',Total Tokens\n'+line.replace(time,'2026-10-05T20:00:00+08:00')+',130\n'+line+',130\n']) {
    const scan=await empty(); scan.cursor.records=extended.cursorCsv(value,store.state.salt); store.ingest(scan,{status:'passed'}); store=new Store(store.dir,selected); assert.equal(total(store),260); assert.equal(store.records().length,2);
  }
});
test('G1: default Cursor SDK SQLite projects only runs usage; JSONL copy dedupes and CSV conflicts',async t=>{
  const dir=workspace(t), selected=roots(path.join(dir,'home')), sdk=path.join(selected.cursor[0],'project','sdk-agent-store','hash'); fs.mkdirSync(sdk,{recursive:true});
  const usage={inputTokens:60,outputTokens:20,cacheReadTokens:40,cacheWriteTokens:10,reasoningTokens:3,totalTokens:130}, db=new DatabaseSync(path.join(sdk,'index.db'));
  db.exec('CREATE TABLE runs(run_id TEXT, agent_id TEXT,model TEXT,created_at TEXT,started_at TEXT,usage_json TEXT,result TEXT)'); db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run('run','agent','gpt-4.1',time,time,JSON.stringify(usage),'PRIVATE-BODY'); db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?)').run('bad','agent','gpt-4.1',time,time,'{torn','PRIVATE-BODY'); db.close();
  fs.writeFileSync(path.join(sdk,'runs.ndjson'),JSON.stringify({runId:'run',agentId:'agent',model:{id:'gpt-4.1'},createdAt:time,usage})+'\n');
  const scan=await scanSources(selected,'salt',{reads:0}); assert.equal(scan.cursor.records.length,1); assert.equal(scan.cursor.records[0].totalTokens,130); assert.deepEqual(scan.cursor.errors,['SOURCE_ROW_INVALID']); assert(!JSON.stringify(scan).includes('PRIVATE-BODY'));
  fs.writeFileSync(path.join(sdk,'usage.csv'),''); const conflict=await scanSources(selected,'salt',{reads:0}); assert.deepEqual(conflict.cursor.errors,['CURSOR_SOURCE_MODE_CONFLICT']);
});
test('R5: truncated compressed tails retain complete prefixes and success time; corruption remains fail-closed',async t=>{
  const dir=workspace(t), selected=roots(path.join(dir,'home')), folder=path.join(selected.deepseek[0],'p','s'); fs.mkdirSync(folder,{recursive:true});
  const header={type:'session',version:4,id:'dsh',isSeeded:false}, usage={inputTokens:60,outputTokens:20,cacheReadTokens:40,cacheWriteTokens:0,totalTokens:120};
  const event={seq:0,type:'assistant/message',time:Date.parse(time),data:{turn:0,step:0,usage,message:{source:{model:'deepseek-chat',provider:'deepseek'}}}};
  const compress=text=>zlib.zstdCompressSync(Buffer.from(text),{params:{[zlib.constants.ZSTD_c_checksumFlag]:1}}), prefix=compress(JSON.stringify(header)+'\n'+JSON.stringify(event)+'\n'), tail=compress(JSON.stringify({...event,seq:1,data:{...event.data,step:1}})+'\n'), file=path.join(folder,'session.v4.jsonl.zstd');
  fs.writeFileSync(file,Buffer.concat([prefix,tail])); const store=new Store(path.join(dir,'app'),selected); store.ingest(await scanSources(selected,store.state.salt,{reads:0}),{status:'passed'}); assert.equal(total(store),240); const success=store.state.statuses.deepseek.lastSuccess;
  for (const size of [1,5,Math.floor(tail.length/2),tail.length-1]) { fs.writeFileSync(file,Buffer.concat([prefix,tail.subarray(0,size)])); const scan=await scanSources(selected,store.state.salt,{reads:0}); assert.equal(scan.deepseek.records.reduce((s,r)=>s+r.totalTokens,0),120); assert(scan.deepseek.partial); assert(scan.deepseek.errors.includes('DEEPSEEK_LOG_INCOMPLETE')); store.ingest(scan,{status:'passed'}); assert.equal(total(store),240); assert.equal(store.state.statuses.deepseek.lastSuccess,success); }
  const corrupt=Buffer.from(tail); corrupt[corrupt.length-1]^=1; fs.writeFileSync(file,Buffer.concat([prefix,corrupt])); const invalid=await scanSources(selected,store.state.salt,{reads:0}); assert.equal(invalid.deepseek.records.length,0); assert(invalid.deepseek.errors.includes('SOURCE_COMPRESSION_INVALID')); store.ingest(invalid,{status:'passed'}); assert.equal(total(store),240);
});
test('R6: first-scan equal-total bucket conflicts are visible and unpriced in both orders, including Gemini checkpoints',async t=>{
  for (const agent of ['claude','gemini','cursor']) for (const reverse of [false,true]) {
    const dir=workspace(t), selected=roots(path.join(dir,'home')); let store=new Store(path.join(dir,'app'),selected);
    const model=agent==='claude'?'claude-sonnet-4-20250514':'gpt-4.1';
    store.setPrice({provider:agent==='claude'?'anthropic':'openai',model,inputUncached:1,output:2,cacheRead:0,cacheWrite:0});
    function row(input,output) {
      if(agent==='claude')return {type:'assistant',timestamp:time,sessionId:'s',message:{id:'same',model,usage:{input_tokens:input,output_tokens:output,cache_read_input_tokens:0,cache_creation_input_tokens:0}}};
      if(agent==='gemini')return {sessionId:'s',messages:[{id:'same',type:'gemini',timestamp:time,model,tokens:{input,output,cached:0,thoughts:0,total:input+output}}]};
      return {runId:'same',agentId:'s',createdAt:time,model:{id:model},usage:{inputTokens:input,outputTokens:output,cacheReadTokens:0,cacheWriteTokens:0,reasoningTokens:0,totalTokens:input+output}};
    }
    const variants=reverse?[row(90,30),row(100,20)]:[row(100,20),row(90,30)];
    const files=agent==='claude'?[path.join(selected.claude[0],'a.jsonl'),path.join(selected.claude[1],'b.jsonl')]:agent==='gemini'?[path.join(selected.gemini[0],'p/chats/session-a.jsonl'),path.join(selected.gemini[0],'p/chats/session-b.jsonl')]:[path.join(selected.cursor[0],'p/sdk-agent-store/a/runs.ndjson'),path.join(selected.cursor[0],'p/sdk-agent-store/b/runs.ndjson')];
    files.forEach((file,index)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(variants[index])+'\n');});
    let scan=await scanSources(selected,store.state.salt,{reads:0}); assert.equal(scan[agent].records.length,1); assert(scan[agent].partial); assert(scan[agent].errors.includes('SOURCE_USAGE_CONFLICT'));
    store.ingest(scan,{status:'passed'}); assert.equal(total(store),120); assert.equal(store.snapshot().daily[0].estimatedCostUsd,null); assert.equal(store.snapshot().daily[0].inputUncached,null); assert.deepEqual(store.snapshot().daily[0].knownUsage,{}); assert.equal(store.state.statuses[agent].lastSuccess,null);
    fs.unlinkSync(files[1]); store=new Store(store.dir,selected); scan=await scanSources(selected,store.state.salt,{reads:0}); store.ingest(scan,{status:'passed'}); assert.equal(total(store),120); assert.equal(store.snapshot().daily[0].estimatedCostUsd,null); assert(store.state.statuses[agent].errors.includes('SOURCE_USAGE_CONFLICT'));
    if(agent==='gemini') {const within=extended.gemini([variants[0],{$set:{sessionId:'s',messages:variants[1].messages}}],store.state.salt,'s');assert(within.warnings.includes('SOURCE_USAGE_CONFLICT'));assert(within[0].usageConflict);}
    fs.writeFileSync(files[0],JSON.stringify(row(100,40))+'\n');store.ingest(await scanSources(selected,store.state.salt,{reads:0}),{status:'passed'});assert.equal(total(store),140);assert.equal(store.records()[0].quality,'measured');assert(!store.records()[0].usageConflict);assert(store.state.statuses[agent].lastSuccess);if(agent!=='gemini')assert(Math.abs(store.snapshot().daily[0].estimatedCostUsd-.00018)<1e-12);
  }
});
test('R7: compatible equal-total complete copies improve scan and persistent quality without changing first ownership',async t=>{
  for (const first of ['opencode','mimo']) {
    const dir=workspace(t), selected=roots(path.join(dir,'home')); let store=new Store(path.join(dir,'app'),selected);
    const obj={role:'assistant',id:'same-request',modelID:'gpt-4.1',time:{created:Date.parse(time)},tokens:{input:60,output:20,cache:{read:40,write:0}}};
    const openFile=path.join(selected.opencode[0],'storage/message/same.json'),mimoFile=path.join(selected.mimo[0],'mimocode.db');
    function put(agent,complete) {const data={...obj,tokens:complete?{...obj.tokens,reasoning:0}:obj.tokens};if(agent==='opencode'){fs.mkdirSync(path.dirname(openFile),{recursive:true});fs.writeFileSync(openFile,JSON.stringify(data));}else{fs.mkdirSync(path.dirname(mimoFile),{recursive:true});const db=new DatabaseSync(mimoFile);db.exec('CREATE TABLE IF NOT EXISTS message(id TEXT,session_id TEXT,data TEXT)');db.exec('DELETE FROM message');db.prepare('INSERT INTO message VALUES(?,?,?)').run(obj.id,'s',JSON.stringify(data));db.close();}}
    const second=first==='opencode'?'mimo':'opencode'; put(first,false);
    store.setPrice({provider:'openai',model:'gpt-4.1',inputUncached:1,output:2,cacheRead:1,cacheWrite:0});
    store.ingest(await scanSources(selected,store.state.salt,{reads:0}),{status:'passed'}); assert.equal(store.records()[0].quality,'partial'); assert.equal(store.snapshot().daily[0].estimatedCostUsd,null);
    put(second,true);
    for(const selection of [selected,{[first]:selected[first]},selected]) {store.ingest(await scanSources(selection,store.state.salt,{reads:0}),{status:'passed'});store=new Store(store.dir,selected);assert.equal(total(store),120);assert.equal(store.records()[0].agent,first);assert.equal(store.records()[0].quality,'measured');assert.equal(store.records()[0].reasoning,0);assert(Math.abs(store.snapshot().daily[0].estimatedCostUsd-.00014)<1e-12);}
  }
});
test('R8: old alias migration preserves first-save attribution, whole growing copy and billing in either order',async t=>{
  for(const first of ['mimo','opencode'])for(const suppressed of [false,true]) {
    const dir=workspace(t),selected=roots(path.join(dir,'home'));let store=new Store(path.join(dir,'app'),selected);
    const second=first==='mimo'?'opencode':'mimo',salt=store.state.salt;
    const make=(agent,out)=>normalize(agent,{input:60,output:out,reasoning:0,cache:{read:40,write:0}},{id:'legacy',session:'s',model:'gpt-4.1',time},salt,'exclusive');
    const a=make(first,20),b=make(second,30);for(const [r,out] of [[a,20],[b,30]]){r.sharedKey=digest(salt,JSON.stringify(['shared-opencode-schema','legacy',new Date(time).toISOString(),'gpt-4.1',{input:60,output:out,reasoning:0,cache:{read:40,write:0}}]));delete r.sharedRecordIds;store.state.records[r.id]=r;}
    if(suppressed)store.state.duplicateIds[a.id]=b.id;
    store.setPrice({provider:'openai',model:'gpt-4.1',inputUncached:1,output:2,cacheRead:1,cacheWrite:0});store.setBilling({autoSync:false,defaults:{mimo:{mode:'actual',multiplier:2},opencode:{mode:'actual',multiplier:1}},mappings:{}});atomic(path.join(store.dir,'statistics.json'),store.state);
    store=new Store(store.dir,selected);const scan=await empty();scan.opencode.records=[make('opencode',30)];store.ingest(scan,{status:'passed'});
    for(let i=0;i<2;i++){store=new Store(store.dir,selected);assert.equal(total(store),130);assert.equal(store.records()[0].id,a.id);assert.equal(store.records()[0].agent,first);assert.equal(store.records()[0].output,30);assert.equal(Object.keys(store.state.records).length,2);assert(Math.abs(store.snapshot().daily[0].estimatedCostUsd-(first==='mimo'?.00032:.00016))<1e-12);store.ingest(await empty(),{status:'passed'});}
    const backups=fs.readdirSync(path.join(store.dir,'backups'));assert(backups.length>0);const saved=JSON.parse(fs.readFileSync(path.join(store.dir,'backups',backups[0]),'utf8'));assert.equal(saved.records[a.id].agent,first);
  }
});
test('R6/R7: equal-total partial versus measured disagreements stay ambiguous in either source order and on migration',async t=>{
  for(const full of ['opencode','mimo']) {
    const dir=workspace(t),selected=roots(path.join(dir,'home')),store=new Store(path.join(dir,'app'),selected);
    const obj={role:'assistant',id:'same',modelID:'gpt-4.1',time:{created:Date.parse(time)}};
    const data=agent=>({...obj,tokens:agent===full?{input:50,output:30,reasoning:0,cache:{read:40,write:0}}:{input:60,output:20,cache:{read:40,write:0}}});
    const open=path.join(selected.opencode[0],'storage/message/same.json');fs.mkdirSync(path.dirname(open),{recursive:true});fs.writeFileSync(open,JSON.stringify(data('opencode')));
    fs.mkdirSync(selected.mimo[0],{recursive:true});const db=new DatabaseSync(path.join(selected.mimo[0],'mimocode.db'));db.exec('CREATE TABLE message(id TEXT,session_id TEXT,data TEXT)');db.prepare('INSERT INTO message VALUES(?,?,?)').run('same','s',JSON.stringify(data('mimo')));db.close();
    const scan=await scanSources(selected,store.state.salt,{reads:0});assert(scan.opencode.errors.includes('SOURCE_USAGE_CONFLICT'));assert(scan.mimo.errors.includes('SOURCE_USAGE_CONFLICT'));store.ingest(scan,{status:'passed'});assert.equal(total(store),120);assert.equal(store.records()[0].quality,'usage-conflict');assert.equal(store.state.statuses.opencode.lastSuccess,null);
  }
  const dir=workspace(t),selected=roots(path.join(dir,'home')),store=new Store(path.join(dir,'app'),selected);
  const make=(agent,input,output)=>normalize(agent,{input,output,reasoning:0,cache:{read:0,write:0}},{id:'old',model:'gpt-4.1',time},store.state.salt,'exclusive');
  const a=make('mimo',100,20),b=make('opencode',90,30);store.state.records[a.id]=a;store.state.records[b.id]=b;atomic(path.join(store.dir,'statistics.json'),store.state);
  const migrated=new Store(store.dir,selected);assert.equal(total(migrated),120);assert.equal(migrated.records()[0].agent,'mimo');assert.equal(migrated.records()[0].quality,'usage-conflict');assert(migrated.state.statuses.mimo.errors.includes('SOURCE_USAGE_CONFLICT'));assert.equal(migrated.snapshot().daily[0].inputUncached,null);assert.equal(migrated.snapshot().daily[0].estimatedCostUsd,null);
});
