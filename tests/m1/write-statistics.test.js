'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {writeStatistics}=require('../../src/m1/write-statistics');
const {atomic}=require('../../src/m1/store');
test('streamed ledger output and digest equal native JSON bytes, including unknown keys and sparse values',()=>{
 const records=JSON.parse('{"__proto__":{"retained":true},"2":{"zero":-0},"1":null}');
 for(let i=0;i<10000;i++)records['r'+i]={model:'中文🙂',text:'\\"\n{}',nullable:null,missing:undefined,nested:[0,null,{x:true}],unknownSavedField:i};
 const value={version:1,sequence:5,records,unknown:{retained:true},missing:undefined,statuses:{codex:{lastSuccess:null}}},chunks=[];
 writeStatistics(value,text=>chunks.push(text));const native=JSON.stringify(value);assert.equal(chunks.join(''),native);assert(chunks.length>10);assert(chunks.every(c=>c.length<70000));
 const hash=crypto.createHash('sha256');writeStatistics(value,text=>hash.update(text));assert.equal(hash.digest('hex'),crypto.createHash('sha256').update(native).digest('hex'));
 for(const v of [null,[],true,42,'text',{}, {records:[]}, {records:null}]){const output=[];writeStatistics(v,text=>output.push(text));assert.equal(output.join(''),JSON.stringify(v));}
});
test('failed streamed persistence keeps previous bytes, removes only its temporary file and closes its handle',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'streamed-atomic-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'statistics.json');atomic(file,{before:true});
 const original=fs.writeFileSync;let chunks=0;t.mock.method(fs,'writeFileSync',(target,...args)=>{if(typeof target==='number'&&++chunks===2)throw Object.assign(Error('synthetic full disk'),{code:'ENOSPC'});return original(target,...args);});
 const value={records:Object.fromEntries(Array.from({length:3000},(_,i)=>[String(i),{text:'x'.repeat(100)}]))};assert.throws(()=>atomic(file,value,true),{code:'ENOSPC'});assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),{before:true});assert.deepEqual(fs.readdirSync(root),['statistics.json']);
 t.mock.restoreAll();atomic(file,value,true);assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(value));
});
