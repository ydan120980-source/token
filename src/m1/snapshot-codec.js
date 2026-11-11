'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.snapshotCodec=factory();})(typeof window==='undefined'?this:window,function(){
  const dimensions=new Set(['date','agent','entry','provider','model']);
  const maps=new Set(['pricingReasons','unpricedTokens','incompleteTokens','costParts','knownUsage','knownRecords']);
  function blankRow(){return {date:null,agent:null,entry:null,provider:null,model:null,totalTokens:null,inputUncached:null,output:null,cacheRead:null,cacheWrite:null,reasoning:null,records:null,pricedTokens:null,estimatedCostUsd:null,partialRecords:0,estimatedCostUpperUsd:null,boundedTokens:0,pricingReasons:null,unpricedTokens:null,incompleteTokens:null,costParts:null,cacheSavingsUsd:null,knownUsage:null,knownRecords:null};}
  function packRows(rows){
    const columns=rows.length?Object.keys(rows[0]):[],layouts=columns.map(key=>{
      if(dimensions.has(key)){const values=[...new Set(rows.map(r=>r[key]))];return {kind:'dictionary',values};}
      if(maps.has(key)){
        const names=new Set();for(const row of rows)for(const name of Object.keys(row[key]||{}))names.add(name);
        const keys=[...names],values=[],seen=new Map();
        // Most reasons/known-field maps repeat across thousands of rows. A bounded
        // dictionary avoids serializing/decoding the same vector per row. Diverse
        // amounts keep the original vector representation; null has its own cell.
        for(const row of rows){if(row[key]===null)continue;const vector=keys.map(k=>row[key]?.[k]??null),signature=JSON.stringify(vector);if(!seen.has(signature)){seen.set(signature,values.length);values.push(vector);if(values.length>128)return {kind:'map',keys};}}
        return {kind:'map',keys,values};
      }
      return null;
    });
    const indices=layouts.map(layout=>layout?.kind==='dictionary'?new Map(layout.values.map((v,i)=>[v,i])):layout?.kind==='map'&&layout.values?new Map(layout.values.map((v,i)=>[JSON.stringify(v),i])):null);
    return {columns,layouts,rows:rows.map(row=>columns.map((key,i)=>{const layout=layouts[i],v=row[key];if(layout?.kind==='dictionary')return indices[i].get(v);if(layout?.kind!=='map'||v===null)return v;const vector=layout.keys.map(k=>v?.[k]??null);return indices[i]?indices[i].get(JSON.stringify(vector)):vector;}))};
  }
  function unpackRows(packed,pools,consume){
    const caches=packed.layouts.map((layout,i)=>{if(layout?.kind!=='map')return null;const key=packed.columns[i]+JSON.stringify(layout.keys);if(!pools.has(key))pools.set(key,new Map());return pools.get(key);});
    const dictionaries=packed.layouts.map(layout=>layout?.kind==='map'&&layout.values?layout.values.map(v=>Object.freeze(Object.fromEntries(layout.keys.flatMap((k,j)=>v[j]===null?[]:[[k,v[j]]])))):null);
    const shape=new Set(Object.keys(blankRow())),canonical=packed.columns.length===(packed.columns.includes('hour')?25:24)&&packed.columns.every(k=>k==='hour'||shape.has(k));
    const result=consume?packed.rows:new Array(packed.rows.length);
    for(let r=0;r<packed.rows.length;r++){
      const values=packed.rows[r],row=canonical?blankRow():{};
      for(let i=0;i<packed.columns.length;i++){
        const key=packed.columns[i],layout=packed.layouts[i],v=values[i];let value=v;
        if(layout?.kind==='dictionary')value=layout.values[v];
        else if(layout?.kind==='map'&&v!==null){if(dictionaries[i])value=dictionaries[i][v];else{const signature=JSON.stringify(v),cache=caches[i];value=cache.get(signature);if(!value){value=Object.freeze(Object.fromEntries(layout.keys.flatMap((k,j)=>v[j]===null?[]:[[k,v[j]]])));if(cache.size<128)cache.set(signature,value);}}}
        if(canonical)row[key]=value;else Object.defineProperty(row,key,{value,writable:true,configurable:true,enumerable:true});
      }
      result[r]=row;
    }
    return result;
  }
  function pack(snapshot){const {daily,hourly,...header}=snapshot;return {codec:'LocalUsageColumnsV1',header,daily:packRows(daily),hourly:packRows(hourly||[])};}
  function unpack(value,{consume=false,previous=null,revision=null}={}){
    if(!['LocalUsageColumnsV1','LocalUsageDeltaV1'].includes(value?.codec))throw Error('INVALID_USAGE_TRANSPORT');
    const delta=value.codec==='LocalUsageDeltaV1';
    if(delta&&(!previous||revision!==value.baseRevision))throw Error('USAGE_DELTA_BASE_MISMATCH');
    const pools=new Map(),daily=unpackRows(value.daily,pools,consume),hourly=unpackRows(value.hourly,pools,consume);
    const apply=(order,before,changed,limit)=>{
      if(!Array.isArray(order)||order.length>limit)throw Error('INVALID_USAGE_TRANSPORT');
      return order.map(index=>{if(!Number.isSafeInteger(index)||index>=before.length||index<0&&-index>changed.length)throw Error('INVALID_USAGE_TRANSPORT');return index>=0?before[index]:changed[-index-1];});
    };
    return {...value.header,daily:delta?apply(value.dailyOrder,previous.daily,daily,100000):daily,hourly:delta?apply(value.hourlyOrder,previous.hourly,hourly,50000):hourly};
  }
  return Object.freeze({pack,unpack});
});
