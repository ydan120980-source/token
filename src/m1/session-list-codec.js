'use strict';
// Request-local saved-facts transport: no source reads, index or packed cache.
// The facade in the page still returns the existing SessionListV1 interface.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./session-list'));else root.sessionListCodec=factory(root.sessionListContract);})(typeof window==='object'?window:globalThis,function(contract){
 const {COUNTS,NULLABLE}=contract,fields=[...COUNTS,...NULLABLE];
 const invalid=()=>{throw Error('INVALID_SESSION_LIST');};
 function pack(source,catalog){
  if(source?.schemaVersion!=='SessionListV1'||!Array.isArray(source.sessions)||source.sessions.length>50000)invalid();
  return packIterable(source,catalog);
 }
 // The owner may generate one saved session at a time. Apply the same whitelist
 // before encoding each row; never materialize a second complete session graph.
 function packIterable(source,catalog){
  if(source?.schemaVersion!=='SessionListV1'||typeof source.sessions?.[Symbol.iterator]!=='function')invalid();
  const header=contract.selectSessions({...source,sessions:[]},catalog),one=contract.createSelector(catalog),strings=[],arrays=[],usage=[],rows=[],days=[],seen=new Map(),arrayIds=new Map(),usageIds=new Map(),agents=new Set(Object.keys(header.unattributed));
  const string=value=>{if(value===null)return -1;if(!seen.has(value)){seen.set(value,strings.length);strings.push(value);}return seen.get(value);};
  const array=value=>{const signature=JSON.stringify(value);if(!arrayIds.has(signature)){arrayIds.set(signature,arrays.length);arrays.push(value.map(string));}return arrayIds.get(signature);};
  for(const raw of source.sessions){if(rows.length>=50000)invalid();const s=one(raw);agents.add(s.agent);const begin=days.length;
   for(const d of s.days){const signature=JSON.stringify(d.knownUsage);if(!usageIds.has(signature)){usageIds.set(signature,usage.length);usage.push(d.knownUsage);}days.push([string(d.date),...fields.map(key=>d[key]),usageIds.get(signature)]);}
   rows.push([string(s.key),string(s.agent),array(s.entries),array(s.models),string(s.start),string(s.end),string(s.id),string(s.cwd),string(s.title),string(s.project),s.resumable,begin,days.length-begin]);
  }
  delete header.sessions;const frame={schemaVersion:'SessionListWireV1',header,agents:[...agents],strings,arrays,usage,rows,days};
  return {schemaVersion:'SessionListBytesV1',sessionBytes:new TextEncoder().encode(JSON.stringify(frame)).buffer};
 }
 function* decode(wire){
  if(wire?.schemaVersion!=='SessionListBytesV1'||Object.prototype.toString.call(wire.sessionBytes)!=='[object ArrayBuffer]')invalid();
  let frame;try{frame=JSON.parse(new TextDecoder().decode(wire.sessionBytes));}catch{invalid();}
  if(frame?.schemaVersion!=='SessionListWireV1'||!Array.isArray(frame.rows)||frame.rows.length>50000||!Array.isArray(frame.days)||!Array.isArray(frame.strings)||!Array.isArray(frame.arrays)||!Array.isArray(frame.usage)||!Array.isArray(frame.agents))invalid();
  if(frame.agents.some(agent=>typeof agent!=='string'||!agent.length||agent.length>200||/[\0-\x1f\x7f]/.test(agent)))invalid();
  const catalog=Object.fromEntries(frame.agents.map(agent=>[agent,{}])),header=contract.selectSessions({...frame.header,sessions:[]},catalog),selectedArrays=new Map(),usageMaps=new Map();
  const string=index=>{if(index===-1)return null;if(!Number.isSafeInteger(index)||index<0||index>=frame.strings.length||typeof frame.strings[index]!=='string')invalid();return frame.strings[index];};
  const one=contract.createSelector(catalog,(index,select)=>{
    // An entry and a model can refer to the same dictionary index. Apply the
    // field's own whitelist once, then share only the immutable selected value.
    if(!selectedArrays.has(select))selectedArrays.set(select,new Map());
    const cache=selectedArrays.get(select);
    if(!cache.has(index)){
      if(!Number.isSafeInteger(index)||index<0||!Array.isArray(frame.arrays[index]))invalid();
      cache.set(index,Object.freeze(select(frame.arrays[index].map(string))));
    }
    return cache.get(index);
  });
  let cursor=0;
  header.sessions=[];
  for(let index=0;index<frame.rows.length;index++){const row=frame.rows[index];
   if(!Array.isArray(row)||row.length!==13||row[11]!==cursor||!Number.isSafeInteger(row[12])||row[12]<0||row[12]>4000||cursor+row[12]>frame.days.length)invalid();
   const s=one({key:string(row[0]),agent:string(row[1]),entries:row[2],models:row[3],start:string(row[4]),end:string(row[5]),id:string(row[6]),cwd:string(row[7]),title:string(row[8]),project:string(row[9]),resumable:row[10],days:[]});
   for(let at=cursor;at<cursor+row[12];at++){
    const d=frame.days[at];if(!Array.isArray(d)||d.length!==fields.length+2||!Number.isSafeInteger(d.at(-1))||d.at(-1)<0||d.at(-1)>=frame.usage.length)invalid();
    const id=d.at(-1);
    if(!usageMaps.has(id))usageMaps.set(id,Object.freeze(contract.knownUsage(frame.usage[id])));
    const selected=contract.selectPackedDay(string(d[0]),d,usageMaps.get(id));
    s.days.push(selected);frame.days[at]=null;
   }
   cursor+=row[12];frame.rows[index]=null;header.sessions.push(s);yield;
  }
  if(cursor!==frame.days.length)invalid();return header;
 }
 // Both paths run exactly the same validation and decoding. Only the async
 // facade yields between bounded batches; no partial list escapes to consumers.
 function unpack(wire){const rows=decode(wire);let step;do{step=rows.next();}while(!step.done);return step.value;}
 async function unpackAsync(wire){
  const rows=decode(wire);let began=performance.now(),count=0;const channel=new MessageChannel();let resume;channel.port1.onmessage=()=>resume();try{
  for(;;){const step=rows.next();if(step.done)return step.value;
   if(++count%64===0&&performance.now()-began>=4){
    await new Promise(resolve=>{resume=resolve;channel.port2.postMessage(null);});
    began=performance.now();
   }
  }}finally{channel.port1.close();channel.port2.close();}
 }
 return Object.freeze({pack,packIterable,unpack,unpackAsync});
});
