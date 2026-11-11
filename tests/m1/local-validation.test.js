'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {agentFixtures}=require('./agent-fixtures');
const {independent,compare,jsonRows}=require('../../scripts/m1/source-oracle');
const {validate}=require('../../scripts/m1/validate-local');
const {filesUnder}=require('../../src/m1/policy');
const {remove}=require('./temp');
function hashes(dir){const out={};for(const item of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,item.name);if(item.isDirectory())Object.assign(out,hashes(f));else out[f]=crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}return out;}
test('real-validation entry is first exercised against synthetic homes and only writes isolated aggregates',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'validation-oracle-'));t.after(()=>remove(dir));
  const home=path.join(dir,'home'),fixture=agentFixtures(home),before=hashes(home),directory=path.join(dir,'report');
  const read=fs.readFileSync;fs.readFileSync=(file,...args)=>{if(typeof file==='string')assert(!/auth\.json$/i.test(file));return read(file,...args);};
  let report;try{report=await validate({selected:fixture.roots,directory,native:false});}finally{fs.readFileSync=read;}
  assert.deepEqual(hashes(home),before);assert.equal(report.writesProductState,false);
  for(const agent of ['codex','claude','opencode','workbuddy','mimo','gemini','cursor','zcode','deepseek','antigravity'])assert.equal(report.sources[agent].sampleVerified,true,agent);
  assert.equal(report.sources.deepseek.samples[0].expectedTokens,135);
  assert.equal(report.sources.antigravity.samples[0].modelPairingVerified,true);
  assert.equal(report.sourceIdentityVerified,false);assert.equal(report.modelPairingVerified,false);
  const text=fs.readFileSync(path.join(directory,'report.json'),'utf8');
  for(const secret of [home,fixture.sentinel,'synthetic-session','claude-msg','sdk-agent','gpt-4.1'])assert(!text.includes(secret));
  assert.equal(fs.existsSync(path.join(home,'validation.json')),false);
  await assert.rejects(validate({selected:fixture.roots,directory:fixture.roots.claude[0],native:false}),/OUTPUT_OVERLAP/);
});

test('OpenCode sampling projects bounded usage rows from a large image without extracting content or changing source bytes',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sqlite-sample-'));t.after(()=>remove(dir));const file=path.join(dir,'opencode.db');
  const SQL=await require('../../src/m1/sqlite-memory').sql(),db=new SQL.Database();db.run('CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT)');
  const insert=db.prepare('INSERT INTO message VALUES(?,?,?)');for(let i=0;i<240;i++)insert.run([String(i).padStart(4,'0'),'private-session',JSON.stringify({id:String(i).padStart(4,'0'),role:'assistant',time:{created:1760000000000},modelID:'fixture-model',content:'PRIVATE_BODY',tokens:{input:10,output:2,reasoning:1,cache:{read:3,write:0}}})]);insert.free();fs.writeFileSync(file,Buffer.from(db.export()));db.close();fs.truncateSync(file,65*1024*1024);
  const before=hashes(dir),value=await independent('opencode',file,{reads:0});assert.equal(value.comparable,true);assert.equal(value.records.length,200);assert.equal(value.sampling.limitReached,true);assert(!JSON.stringify(value.projection).includes('PRIVATE_BODY'));
  const report=await validate({selected:{opencode:[file]},directory:path.join(dir,'evidence'),native:false});assert.equal(report.sources.opencode.sampleVerified,true);assert.equal(report.sources.opencode.samples[0].actualRecords,200);assert.equal(report.sources.opencode.samples[0].expectedTokens,3200);assert.equal(hashes(dir)[file],before[file]);
});
test('independent oracle detects bucket errors with equal totals and refuses ambiguous or invalid observations',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bucket-oracle-'));t.after(()=>remove(dir));const fixture=agentFixtures(path.join(dir,'home'));
  const file=filesUnder('claude',fixture.roots.claude[0],{reads:0})[0],expected=await independent('claude',file,{reads:0});
  const exact={inputUncached:100,output:20,cacheRead:40,cacheWrite:10,reasoning:null,totalTokens:170};
  assert.equal(compare(expected,[exact]).matches,true);
  assert.equal(compare(expected,[{...exact,inputUncached:90,cacheRead:50}]).matches,false);
  const row={type:'assistant',message:{id:'same',usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:40,cache_creation_input_tokens:10}}};
  assert.equal(jsonRows('claude',[row,{...row,message:{...row.message,usage:{...row.message.usage,input_tokens:90,output_tokens:30}}}]).comparable,false);
  assert.equal(jsonRows('claude',[{...row,message:{...row.message,usage:{...row.message.usage,input_tokens:-1}}}]).comparable,false);
  assert.equal(jsonRows('codex',[{type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{total_tokens:-1}}}}]).comparable,false);
  const harness=fixture.deepseekRows;
  assert.equal(jsonRows('deepseek',harness).records.reduce((sum,r)=>sum+r.totalTokens,0),135);
  assert.equal(jsonRows('deepseek',harness.filter(r=>r.seq!==2)).comparable,false);
  assert.equal(jsonRows('deepseek',[{...harness[0],isSeeded:false},...harness.slice(1)]).comparable,false);
});
