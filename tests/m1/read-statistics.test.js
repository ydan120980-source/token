'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readStatistics}=require('../../src/m1/read-statistics');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'saved-json-stream-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return path.join(root,'statistics.json');}
test('entry-wise saved JSON equals native parsing at UTF-8, escape, key and value boundaries',t=>{
 const file=fixture(t),rows=[
  {version:1,deviceId:'synthetic',records:{abc:{model:'中文🙂',text:'comma, brace } bracket ] slash \\ and " quote',null:null,number:1.25e-9,list:[1,{x:true}]}},sessions:{abc:{cwd:'E:\\合成 路径'}}},
  {},{records:{}},[1,2],null,42,true,'text',
 ];
 const texts=rows.map(row=>JSON.stringify(row));texts.push(' { "records": {"__proto__":{"polluted":true},"constructor":1,"1":null,"1":{"last":true}},"records":{"final":{"x":[]}},"x":-0 }\n','{"records":{"__proto__":{"polluted":true},"constructor":{"x":1}}}','{"r\\u0065cords":{"a":{"x":"\\uD83D\\uDE00"}},"trailing":false}',JSON.stringify(rows[0],null,2));
 for(const text of texts){fs.writeFileSync(file,text);for(const chunkSize of [1,2,3,7,31,64,127])assert.deepEqual(readStatistics(file,{chunkSize,threshold:0}),JSON.parse(text));}
 assert.equal({}.polluted,undefined);
});
test('large ledger default reader preserves all records and fields, while corruption keeps quarantine bytes',t=>{
 const scratch=fixture(t),file=path.join(path.dirname(scratch),'app','statistics.json'),{Store}=require('../../src/m1/store'),{fixtures}=require('./fixtures');fs.mkdirSync(path.dirname(file));
 const value={version:1,deviceId:'synthetic-stream',salt:'synthetic-salt',sequence:7,records:{},statuses:{},duplicateIds:{},sessions:{},futureField:{retained:true}};
 for(let i=0;i<9000;i++)value.records['record-'+i]={id:'record-'+i,agent:'codex',model:'合成模型🙂',timestamp:'2026-10-30T01:00:00Z',unknownSavedField:'x'.repeat(500),futureNested:{nullable:null}};
 const bytes=Buffer.from(JSON.stringify(value));assert(bytes.length>4*1024*1024);fs.writeFileSync(file,bytes);assert.deepEqual(readStatistics(file),JSON.parse(bytes.toString('utf8')));
 const home=path.join(path.dirname(scratch),'home'),{roots}=fixtures(home),store=new Store(path.dirname(file),roots);assert.equal(Object.keys(store.state.records).length,9000);assert.deepEqual(store.state.futureField,value.futureField);assert.equal(store.state.sequence,7);assert(fs.readFileSync(file).equals(bytes),'loading an existing ledger never rewrites its format');
 const broken=Buffer.concat([bytes,Buffer.from(' trailing corruption')]);fs.writeFileSync(file,broken);const recovered=new Store(path.dirname(file),roots);assert.equal(Object.keys(recovered.state.records).length,0);const ledger=recovered.recovered.find(r=>r.file==='statistics.json');assert(ledger?.quarantined);assert(fs.readFileSync(path.join(path.dirname(file),ledger.quarantined)).equals(broken));
});
test('invalid saved JSON is rejected without a partial result, and the file handle is released',t=>{
 const file=fixture(t);for(const text of ['', ' ', '{', '{"records":{', '{"records":{"a":1,}}', '{"records":{"a":01}}','{"records":{"a":trueX}}','{"records":{"a":"bad\\x"}}','{"records":{"a":[1,]}}','{"records":{"a":{"x":1]}}','{"records":{},}', '{records:{}}', '{"records":{}}false']){
  fs.writeFileSync(file,text);assert.throws(()=>JSON.parse(text));for(const chunkSize of [1,7,64])assert.throws(()=>readStatistics(file,{chunkSize,threshold:0}));const renamed=file+'.moved';fs.renameSync(file,renamed);fs.renameSync(renamed,file);
 }
});
