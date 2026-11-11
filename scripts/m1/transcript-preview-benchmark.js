'use strict';
// Synthetic parser-only A/B: a fresh child for every read; no forced GC or cache.
// node scripts/m1/transcript-preview-benchmark.js <baseline transcript.js> <report.json>
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const baseline=process.argv[2],output=process.argv[3];
if(!baseline||!output)throw Error('USAGE: baseline-transcript.js output.json');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'usage-preview-ab-')),id='synthetic-reader',file=path.join(root,id+'.jsonl');
const targets=[['before',path.resolve(baseline)],['after',path.resolve(__dirname,'../../src/m1/transcript.js')]];
const text='```js\n'+Array.from({length:40},(_,i)=>'const item'+i+' = '+i+';').join('\n')+'\n```\n\n'+'合成内存测量段落。'.repeat(3000);
const script=`const crypto=require('node:crypto');(async()=>{const t=require(process.argv[1]),begin=performance.now();const value=await t.transcript('codex',process.argv[3],[process.argv[2]]);console.log(JSON.stringify({ms:performance.now()-begin,heapMiB:process.memoryUsage().heapUsed/1048576,maxRssMiB:process.resourceUsage().maxRSS/1024,items:value.items.length,hash:crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}));})().catch(()=>{process.exitCode=1});`;
const rows=[];
try{
 const fd=fs.openSync(file,'w');
 try{
  fs.writeSync(fd,JSON.stringify({type:'session_meta',payload:{id,cwd:'C:/synthetic/reader'}})+'\n');
  for(let i=0;i<300;i++)for(const [role,words]of [['user','question '+i],['assistant',text+' '+i]])fs.writeSync(fd,JSON.stringify({timestamp:'2026-11-04T00:00:00Z',type:'response_item',payload:{type:'message',role,content:[{text:words}]}})+'\n');
 }finally{fs.closeSync(fd);}
 for(let round=0;round<5;round++)for(const [target,module]of(round%2?targets.toReversed():targets)){
  const result=spawnSync(process.execPath,['-e',script,module,root,id],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,'parser child must complete');
  const row=JSON.parse(result.stdout);assert.equal(row.items,600,'empty or partial fixtures cannot pass');
  assert(row.ms>0&&Number.isFinite(row.maxRssMiB));rows.push({round,target,...row});
 }
 assert.equal(new Set(rows.map(row=>row.hash)).size,1,'complete returned previews must match');
 const median=values=>values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)];
 const medians=Object.fromEntries(targets.map(([target])=>[target,Object.fromEntries(['ms','heapMiB','maxRssMiB'].map(key=>[key,median(rows.filter(row=>row.target===target).map(row=>row[key]))]))]));
 fs.writeFileSync(path.resolve(output),JSON.stringify({syntheticOnly:true,valid:true,measurement:'fresh Node child per initial read; OS caches uncontrolled; maxRSS is process RSS, not application private working set; no forced GC',fileBytes:fs.statSync(file).size,medians,rows},null,2));
 console.log(JSON.stringify({valid:true,medians}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
