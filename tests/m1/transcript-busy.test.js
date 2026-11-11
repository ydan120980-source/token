'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const reader=require('../../src/m1/transcript'),protocol=require('../../src/m1/transcript-continuation');
const row=(role,text)=>JSON.stringify({type:'response_item',payload:{type:'message',role,content:[{text}]}})+'\n';
async function changingSource(change,check){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-busy-')),file=path.join(root,'own-session.jsonl'),read=fs.readSync;
 assert.equal(path.dirname(root),path.resolve(os.tmpdir()));
 fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{id:'own-session'}})+'\n'+row('user','synthetic question')+row('assistant','synthetic answer'));
 const inode=fs.statSync(file).ino;let reads=0;
 try{
  fs.readSync=function(fd,...args){const count=read.call(fs,fd,...args);if(fs.fstatSync(fd).ino===inode){reads++;change({file,reads});}return count;};
  await check({root,file,reads:()=>reads});
 }finally{fs.readSync=read;fs.rmSync(root,{recursive:true,force:true});}
}
test('a preview interrupted by one source append rereads once from a fresh stamp, with complete rows and no cache',async()=>{
 await changingSource(({file,reads})=>{if(reads===1)fs.appendFileSync(file,row('user','appended question')+row('assistant','appended answer'));},async({root,file,reads})=>{
  const result=protocol.merge(null,await reader.transcript('codex','own-session',[root],protocol.request(null)));
  assert.equal(reads(),3,'one interrupted prepass, then a fresh prepass and full read');assert.deepEqual(result.items.map(item=>item.text),['synthetic question','synthetic answer','appended question','appended answer']);
  assert.equal(result.stamp,await reader.stampNow('codex','own-session',[root]));assert.equal(result.turns,2);assert.equal(fs.readdirSync(root).length,1);assert(fs.readFileSync(file,'utf8').includes('appended answer'));
 });
});
test('continuous writes stop after the one retry, rather than indefinitely hiding a changed source',async()=>{
 await changingSource(({file})=>fs.appendFileSync(file,'\n'),async({root,reads})=>{
  await assert.rejects(reader.transcript('codex','own-session',[root]),/TRANSCRIPT_CHANGED/);assert.equal(reads(),2);
 });
});
test('full-text parts never retry into a newer source version, and unrelated I/O errors do not get retried',async()=>{
 await changingSource(({file,reads})=>{if(reads===1)fs.appendFileSync(file,'\n');},async({root,reads})=>{
  const stamp=await reader.stampNow('codex','own-session',[root]);await assert.rejects(reader.part('codex','own-session',[root],{stamp,index:1,field:'text'}),/TRANSCRIPT_CHANGED/);assert.equal(reads(),1);
 });
 await changingSource(()=>{throw Error('synthetic I/O failure');},async({root,reads})=>{
  await assert.rejects(reader.transcript('codex','own-session',[root]),/TRANSCRIPT_UNREADABLE/);assert.equal(reads(),1);
 });
});
