'use strict';
const { projectResources, instant } = require('./resource-contract');
const { routes } = require('./provider-catalog');
const { adapters } = require('./provider-adapters');
const { record, fail } = require('./provider-adapter-helpers');

// Shared validation/normalization boundary. Provider-specific parsing is pure and
// resides with that built-in adapter; it never owns persistence or transport.
function fromProvider(adapter, raw, fetchedAt, options = {}) {
  const route = routes[adapter], implementation = Object.hasOwn(adapters, adapter) ? adapters[adapter] : null;
  if (!route || !implementation || !(implementation.rawArray ? Array.isArray(raw) : record(raw)) || !instant(fetchedAt)) fail();
  const { pools, plan, incomplete, entitlementState, validUntil } = implementation.parse(raw, options);
  if (!pools.some(pool => pool.windows.length || pool.balances.length) && !(implementation.emptyAllowed && raw.data.balances.length === 0)) throw Error('PROVIDER_QUOTA_UNAVAILABLE');
  const result = projectResources({ schemaVersion: 'AccountQuotaV2', provider: route.provider, fetchedAt, incomplete, provenance: { kind: route.provenance }, entitlement: { plan, state: entitlementState, validUntil }, pools });
  if (!result) fail();
  return result;
}
module.exports = { fromProvider };
