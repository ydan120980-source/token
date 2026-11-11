'use strict';
/* global document, innerWidth, innerHeight, devicePixelRatio */
// Comparable visible-window memory/navigation evidence. Fresh synthetic home only.
// No forced GC, memory-pressure notifications, GPU overrides or artificial caps.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync,spawn}=require('node:child_process');
const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const {seed,CODEX_ID}=require('../../tests/m1/sessions-reader-fixture');
const {Store,atomic}=require('../../src/m1/store');
const {normalize}=require('../../src/m1/normalize');
const {roots}=require('../../src/m1/policy');
const {showView,settle,until,isolatePointer,cleanup}=require('./ui-settle');
async function run(){
 const rows=Number(process.env.PERF_ROWS||64000),models=Number(process.env.PERF_MODELS||100),idleSamples=Number(process.env.PERF_IDLE_SAMPLES||0);
 const cycles=Number(process.env.PERF_NAV_CYCLES||1),monitor=process.env.PERF_CONTINUOUS==='1';
 if(!Number.isSafeInteger(rows)||rows<0||rows>100000||!Number.isInteger(models)||models<1||models>100||!Number.isInteger(idleSamples)||idleSamples<0||idleSamples>8)throw Error('INVALID_PERFORMANCE_OPTIONS');
 if(!Number.isInteger(cycles)||cycles<1||cycles>5)throw Error('INVALID_PERFORMANCE_OPTIONS');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'usage-window-perf-')),out=path.resolve(process.env.PERF_OUTPUT||'artifacts/handoff-20261102/memory');fs.mkdirSync(out,{recursive:true});
 const seeded=await seed(root),{home,usage}=seeded, producer=new Store(usage,roots(home)),now=Date.now();
 for(let i=0;i<rows;i++){const row=normalize('codex',{input_tokens:80,output_tokens:20,cached_input_tokens:0,total_tokens:100},{id:'nov2-memory-'+i,session:'saved-session-'+i%500,time:now-Math.floor(i/Math.max(100,rows/200))*86400000,model:'synthetic-'+i%100,entry:'cli'},producer.state.salt);producer.state.records[row.id]=row;}
 producer.state.sequence++;atomic(path.join(usage,'statistics.json'),producer.state);producer.setEnabled(false);
 const ledgerBytes=fs.readFileSync(path.join(usage,'statistics.json')),expectedTokens=producer.snapshot().daily.reduce((sum,row)=>sum+row.totalTokens,0);
 const longReply='```js\n'+Array.from({length:40},(_,i)=>'const item'+i+' = '+i+';').join('\n')+'\n```\n\n'+'合成内存测量段落。'.repeat(3000),longRows=[{timestamp:new Date(now-600000).toISOString(),type:'session_meta',payload:{id:CODEX_ID,cwd:'C:/synthetic/reader-codex',originator:'codex_cli_rs'}},{type:'turn_context',payload:{model:'gpt-4.1'}}];
 for(let i=0;i<300;i++){const timestamp=new Date(now-600000+i*1000).toISOString();longRows.push({timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'合成长会话问题 '+i}]}},{timestamp,type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:longReply}]}},{timestamp,type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:(i+1)*100,output_tokens:(i+1)*20,total_tokens:(i+1)*120},last_token_usage:{input_tokens:100,output_tokens:20,total_tokens:120}}}});}
 fs.writeFileSync(seeded.codexFile,longRows.map(row=>JSON.stringify(row)).join('\n')+'\n');
 const longFileBytes=fs.statSync(seeded.codexFile).size;
 if(models!==100){const file=path.join(usage,'statistics.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));for(const row of Object.values(data.records))if(row.model.startsWith('synthetic-'))row.model='synthetic-'+(Number(row.model.slice(10))%models);fs.writeFileSync(file,JSON.stringify(data));}
 let app,sampler;const report={rows,models,cycles,followUpdates:4,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),syntheticOnly:true,samples:[],continuous:[],errors:[],memoryGoalMiB:[300,500],measurement:'continuous Windows counter sums over owned application descendants are authoritative for resident private working set and private commit; Electron-listed discrete samples and ordinary shared working sets kept separately; begins after window/data ready, not full initial source import',noForcedGC:true,nativeClocks:true};
 const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
 try{
  app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home],timeout:60000});await isolatePointer(app);
  const page=await app.firstWindow();await page.waitForURL(/^file:/);await page.waitForLoadState('load');await until(page,()=>window.usageData.ready());await page.waitForFunction(expected=>window.usageData.rows().reduce((sum,row)=>sum+row.totalTokens,0)===expected,expectedTokens);report.expectedTokens=expectedTokens;report.defaultWindow=await app.evaluate(({BrowserWindow,screen})=>{const win=BrowserWindow.getAllWindows()[0],bounds=win.getBounds(),display=screen.getDisplayMatching(bounds);win.on('minimize',()=>setTimeout(()=>{if(!win.isDestroyed()){win.showInactive();win.webContents.invalidate();}},300));return{bounds,contentBounds:win.getContentBounds(),workArea:display.workArea,nominal:{width:1480,height:960},borderRoundingTolerancePx:4};});assert(Math.abs(report.defaultWindow.bounds.width-Math.min(1480,report.defaultWindow.workArea.width))<=4);assert(Math.abs(report.defaultWindow.bounds.height-Math.min(960,report.defaultWindow.workArea.height))<=4);report.viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,dpr:devicePixelRatio}));report.longReader={turns:300,fileBytes:longFileBytes,followUpdates:[]};const cdp=await page.context().newCDPSession(page);page.on('pageerror',e=>report.errors.push(e.message));await cdp.send('Performance.enable');
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
  await page.waitForTimeout(5000);await sample('default-window-idle');
  report.navigationStartedAt=Date.now();
  for(let cycle=0;cycle<cycles;cycle++)for(const view of ['quota','usage','cost','sessions','sources','settings','usage']){await showView(page,view);await settle(page);await page.waitForTimeout(1800);await sample(view);}
  await showView(page,'sessions');await page.getByRole('tablist',{name:'会话时间范围',exact:true}).getByRole('tab',{name:'全部',exact:true}).click();await until(page,()=>!!window.sessionsHost.get().list&&!window.sessionsHost.get().loading);
  const key=await page.evaluate(id=>window.sessionsHost.get().list.sessions.find(row=>row.id===id)?.key,CODEX_ID);assert(key);
  await page.getByRole('textbox',{name:'搜索会话',exact:true}).fill(CODEX_ID);await settle(page);
  const closedGroups=page.locator('[data-session-group] [data-fold-head] button[aria-expanded=false]');while(await closedGroups.count()){await closedGroups.first().click();await settle(page);}
  const row=page.locator('[data-session="'+key+'"]');report.longReader.openedBy='real metadata search and group expansion';
  await app.evaluate(({ipcMain})=>{globalThis.memoryReaderReads=[];const original=ipcMain._invokeHandlers.get('usage:transcript');ipcMain._invokeHandlers.set('usage:transcript',async(...args)=>{const began=performance.now(),result=await original(...args);globalThis.memoryReaderReads.push({ms:performance.now()-began});return result;});});
  await row.locator('[data-fold-cell="tokens"]').click();await page.locator('[data-reader-turn]').first().waitFor();await settle(page);assert.match(await page.locator('[data-reader-page] header').textContent(),/300 轮/);await sample('long-reader-initial-viewport');
  await page.locator('[data-outline-item="299"]').click();await page.locator('[data-reader-turn="299"]').waitFor();await page.locator('[data-reader-scroll]').hover();await page.mouse.wheel(0,1000000);await page.waitForTimeout(1800);await settle(page);report.longReader.mountedTurns=await page.locator('[data-reader-turn]').count();await sample('long-reader-near-end');
  await page.getByRole('button',{name:'跟随',exact:true}).click();
  for(let i=1;i<=4;i++){
   const began=Date.now(),timestamp=new Date().toISOString();fs.appendFileSync(seeded.codexFile,[{timestamp,type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'合成跟随问题 '+i}]}},{timestamp,type:'response_item',payload:{type:'message',role:'assistant',content:[{type:'output_text',text:'合成跟随回复 '+i}]}}].map(row=>JSON.stringify(row)).join('\n')+'\n');
   await page.waitForFunction(turns=>document.querySelector('[data-reader-page] header')?.textContent.includes(turns+' 轮'),300+i,{timeout:90000});await settle(page);report.longReader.followUpdates.push({update:i,observedMs:Date.now()-began});await sample('long-reader-follow-'+i);
  }
  report.longReader.actualReads=await app.evaluate(()=>globalThis.memoryReaderReads);assert(report.longReader.actualReads.length>=5);await page.getByRole('button',{name:'跟随中',exact:true}).click();await page.locator('[data-reader-back] button').click();await showView(page,'usage');await sample('after-reader-close');
  assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),ledgerBytes,'reading/follow never persist source content into statistics');
  const labels=JSON.parse(fs.readFileSync(path.join(usage,'session-labels.json'),'utf8'));assert(Object.values(labels.labels).every(value=>Object.keys(value).every(key=>key==='turn')&&Number.isInteger(value.turn)));report.turnNumberOnlyPersistence=true;
  const idleStart=Date.now();for(let i=1;i<=idleSamples;i++){await page.waitForTimeout(15000);await sample('usage-idle',Date.now()-idleStart);}
  report.maximumPrivateMiB=Math.max(...report.samples.map(s=>s.privateMiB));report.finalPrivateMiB=report.samples.at(-1).privateMiB;report.privateCommitWithin500=report.maximumPrivateMiB<=500;save();
  report.maximumPrivateWorkingMiB=report.samples.every(s=>s.privateWorkingMiB!==null)?Math.max(...report.samples.map(s=>s.privateWorkingMiB)):null;report.finalPrivateWorkingMiB=report.samples.at(-1).privateWorkingMiB;report.privateWorkingGoalMet=report.maximumPrivateWorkingMiB!==null&&report.maximumPrivateWorkingMiB<=500;save();
  if(sampler){fs.writeFileSync(stopFile,'stop');const owned=sampler;await new Promise(resolve=>{const timeout=setTimeout(()=>{owned.kill();resolve();},5000);owned.once('exit',()=>{clearTimeout(timeout);resolve();});});sampler=null;const valid=report.continuous.filter(s=>s.complete&&!s.error);report.continuousMaximumPrivateWorkingMiB=valid.length?Math.max(...valid.map(s=>s.privateWorkingMiB)):null;report.continuousMaximumPrivateMiB=valid.length?Math.max(...valid.map(s=>s.privateMiB)):null;report.continuousIncomplete=report.continuous.length-valid.length;report.continuousMaxGapMs=Math.max(0,...report.continuous.slice(1).map((s,i)=>s.at-report.continuous[i].at));save();}
  report.residentSampledGoalMet=report.maximumPrivateWorkingMiB!==null&&report.continuousMaximumPrivateWorkingMiB!==null&&Math.max(report.maximumPrivateWorkingMiB,report.continuousMaximumPrivateWorkingMiB)<=500;report.peakIsSampledNotInstantaneousBound=true;save();if(report.errors.length)throw Error('RENDERER_ERRORS');
 }catch(error){report.failed={message:error.message};save();if(app)await app.firstWindow().then(page=>page.screenshot({path:path.join(out,'failure.png')})).catch(()=>{});throw error;}finally{if(sampler)sampler.kill();if(app)await app.close();await cleanup(root);}
}
run().catch(e=>{console.error(e);process.exitCode=1;});
