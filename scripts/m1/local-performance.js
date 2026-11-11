'use strict';
/* global document, requestAnimationFrame */
// Opt-in via validate:local --performance only. No screenshots, raw traces,
// transcript dumps, account calls or source writes. Fresh isolated app state is
// removed after the run; retained evidence is numeric timings/counts only.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {Worker,isMainThread,parentPort,workerData}=require('node:worker_threads');
const {roots,disableNetwork}=require('../../src/m1/policy');
if(!isMainThread&&workerData?.localPerformance){
 disableNetwork({networkAttempts:0});
 const {Service}=require('../../src/m1/service'),service=new Service(workerData.usage,roots(workerData.home),()=>{},{home:workerData.home});
 parentPort.on('message',()=>{void service.close();});
 (async()=>{
  try{
   service.store.savePreferences({...service.store.settings,enabled:false,refreshIntervalMs:0,sources:{added:workerData.selected,excluded:{},disabled:[]}});
   const start=performance.now();await service.refresh();
   const snapshot=service.store.snapshot(),result={collectionMs:performance.now()-start,records:snapshot.daily.reduce((n,row)=>n+row.records,0),dailyRows:snapshot.daily.length,sessions:Object.keys(service.store.state.sessions).length};
   if(workerData.cpuProfile)result.readerCPU=await require('./local-reader-cpu').profileReaders(service.store,workerData.selected);
   parentPort.postMessage(result);
  }catch{parentPort.postMessage({error:'REAL_COLLECTION_FAILED'});}finally{await service.close();parentPort.close();}
 })();
}
async function collect(data){
 return new Promise((resolve,reject)=>{
  const worker=new Worker(__filename,{workerData:{localPerformance:true,...data}});let result,failed,termination;
  const timer=setTimeout(()=>{failed='REAL_COLLECTION_TIMEOUT';worker.postMessage('close');termination=setTimeout(()=>{void worker.terminate();},5000);},120000);
  worker.on('message',message=>{result=message;});
  worker.on('error',()=>{failed='REAL_COLLECTION_FAILED';});
  worker.on('exit',()=>{clearTimeout(timer);clearTimeout(termination);if(failed||!result||result.error)reject(Error(failed||result?.error||'REAL_COLLECTION_FAILED'));else resolve(result);});
 });
}
async function run({selected=roots(),directory=path.resolve('artifacts/local-performance-'+Date.now()),profile:cpuProfile=false,layoutProfile=false,readerOnly=false}={}){
 const {_electron:electron}=require('playwright'),{cleanup,isolatePointer}=require('./ui-settle');
 directory=path.resolve(directory);
 for(const root of Object.values(selected).flat())if(require('../../src/m1/jsonl-adapter').overlaps(root,directory))throw Error('VALIDATION_OUTPUT_OVERLAP');
 fs.mkdirSync(directory,{recursive:true});
 const source=path.resolve(process.env.PERF_SOURCE_ROOT||'.');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentusage-real-perf-')),home=path.join(root,'empty-home'),usage=path.join(root,'usage');fs.mkdirSync(home);
 let app;const report={schemaVersion:'LocalInteractionPerformanceV1',realData:true,readerOnly,cpuDiagnostic:cpuProfile,sourceWrites:false,providerCalls:false,rawContentSaved:false,measurement:'Event Timing uses trusted pointer events through first presentation; driver readyMs includes automation waits and is not click latency; frame gaps are observed, not a refresh-rate guarantee',phases:[],errors:[],source:{rendererSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'design/desktop-reference/ui/agent-ui.js'))).digest('hex')}};
 report.layoutDiagnostic=layoutProfile;
 report.source.modules=Object.fromEntries(['design/desktop-reference/preview.js','design/desktop-reference/cost-page.js','design/desktop-reference/sessions-model.js','src/m1/session-list.js','src/m1/session-list-codec.js','src/m1/policy.js','src/m1/transcript.js','src/m1/transcript-tasks.js','src/m1/statistics-service.js'].map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file))).digest('hex')]));
 const save=()=>fs.writeFileSync(path.join(directory,'performance.json'),JSON.stringify(report,null,2));
 try{
  report.desktopAdmission=require('./desktop-readiness').desktopReadiness();save();if(!report.desktopAdmission.eligible)throw Error('DESKTOP_UNAVAILABLE');
  report.load=await collect({selected,usage,home,cpuProfile});save();
  app=await electron.launch({executablePath:require('electron'),cwd:source,args:['src/quota/main.js','--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home]});
  const page=await app.firstWindow();await page.waitForURL(/^file:/);await page.waitForFunction(()=>window.usageData?.ready(),null,{timeout:60000});await isolatePointer(app);
  report.windowAdmission=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.show();win.focus();let lost=0;win.on('blur',()=>lost++);globalThis.localPerformanceFocusLosses=()=>lost;return{visible:win.isVisible(),focused:win.isFocused(),minimized:win.isMinimized()};});
  report.fontFacesBefore=await page.evaluate(()=>[...document.fonts].map(face=>({family:face.family,status:face.status})));
  page.on('pageerror',error=>report.errors.push({name:error.name,reactCode:error.message.match(/Minified React error #(\d+)/)?.[1]??null,locations:[...error.stack.matchAll(/agent-ui\.js:(\d+):(\d+)/g)].slice(0,6).map(match=>({line:Number(match[1]),column:Number(match[2])}))}));
  // Wall time only, no arguments, IDs, bodies or result copies retained.
  await app.evaluate(({ipcMain})=>{
   globalThis.localPerformanceRequests=[];
   for(const channel of ['usage:transcript','usage:transcriptFacts','usage:sessions']){
    const original=ipcMain._invokeHandlers.get(channel);if(!original)continue;
    ipcMain._invokeHandlers.set(channel,async(...args)=>{const start=performance.now();try{return await original(...args);}finally{globalThis.localPerformanceRequests.push({channel,handlerMs:performance.now()-start});if(globalThis.localPerformanceRequests.length>200)globalThis.localPerformanceRequests.shift();}});
   }
  });
  await page.evaluate(()=>{
   const host=window.sessionsHost;window.__localBridgeRequests=[];
   window.sessionsHost=Object.freeze({...host,transcript:async(...args)=>{const start=performance.now();let outcome='ok',code=null;try{return await host.transcript(...args);}catch(error){outcome='error';code=String(error?.message??'').match(/TRANSCRIPT_[A-Z_]+/)?.[0]??'UNKNOWN';throw error;}finally{window.__localBridgeRequests.push({method:'transcript',ms:performance.now()-start,outcome,code});}}});
  });
  report.requestTimingInstrumentation=true;
  report.display=await app.evaluate(({screen,BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],d=screen.getDisplayMatching(win.getBounds());return{refresh:d.displayFrequency,scale:d.scaleFactor,window:win.getBounds()};});
  await page.evaluate(()=>{
   const state=window.__localInteraction={phase:null,timeline:[],events:[],longTasks:[],frames:[],previous:0},phaseAt=at=>state.timeline.findLast(row=>row.at<=at)?.name??null;
   new PerformanceObserver(list=>{for(const e of list.getEntries())state.longTasks.push({phase:phaseAt(e.startTime),start:e.startTime,ms:e.duration});}).observe({type:'longtask'});
   new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.interactionId)state.events.push({phase:phaseAt(e.startTime),type:e.name,ms:e.duration,inputDelay:e.processingStart-e.startTime,processing:e.processingEnd-e.processingStart});}).observe({type:'event',durationThreshold:16});
   const frame=at=>{if(state.previous&&state.phase)state.frames.push({phase:state.phase,ms:at-state.previous});state.previous=at;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  const cdp=cpuProfile||layoutProfile?await page.context().newCDPSession(page):null,layout=layoutProfile?await require('./local-layout-profile').start(cdp):null;
  if(cpuProfile){await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  const phase=async(name,action,ready)=>{
   await page.evaluate(({name,index})=>{performance.mark('local-perf:'+index+':'+name);window.__localInteraction.phase=name;window.__localInteraction.began=performance.now();window.__localInteraction.timeline.push({name,at:performance.now()});},{name,index:report.phases.length});
   await action();if(ready)await ready();
   const ms=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-window.__localInteraction.began)))));
   report.phases.push({name,readyMs:ms});await page.waitForTimeout(150);save();
  };
  for(const view of readerOnly?['sessions']:['usage','cost','sessions','usage','cost','usage','sessions'])await phase('navigate-'+view,()=>page.locator('[data-view="'+view+'"]').click(),()=>page.waitForFunction(view=>document.getElementById('main').dataset.currentView===view,view));
  await phase('all-sessions',()=>page.getByRole('tab',{name:'全部',exact:true}).click(),()=>page.waitForFunction(()=>window.sessionsHost.get().range==='all'&&!window.sessionsHost.get().loading));
  report.sessionCounts=await page.evaluate(()=>{
   const sessions=window.sessionsHost.list()?.sessions||[],readable=sessions.filter(s=>window.sessionsHost.readable(s.agent));
   window.__localTargets=readable.toSorted((a,b)=>b.days.reduce((n,d)=>n+d.records,0)-a.days.reduce((n,d)=>n+d.records,0)).slice(0,2);
   return {all:sessions.length,readable:readable.length,selected:window.__localTargets.map(s=>({agent:s.agent,records:s.days.reduce((n,d)=>n+d.records,0)}))};
  });
  for(let index=0;index<report.sessionCounts.selected.length;index++){
   await phase('open-record-'+index,()=>page.evaluate(index=>window.sessionsHost.read(window.__localTargets[index]),index),()=>page.waitForFunction(index=>window.__localBridgeRequests[index]?.outcome==='error'||window.__localBridgeRequests[index]?.outcome==='ok'&&document.querySelector('[data-reader-turn]'),index,{timeout:90000}));
   report.phases.at(-1).drawn=await page.locator('[data-reader-turn]').count();
   report.phases.at(-1).dom=await page.evaluate(()=>({nodes:document.querySelectorAll('*').length,paneNodes:document.querySelector('[data-reader-page]')?.querySelectorAll('*').length??0,textChars:document.querySelector('[data-reader-page]')?.textContent.length??0,items:document.querySelectorAll('[data-reader-item]').length,turns:document.querySelectorAll('[data-rail-mark]').length}));
   if(!report.phases.at(-1).drawn)throw Error('REAL_TRANSCRIPT_FAILED');
   const region=page.locator('[data-reader-scroll]').first();if(await region.count()){
    if(readerOnly){
     const toggle=page.locator('[data-reader-side-toggle] button');if(await toggle.getAttribute('aria-label')==='这次会话')await toggle.click();
     await page.locator('[data-reader-side]').waitFor();
    }
    await region.hover();await phase('scroll-record-'+index,async()=>{const before=await region.evaluate(node=>node.scrollTop);for(let i=0;i<8;i++){await page.mouse.wheel(0,600);await page.waitForTimeout(60);}if(readerOnly&&!(await region.evaluate(node=>node.scrollTop)>before))throw Error('READER_SCROLL_DID_NOT_MOVE');});
    if(readerOnly){
     const tabs=page.getByRole('tablist',{name:'这次会话的内容',exact:true});
     for(const [at,label]of ['命令','文件','概况','命令','概况'].entries())await phase('reader-side-'+index+'-'+at,()=>tabs.getByRole('tab',{name:label,exact:true}).click());
     const navTabs=page.getByRole('tablist',{name:'左栏内容',exact:true});await phase('reader-nav-'+index,()=>navTabs.getByRole('tab',{name:'会话',exact:true}).click());
     await phase('reader-nav-hover-'+index,async()=>{const rows=page.locator('[data-nav-session]');for(let at=0;at<Math.min(await rows.count(),6);at++){await rows.nth(at).hover();await page.waitForTimeout(50);}});
    }
   }
   await phase('leave-record-'+index,()=>page.locator('[data-reader-back] button').click(),()=>page.waitForSelector('[data-sessions-page]'));
  }
  if(!readerOnly)await phase('return-usage',()=>page.locator('[data-view="usage"]').click(),()=>page.waitForFunction(()=>document.getElementById('main').dataset.currentView==='usage'));
  await page.waitForTimeout(400);
  report.fonts=await page.evaluate(()=>performance.getEntriesByType('resource').filter(entry=>entry.name.endsWith('.woff2')).map(entry=>({file:entry.name.split('/').at(-1),start:entry.startTime,ms:entry.duration})));
  report.fontFacesAfter=await page.evaluate(()=>[...document.fonts].map(face=>({family:face.family,status:face.status})));
  if(layout)report.layout=await layout.stop();
  if(cpuProfile){const profile=(await cdp.send('Profiler.stop')).profile,counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map(profile.nodes.flatMap(n=>(n.children||[]).map(child=>[child,n.id]))),location=n=>({function:n.callFrame.functionName||'(anonymous)',script:path.basename(n.callFrame.url.split('?')[0]),line:n.callFrame.lineNumber+1,column:n.callFrame.columnNumber+1});
  report.cpu=profile.nodes.filter(n=>counts.has(n.id)).map(n=>{const stack=[];let node=n;for(let depth=0;depth<6&&node;depth++,node=nodes.get(parents.get(node.id)))stack.push(location(node));return {...location(n),samples:counts.get(n.id),stack};}).sort((a,b)=>b.samples-a.samples).slice(0,50);
  }
  report.interaction=await page.evaluate(()=>{const state=window.__localInteraction;
   const summarize=frames=>{const sorted=frames.map(f=>f.ms).sort((a,b)=>a-b);return {count:sorted.length,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:sorted.at(-1),over16:sorted.filter(ms=>ms>16).length,over50:sorted.filter(ms=>ms>50).length};};
   return {events:state.events,longTasks:state.longTasks,frames:state.frames.filter(f=>f.ms>12),frameSummary:summarize(state.frames),phaseFrames:Object.fromEntries([...new Set(state.frames.map(f=>f.phase))].map(phase=>[phase,summarize(state.frames.filter(f=>f.phase===phase))]))};
  });
  report.requests=await app.evaluate(()=>globalThis.localPerformanceRequests);report.bridgeRequests=await page.evaluate(()=>window.__localBridgeRequests);
  report.windowEnd=await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];return{visible:win.isVisible(),focused:win.isFocused(),minimized:win.isMinimized(),focusLosses:globalThis.localPerformanceFocusLosses()};});
  report.desktopEnd=require('./desktop-readiness').desktopReadiness();report.runComplete=report.desktopEnd.eligible&&report.errors.length===0&&report.load.records>0&&report.sessionCounts.selected.length>0&&report.phases.filter(p=>p.name.startsWith('open-record-')).every(p=>p.drawn>0);report.measurementEligible=report.runComplete&&!cpuProfile&&!layoutProfile&&report.windowAdmission.focused&&report.windowEnd.focused&&report.windowEnd.focusLosses===0;save();if(!report.runComplete)throw Error('LOCAL_PERFORMANCE_INELIGIBLE');return report;
 }catch(error){report.failed=/^[A-Z_]+$/.test(error.message)?error.message:'LOCAL_PERFORMANCE_FAILED';report.failureType=/^[A-Za-z]+Error$/.test(error.name)?error.name:'Error';if(app){report.requests=await app.evaluate(()=>globalThis.localPerformanceRequests).catch(()=>[]);report.bridgeRequests=await app.firstWindow().then(page=>page.evaluate(()=>window.__localBridgeRequests)).catch(()=>[]);}save();throw Error('LOCAL_PERFORMANCE_FAILED',{cause:error});}
 finally{
  if(app)await app.close();
  if(path.dirname(fs.realpathSync(root))===fs.realpathSync(os.tmpdir())&&path.basename(root).startsWith('agentusage-real-perf-'))await cleanup(root);
 }
}
module.exports={run};
