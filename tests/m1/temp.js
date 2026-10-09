'use strict';
const fs = require('node:fs');
const { setTimeout: delay } = require('node:timers/promises');
// Windows releases a worker's file handles asynchronously: for a few milliseconds
// after `service.close()` resolves, a fixture directory can still be locked and
// `fs.rmSync` fails with EPERM. That is a scheduling race, not a leak, so retry
// briefly instead of failing a test on it.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
async function remove(dir, budgetMs = 5000) {
  const start = Date.now();
  for (let attempt = 1; ; attempt++) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return attempt; }
    catch (error) {
      if (!TRANSIENT.has(error.code) || Date.now() - start > budgetMs) throw error;
      await delay(Math.min(5 * attempt, 100));
    }
  }
}
module.exports = { remove };
