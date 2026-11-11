'use strict';
const { readSavedModel } = require('./read-snapshot');
const { selectSnapshot } = require('./local-snapshot');
const { isIdentifier } = require('./pricing');
const { localDay } = require('./usage-math');
const { total } = require('./cost-insights');
const { cacheHitRate, recordedFields } = require('./insights-math');
const { createHash } = require('node:crypto');
const DIMENSIONS = ['date', 'agent', 'model', 'provider', 'entry'];
const BUCKETS = ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
const UNPRICED = ['model-unpriced','price-unverified','usage-incomplete','rate-missing'];
// MCP duplicates the JSON as text + structuredContent, keeping the wire below 1 MiB.
const MAX_RESPONSE = 480 * 1024;
const REVISION = /^uq1_[a-f0-9]{64}$/;
const inputSchema = {type:'object',additionalProperties:false,properties:{
  from:{type:'string',format:'date'},to:{type:'string',format:'date'},
  groupBy:{type:'array',uniqueItems:true,maxItems:5,items:{type:'string',enum:DIMENSIONS}},
  ...Object.fromEntries(DIMENSIONS.filter(d=>d!=='date').map(d=>[d,{type:'array',maxItems:50,items:{type:'string',minLength:1,maxLength:180}}])),
  offset:{type:'integer',minimum:0,maximum:100000},limit:{type:'integer',minimum:1,maximum:500},
  revision:{type:'string',pattern:'^uq1_[a-f0-9]{64}$'}
}};
const metricNames=['totalTokens',...BUCKETS,'records','partialRecords','pricedTokens','unpricedTokens','pricingCoverage','estimatedCostUsd','estimatedCostUpperUsd','cacheHitRate','sessions','knownSessions','unattributedRecords','pricedRecords'];
const metricProperties=Object.fromEntries(metricNames.map(name=>[name,{type:['number','null'],minimum:0}]));
const metricSchema={type:'object',additionalProperties:false,required:metricNames,properties:metricProperties};
const outputSchema={type:'object',additionalProperties:false,required:['schemaVersion','revision','sequence','collectedAt','timezone','costKind','total','rows','totalRows','nextOffset'],properties:{
  revision:{type:'string',pattern:'^uq1_[a-f0-9]{64}$'},
  schemaVersion:{const:'UsageQueryV1'},sequence:{type:'integer',minimum:0},collectedAt:{type:['string','null']},timezone:{type:'string'},costKind:{const:'API-equivalent-estimate'},total:metricSchema,
  rows:{type:'array',maxItems:500,items:{type:'object',additionalProperties:false,required:['dimensions',...metricNames],properties:{dimensions:{type:'object',additionalProperties:false,properties:Object.fromEntries(DIMENSIONS.map(d=>[d,{type:'string',maxLength:180}]))},...metricProperties}}},
  totalRows:{type:'integer',minimum:0},nextOffset:{type:['integer','null'],minimum:0}
}};
function date(value) { return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value; }
function request(input={}) {
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!Object.hasOwn(inputSchema.properties,k)))throw new Error('QUERY_ARGUMENT_INVALID');
  for(const d of DIMENSIONS.filter(d=>d!=='date'))if(input[d]!==undefined&&(!Array.isArray(input[d])||input[d].length>50||input[d].some(v=>!isIdentifier(v))))throw new Error('QUERY_ARGUMENT_INVALID');
  if(['from','to'].some(k=>input[k]!==undefined&&!date(input[k]))||input.from&&input.to&&(input.from>input.to||Date.parse(input.to)-Date.parse(input.from)>36600*86400000))throw new Error('QUERY_DATE_INVALID');
  const groupBy=input.groupBy??[],offset=input.offset??0,limit=input.limit??100;
  if(!Array.isArray(groupBy)||groupBy.length>5||new Set(groupBy).size!==groupBy.length||groupBy.some(d=>!DIMENSIONS.includes(d))||!Number.isSafeInteger(offset)||offset<0||offset>100000||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new Error('QUERY_ARGUMENT_INVALID');
  if(input.revision!==undefined&&(typeof input.revision!=='string'||!REVISION.test(input.revision)))throw new Error('QUERY_ARGUMENT_INVALID');
  if(offset>0&&!input.revision)throw new Error('QUERY_REVISION_REQUIRED');
  return {...input,...Object.fromEntries(DIMENSIONS.filter(d=>Array.isArray(input[d])).map(d=>[d,[...new Set(input[d])].sort()])),groupBy:DIMENSIONS.filter(d=>groupBy.includes(d)),offset,limit};
}
function summarize(rows,sessions,missing,recorded) {
  const sum=total(rows),records=rows.reduce((n,r)=>n+r.records,0);
  const buckets=Object.fromEntries(BUCKETS.map(f=>[f,rows.length&&rows.every(r=>Number.isFinite(r[f]))?rows.reduce((n,r)=>n+r[f],0):null]));
  return {totalTokens:sum.tokens,...buckets,records,partialRecords:rows.reduce((n,r)=>n+r.partialRecords,0),
    pricedTokens:sum.pricedTokens,unpricedTokens:sum.tokens-sum.pricedTokens,pricingCoverage:sum.coverage,
    estimatedCostUsd:sum.lower,estimatedCostUpperUsd:sum.upper,cacheHitRate:cacheHitRate(rows,recorded),
    sessions:missing||!records?null:sessions.size,knownSessions:sessions.size,unattributedRecords:missing,
    pricedRecords:records-rows.reduce((n,r)=>n+Object.entries(r.pricingReasons).filter(([reason])=>UNPRICED.includes(reason)).reduce((s,[,v])=>s+v,0),0)};
}
function query(file,input={}) {
  const selection=request(input),store=readSavedModel(file),snapshot=selectSnapshot(store.snapshot(),store.catalog());
  const safe=row=>Object.fromEntries(DIMENSIONS.map(d=>[d,d==='date'?row.date:d==='entry'&&!['desktop','cli','sdk','export','harness'].includes(row.entry)?'unknown':isIdentifier(row[d])&&!row[d].includes(':')?row[d]:'unknown']));
  const matches=dims=>(!selection.from||dims.date>=selection.from)&&(!selection.to||dims.date<=selection.to)&&DIMENSIONS.filter(d=>d!=='date').every(d=>!selection[d]||selection[d].includes(dims[d]));
  const groups=new Map(),all={rows:[],sessions:new Set(),missing:0},recorded=recordedFields(snapshot.daily);
  for(const row of snapshot.daily){const dims=safe(row);if(!matches(dims))continue;const dimensions=Object.fromEntries(selection.groupBy.map(d=>[d,dims[d]])),key=JSON.stringify(dimensions);if(!groups.has(key))groups.set(key,{dimensions,rows:[],sessions:new Set(),missing:0});groups.get(key).rows.push(row);all.rows.push(row);}
  for(const record of store.records()){
    const dims=safe({...record,date:localDay(snapshot.timezone,record.timestamp)});if(!matches(dims))continue;
    const key=JSON.stringify(Object.fromEntries(selection.groupBy.map(d=>[d,dims[d]]))),group=groups.get(key);if(!group)continue;
    if(typeof record.sessionKey==='string'&&record.sessionKey.length){const identity=record.agent+'/'+record.sessionKey;group.sessions.add(identity);all.sessions.add(identity);}else{group.missing++;all.missing++;}
  }
  const sorted=[...groups].sort(([a],[b])=>a<b?-1:a>b?1:0),selected=sorted.slice(selection.offset,selection.offset+selection.limit);
  const totalMetrics=summarize(all.rows,all.sessions,all.missing,recorded);
  const rows=sorted.map(([,g])=>({dimensions:g.dimensions,...summarize(g.rows,g.sessions,g.missing,recorded)}));
  // Hash only calculation-basis fingerprints and public aggregates, never saved
  // file bytes, paths, raw or hashed session/record identities, or session metadata.
  const filters=Object.fromEntries(['from','to',...DIMENSIONS.filter(d=>d!=='date'),'groupBy'].filter(k=>selection[k]!==undefined).map(k=>[k,selection[k]]));
  const revision='uq1_'+createHash('sha256').update(JSON.stringify({contract:'saved-query/2',sequence:snapshot.sequence,timezone:snapshot.timezone,prices:[snapshot.priceCatalog.sha256,snapshot.priceCatalog.overrideSha256,snapshot.priceCatalog.billingSha256],filters,total:totalMetrics,rows})).digest('hex');
  if(selection.revision&&selection.revision!==revision)throw new Error('QUERY_SNAPSHOT_CHANGED');
  const result={schemaVersion:'UsageQueryV1',revision,sequence:snapshot.sequence,collectedAt:Number.isFinite(Date.parse(snapshot.collectedAt))?new Date(snapshot.collectedAt).toISOString():null,timezone:snapshot.timezone,costKind:'API-equivalent-estimate',
    total:totalMetrics,rows:rows.slice(selection.offset,selection.offset+selection.limit),
    totalRows:sorted.length,nextOffset:selection.offset+selected.length<sorted.length?selection.offset+selected.length:null};
  if(Buffer.byteLength(JSON.stringify(result))>MAX_RESPONSE)throw new Error('QUERY_OUTPUT_LIMIT');
  return result;
}
module.exports={query,request,inputSchema,outputSchema};
