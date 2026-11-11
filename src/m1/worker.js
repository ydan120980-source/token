'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parentPort } = require('node:worker_threads');
const { AsyncLocalStorage } = require('node:async_hooks');
const { disableNetwork } = require('./policy');
const { scanSources, sourceStamp, refreshCache, survey } = require('./sources');
const { verifyProjection } = require('./native');
const { discover } = require('./discovery');
const {failure}=require('./collection-diagnostic');
const {ParseCache}=require('./parse-cache');
const auditScope=new AsyncLocalStorage(),detachedAudit={networkAttempts:0};
const networkAudit={get networkAttempts(){return (auditScope.getStore()||detachedAudit).networkAttempts;},set networkAttempts(value){(auditScope.getStore()||detachedAudit).networkAttempts=value;}};
function createExecutor() {
const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
disableNetwork(networkAudit);
// Lives as long as this worker: unchanged files are not read again.
const cache = { salt: null, files: new ParseCache(), fingerprints:new Map(), seen: new Set(), listing: null };
// Stamp of the last scan this worker handed over; the service echoes it back only
// after ingesting that scan, which proves the ledger already holds its outcomes.
let delivered = null;
// Change notifications replace the per-refresh directory walk while nothing moves.
// A full stamp still runs at least once a minute, so a missed event, a root that
// appears later or a platform without recursive watching costs at most that delay.
const FULL_CHECK_MS = 60000;
const watchers = new Map();
let dirty = true, checkedAt = 0;
function watch(roots) {
  const wanted = new Map();
  for (const root of Object.values(roots).flat()) {
    let stat; try { stat = fs.statSync(root); } catch { continue; }
    // A database root is watched through its directory so WAL writes count too.
    const target = stat.isDirectory() ? root : path.dirname(root);
    wanted.set(target, wanted.get(target) === true || stat.isDirectory());
  }
  for (const [target, watcher] of watchers) if (!wanted.has(target)) { watcher.close(); watchers.delete(target); }
  let complete = true;
  for (const [target, recursive] of wanted) {
    if (watchers.has(target)) continue;
    try {
      const watcher = fs.watch(target, { recursive, persistent: false }, () => { dirty = true; });
      watcher.on('error', () => { watcher.close(); watchers.delete(target); dirty = true; });
      watchers.set(target, watcher);
    } catch { complete = false; }
  }
  return complete;
}
function unchanged(stamp, reason) { return { unchanged: true, reason, stamp, audit: { ...audit } }; }
async function collectBuiltin(request,context,send) {
  for (const key of Object.keys(audit)) audit[key] = 0;
  if (request.maintenance) {
    context.stage='source-scan';
    const scan = await scanSources(request.roots, request.salt, audit);
    return { scan, native: { status: 'not-run-maintenance-preview' }, audit: { ...audit } };
  }
  context.stage='source-watch';
  const watched = watch(request.roots), synced = request.previousStamp !== null && request.previousStamp === delivered;
  if (watched && !dirty && synced && Date.now() - checkedAt < FULL_CHECK_MS) return unchanged(request.previousStamp, 'quiet');
  // Cleared before reading, so an event during this check marks the next one dirty.
  dirty = false; checkedAt = Date.now();
  context.stage='source-stamp';
  // One walk serves the stamp, the refresh and the scan below: the three used to
  // list every root and stat every file separately.
  const walk = survey(request.roots, audit);
  const stamp = sourceStamp(request.roots, request.salt, audit, walk);
  if (stamp === request.previousStamp) { delivered = stamp; return unchanged(stamp, 'stamp'); }
  // A transcript that only grew by lines without usage changes no parse outcome.
  context.stage='source-refresh';
  const refreshed = await refreshCache(request.roots, request.salt, audit, cache, walk);
  if (!refreshed.changed && !refreshed.failures && synced) { delivered = stamp; return unchanged(stamp, 'outcome'); }
  const report = { failures: 0 };
  context.stage='source-scan';
  const scan = await scanSources(request.roots, request.salt, audit, { cache, report, prepared: walk, borrowRecords: true });
  const records = Object.values(scan).flatMap(s => s.records);
  context.stage='native-verification';
  const native = await verifyProjection(records, request.dir, pid => send({ id: request.id, childPid: pid }));
  // A failed or timed-out file may succeed on retry without changing its stamp.
  delivered = report.failures || refreshed.failures ? null : stamp;
  if (!delivered) dirty = true;
  return { scan, native, audit: { ...audit }, stamp: delivered };
}
async function collect(request,context,send) {
  const result=await collectBuiltin(request,context,send); result.custom={};context.stage='custom-source';
  for(const source of Object.values(request.customSources || {})) if(source.enabled && !source.archived) {
    const adapter=require('./jsonl-adapter');adapter.definition(source.definition);adapter.checkRoots(source,[...(request.customReservedRoots || []),...Object.values(request.customSources).filter(other=>other.id!==source.id).flatMap(other=>other.reservedRoots || other.roots)],request.customProtectedDirs || [request.dir]);
    result.custom[source.id]=await adapter.scan(source,request.salt,source.files,audit);
  }
  if(Object.entries(result.custom).some(([id,value])=>JSON.stringify(value.files)!==JSON.stringify(request.customSources[id].files))) { const records=Object.values(result.custom).flatMap(value=>value.records); if(records.length) {context.stage='native-verification';await verifyProjection(records,request.dir,pid=>send({id:request.id,childPid:pid}));} }
  result.audit={...audit}; return result;
}
function executeRequest(request, send) {
  if(request.customTask) { const {action,source,previous,salt}=request.customTask, adapter=require('./jsonl-adapter');
    const run=async()=>action==='scan'?adapter.scan(source,salt,previous,audit):action==='sample'?adapter.sample(source,audit):adapter.fingerprint(source);
    return run().then(result=>send({id:request.id,result}),error=>send({id:request.id,...failure(error,'custom-source','SOURCE_PARSE_FAILED')}));
  }
  // Discovery runs in a worker of its own, so it never waits behind a collection.
  if (request.discover) {
    try { send({ id: request.id, discovery: {...discover(request.discover.defaults, request.discover.scope, request.discover.places),custom:require('./custom-sources').describe(request.discover.customSources)} }); }
    catch (error) { send({ id: request.id, ...failure(error,'discovery','DISCOVERY_FAILED') }); }
    return;
  }
  const context={stage:'collection'};
  return collect(request,context,send).then(result => send({ id: request.id, ...result }),
    error => { dirty = true; send({ id: request.id, ...failure(error,context.stage), audit: { ...audit } }); });
}
return { execute:(request,send)=>auditScope.run(audit,()=>executeRequest(request,send)), dispose() { for (const watcher of watchers.values()) watcher.close(); watchers.clear(); cache.files.clear(); cache.fingerprints.clear(); } };
}
if (require.main === module && parentPort) { const executor = createExecutor(); parentPort.on('message', request => { void executor.execute(request, value => parentPort.postMessage(value)); }); }
module.exports = { createExecutor };
