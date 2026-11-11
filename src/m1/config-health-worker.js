'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { disableNetwork } = require('./policy');
const { scanConfigHealth } = require('./config-health');
const audit = { networkAttempts: 0 }; disableNetwork(audit);
try { parentPort.postMessage({ result: scanConfigHealth(workerData.selection, [workerData.agent]) }); }
catch { parentPort.postMessage({ error: 'CONFIG_CHECK_FAILED' }); }
