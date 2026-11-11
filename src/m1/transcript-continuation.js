'use strict';
// Request-local prefix verification, not a transcript cache. The producer still
// rereads the source and validates the complete preview; only transport omits a
// prefix already displayed by the caller. No proof or body is persisted here.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('node:crypto'));else root.transcriptContinuation=factory(null);})(typeof window==='object'?window:globalThis,function(crypto){
 const STEP=64,MAX_ITEMS=500000;
 const invalid=()=>{throw Error('TRANSCRIPT_PART_INVALID');};
 const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
 function validate(value){
  if(!object(value)||Object.keys(value).some(key=>!['count','digests'].includes(key))||!Number.isSafeInteger(value.count)||value.count<0||value.count>MAX_ITEMS||!Array.isArray(value.digests)||value.digests.length!==Math.ceil(value.count/STEP)||value.digests.some(digest=>typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)))invalid();
  return value;
 }
 const full=value=>object(value)&&value.schemaVersion==='TranscriptV2'&&typeof value.agent==='string'&&typeof value.stamp==='string'&&value.stamp.length<=200&&Array.isArray(value.items)&&value.items.length<=MAX_ITEMS;
 function request(previous){
  if(full(previous)&&previous.continuation?.count===previous.items.length){
   try{const proof=validate(previous.continuation);return {count:proof.count,digests:proof.digests.slice()};}catch{/* A legacy or damaged proof safely requests the complete result. */}
  }
  return {count:0,digests:[]};
 }
 function make(value,id,provided){
  const before=validate(provided);if(!crypto||!full(value)||typeof id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(id))invalid();
  const hash=crypto.createHash('sha256').update('TranscriptPrefixV1\0'+value.agent+'\0'+id+'\0'),digests=[];
  let offset=0,scratch=null;
  try{for(let index=0;index<value.items.length;index++){
   const item=value.items[index];if(!object(item))invalid();
   if(typeof item.text==='string'&&item.text.length>4096){
    // Hash long strings directly as exact UTF-16 code units. A request-local
    // scratch buffer avoids JSON copies of every reply and preserves lone
    // surrogates, which UTF-8 would silently turn into replacement characters.
    hash.update('text:'+JSON.stringify({...item,text:undefined})+'\0'+item.text.length+':');
    scratch??=Buffer.allocUnsafe(64*1024);
    for(let at=0;at<item.text.length;at+=scratch.length/2){const part=item.text.slice(at,at+scratch.length/2),bytes=scratch.write(part,0,scratch.length,'utf16le');if(bytes!==part.length*2)invalid();hash.update(scratch.subarray(0,bytes));}
   }else hash.update('json:'+JSON.stringify(item));
   hash.update('\n');
   const count=index+1,publish=count%STEP===0||count===value.items.length,compare=count<=before.count&&(count%STEP===0||count===before.count);
   if(!publish&&!compare)continue;
   const digest=hash.copy().digest('hex');if(publish)digests.push(digest);
   if(compare&&digest===before.digests[Math.ceil(count/STEP)-1])offset=count;
  }}finally{scratch?.fill(0);}
  return {schemaVersion:'TranscriptDeltaV1',offset,transcript:{...value,items:value.items.slice(offset)},continuation:{count:value.items.length,digests}};
 }
 function merge(previous,wire){
  if(full(wire))return wire;
  if(!object(wire)||wire.schemaVersion!=='TranscriptDeltaV1'||!full(wire.transcript)||!Number.isSafeInteger(wire.offset)||wire.offset<0)invalid();
  const proof=validate(wire.continuation);
  if(wire.offset+wire.transcript.items.length!==proof.count)invalid();
  if(wire.offset&&(!full(previous)||previous.agent!==wire.transcript.agent||previous.items.length<wire.offset||previous.continuation?.count!==previous.items.length))invalid();
  return {...wire.transcript,items:wire.offset?previous.items.slice(0,wire.offset).concat(wire.transcript.items):wire.transcript.items,continuation:{count:proof.count,digests:proof.digests.slice()}};
 }
 return Object.freeze({STEP,MAX_ITEMS,validate,request,make,merge});
});
