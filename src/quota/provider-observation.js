'use strict';
const { adapters } = require('./provider-adapters');
const { fromProvider } = require('./provider-resources');

/**
 * Worker-only composition. Transports are injected by the existing IPC child;
 * adapters cannot choose a URL or receive persistence/encryption capabilities.
 * identityContext is internal and must not enter the normalized resource/cache.
 * @param {string} adapter
 * @param {string} credential
 * @param {{signal: AbortSignal, project?: unknown}} options
 * @param {{transport: Function, packages: Function}} dependencies
 */
async function observeProvider(adapter, credential, { signal, project }, { transport, packages }) {
  const implementation = Object.hasOwn(adapters, adapter) ? adapters[adapter] : null;
  const observation = implementation?.read
    ? await implementation.read({ adapter, credential, signal, project, transport, packages })
    : { raw: await transport(adapter, credential, { signal, project }) };
  return {
    resources: fromProvider(adapter, observation.raw, new Date().toISOString(), { completePackages: observation.completePackages === true }),
    identityContext: observation.identityContext
  };
}
module.exports = { observeProvider };
