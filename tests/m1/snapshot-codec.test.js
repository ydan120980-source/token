'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pack,unpack}=require('../../src/m1/snapshot-codec');
test('columnar transport preserves missing counters, null cost parts, zero and sparse maps and shares immutable equal maps',()=>{
  const base={date:'2026-10-22',agent:'codex',entry:'cli',provider:'openai',model:'synthetic',totalTokens:100,inputUncached:null,output:0,cacheRead:null,cacheWrite:0,reasoning:null,knownUsage:{output:0},knownRecords:{output:1},pricingReasons:{'usage-incomplete':1},unpricedTokens:{'usage-incomplete':100},incompleteTokens:{'missing-inputUncached':100},costParts:null};
  const snapshot={schemaVersion:'LocalUsagePreviewV1',sequence:1,daily:Array.from({length:100},()=>({...base})),hourly:[{...base,hour:0}],sources:[]};
  const original=JSON.stringify(snapshot),encoded=JSON.stringify(pack(snapshot)),restored=unpack(JSON.parse(encoded));
  const transport=JSON.parse(encoded),array=transport.daily.rows;assert.deepEqual(unpack(transport,{consume:true}),snapshot);assert.equal(transport.daily.rows,array);assert.equal(array[0].date,snapshot.daily[0].date);
  assert.deepEqual(restored,snapshot);assert(encoded.length<original.length*.5);
  assert.equal(restored.daily[0].knownUsage,restored.daily[1].knownUsage);assert(Object.isFrozen(restored.daily[0].knownUsage));
  assert.equal(restored.daily[0].inputUncached,null);assert.equal(restored.daily[0].output,0);assert.equal(restored.daily[0].costParts,null);
  assert.deepEqual(unpack(JSON.parse(JSON.stringify(pack({...snapshot,daily:[],hourly:[]})))),{...snapshot,daily:[],hourly:[]});
  assert.throws(()=>unpack({codec:'unknown'}),/INVALID_USAGE_TRANSPORT/);
});

test('bounded map dictionaries preserve null, empty, sparse zero and fall back for diverse values; legacy vectors still decode',()=>{
  const daily=Array.from({length:300},(_,i)=>({knownUsage:i%3===0?null:i%3===1?{}:{output:0},costParts:{output:i},pricingReasons:{exact:1}}));
  const snapshot={daily,hourly:[]},packed=pack(snapshot),layouts=Object.fromEntries(packed.daily.columns.map((k,i)=>[k,packed.daily.layouts[i]]));
  assert.equal(layouts.knownUsage.values.length,2);
  assert.equal(layouts.costParts.values,undefined,'more than 128 distinct maps keep vector encoding');
  assert.deepEqual(unpack(JSON.parse(JSON.stringify(packed))),snapshot);
  const legacy=structuredClone(packed);
  legacy.daily.layouts.forEach((layout,i)=>{if(layout?.kind!=='map'||!layout.values)return;for(const row of legacy.daily.rows)if(row[i]!==null)row[i]=layout.values[row[i]];delete layout.values;});
  assert.deepEqual(unpack(legacy),snapshot);
  const repeated={daily:Array.from({length:10000},()=>({knownUsage:{output:0},pricingReasons:{exact:1},costParts:null})),hourly:[]};
  const compact=JSON.stringify(pack(repeated)),legacyRepeat=pack(repeated);
  legacyRepeat.daily.layouts.forEach((layout,i)=>{if(!layout?.values||layout.kind!=='map')return;for(const row of legacyRepeat.daily.rows)if(row[i]!==null)row[i]=layout.values[row[i]];delete layout.values;});
  assert(compact.length<JSON.stringify(legacyRepeat).length*.8,'repeated maps reduce the already columnar transport');
});
