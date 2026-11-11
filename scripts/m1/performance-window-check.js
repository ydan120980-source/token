'use strict';
/* global document */
// Comparable visible-window memory/navigation evidence. Fresh synthetic home only.
// No forced GC, memory-pressure notifications, GPU overrides or artificial caps.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const {_electron:electron}=require('playwright');
const {seed}=require('./performance-benchmark');
const {showView,settle,keepVisible,isolatePointer,cleanup}=require('./ui-settle');
async function run(){
 const rows=Number(process.env.PERF_ROWS||64000),models=Number(process.env.PERF_MODELS||100),idleSamples=Number(process.env.PERF_IDLE_SAMPLES||0);
 const cycles=Number(process.env.PERF_NAV_CYCLES||1),refreshes=Number(process.env.PERF_REFRESHES||0),monitor=process.env.PERF_CONTINUOUS==='1';
 if(!Number.isSafeInteger(rows)||rows<0||rows>100000||!Number.isInteger(models)||models<1||models>100||!Number.isInteger(idleSamples)||idleSamples<0||idleSamples>8)throw Error('INVALID_PERFORMANCE_OPTIONS');
 if(!Number.isInteger(cycles)||cycles<1||cycles>5||!Number.isInteger(refreshes)||refreshes<0||refreshes>10)throw Error('INVALID_PERFORMANCE_OPTIONS');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'usage-window-perf-')),out=path.resolve(process.env.PERF_OUTPUT||'artifacts/m12/performance-window');fs.mkdirSync(out,{recursive:true});
 const {home,usage}=seed(root,rows);
 if(models!==100){const file=path.join(usage,'statistics.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));for(const row of Object.values(data.records))row.model='synthetic-'+(Number(row.model.slice(10))%models);fs.writeFileSync(file,JSON.stringify(data));}
 let app,sampler;const report={rows,models,cycles,refreshes,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),syntheticOnly:true,samples:[],continuous:[],errors:[],memoryGoalMiB:[300,500],measurement:'sum of app.getAppMetrics privateBytes / 1024; working set separately; no forced GC'};
 const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
 try{
  app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home],timeout:60000});await keepVisible(app);await isolatePointer(app);
  const page=await app.firstWindow(),cdp=await page.context().newCDPSession(page);page.on('pageerror',e=>report.errors.push(e.message));await cdp.send('Performance.enable');
  report.runtime=await app.evaluate(({app})=>({electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,v8:process.versions.v8,rendererJsFlags:app.commandLine.getSwitchValue('js-flags')}));
  report.displays=await app.evaluate(({screen})=>screen.getAllDisplays().map(d=>({id:d.id,refreshRate:d.displayFrequency,scale:d.scaleFactor,size:d.size})));
  const stopFile=path.join(root,'stop-memory-sampler');
  if(monitor&&process.platform==='win32'){
   const pid=await app.evaluate(()=>process.pid);if(!Number.isSafeInteger(pid)||pid<=0)throw Error('INVALID_OWNED_PID');
   // A separate, read-only process samples while navigation/collection is in
   // progress. Include current descendants (not just Chromium's app metrics),
   // so a transient owned native collector is not silently excluded.
   const command=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $end=(Get-Date).AddMinutes(8); while(!(Test-Path -LiteralPath '${stopFile.replaceAll("'","''")}') -and (Get-Date) -lt $end){try{$ids=@(${pid});for($i=0;$i -lt $ids.Count;$i++){$parent=$ids[$i];$children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$parent" | Select-Object -ExpandProperty ProcessId);foreach($child in $children){if($ids -notcontains $child){$ids+=$child}}};$filter=($ids | ForEach-Object {"IDProcess=$_"}) -join ' OR ';$c=@(Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter $filter);[pscustomobject]@{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();pids=$ids;complete=($c.Count -eq $ids.Count);privateWorkingMiB=(($c | Measure-Object WorkingSetPrivate -Sum).Sum / 1048576);privateMiB=(($c | Measure-Object PrivateBytes -Sum).Sum / 1048576)} | ConvertTo-Json -Compress}catch{[pscustomobject]@{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();error='COUNTER_QUERY_FAILED'} | ConvertTo-Json -Compress};Start-Sleep -Milliseconds 250}`;
   sampler=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
   let pending='';sampler.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines)if(line.trim())try{report.continuous.push(JSON.parse(line));}catch{report.errors.push('INVALID_COUNTER_OUTPUT');}});
   sampler.stderr.on('data',chunk=>{report.samplerStderr=(report.samplerStderr||'')+chunk.toString();});sampler.on('error',()=>report.errors.push('COUNTER_SAMPLER_START_FAILED'));
   for(let i=0;i<100&&!report.continuous.length;i++)await page.waitForTimeout(100);
   if(!report.continuous.length)throw Error('COUNTER_SAMPLER_NOT_READY');
  }
  const sample=async(view,elapsedIdleMs=0)=>{
   const memory=await app.evaluate(({app})=>({processes:app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,privateMiB:(p.memory.privateBytes||0)/1024,workingMiB:p.memory.workingSetSize/1024})),main:process.memoryUsage()}));
   // WorkingSet includes shared pages and cannot be added as private RAM. Query
   // the Windows private working-set counter for only these owned PIDs as well.
   let privateWorkingMiB=null,privateWorkingError=null;
   if(process.platform==='win32')try{
    if(memory.processes.some(p=>!Number.isSafeInteger(p.pid)||p.pid<=0))throw Error('INVALID_OWNED_PID');
    const filter=memory.processes.map(p=>'IDProcess='+p.pid).join(' OR ');
    const command="Get-CimInstance -ClassName Win32_PerfRawData_PerfProc_Process -Filter '"+filter+"' | Select-Object IDProcess,WorkingSetPrivate | ConvertTo-Json -Compress";
    const result=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000}));
    const counters=Array.isArray(result)?result:[result];
    if(counters.length!==memory.processes.length||counters.some(p=>!Number.isFinite(Number(p.WorkingSetPrivate))))throw Error('INCOMPLETE_OWNED_COUNTERS');
    privateWorkingMiB=counters.reduce((n,p)=>n+Number(p.WorkingSetPrivate)/1048576,0);
   }catch(error){privateWorkingError=error.code||error.message;}
   const diagnostics=await page.evaluate(()=>window.usageBridge.statisticsDiagnostics()),owner=diagnostics.owner?.memory||null;
   const dom=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,svg:document.querySelectorAll('svg').length,activeAnimations:document.getAnimations().filter(a=>a.playState==='running').length,timings:performance.getEntriesByType('measure').filter(e=>e.name.startsWith('usage:')).map(e=>({name:e.name,ms:e.duration}))}));
   const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(x=>/JSHeap|Nodes|LayoutCount|RecalcStyleCount/.test(x.name)).map(x=>[x.name,x.value]));
   const row={view,elapsedIdleMs,...memory,owner,requests:diagnostics.requests,projection:diagnostics.owner?.projection,storage:diagnostics.owner?.storage,privateMiB:memory.processes.reduce((n,p)=>n+p.privateMiB,0),workingMiB:memory.processes.reduce((n,p)=>n+p.workingMiB,0),privateWorkingMiB,privateWorkingError,dom,metrics};report.samples.push(row);save();console.log(JSON.stringify(row));
  };
  report.navigationStartedAt=Date.now();
  for(let cycle=0;cycle<cycles;cycle++)for(const view of ['quota','usage','cost','sessions','sources','settings','usage']){await showView(page,view);await settle(page);await page.waitForTimeout(1800);await sample(view);}
  report.collection=[];
  for(let i=0;i<refreshes;i++){
   if(i===2){const file=path.join(require('../../src/m1/policy').roots(home).claude[0],'project','session.jsonl');fs.appendFileSync(file,JSON.stringify({type:'assistant',uuid:'memory-changed-synthetic',timestamp:new Date().toISOString(),message:{id:'memory-changed-synthetic',model:'synthetic-memory-model',usage:{input_tokens:100,output_tokens:20,cache_read_input_tokens:0,cache_creation_input_tokens:0}}})+'\n');}
   const result=await page.evaluate(async()=>{await window.usageHost.refresh();const s=window.usageData.collection();return{error:s.error,checkedAt:s.checkedAt,totalTokens:window.usageData.rows().reduce((n,r)=>n+r.totalTokens,0)};});
   if(result.error||!result.checkedAt||result.checkedAt===report.collection.at(-1)?.checkedAt)throw Error('SYNTHETIC_COLLECTION_FAILED');
   if(result.totalTokens!==rows*100+694+(i>=2?120:0))throw Error('SYNTHETIC_COLLECTION_TOTAL_MISMATCH');
   report.collection.push(result);await settle(page);await sample('refresh-'+(i+1));
  }
  const idleStart=Date.now();for(let i=1;i<=idleSamples;i++){await page.waitForTimeout(15000);await sample('usage-idle',Date.now()-idleStart);}
  report.maximumPrivateMiB=Math.max(...report.samples.map(s=>s.privateMiB));report.finalPrivateMiB=report.samples.at(-1).privateMiB;report.memoryGoalMet=report.maximumPrivateMiB<=500;save();
  report.maximumPrivateWorkingMiB=report.samples.every(s=>s.privateWorkingMiB!==null)?Math.max(...report.samples.map(s=>s.privateWorkingMiB)):null;report.finalPrivateWorkingMiB=report.samples.at(-1).privateWorkingMiB;report.privateWorkingGoalMet=report.maximumPrivateWorkingMiB!==null&&report.maximumPrivateWorkingMiB<=500;save();
  if(sampler){fs.writeFileSync(stopFile,'stop');const owned=sampler;await new Promise(resolve=>{const timeout=setTimeout(()=>{owned.kill();resolve();},5000);owned.once('exit',()=>{clearTimeout(timeout);resolve();});});sampler=null;const valid=report.continuous.filter(s=>s.complete&&!s.error);report.continuousMaximumPrivateWorkingMiB=valid.length?Math.max(...valid.map(s=>s.privateWorkingMiB)):null;report.continuousMaximumPrivateMiB=valid.length?Math.max(...valid.map(s=>s.privateMiB)):null;report.continuousIncomplete=report.continuous.length-valid.length;report.continuousMaxGapMs=Math.max(0,...report.continuous.slice(1).map((s,i)=>s.at-report.continuous[i].at));save();}
  if(report.errors.length)throw Error('RENDERER_ERRORS');
 }finally{if(sampler)sampler.kill();if(app)await app.close();await cleanup(root);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
