'use strict';
// Synthetic desktop measurements only. No real home, account or configuration.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const { _electron: electron } = require('playwright');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');
const { fixtures } = require('../../tests/m1/fixtures');
const { cleanup, isolatePointer } = require('./ui-settle');
const option = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, p) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length*p)-1)] ?? null;
function seed(root, size) {
  const home = path.join(root, 'home'), fixture = fixtures(home), usage = path.join(root, 'usage'), store = new Store(usage, fixture.roots);
  const now = new Date(); now.setHours(12,0,0,0);
  for (let i = 0; i < size; i++) {
    const record = normalize('codex', { input_tokens:80, output_tokens:20, cached_input_tokens:0, cache_creation_input_tokens:0, reasoning_output_tokens:0, total_tokens:100 },
      { id:'performance-'+i, session:'session-'+i%500, time:now.valueOf()-Math.floor(i/Math.max(100,size/200))*86400000, model:'synthetic-'+i%100, entry:'cli' }, store.state.salt);
    store.state.records[record.id] = record;
  }
  store.state.sequence = 1; atomic(path.join(usage,'statistics.json'), store.state); store.setEnabled(false);
  return { home, usage };
}
async function memory(app) {
  return app.evaluate(({ app }) => {
    const processes = app.getAppMetrics().map(({ type, memory }) => ({ type, privateMiB:(memory.privateBytes || 0)/1024, workingMiB:memory.workingSetSize/1024 }));
    return { processes, privateMiB:processes.reduce((n,p)=>n+p.privateMiB,0), nonGpuMiB:processes.filter(p=>p.type!=='GPU').reduce((n,p)=>n+p.privateMiB,0), mainHeapMiB:process.memoryUsage().heapUsed/1048576 };
  });
}
async function run() {
  const repeats = Number(option('--repeats','10')), sizes = option('--rows','0,20000,100000').split(',').map(Number), soakMinutes = Number(option('--soak-minutes','0'));
  const memoryCount=Number(option('--memory-samples','1')),idleMs=Number(option('--idle-ms','3000'));
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 30 || sizes.some(n=>!Number.isInteger(n)||n<0||n>100000) || !Number.isFinite(soakMinutes) || soakMinutes<0 || soakMinutes>120) throw Error('Invalid benchmark options');
  if(!Number.isInteger(memoryCount)||memoryCount<1||memoryCount>12||!Number.isFinite(idleMs)||idleMs<0||idleMs>60000||soakMinutes>0&&sizes.length!==1)throw Error('Invalid sampling options');
  const output = path.resolve(option('--output', path.join(os.tmpdir(),'agent-usage-performance-'+Date.now())));
  fs.mkdirSync(output,{recursive:true});
  const report = { schemaVersion:'PerformanceBenchmarkV1', node:process.versions.node, mode:process.env.QUOTA_PACKAGED_EXE?'packaged-synthetic':'source-synthetic', osCache:'uncontrolled', samples:[], soak:[], summary:[], realAccountRequests:0 };
  const save = () => fs.writeFileSync(path.join(output,'performance.json'), JSON.stringify(report,null,2));
  console.log('Evidence: '+output);
  try { for (const size of sizes) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-perf-'));
    try {
      const {home,usage} = seed(root,size);
      for (let repeat=0;repeat<repeats;repeat++) {
        let app;
        try {
          const started=performance.now();
          app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE || require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:[path.resolve(option('--entry','src/quota/main.js'))]),'--usage-data-dir',usage,'--quota-data-dir',path.join(root,'quota-'+repeat),'--m1-fixture-root',home],timeout:60000});
          const page=await app.firstWindow(), errors=[];
          let profiler;
          if(process.argv.includes('--cpu-profile')){profiler=await page.context().newCDPSession(page);await profiler.send('Profiler.enable');await profiler.send('Profiler.start');}
          page.on('pageerror',e=>errors.push(e.message));
          await page.waitForURL(/^file:/); await page.waitForLoadState('load'); await isolatePointer(app);
          const shellMs=performance.now()-started;
          // Readiness is checked on the test side, never an async waitForFunction.
          // Return only a predicate, never the ledger through CDP: serializing a
          // full snapshot into the driver distorts both startup and renderer RSS.
          await page.waitForFunction(expected=>{const rows=window.usageData?.rows();return rows&&rows.reduce((n,r)=>n+r.totalTokens,0)===expected&&(window.usageData.ready?window.usageData.ready():window.previewUsage?.loading!==true);},size*100);
          if(size)await page.waitForFunction(()=>!!window.usageHost&&typeof window.usageHost.filters==='function');
          const dataMs=performance.now()-started;
          if(profiler){const {profile}=await profiler.send('Profiler.stop');fs.writeFileSync(path.join(output,'renderer-'+size+'-'+repeat+'.cpuprofile'),JSON.stringify(profile));const nodes=new Map(profile.nodes.map(n=>[n.id,n])),hits=new Map();for(const id of profile.samples||[]){const name=nodes.get(id)?.callFrame.functionName||'(anonymous)';hits.set(name,(hits.get(name)||0)+1);}console.log(JSON.stringify({cpuProfileTop:[...hits].sort((a,b)=>b[1]-a[1]).slice(0,15)}));await profiler.detach();}
          await app.evaluate(()=>{globalThis.performanceLoop=process.getBuiltinModule('node:perf_hooks').monitorEventLoopDelay({resolution:10});globalThis.performanceLoop.enable();});
          await wait(idleMs);
          const memorySamples=[];
          for(let i=0;i<memoryCount;i++){if(i)await wait(5000);memorySamples.push(await memory(app));}
          const timings=await page.evaluate(()=>performance.getEntriesByType('measure').filter(e=>e.name.startsWith('usage:')).map(e=>({name:e.name,ms:e.duration})));
          const ipc=await page.evaluate(()=>window.usageBridge.performanceState?.()||null);
          const sample={size,repeat,shellMs,dataMs,...memorySamples.at(-1),privateMiB:percentile(memorySamples.map(m=>m.privateMiB),.5),nonGpuMiB:percentile(memorySamples.map(m=>m.nonGpuMiB),.5),memorySamples,timings,ipc,errors};
          report.samples.push(sample);save();console.log(JSON.stringify(sample));
          if(soakMinutes>0 && repeat===repeats-1) {
            const refresh=async()=>{
              const state=await page.evaluate(async()=>{const s=await window.usageBridge.refresh();return {revision:s.snapshotRevision,error:s.error,sequence:s.snapshot?.sequence,rows:s.snapshot?.daily.length,totalTokens:s.snapshot?.daily.reduce((sum,row)=>sum+row.totalTokens,0)};});
              if(state.error)throw Error('Synthetic collection failed: '+state.error);
              return state;
            };
            for(let i=0;i<5;i++)await refresh();
            for(const view of ['cost','settings','sessions','sources','usage']){await page.locator('[data-view="'+view+'"]').click();await wait(500);}
            await page.waitForFunction(()=>window.sessionsUi.loaded);await wait(10000);
            report.soakWarmup={size,...await memory(app)};save();
            const soakStart=Date.now(),end=soakStart+soakMinutes*60000;let refreshes=0;
            while(Date.now()<end){const state=await refresh();refreshes++;if(refreshes%20===0){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());await wait(300);await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.restore();w.showInactive();w.webContents.invalidate();});}if(refreshes%5===0){await page.locator('[data-view="cost"]').click();await page.locator('[data-view="usage"]').click();}report.soak.push({size,refreshes,...state,elapsedMinutes:soakMinutes-(end-Date.now())/60000,...await memory(app)});save();await wait(15000);}
            report.soakCompleted={minutes:(Date.now()-soakStart)/60000,refreshes,ipc:await page.evaluate(()=>window.usageBridge.performanceState?.()||null)};save();
          }
          const loop=await app.evaluate(()=>{const h=globalThis.performanceLoop;h.disable();return {p95Ms:h.percentile(95)/1e6,maxMs:h.max/1e6};});sample.mainEventLoop=loop;save();
          if(errors.length)throw Error('Renderer exceptions during benchmark');
        }finally{if(app)await app.close();}
      }
      const samples=report.samples.filter(s=>s.size===size);
      report.summary.push({size,samples:samples.length,shellP95Ms:percentile(samples.map(s=>s.shellMs),.95),dataP95Ms:percentile(samples.map(s=>s.dataMs),.95),privateMedianMiB:percentile(samples.map(s=>s.privateMiB),.5),nonGpuMedianMiB:percentile(samples.map(s=>s.nonGpuMiB),.5)});save();
    }finally{await cleanup(root);}
  }
  } catch(error) { report.failed={message:error.message,at:new Date().toISOString()};save();throw error; }
  console.log(JSON.stringify(report.summary));
}
if(require.main===module)run().catch(e=>{console.error(e.stack);process.exitCode=1;});
module.exports={percentile,seed};
