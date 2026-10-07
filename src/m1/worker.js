'use strict';
const { parentPort } = require('node:worker_threads');
const { disableNetwork } = require('./policy');
const { scanSources, sourceStamp } = require('./sources');
const { verifyProjection } = require('./native');
const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
disableNetwork(audit);
// Lives as long as this worker: unchanged files are not read again.
const cache = { salt: null, files: new Map(), seen: new Set() };
async function collect(request) {
  for (const key of Object.keys(audit)) audit[key] = 0;
  if (request.maintenance) {
    const scan = await scanSources(request.roots, request.salt, audit);
    return { scan, native: { status: 'not-run-maintenance-preview' }, audit: { ...audit } };
  }
  const stamp = sourceStamp(request.roots, request.salt, audit);
  if (stamp === request.previousStamp) return { unchanged: true, stamp, audit: { ...audit } };
  const report = { failures: 0 };
  const scan = await scanSources(request.roots, request.salt, audit, { cache, report });
  const records = Object.values(scan).flatMap(s => s.records);
  const native = await verifyProjection(records, request.dir, pid => parentPort.postMessage({ id: request.id, childPid: pid }));
  // A failed or timed-out file may succeed on retry without changing its stamp.
  return { scan, native, audit: { ...audit }, stamp: report.failures ? null : stamp };
}
parentPort.on('message', request => {
  collect(request).then(result => parentPort.postMessage({ id: request.id, ...result }),
    error => parentPort.postMessage({ id: request.id, error: /^[A-Z_]+$/.test(error.message) ? error.message : 'COLLECTION_FAILED', audit: { ...audit } }));
});
