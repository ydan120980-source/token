'use strict';
/* global document, requestAnimationFrame, ResizeObserver */
// Browser plugin not available for Electron. Trusted Playwright pointer events,
// native Event Timing and frame gaps; no profiler, screenshots or real sources.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {_electron:electron}=require('playwright');
const {seedMemory}=require('../../tests/m1/multi-reader-memory-fixture');
const {until,isolatePointer,settle,cleanup}=require('./ui-settle');
const {desktopReadiness}=require('./desktop-readiness');
async function run(){
 const diagnostic=process.env.PERF_LAYOUT_DIAGNOSTIC||null;if(diagnostic&&!['auto-sections','layout-sections','retained-layout','trace'].includes(diagnostic))throw Error('INVALID_LAYOUT_DIAGNOSTIC');
 const source=path.resolve(process.env.PERF_SOURCE_ROOT||'.'),out=path.resolve(process.env.PERF_OUTPUT||'artifacts/interaction-benchmark'),root=fs.mkdtempSync(path.join(os.tmpdir(),'interaction-benchmark-'));
 assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.mkdirSync(out,{recursive:true});let app,layout;
 const files=['design/desktop-reference/ui/agent-ui.js','design/desktop-reference/ui/agent-ui.css','design/desktop-reference/display-values.js','design/desktop-reference/sessions-host.js','src/m1/transcript.js','src/m1/transcript-continuation.js'];
 const hash=file=>fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
 const report={syntheticOnly:true,cpuDiagnostic:false,layoutDiagnostic:diagnostic,measurement:'trusted pointer Event Timing through next presentation; readyMs includes driver waits and is not INP; observed frame gaps are not a refresh-rate guarantee; injected diagnostic styles never qualify for product acceptance',source:source,sourceBytes:Object.fromEntries(files.map(file=>[file,hash(path.join(source,file))])),fixtureBytes:hash(path.join(__dirname,'../../tests/m1/multi-reader-memory-fixture.js')),probeBytes:hash(__filename),desktopAdmission:desktopReadiness(),phases:[],errors:[]};
 const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));save();
 try{
  if(!report.desktopAdmission.eligible)throw Error('DESKTOP_UNAVAILABLE');
  const {home,usage,longIds}=await seedMemory(root),ledger=fs.readFileSync(path.join(usage,'statistics.json'));
  app=await electron.launch({executablePath:require('electron'),args:[path.join(source,'src/quota/main.js'),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota'),'--m1-fixture-root',home],timeout:60000});await isolatePointer(app);
  const page=await app.firstWindow();await page.waitForURL(/^file:/);await until(page,()=>window.usageData?.ready());
  if(diagnostic==='trace')layout=await require('./local-layout-profile').start(await page.context().newCDPSession(page));
  else if(diagnostic){
   let css;
   if(diagnostic==='retained-layout'){
    await page.evaluate(()=>{const main=document.getElementById('main');let previous=0;window.__benchmarkWidthObserver=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width>0&&width!==previous){previous=width;main.style.setProperty('--benchmark-content-width',width+'px');}});window.__benchmarkWidthObserver.observe(main);});
    css='#usage[hidden],#cost[hidden]{display:block!important;position:fixed;left:-100000px;top:0;width:var(--benchmark-content-width);visibility:hidden;pointer-events:none;contain:layout style;}#usage[hidden] [data-usage-page],#cost[hidden] [data-cost-page]{display:flex!important;}';
   }else css='#usage [data-usage-activity],#usage [data-usage-trend]{'+(diagnostic==='auto-sections'?'content-visibility:auto;contain-intrinsic-block-size:auto 1000px;overflow-clip-margin:32px;':'contain:layout style;')+'}';
   await page.addStyleTag({content:css});report.injectedCssSha256=crypto.createHash('sha256').update(css).digest('hex');
  }
  report.savedFacts=await page.evaluate(()=>{const rows=window.usageData.rows();return{dailyRows:rows.length,records:rows.reduce((n,row)=>n+row.records,0),totalTokens:rows.reduce((n,row)=>n+(Number.isFinite(row.totalTokens)?row.totalTokens:0),0),unknownTotals:rows.filter(row=>!Number.isFinite(row.totalTokens)).length,models:new Set(rows.map(row=>row.model)).size};});assert(report.savedFacts.records>=64000&&report.savedFacts.totalTokens>0,'empty or partial benchmark fixtures cannot pass');
  report.display=await app.evaluate(({screen,BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0],d=screen.getDisplayMatching(w.getBounds());return{refresh:d.displayFrequency,scale:d.scaleFactor,window:w.getBounds()};});
  page.on('pageerror',()=>report.errors.push('RENDERER_ERROR'));
  await page.evaluate(()=>{
   const state=window.__interactionBenchmark={phase:null,timeline:[],events:[],tasks:[],frames:[],previous:0},phaseAt=at=>state.timeline.findLast(row=>row.at<=at)?.name??null;
   new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.interactionId)state.events.push({phase:phaseAt(e.startTime),type:e.name,ms:e.duration,inputDelay:e.processingStart-e.startTime,processing:e.processingEnd-e.processingStart});}).observe({type:'event',durationThreshold:16});
   new PerformanceObserver(list=>{for(const e of list.getEntries())state.tasks.push({phase:phaseAt(e.startTime),ms:e.duration});}).observe({type:'longtask'});
   const frame=at=>{if(!window.__interactionBenchmark)return;if(state.previous&&state.phase)state.frames.push({phase:state.phase,ms:at-state.previous});state.previous=at;requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  const phase=async(name,action,ready)=>{
   await page.evaluate(({name,index})=>{performance.mark('local-perf:'+index+':'+name);const s=window.__interactionBenchmark;s.phase=name;s.began=performance.now();s.timeline.push({name,at:s.began});},{name,index:report.phases.length});
   await action();if(ready)await ready();const readyMs=await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-window.__interactionBenchmark.began)))));
   report.phases.push({name,readyMs});await settle(page);await page.waitForTimeout(150);save();
  };
  for(const [index,view]of ['usage','cost','sessions','usage','cost','usage','sessions'].entries())await phase('nav-'+index+'-'+view,()=>page.locator('[data-view="'+view+'"]').click(),()=>page.waitForFunction(view=>document.getElementById('main').dataset.currentView===view,view));
  await phase('all-sessions',()=>page.getByRole('tab',{name:'全部',exact:true}).click(),()=>until(page,()=>!!window.sessionsHost.list()&&!window.sessionsHost.get().loading));
  report.savedSessions=await page.evaluate(()=>window.sessionsHost.list().sessions.length);assert(report.savedSessions>=20000);
  await phase('open-long-reader',()=>page.evaluate(id=>{const h=window.sessionsHost;h.read(h.list().sessions.find(s=>s.id===id));},longIds[0]),()=>page.waitForFunction(()=>document.querySelectorAll('[data-rail-mark]').length===300));
  const scroller=page.locator('[data-reader-scroll]').first();await scroller.hover();
  await phase('scroll-long-reader',async()=>{const before=await scroller.evaluate(e=>e.scrollTop);for(let i=0;i<8;i++){await page.mouse.wheel(0,600);await page.waitForTimeout(60);}assert((await scroller.evaluate(e=>e.scrollTop))>before,'the actual scroll control must respond');});
  await phase('leave-long-reader',()=>page.locator('[data-reader-back] button').click(),()=>page.waitForFunction(()=>!document.querySelector('[data-reader-page]')));
  await phase('return-usage',()=>page.locator('[data-view="usage"]').click(),()=>page.waitForFunction(()=>document.getElementById('main').dataset.currentView==='usage'));
  report.interaction=await page.evaluate(()=>{const s=window.__interactionBenchmark;window.__interactionBenchmark=null;const summary=frames=>{const a=frames.map(f=>f.ms).sort((a,b)=>a-b);return{count:a.length,p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1),over16:a.filter(ms=>ms>16).length,over50:a.filter(ms=>ms>50).length};};return{events:s.events,tasks:s.tasks,frames:summary(s.frames),phaseFrames:Object.fromEntries([...new Set(s.frames.map(f=>f.phase))].map(phase=>[phase,summary(s.frames.filter(f=>f.phase===phase))]))};});
  if(layout){report.layout=await layout.stop();layout=null;}
  assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),ledger,'the workload must not modify saved facts');report.desktopEnd=desktopReadiness();report.ok=report.desktopEnd.eligible&&report.errors.length===0;report.measurementEligible=report.ok&&!diagnostic;save();assert(report.ok);console.log(JSON.stringify({ok:true,measurementEligible:report.measurementEligible,output:out}));
 }catch(error){report.ok=false;report.failure=/^[A-Z_]+$/.test(error.message)?error.message:'INTERACTION_WORKLOAD_FAILED';save();throw error;}
 finally{if(layout)try{report.layout=await layout.stop();save();}catch{report.traceIncomplete=true;save();}await app?.close();await cleanup(root);}
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={run};
