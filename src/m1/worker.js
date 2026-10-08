'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parentPort } = require('node:worker_threads');
const { disableNetwork } = require('./policy');
const { scanSources, sourceStamp, refreshCache } = require('./sources');
const { verifyProjection } = require('./native');
const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
disableNetwork(audit);
// Lives as long as this worker: unchanged files are not read again.
const cache = { salt: null, files: new Map(), seen: new Set(), listing: null };
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
async function collect(request) {
  for (const key of Object.keys(audit)) audit[key] = 0;
  if (request.maintenance) {
    const scan = await scanSources(request.roots, request.salt, audit);
    return { scan, native: { status: 'not-run-maintenance-preview' }, audit: { ...audit } };
  }
  const watched = watch(request.roots), synced = request.previousStamp !== null && request.previousStamp === delivered;
  if (watched && !dirty && synced && Date.now() - checkedAt < FULL_CHECK_MS) return unchanged(request.previousStamp, 'quiet');
  // Cleared before reading, so an event during this check marks the next one dirty.
  dirty = false; checkedAt = Date.now();
  const stamp = sourceStamp(request.roots, request.salt, audit);
  if (stamp === request.previousStamp) { delivered = stamp; return unchanged(stamp, 'stamp'); }
  // A transcript that only grew by lines without usage changes no parse outcome.
  const refreshed = await refreshCache(request.roots, request.salt, audit, cache);
  if (!refreshed.changed && !refreshed.failures && synced) { delivered = stamp; return unchanged(stamp, 'outcome'); }
  const report = { failures: 0 };
  const scan = await scanSources(request.roots, request.salt, audit, { cache, report });
  const records = Object.values(scan).flatMap(s => s.records);
  const native = await verifyProjection(records, request.dir, pid => parentPort.postMessage({ id: request.id, childPid: pid }));
  // A failed or timed-out file may succeed on retry without changing its stamp.
  delivered = report.failures || refreshed.failures ? null : stamp;
  if (!delivered) dirty = true;
  return { scan, native, audit: { ...audit }, stamp: delivered };
}
parentPort.on('message', request => {
  collect(request).then(result => parentPort.postMessage({ id: request.id, ...result }),
    error => { dirty = true; parentPort.postMessage({ id: request.id, error: /^[A-Z_]+$/.test(error.message) ? error.message : 'COLLECTION_FAILED', audit: { ...audit } }); });
});
