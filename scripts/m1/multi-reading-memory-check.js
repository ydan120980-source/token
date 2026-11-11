'use strict';
/* global document, innerWidth, innerHeight, devicePixelRatio */
// Comparable visible-window memory/navigation evidence. Fresh synthetic home only.
// No forced GC, memory-pressure notifications, GPU overrides or artificial caps.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawn}=require('node:child_process');
const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const {Store}=require('../../src/m1/store');
const {roots}=require('../../src/m1/policy');
const {until,isolatePointer,cleanup}=require('./ui-settle');
const {python}=require('./python');
async function run(){
 const rows=64000,models=100,cycles=1,monitor=true;
 const profile=process.env.PERF_PROFILE||'two';if(!['two','three','compare','list','scan','drag'].includes(profile))throw Error('INVALID_PROFILE');
 const counterBackend=process.env.MEMORY_COUNTER_BACKEND||(process.platform==='win32'&&Number(os.release().split('.')[2])>=22000?'pdh':'cim');if(!['pdh','cim'].includes(counterBackend))throw Error('INVALID_COUNTER_BACKEND');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'usage-multi-perf-')),out=path.resolve(process.env.PERF_OUTPUT||'artifacts/reader-performance-20261102/memory/'+profile);fs.mkdirSync(out,{recursive:true});
 const seeded=await require('../../tests/m1/multi-reader-memory-fixture').seedMemory(root),{home,usage,longFiles,longIds}=seeded,producer=new Store(usage,roots(home));
 const ledgerBytes=fs.readFileSync(path.join(usage,'statistics.json')),expectedTokens=producer.snapshot().daily.reduce((sum,row)=>sum+row.totalTokens,0),longFileBytes=fs.statSync(longFiles[0]).size;
 let app,sampler,allocation;const report={profile,rows,models,cycles,followUpdates:2,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),syntheticOnly:true,samples:[],continuous:[],errors:[],memoryGoalMiB:[300,500],measurement:'continuous Windows counter sums over owned application descendants are authoritative for resident private working set and private commit; Electron-listed discrete samples and ordinary shared working sets kept separately; begins after window/data ready, not full initial source import',noForcedGC:true,nativeClocks:true,allocationDiagnostic:process.env.PERF_ALLOCATION_DIAGNOSTIC==='1',desktopAdmission:require('./desktop-readiness').desktopReadiness()};
 const sourceRoot=path.resolve(process.env.PERF_SOURCE_ROOT||'.');report.sourceRoot=sourceRoot;
 const product=process.env.QUOTA_PACKAGED_EXE?path.join(path.dirname(process.env.QUOTA_PACKAGED_EXE),'resources/app.asar'):path.join(sourceRoot,'design/desktop-reference/ui/agent-ui.js');report.productByteProof={kind:process.env.QUOTA_PACKAGED_EXE?'ASAR':'compiled renderer',sha256:crypto.createHash('sha256').update(fs.readFileSync(product)).digest('hex')};
 if(!process.env.QUOTA_PACKAGED_EXE)report.productByteProof.sourceFiles=Object.fromEntries(['design/desktop-reference/index.html','design/desktop-reference/sessions-host.js','src/quota/preload.js','src/m1/transcript-continuation.js','design/desktop-reference/cost-page.js','design/desktop-reference/sessions-model.js','src/m1/policy.js','src/m1/session-list.js','src/m1/native.js','src/m1/store.js','src/m1/saved-string-sharing.js','src/m1/sources.js','src/m1/worker.js','src/m1/transcript.js','src/m1/transcript-tasks.js','src/m1/statistics-worker.js','src/m1/statistics-service.js','src/m1/session-list-codec.js','src/quota/main.js','design/desktop-reference/preview.js','design/desktop-reference/usage-data.js','design/desktop-reference/ui/agent-ui.css','package-lock.json'].map(file=>[file,file==='src/m1/saved-string-sharing.js'&&!fs.existsSync(path.join(sourceRoot,file))?null:crypto.createHash('sha256').update(fs.readFileSync(path.join(sourceRoot,file))).digest('hex')]));
 report.fixtureByteProof=Object.fromEntries(['tests/m1/multi-reader-memory-fixture.js','scripts/m1/multi-reader-workload.js','scripts/m1/windows-memory-sampler.py'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'../..',file))).digest('hex')]));
 const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
 try{
  if(report.desktopAdmission.checked!==true||report.desktopAdmission.locked)throw Error('DESKTOP_UNAVAILABLE');
  app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:[path.join(sourceRoot,'src/quota/main.js')]),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home],timeout:60000});await isolatePointer(app);
  const page=await app.firstWindow();await page.waitForURL(/^file:/);await page.waitForLoadState('load');await until(page,()=>window.usageData.ready());await page.waitForFunction(expected=>window.usageData.rows().reduce((sum,row)=>sum+row.totalTokens,0)===expected,expectedTokens);report.expectedTokens=expectedTokens;report.defaultWindow=await app.evaluate(({BrowserWindow,screen})=>{const win=BrowserWindow.getAllWindows()[0],bounds=win.getBounds(),display=screen.getDisplayMatching(bounds);win.on('minimize',()=>setTimeout(()=>{if(!win.isDestroyed()){win.showInactive();win.webContents.invalidate();}},300));return{bounds,contentBounds:win.getContentBounds(),workArea:display.workArea,nominal:{width:1480,height:960},borderRoundingTolerancePx:4};});assert(Math.abs(report.defaultWindow.bounds.width-Math.min(1480,report.defaultWindow.workArea.width))<=4);assert(Math.abs(report.defaultWindow.bounds.height-Math.min(960,report.defaultWindow.workArea.height))<=4);report.viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));report.longReader={turns:300,fileBytes:longFileBytes,followUpdates:[]};const cdp=await page.context().newCDPSession(page);page.on('pageerror',e=>report.errors.push(e.message));await cdp.send('Performance.enable');
  report.runtime=await app.evaluate(({app})=>({electron:process.versions.electron,chrome:process.versions.chrome,node:process.versions.node,v8:process.versions.v8,rendererJsFlags:app.commandLine.getSwitchValue('js-flags'),gpuPreference:Object.fromEntries(['force_high_performance_gpu','force_low_power_gpu'].map(key=>[key,app.commandLine.hasSwitch(key)])),renderingSwitches:Object.fromEntries(['use-angle','enable-features','disable-features','skia-graphite-backend'].map(key=>[key,app.commandLine.getSwitchValue(key)]))}));
  report.displays=await app.evaluate(({screen})=>screen.getAllDisplays().map(d=>({id:d.id,refreshRate:d.displayFrequency,scale:d.scaleFactor,size:d.size})));
  if(report.allocationDiagnostic)allocation=await require('./reader-allocation-profile').start(app,page,cdp,sourceRoot,out);
  const stopFile=path.join(root,'stop-memory-sampler');
  const ownedPid=await app.evaluate(()=>process.pid);if(!Number.isSafeInteger(ownedPid)||ownedPid<=0)throw Error('INVALID_OWNED_PID');
  const counterScript=path.join(__dirname,'windows-memory-sampler.py');report.counterBackend=counterBackend;report.requestedSampleIntervalMs=counterBackend==='pdh'?100:250;
  if(monitor&&process.platform==='win32'){
   const pid=await app.evaluate(()=>process.pid);if(!Number.isSafeInteger(pid)||pid<=0)throw Error('INVALID_OWNED_PID');
   // A separate, read-only process samples while navigation/collection is in
   // progress. Include current descendants (not just Chromium's app metrics),
   // so a transient owned native collector is not silently excluded.
   const command=`$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $end=(Get-Date).AddMinutes(8); while(!(Test-Path -LiteralPath '${stopFile.replaceAll("'","''")}') -and (Get-Date) -lt $end){try{$ids=@(${pid});for($i=0;$i -lt $ids.Count;$i++){$parent=$ids[$i];$children=@(Get-CimInstance Win32_Process -Filter "ParentProcessId=$parent" | Select-Object -ExpandProperty ProcessId);foreach($child in $children){if($ids -notcontains $child){$ids+=$child}}};$filter=($ids | ForEach-Object {"IDProcess=$_"}) -join ' OR ';$c=@(Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter $filter);[pscustomobject]@{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();pids=$ids;complete=($c.Count -eq $ids.Count);privateWorkingMiB=(($c | Measure-Object WorkingSetPrivate -Sum).Sum / 1048576);privateMiB=(($c | Measure-Object PrivateBytes -Sum).Sum / 1048576)} | ConvertTo-Json -Compress}catch{[pscustomobject]@{at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();error='COUNTER_QUERY_FAILED'} | ConvertTo-Json -Compress};Start-Sleep -Milliseconds 250}`;
   sampler=counterBackend==='pdh'?spawn(python(),[counterScript,'--pid',String(ownedPid),'--stop-file',stopFile],{windowsHide:true,stdio:['ignore','pipe','pipe']}):spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
   let pending='';sampler.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split(/\r?\n/);pending=lines.pop();for(const line of lines)if(line.trim())try{report.continuous.push(JSON.parse(line));}catch{report.errors.push('INVALID_COUNTER_OUTPUT');}});
   sampler.stderr.on('data',chunk=>{report.samplerStderr=(report.samplerStderr||'')+chunk.toString();});sampler.on('error',()=>report.errors.push('COUNTER_SAMPLER_START_FAILED'));
   for(let i=0;i<100&&!report.continuous.length;i++)await page.waitForTimeout(100);
   if(!report.continuous.length)throw Error('COUNTER_SAMPLER_NOT_READY');
  }
  const sample=async(view,elapsedIdleMs=0)=>{
   const beganAt=Date.now();
   const memory=await app.evaluate(({app})=>({processes:app.getAppMetrics().map(p=>({pid:p.pid,type:p.type,privateMiB:(p.memory.privateBytes||0)/1024,workingMiB:p.memory.workingSetSize/1024})),main:process.memoryUsage()}));
   // WorkingSet includes shared pages and cannot be added as private RAM. Query
   // the Windows private working-set counter for only these owned PIDs as well.
   let privateWorkingMiB=null,privateWorkingError=null;
   if(process.platform==='win32')try{
    if(memory.processes.some(p=>!Number.isSafeInteger(p.pid)||p.pid<=0))throw Error('INVALID_OWNED_PID');
    if(counterBackend==='pdh'){
     const result=JSON.parse(execFileSync(python(),[counterScript,'--pid',String(ownedPid),'--stop-file',stopFile,'--count','1'],{encoding:'utf8',windowsHide:true,timeout:15000}));
     if(!result.complete||!Number.isFinite(result.privateWorkingMiB))throw Error('INCOMPLETE_OWNED_COUNTERS');privateWorkingMiB=result.privateWorkingMiB;
    }else{
     const filter=memory.processes.map(p=>'IDProcess='+p.pid).join(' OR ');
     const command="Get-CimInstance -ClassName Win32_PerfRawData_PerfProc_Process -Filter '"+filter+"' | Select-Object IDProcess,WorkingSetPrivate | ConvertTo-Json -Compress";
     const result=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000}));
     const counters=Array.isArray(result)?result:[result];
     if(counters.length!==memory.processes.length||counters.some(p=>!Number.isFinite(Number(p.WorkingSetPrivate))))throw Error('INCOMPLETE_OWNED_COUNTERS');
     privateWorkingMiB=counters.reduce((n,p)=>n+Number(p.WorkingSetPrivate)/1048576,0);
    }
   }catch(error){privateWorkingError=error.code||error.message;}
   const diagnostics=await page.evaluate(()=>window.usageBridge.statisticsDiagnostics()),owner=diagnostics.owner?.memory||null;
   const dom=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,svg:document.querySelectorAll('svg').length,activeAnimations:document.getAnimations().filter(a=>a.playState==='running').length,timings:performance.getEntriesByType('measure').filter(e=>e.name.startsWith('usage:')).map(e=>({name:e.name,ms:e.duration}))}));
   const metrics=Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.filter(x=>/JSHeap|Nodes|LayoutCount|RecalcStyleCount/.test(x.name)).map(x=>[x.name,x.value]));
   const row={view,beganAt,at:Date.now(),elapsedIdleMs,...memory,owner,readerWork:diagnostics.owner?.reader,requests:diagnostics.requests,projection:diagnostics.owner?.projection,storage:diagnostics.owner?.storage,privateMiB:memory.processes.reduce((n,p)=>n+p.privateMiB,0),workingMiB:memory.processes.reduce((n,p)=>n+p.workingMiB,0),privateWorkingMiB,privateWorkingError,dom,metrics};report.samples.push(row);save();console.log(JSON.stringify(row));if(allocation&&view==='after-reader-close')await allocation.stop();
  };
  await require('./multi-reader-workload').run({page,app,report,sample,profile,longFiles,longIds,ledgerBytes,usage,out});
  report.maximumPrivateMiB=Math.max(...report.samples.map(s=>s.privateMiB));report.finalPrivateMiB=report.samples.at(-1).privateMiB;report.privateCommitWithin500=report.maximumPrivateMiB<=500;save();
  report.maximumPrivateWorkingMiB=report.samples.every(s=>s.privateWorkingMiB!==null)?Math.max(...report.samples.map(s=>s.privateWorkingMiB)):null;report.finalPrivateWorkingMiB=report.samples.at(-1).privateWorkingMiB;report.privateWorkingGoalMet=report.maximumPrivateWorkingMiB!==null&&report.maximumPrivateWorkingMiB<=500;save();
  if(sampler){fs.writeFileSync(stopFile,'stop');const owned=sampler;await new Promise(resolve=>{const timeout=setTimeout(()=>{owned.kill();resolve();},5000);owned.once('exit',()=>{clearTimeout(timeout);resolve();});});sampler=null;const valid=report.continuous.filter(s=>s.complete&&!s.error);report.continuousMaximumPrivateWorkingMiB=valid.length?Math.max(...valid.map(s=>s.privateWorkingMiB)):null;report.continuousMaximumPrivateMiB=valid.length?Math.max(...valid.map(s=>s.privateMiB)):null;report.continuousIncomplete=report.continuous.length-valid.length;report.continuousMaxGapMs=Math.max(0,...report.continuous.slice(1).map((s,i)=>s.at-report.continuous[i].at));save();}
  report.samplingReliable=report.continuousIncomplete===0&&report.continuousMaxGapMs<=500;
  report.desktopEnd=require('./desktop-readiness').desktopReadiness();report.desktopEligible=report.desktopEnd.checked===true&&!report.desktopEnd.locked;
  report.residentSampledGoalMet=report.desktopEligible&&!report.allocationDiagnostic&&report.samplingReliable&&report.maximumPrivateWorkingMiB!==null&&report.continuousMaximumPrivateWorkingMiB!==null&&Math.max(report.maximumPrivateWorkingMiB,report.continuousMaximumPrivateWorkingMiB)<=500;report.peakIsSampledNotInstantaneousBound=true;save();if(allocation)await allocation.stop();if(report.errors.length)throw Error('RENDERER_ERRORS');
  // Optional backend metadata can initialize additional driver contexts. Obtain
  // it only after the memory counters have stopped, never inside acceptance peaks.
  if(process.env.PERF_GPU_DIAGNOSTIC==='1'){report.gpuAfterSampling=await app.evaluate(async({app})=>({status:app.getGPUFeatureStatus(),info:await app.getGPUInfo('complete')}));save();}
 }catch(error){report.failed={message:error.message};if(app)await app.firstWindow().then(async page=>{report.failureDom=await page.evaluate(()=>({outlines:[...document.querySelectorAll('[data-reader-outline]')].map(e=>({connected:e.isConnected,children:e.children.length})),panes:[...document.querySelectorAll('[data-reader-page]')].map(e=>{let fiber=e[Object.keys(e).find(k=>k.startsWith('__reactFiber'))];while(fiber&&!fiber.memoizedProps?.nav)fiber=fiber.return;const p=fiber?.memoizedProps;return{focused:e.dataset.focused,rail:e.querySelectorAll('[data-rail-mark]').length,props:p?{focused:p.focused,navShown:p.nav.shown,navTab:p.nav.tab,targetConnected:p.nav.element?.isConnected,targetChildren:p.nav.element?.children.length}:null};})}));await page.screenshot({path:path.join(out,'failure.png')});}).catch(()=>{});save();throw error;}finally{if(sampler)sampler.kill();if(app)await app.close();await cleanup(root);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
