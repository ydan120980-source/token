'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { EventEmitter } = require('node:events');
const { Service } = require('./service');
const { createExecutor } = require('./worker');
const { selectSnapshot } = require('./local-snapshot');
const { selectSessions } = require('./session-list');
const { PriceSyncService } = require('./price-sync-service');
const { costExport } = require('./cost-export');
const { pack } = require('./snapshot-codec');
const { requestError } = require('./statistics-errors');
const { STORE_COMMANDS, CUSTOM_COMMANDS, COMMANDS, commandMode, validRequest } = require('./statistics-contract');
const { OperationMetrics } = require('./operation-metrics');
const metrics = new OperationMetrics(['pack', 'sessionIndex'], ['revisionChanges', 'packedHits', 'sessionHits']);
require('./policy').disableNetwork({networkAttempts:0});
let service, priceSync, tail = Promise.resolve(), closing = false, started = false, source, revision = workerData.initialRevision;
let sessionIndex;
let packedSource,packedBytes;
let deltaBytes,deltaBaseRevision;
// The collector runs inside the ledger owner: no second resident ledger or parse worker.
class LocalCollector extends EventEmitter {
  constructor() { super(); this.executor=createExecutor(); this.pending=new Set(); this.closed=false; }
  postMessage(request) {
    const children=new Set();
    const p=Promise.resolve().then(()=>this.executor.execute(request,value=>{
      if(value.childPid){children.add(value.childPid);parentPort.postMessage({event:'child',pid:value.childPid});}
      if(!this.closed)this.emit('message',value);
    })).catch(error=>{if(!this.closed)this.emit('error',error);}).finally(()=>{this.pending.delete(p);for(const pid of children)parentPort.postMessage({event:'childDone',pid});});
    this.pending.add(p);
  }
  async terminate() { this.closed=true;this.executor.dispose();await Promise.all([...this.pending]);this.emit('exit',0); }
}
function metadata() {
  const store=service.store;
  return {settings:store.settings,defaults:store.defaults,catalog:store.catalog(),statuses:store.state.statuses,
    customSources:Object.fromEntries(Object.entries(store.state.customSources||{}).map(([id,s])=>[id,{id,roots:s.roots,reservedRoots:s.reservedRoots,enabled:s.enabled,archived:s.archived}])),
    checkedAt:service.checkedAt,collecting:Boolean(service.current),customBusy:Boolean(service.customBusy),maintenance:service.maintenance?{summary:service.maintenance.summary}:null,
    priceSync:priceSync?.state()};
}
function notify() { if(!closing)parentPort.postMessage({event:'update',meta:metadata()}); }
function state(known,packed=false) {
  const value=service.get();
  if(source!==value.snapshot){
    const previous=source,base=revision;source=value.snapshot;revision++;packedSource=null;packedBytes=null;sessionIndex=null;deltaBytes=null;deltaBaseRevision=null;
    if(previous){const delta=require('./snapshot-delta').snapshotDelta(previous,source,base,service.store.catalog());if(delta){deltaBytes=metrics.measure('pack',()=>new TextEncoder().encode(JSON.stringify(delta)).buffer);deltaBaseRevision=base;}}
    metrics.count('revisionChanges');
  }
  const unchanged=Number.isSafeInteger(known)&&known===revision;
  if(packed){
    const delta=!unchanged&&deltaBytes&&known===deltaBaseRevision;
    if(!unchanged&&!delta&&packedSource!==source){packedBytes=metrics.measure('pack',()=>new TextEncoder().encode(JSON.stringify(pack(selectSnapshot(source,service.store.catalog())))).buffer);packedSource=source;}
    if(unchanged)metrics.count('packedHits');
    return {...value,snapshot:null,snapshotBytes:unchanged?null:(delta?deltaBytes:packedBytes).slice(0),snapshotRevision:revision};
  }
  return {...value,snapshot:unchanged?null:selectSnapshot(source,service.store.catalog()),snapshotRevision:revision};
}
function counts(selection={}) {
  const {agent='all',date=service.store.snapshot().today,model='all'}=selection;
  if(typeof agent!=='string'||agent!=='all'&&!service.store.catalog()[agent]||!/^\d{4}-\d{2}-\d{2}$/.test(date)||typeof model!=='string'||model.length>180)throw Error('SESSION_SELECTION_INVALID');
  const snapshot=service.store.snapshot();
  if(sessionIndex?.snapshot!==snapshot)sessionIndex={snapshot,views:new Map()};
  const key=JSON.stringify([date,model]);
  if(!sessionIndex.views.has(key)){
    const agents=metrics.measure('sessionIndex',()=>{
      const records=service.store.records(),selected=model==='all'?null:new Set(records.filter(r=>r.model===model).map(r=>r.sessionKey)),groups=new Map(),dates=new Map(),day=require('./usage-math').localDay;
      for(const r of records){
        if(!r.sessionKey||selected&&!selected.has(r.sessionKey))continue;
        let local=dates.get(r.timestamp);if(!local){local=day(snapshot.timezone,r.timestamp);if(dates.size<4096)dates.set(r.timestamp,local);}
        if(local===date)groups.set(r.sessionKey,r.agent);
      }
      const result={};for(const id of groups.values())result[id]=(result[id]||0)+1;return result;
    });
    if(sessionIndex.views.size>=8)sessionIndex.views.delete(sessionIndex.views.keys().next().value);
    sessionIndex.views.set(key,agents);
  }else metrics.count('sessionHits');
  const all=sessionIndex.views.get(key),agents=agent==='all'?all:Object.hasOwn(all,agent)?{[agent]:all[agent]}:{};
  return {count:Object.values(agents).reduce((n,value)=>n+value,0),agents,date,model};
}
service=new Service(workerData.dir,workerData.roots,notify,workerData.places,()=>new LocalCollector());
service.custom.protectedDirs.push(...workerData.protectedDirs);
service.scheduledRefresh=()=>{tail=tail.then(()=>{if(!closing)return service.refresh();}).catch(()=>{});};
priceSync=new PriceSyncService(service.store,notify,workerData.offline);
const commands={
  get:state,getPacked:known=>state(known,true),refresh:async maintenance=>{const p=service.refresh(maintenance);notify();await p;return maintenance?service.maintenance?.summary:null;},
  enabled:async value=>{await service.setEnabled(value);if(value&&service.current)await service.current.catch(()=>{});},interval:value=>{service.setRefreshInterval(value);},subscription:(agent,fee)=>{service.setSubscription(agent,fee);},
  discover:()=>service.discover(),applyMaintenance:id=>service.applyMaintenance(id),sessions:selection=>selectSessions(service.store.sessionList(selection),service.store.catalog()),sessionsPacked:selection=>service.store.sessionListPacked(selection),sessionSummary:counts,
  exportCost:request=>costExport(selectSnapshot(service.store.snapshot(),service.store.catalog()),request),
  exportProjects:selection=>{const view=service.store.workbench(selection);return {csv:require('./workbench').csv(view),rows:view.projects.length};},
  serializeStatistics:payload=>{const value=selectSnapshot(payload,service.store.catalog());return {json:JSON.stringify(value,null,2),rows:value.daily.length};},
  attention:()=>{const view=service.store.workbench({period:'total',project:'all'});return {sources:[],issues:view.issues,omittedIssues:view.omittedIssues,budgetOverview:view.budgetOverview};},
  diagnostics:()=>{const {heapUsed,heapTotal,external,arrayBuffers}=process.memoryUsage();return {storage:service.store.diagnostics(),projection:metrics.state(),reader:require('./transcript-tasks').metrics(),memory:{heapUsed,heapTotal,external,arrayBuffers}};},
  customCheck:token=>{service.custom.get(token);return true;},
  priceStart:()=>{priceSync.start();},priceSync:()=>priceSync.sync(),priceAuto:value=>priceSync.setEnabled(value),
  start:async()=>{if(started||closing)return;started=true;if(service.store.settings.enabled){const task=service.refresh();notify();await task;}priceSync.start();},
  close:async()=>{closing=true;await Promise.all([service.close(),priceSync.close(),require('./transcript-tasks').close()]);}
};
for(const name of STORE_COMMANDS)commands[name]=(...args)=>service.store[name](...args);
for(const name of CUSTOM_COMMANDS)commands['custom:'+name]=(...args)=>service.custom[name](...args);
if(Object.keys(commands).sort().join(',')!==Object.keys(COMMANDS).sort().join(','))throw Error('STATISTICS_COMMAND_REJECTED');
parentPort.on('message',request=>{
  if(!Number.isSafeInteger(request?.id))return;
  if(!validRequest(request)){parentPort.postMessage({id:request.id,error:'STATISTICS_COMMAND_REJECTED'});return;}
  const run=async()=>{
    try { if(closing&&request.command!=='close')throw Error('STATISTICS_CLOSED');const value=await commands[request.command](...request.args);parentPort.postMessage({id:request.id,value,meta:metadata()},value?.snapshotBytes?[value.snapshotBytes]:value?.sessionBytes?[value.sessionBytes]:[]); }
    catch(error){parentPort.postMessage({id:request.id,error:requestError(error),meta:metadata()});}
    if(request.command==='close')parentPort.close();
  };
  // Close is allowed to cancel the current operation rather than wait behind it.
  if(commandMode(request.command)!=='mutation')void run();else tail=tail.then(run,run);
});
// Only an initialized application resumes its existing schedules after a crash.
// Initial startup still waits for the main window's explicit start command.
if(workerData.resumeStarted)tail=tail.then(commands.start).catch(()=>notify());
parentPort.postMessage({event:'ready',meta:metadata()});
