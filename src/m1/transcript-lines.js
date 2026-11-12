'use strict';
// Request-local JSONL iteration for the reader. No index, parsed cache or writes.
// Same regular-file/link/size and changed-file rejection as policy.readBytes;
// a chunk and the current line replace the whole decoded file + object array.
const fs=require('node:fs');
const CHUNK=256*1024;
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs;
function closeChecked(fd,before,file){
 try{if(!same(before,fs.fstatSync(fd))||!same(before,fs.lstatSync(file)))throw Error('SOURCE_BUSY');}
 finally{fs.closeSync(fd);}
}
function* readObjects(file,maxBytes,onLine){
 const before=fs.lstatSync(file);
 if(!before.isFile()||before.isSymbolicLink()||before.size>maxBytes)throw Error('SOURCE_SIZE_OR_LINK');
 const fd=fs.openSync(file,fs.constants.O_RDONLY);
 let offset=0,parts=[],length=0;
 const parse=(buffer,start,end)=>{let text;if(parts.length){parts.push(buffer.subarray(start,end));text=Buffer.concat(parts,length+end-start).toString('utf8');parts=[];length=0;}else text=buffer.toString('utf8',start,end);if(onLine)onLine(text);try{return {value:JSON.parse(text)};}catch{return null;}};
 try{
  if(!same(before,fs.fstatSync(fd)))throw Error('SOURCE_BUSY');
  while(offset<before.size){
   const buffer=Buffer.allocUnsafe(Math.min(CHUNK,before.size-offset)),count=fs.readSync(fd,buffer,0,buffer.length,offset);
   if(!count)throw Error('SOURCE_BUSY');offset+=count;
   let start=0,end;
   while((end=buffer.indexOf(10,start))>=0&&end<count){const row=parse(buffer,start,end);if(row)yield row.value;start=end+1;}
   if(start<count){const tail=buffer.subarray(start,count);parts.push(tail);length+=tail.length;}
  }
  if(length){const row=parse(Buffer.alloc(0),0,0);if(row)yield row.value;}
 }finally{
  closeChecked(fd,before,file);
 }
}
module.exports={readObjects};
