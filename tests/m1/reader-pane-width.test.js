'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../ui/src/pages/sessions/pane-layout.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,layout={};vm.runInNewContext(code,{exports:layout});
test('width bands retain every native reader fit decision at and around each boundary',()=>{
 const policy={min:440,floor:320,nav:248,side:320,gap:12,max:3},edges=layout.paneWidthThresholds(policy);
 const fit=width=>Array.from({length:policy.max},(_,index)=>{const count=index+1;return [...[0,policy.nav,policy.side,policy.nav+policy.side].map(taken=>(width-taken-policy.gap*count)/count>=policy.floor),width/(count+1)>=policy.min];}).flat();
 const samples=[...Array.from({length:8001},(_,index)=>index/2),...edges.flatMap(edge=>[edge-0.000001,edge,edge+0.000001])].sort((a,b)=>a-b),byBand=new Map();
 for(const width of samples){const band=layout.paneWidthBand(width,edges),decisions=fit(width);if(byBand.has(band))assert.deepEqual(decisions,byBand.get(band),'fit decisions must not change without a React update');else byBand.set(band,decisions);}
 let representative=1480,updates=0;for(let width=1479.5;width>=1200;width-=0.5)if(layout.paneWidthBand(width,edges)!==layout.paneWidthBand(representative,edges)){representative=width;updates++;}
 assert(updates<10,'a continuous resize must not redraw the full reader at every half pixel');
});
