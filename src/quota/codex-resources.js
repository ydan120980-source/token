'use strict';
const { projectQuota, projectCachedQuota } = require('./contract');
const { projectResources, instant, identifier } = require('./resource-contract');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function legacyWindow(window) {
  return { id: window.kind, role: window.kind, unit: 'percent', usedPercent: window.usedPercent, durationMins: window.durationMins, resetsAt: window.resetsAt, requiresEntitlement: true };
}
function createPools(windows) {
  const pools = new Map();
  for (const window of windows) {
    if (!identifier(window.bucket)) return null;
    if (!pools.has(window.bucket)) pools.set(window.bucket, { id: window.bucket, label: window.name, scope: 'unknown', windows: [], balances: [] });
    pools.get(window.bucket).windows.push(legacyWindow(window));
  }
  return pools;
}
function fromLegacy(quota, plan = null) {
  let saved;
  try { saved = projectCachedQuota(quota); } catch { return null; }
  if (!saved) return null;
  const pools = createPools(saved.windows);
  if (!pools) return null;
  return projectResources({ schemaVersion: 'AccountQuotaV2', provider: 'codex', fetchedAt: saved.fetchedAt,
    provenance: { kind: 'legacy-cache' }, entitlement: { plan, state: 'unknown', observedAt: saved.fetchedAt }, pools: [...pools.values()], resetCredits: saved.resetCredits });
}
function fromCodex(response, fetchedAt, plan = null) {
  if (!record(response)) throw new Error('CODEX_PROTOCOL_INVALID');
  if (!Object.hasOwn(response, 'rateLimits') && !Object.hasOwn(response, 'rateLimitsByLimitId')) throw new Error('CODEX_PROTOCOL_INVALID');
  const byId = response.rateLimitsByLimitId;
  if (byId !== undefined && byId !== null && !record(byId)) throw new Error('CODEX_PROTOCOL_INVALID');
  if (response.rateLimits !== undefined && response.rateLimits !== null && !record(response.rateLimits)) throw new Error('CODEX_PROTOCOL_INVALID');
  const entries = byId && Object.keys(byId).length ? Object.entries(byId) : record(response.rateLimits) ? [['codex', response.rateLimits]] : [];
  if (entries.length > 100) throw new Error('CODEX_PROTOCOL_LIMIT');
  if (entries.some(([id, bucket]) => !identifier(id) || !record(bucket))) throw new Error('CODEX_PROTOCOL_INVALID');
  for (const [, bucket] of entries) for (const role of ['primary', 'secondary', 'credits']) if (bucket[role] !== undefined && bucket[role] !== null && !record(bucket[role])) throw new Error('CODEX_PROTOCOL_INVALID');
  const legacy = projectQuota(response, fetchedAt), pools = createPools(legacy.windows);
  if (!pools) throw new Error('CODEX_PROTOCOL_INVALID');
  for (const [id, bucket] of entries) {
    if (!pools.has(id)) pools.set(id, { id, label: bucket.limitName || id, scope: 'unknown', windows: [], balances: [] });
    for (const window of pools.get(id).windows) {
      const source = bucket[window.role];
      window.usedPercent = source.usedPercent; window.durationMins = source.windowDurationMins;
      if (source.resetsAt !== undefined && source.resetsAt !== null && window.resetsAt === null) window.issues = ['INVALID_TIME'];
    }
    if (record(bucket.credits)) pools.get(id).balances.push({ id: 'purchased-credits', kind: 'purchased', unit: 'credits', remaining: bucket.credits.balance,
      availability: bucket.credits.unlimited === true ? 'unlimited' : bucket.credits.hasCredits === false ? 'unavailable' : bucket.credits.hasCredits === true ? 'available' : 'unknown' });
  }
  const result = projectResources({ schemaVersion: 'AccountQuotaV2', provider: 'codex', fetchedAt, provenance: { kind: 'official-cli' },
    // planType proves a label, not active membership or an expiry date.
    entitlement: { plan, state: 'unknown', observedAt: fetchedAt }, pools: [...pools.values()], resetCredits: legacy.resetCredits });
  if (!result || !instant(fetchedAt)) throw new Error('CODEX_PROTOCOL_INVALID');
  return result;
}
function toLegacy(resources) {
  if (!resources) return null;
  return { schemaVersion: 'AccountQuotaV1', fetchedAt: resources.fetchedAt,
    windows: resources.pools.flatMap(pool => pool.windows.filter(window => window.unit === 'percent' && ['primary', 'secondary'].includes(window.role)).map(window => ({
      bucket: pool.id, name: pool.label, kind: window.role, usedPercent: window.usedPercent, remainingPercent: window.remainingPercent, durationMins: window.durationMins, resetsAt: window.resetsAt }))), resetCredits: resources.resetCredits };
}
function restoreQuota(raw, plan) {
  const resources = raw?.schemaVersion === 'AccountQuotaV1' ? fromLegacy(raw, plan) : projectResources(raw);
  if (resources?.provider !== 'codex') return null;
  return resources;
}
module.exports = { fromCodex, fromLegacy, toLegacy, restoreQuota };
