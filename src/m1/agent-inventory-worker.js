'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { disableNetwork } = require('./policy');
const { scanInventory } = require('./agent-inventory');
const audit = { networkAttempts: 0 }; disableNetwork(audit);
try { parentPort.postMessage({ result: scanInventory(workerData) }); }
catch { parentPort.postMessage({ error: 'INVENTORY_FAILED' }); }
