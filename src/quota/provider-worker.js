'use strict';
const { readProvider } = require('./provider-http');
const { observeProvider } = require('./provider-observation');
// Serves the reads of one batch, each under its own id; the parent disconnects it when the batch is over.
const active = new Map();
const reply = (id, value) => { if (process.connected) process.send({ ...value, id }); };
const code = error => ({ errorCode: /^PROVIDER_[A-Z_]+$/.test(error?.message) ? error.message : 'PROVIDER_REQUEST_FAILED' });
process.on('disconnect', () => { for (const abort of active.values()) abort.abort(); if (!active.size) process.exit(); });
process.on('message', async message => {
  if (message?.cancel === true) { active.get(message.id)?.abort(); return; }
  if (message?.id === undefined || active.has(message.id)) return;
  const abort = new AbortController(), { id } = message; active.set(id, abort);
  try {
    if (message.operation === 'renew') reply(id, { credentials: await require('./provider-oauth').renewOAuth(message.adapter, message.credential, message.project, { signal: abort.signal }) });
    else reply(id, await observeProvider(message.adapter, message.credential, { signal: abort.signal, project: message.project }, { transport: readProvider, packages: require('./workbuddy-packages').readWorkBuddyPackages }));
  } catch (error) { reply(id, code(error)); }
  finally { message.credential = null; active.delete(id); if (!process.connected && !active.size) process.exit(); }
});
