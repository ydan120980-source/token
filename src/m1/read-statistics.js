'use strict';
// Same app-owned JSON format, without retaining a second full ledger text while
// parsing large files. Only the top-level records dictionary is read by entry;
// every key/value still goes through JSON.parse, including unknown saved fields.
const fs=require('node:fs');
const {StringDecoder}=require('node:string_decoder');
function readStatistics(file,{chunkSize=65536,threshold=4*1024*1024}={}){
 if(!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>1048576)throw Error('INVALID_JSON_CHUNK_SIZE');
 const fd=fs.openSync(file,'r');
 try{
  if(fs.fstatSync(fd).size<threshold)return JSON.parse(fs.readFileSync(fd,'utf8'));
  const buffer=Buffer.allocUnsafe(chunkSize),decoder=new StringDecoder('utf8');let chunk='',offset=0,ended=false;
  // These immutable string values recur across many saved observations. Reuse
  // exact strings only, with bounded per-field pools; unique timestamps cannot
  // turn this into a second history index. Unknown saved fields remain intact.
  const pools=['agent','entry','provider','model','timestamp','sessionKey'].map(key=>[key,new Map()]);
  const intern=(key,value)=>{
   if(!value||typeof value!=='object'||Array.isArray(value))return value;
   if(Object.hasOwn(value,'id')&&value.id===key)value.id=key;
   for(const [field,pool] of pools)if(Object.hasOwn(value,field)&&typeof value[field]==='string'){
    const text=value[field];if(pool.has(text))value[field]=pool.get(text);else if(pool.size<2048)pool.set(text,text);
   }
   return value;
  };
  const refill=()=>{while(offset===chunk.length&&!ended){const n=fs.readSync(fd,buffer,0,buffer.length,null);chunk=n?decoder.write(buffer.subarray(0,n)):decoder.end();offset=0;if(!n)ended=true;}return offset<chunk.length;};
  const peek=()=>refill()?chunk[offset]:undefined;
  const whitespace=()=>{while([' ','\n','\r','\t'].includes(peek()))offset++;};
  const requireChar=expected=>{whitespace();if(peek()!==expected)throw SyntaxError('INVALID_SAVED_JSON');offset++;};
  function token(stringOnly=false){
   whitespace();if(stringOnly&&peek()!=='"')throw SyntaxError('INVALID_SAVED_JSON');
   const parts=[];let quoted=false,escaped=false,depth=0,start=offset;
   for(;;){
    if(offset===chunk.length){parts.push(chunk.slice(start));if(!refill())break;start=offset;}
    const ch=chunk[offset];
    if(!quoted&&!stringOnly&&depth===0&&(ch===','||ch==='}'))break;
    offset++;
    if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"'){quoted=false;if(stringOnly)break;}}
    else if(ch==='"')quoted=true;
    else if(ch==='{'||ch==='[')depth++;
    else if(ch==='}'||ch===']')depth--;
   }
   parts.push(chunk.slice(start,offset));return JSON.parse(parts.join(''));
  }
  const define=(object,key,value)=>Object.defineProperty(object,key,{value,writable:true,configurable:true,enumerable:true});
  function object(root=false,records=false){
   requireChar('{');const result={};whitespace();if(peek()==='}'){offset++;return result;}
   for(;;){const key=token(true);requireChar(':');whitespace();const value=root&&key==='records'&&peek()==='{'?object(false,true):token();define(result,key,records?intern(key,value):value);whitespace();const next=peek();if(next==='}'){offset++;return result;}requireChar(',');}
  }
  whitespace();const value=peek()==='{'?object(true):token();whitespace();if(peek()!==undefined)throw SyntaxError('INVALID_SAVED_JSON');return value;
 }finally{fs.closeSync(fd);}
}
module.exports={readStatistics};
