'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../../src/m1/store'),{normalize}=require('../../src/m1/normalize'),{fixtures}=require('./fixtures');
const {unpack}=require('../../src/m1/session-list-codec'),{selectSessions}=require('../../src/m1/session-list');
test('bounded session reads preserve full facts, null pricing, metadata and recent ordering',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'session-range-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const {roots}=fixtures(path.join(root,'home')),store=new Store(path.join(root,'usage'),roots),today=store.snapshot().today;
 for(const age of [0,3,45])for(let s=0;s<12;s++){const time=Date.parse(today+'T12:00:00Z')-age*86400000+s*1000,record=normalize('codex',{input_tokens:10,output_tokens:2,cached_input_tokens:0,cache_creation_input_tokens:0,reasoning_output_tokens:0,total_tokens:12},{id:`${s}-${age}`,session:'s-'+s,time,model:'synthetic-unpriced',entry:'cli'},store.state.salt);store.state.records[record.id]=record;store.state.sessions[record.sessionKey]={agent:'codex',id:'s-'+s,cwd:'E:\\synthetic\\project'};}
 store.state.sequence++;const fresh=unpack(store.sessionListPacked()),all=store.sessionList(),narrow=store.sessionList({range:'today'});assert.deepEqual(fresh,selectSessions(all),'cold packed reads match the public list without a retained full list');assert.equal(narrow.sessions.length,12);assert.equal(narrow.sessions.flatMap(s=>s.days).length,12);assert.equal(all.sessions.flatMap(s=>s.days).length,36);
 assert.deepEqual(store._sessionReferences(),all.sessions.map(({key,agent,end})=>({key,agent,end})),'scan candidates preserve membership, first ownership, insertion order and newest time');
 for(const session of narrow.sessions){const original=all.sessions.find(s=>s.key===session.key);assert.deepEqual(session,{...original,days:original.days.filter(d=>d.date===today)});assert.equal(session.days[0].estimatedCostUsd,null);}
 assert.equal(store.sessionList({range:'today'}),narrow);assert.equal(store.sessionList({range:'7'}).sessions.flatMap(s=>s.days).length,24);assert.equal(store.sessionList({range:'30'}).sessions.flatMap(s=>s.days).length,24);
 const packed=store.sessionListPacked({range:'today'});assert.deepEqual(unpack(packed),selectSessions(narrow));
 structuredClone(packed,{transfer:[packed.sessionBytes]});assert.equal(packed.sessionBytes.byteLength,0);
 const next=store.sessionListPacked({range:'today'});assert.deepEqual(unpack(next),selectSessions(narrow),'a transferred response cannot detach the retained bytes');
 new Uint8Array(next.sessionBytes).fill(0);assert.deepEqual(unpack(store.sessionListPacked({range:'today'})),selectSessions(narrow),'a changed response cannot corrupt the retained bytes');
 assert.deepEqual(unpack(store.sessionListPacked()),selectSessions(all),'changing the selection replaces the encoded facts');
 const recent=store.sessionList({recent:true});assert.deepEqual(recent.sessions,all.sessions.toSorted((a,b)=>b.end.localeCompare(a.end)).slice(0,5));assert.deepEqual(store.sessionList(),all,'all remains available on explicit request');
 for(const value of [null,'today',{range:'365'},{range:'today',path:'x'},{recent:1}]){assert.throws(()=>store.sessionList(value),/SESSION_SELECTION_INVALID/);assert.throws(()=>store.sessionListPacked(value),/SESSION_SELECTION_INVALID/);}
 store.setPrice({provider:'unknown',model:'synthetic-unpriced',inputUncached:0,output:0,cacheRead:0,cacheWrite:0});assert.equal(store.sessionList({range:'today'}).sessions[0].days[0].estimatedCostUsd,0,'same-sequence repricing replaces the cache');
 assert.equal(unpack(store.sessionListPacked({range:'today'})).sessions[0].days[0].estimatedCostUsd,0,'repricing also invalidates encoded facts');
});

test('search, file history and tool-use scans retain candidates and continuation without pricing unused daily facts',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'session-references-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const {roots}=fixtures(path.join(root,'home')),store=new Store(path.join(root,'usage'),roots),tasks=require('../../src/m1/transcript-tasks'),run=tasks.run,requests=[];
 for(const [agent,id,second]of [['codex','one',0],['claude','two',1],['codex','one',2],['zcode','unsupported',3]]){
  const record=normalize(agent,{input_tokens:10,output_tokens:2,total_tokens:12},{id:agent+second,session:id,time:'2026-11-04T00:00:0'+second+'Z',model:'synthetic-unpriced',entry:'cli'},store.state.salt);
  store.state.records[record.id]=record;store.state.sessions[record.sessionKey]={agent,id,cwd:'E:/synthetic/project'};
 }
 store.state.sequence++;const expected=store.sessionList().sessions.filter(s=>['codex','claude','zcode'].includes(s.agent)).sort((a,b)=>b.end.localeCompare(a.end));
 store.estimate=()=>{throw Error('UNUSED_DAILY_PRICING');};
 tasks.run=async(operation,args)=>{requests.push({operation,args});return {scanned:1,results:operation==='toolUse'?[{key:args[0][0].key,mcp:{owned:2},skill:{}}]:[]};};t.after(()=>{tasks.run=run;});
 const search=await store.searchTranscripts({query:'synthetic',range:'today',offset:1});
 assert.deepEqual(requests[0].args[0],expected.slice(1).map(s=>({key:s.key,agent:s.agent,id:s.id})));assert.equal(search.searched,2);assert.equal(search.next,2);assert.equal(search.total,3);
 const history=await store.transcriptFileHistory({key:expected[0].key,path:'src/app.js'});
 assert.deepEqual(requests[1].args[0],expected.slice(1).map(s=>({key:s.key,agent:s.agent,id:s.id,cwd:s.cwd})));assert.equal(history.total,2);assert.equal(history.next,1);
 const tools=await store.agentUse({});assert.deepEqual(tools.rows,[{agent:expected[0].agent,kind:'mcp',name:'owned',calls:2,sessions:1,last:expected[0].end}]);assert.equal(tools.next,1);assert.equal(tools.total,3);
 await assert.rejects(store.searchTranscripts({query:'x',range:'year'}),/TRANSCRIPT_SEARCH_INVALID/);
});
