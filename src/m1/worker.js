'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { disableNetwork } = require('./policy');
const { scanSources } = require('./sources');
const { verifyProjection } = require('./native');
const audit = { reads: 0, sourceWrites: 0, authenticationReads: 0, networkAttempts: 0 };
disableNetwork(audit);
(async () => {
  const scan = await scanSources(workerData.roots, workerData.salt, audit);
  const records = Object.values(scan).flatMap(s => s.records);
  const native = workerData.maintenance ? { status: 'not-run-maintenance-preview' } : await verifyProjection(records, workerData.dir, pid => parentPort.postMessage({ childPid: pid }));
  parentPort.postMessage({ scan, native, audit });
})().catch(error => parentPort.postMessage({ error: /^[A-Z_]+$/.test(error.message) ? error.message : 'COLLECTION_FAILED', audit }));
