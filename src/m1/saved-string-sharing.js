'use strict';
// Only freshly parsed, app-owned saved facts. Equal primitive strings may share
// storage; objects, numbers, nulls, property order and persisted bytes stay intact.
// Both lookup maps die before the Store constructor returns: no new live index.
function shareSavedStrings(state) {
  const pool=new Map(),sessionKeys=new Map();
  const share=value=>{
    if(typeof value!=='string')return value;
    if(pool.has(value))return pool.get(value);
    if(pool.size<4096&&value.length<=256)pool.set(value,value);
    return value;
  };
  for(const key of Object.keys(state.sessions||{}))sessionKeys.set(key,key);
  for(const id of Object.keys(state.records||{})){
    const record=state.records[id];if(!record||typeof record!=='object'||Array.isArray(record))continue;
    if(record.id===id)record.id=id;
    if(sessionKeys.has(record.sessionKey))record.sessionKey=sessionKeys.get(record.sessionKey);
    for(const field of ['agent','entry','model','provider','timestamp','quality'])if(typeof record[field]==='string')record[field]=share(record[field]);
    if(record.semantics&&typeof record.semantics==='object')for(const field of ['input','sourceOutput','reasoning'])if(typeof record.semantics[field]==='string')record.semantics[field]=share(record.semantics[field]);
  }
  for(const session of Object.values(state.sessions||{}))if(session&&typeof session==='object')for(const field of ['agent','cwd'])if(typeof session[field]==='string')session[field]=share(session[field]);
}
module.exports={shareSavedStrings};
