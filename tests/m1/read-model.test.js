'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),{spawnSync}=require('node:child_process');
const {createPricing}=require('../../src/m1/valuation');
const {projectUsage}=require('../../src/m1/usage-projection');
const {localDay}=require('../../src/m1/usage-math');
const agents=require('../../src/m1/agent-catalog').agents;
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
test('pure valuation and projections accept frozen explicit inputs and preserve independent totals/null/conflict/zero',()=>{
 const context=freeze({overrides:{'vendor/model':{inputUncached:.000002,output:.000008,cacheRead:.0000005,cacheWrite:0}},modelCatalog:{},billing:{autoSync:false,defaults:{codex:{mode:'actual',multiplier:2}},mappings:{}}});
 const records=freeze([false,true].map((conflict,i)=>({id:'r'+i,agent:'codex',entry:'cli',provider:'vendor',model:'model',timestamp:'2026-10-18T17:30:00Z',quality:'measured',inputUncached:60,output:20,cacheRead:40,cacheWrite:0,reasoning:5,totalTokens:120,...(conflict?{usageConflict:true}:{})})));
 const pricing=createPricing(context),project=projectUsage({records,estimate:pricing.estimate,sequence:1,updatedAt:null,sourceCatalog:agents,priceCatalog:{},timezone:'Asia/Shanghai',now:Date.parse('2026-10-19T00:00:00Z')});
 assert.equal(project.daily.length,1);const row=project.daily[0];assert.equal(row.date,'2026-10-19');assert.equal(project.hourly[0].hour,1);assert.equal(row.totalTokens,240);assert.equal(row.pricedTokens,120);assert.equal(row.inputUncached,null);assert.equal(row.partialRecords,1);assert(Math.abs(row.estimatedCostUsd-.0006)<1e-15);
 assert.equal(pricing.estimate({...records[0],model:'unknown'}).lower,null);
 const free=createPricing({...context,billing:{...context.billing,defaults:{codex:{mode:'actual',multiplier:0}}}});assert.equal(free.estimate(records[0]).lower,0);assert.equal(free.estimate(records[1]).lower,null);
});
test('loading saved-query code does not load Store, source readers, collection, sessions or policy modules',()=>{
 const entry=path.resolve('src/m1/usage-query.js');
 const script=`require(${JSON.stringify(entry)}); process.stdout.write(JSON.stringify(Object.keys(require.cache).filter(file=>file.includes('src'+require('node:path').sep+'m1')).map(file=>require('node:path').basename(file))));`;
 const child=spawnSync(process.execPath,['-e',script],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(child.status,0,child.stderr);
 const loaded=JSON.parse(child.stdout);for(const name of ['store.js','policy.js','sources.js','service.js','worker.js','native.js','extended-sources.js','sessions.js','custom-sources.js'])assert(!loaded.includes(name),name);
 assert(loaded.includes('valuation.js'));assert(loaded.includes('usage-projection.js'));assert(loaded.includes('usage-read-model.js'));
});
test('local date formatter reuse keeps DST and timezone boundaries identical to fresh Intl formatting',()=>{
 const zones=['UTC','Asia/Shanghai','America/New_York','Europe/London','Asia/Tokyo','Australia/Sydney','Europe/Paris','America/Los_Angeles','Pacific/Auckland'];
 for(let pass=0;pass<2;pass++)for(const zone of zones)for(const stamp of ['2026-03-08T06:59:59Z','2026-03-08T07:00:01Z','2026-11-01T05:59:59Z','2026-11-01T06:00:01Z'])assert.equal(localDay(zone,stamp),new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp)));
 assert.throws(()=>localDay('Invalid/Timezone','2026-01-01'),RangeError);
});
