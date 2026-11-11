'use strict';
const { makeEngine } = require('./agent-install-engine');
const { plans } = require('./agent-install-plans');
const abort = new AbortController(); let started = false, lastProgress = 0;
process.on('disconnect', () => { abort.abort(); setTimeout(() => process.exit(1), 8000).unref(); });
process.on('message', async request => {
  if (request?.cancel === true) { abort.abort(); return; }
  if (started) return; started = true;
  try {
    if (!Object.hasOwn(plans, request?.agent) || !['check', 'install'].includes(request.action) || Object.hasOwn(request,'allowGoverned')) throw new Error('INSTALL_REQUEST_REJECTED');
    const report = value => { const now = Date.now(); if (!value.downloadedBytes || now - lastProgress >= 150) { lastProgress = now; process.send?.({ progress: value }); } };
    const engine = makeEngine({ root: request.root, environment: request.environment, report, signal: abort.signal });
    const result = request.action === 'check' ? await engine.inspect(request.agent, true) : await engine.install(request.agent);
    process.send?.({ result }, () => process.exit(0));
  } catch (error) { process.send?.({ errorCode: /^INSTALL_[A-Z_]{1,60}$/.test(error?.message) ? error.message : 'INSTALL_FAILED' }, () => process.exit(1)); }
});
