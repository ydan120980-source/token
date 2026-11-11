'use strict';
// Synthetic, request-local decode benchmark; no app/source reads or GC controls.
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),Module=require('node:module');
const ref=process.argv[2]??null;if(ref!==null&&!/^[a-f0-9]{7,40}$/.test(ref))throw Error('INVALID_BENCHMARK_REF');
const files=['src/m1/session-list.js','src/m1/session-list-codec.js'],sources=new Map(files.map(file=>[file,ref?require('node:child_process').execFileSync('git',['show',ref+':'+file],{encoding:'utf8',windowsHide:true}):fs.readFileSync(file,'utf8')]));
const modules=new Map();
function load(file){
 if(modules.has(file))return modules.get(file).exports;
 const filename=path.resolve(file),module=new Module(filename);modules.set(file,module);module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));
 const original=module.require.bind(module);module.require=name=>name==='./session-list'?load(files[0]):original(name);module._compile(sources.get(file),filename);return module.exports;
}
const codec=load(files[1]);
const sessions=20000,days=4,iterations=7;
const day=index=>({date:'2026-11-0'+(index+1),totalTokens:120,records:1,partialRecords:0,pricedTokens:120,boundedTokens:0,inputUncached:100,output:20,cacheRead:0,cacheWrite:null,reasoning:null,estimatedCostUsd:0.001,estimatedCostUpperUsd:0.001,knownUsage:{inputUncached:100,output:20}});
const wire=codec.packIterable({schemaVersion:'SessionListV1',sequence:1,timezone:'Asia/Shanghai',today:'2026-11-05',unattributed:{},sessions:(function*(){for(let index=0;index<sessions;index++)yield {key:index.toString(16).padStart(64,'0'),agent:'codex',entries:['cli'],models:['synthetic'],start:'2026-11-01T00:00:00Z',end:'2026-11-04T00:00:00Z',id:'synthetic-'+index,cwd:null,title:null,project:null,resumable:true,days:Array.from({length:days},(_,at)=>day(at))};})()});
const elapsed=[];let totals;
for(let iteration=0;iteration<iterations;iteration++){
 const start=performance.now(),value=codec.unpack(wire);elapsed.push(performance.now()-start);
 totals={sessions:value.sessions.length,days:value.sessions.reduce((n,s)=>n+s.days.length,0),tokens:value.sessions.reduce((n,s)=>n+s.days.reduce((sum,d)=>sum+d.totalTokens,0),0)};
 if(totals.sessions!==sessions||totals.days!==sessions*days||totals.tokens!==sessions*days*120)throw Error('DECODE_BENCHMARK_INVALID');
}
const sorted=elapsed.toSorted((a,b)=>a-b);
console.log(JSON.stringify({syntheticOnly:true,noForcedGC:true,ref,sessions,days,iterations,bytes:wire.sessionBytes.byteLength,totals,elapsed,medianMs:sorted[Math.floor(sorted.length/2)],maxRssMiB:process.resourceUsage().maxRSS/1024,node:process.version,source:Object.fromEntries(files.map(file=>[file,crypto.createHash('sha256').update(sources.get(file)).digest('hex')]))},null,2));
