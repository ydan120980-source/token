'use strict';
const { compare } = require('./amount');
const FRESH_MS = 10 * 60000, CLOCK_SKEW_MS = 60000;
function observation(observedAt, account, now) {
  const time = typeof observedAt === 'string' ? Date.parse(observedAt) : NaN;
  if (!Number.isFinite(time) || time > now + CLOCK_SKEW_MS) return { state: 'missing', reason: 'invalid-time' };
  if (now - time > FRESH_MS) return { state: 'stale', reason: 'age' };
  if (account.status !== 'ready' || account.errorCode || account.busy) return { state: 'cached', reason: 'verification-required' };
  return { state: 'fresh', reason: null };
}
function meterState(item) {
  if (['disabled', 'unlimited', 'unavailable'].includes(item.availability)) return item.availability;
  if (item.issues.includes('INVALID_INTERVAL') || item.unit === 'unknown' || item.unit === 'currency' && !item.currency) return 'unknown';
  if (item.remaining !== null) return compare(item.remaining, '0') === 0 ? 'exhausted' : item.availability === 'available' ? 'available' : 'unknown';
  if (item.unit === 'percent' && item.usedPercent !== null) return item.usedPercent >= 100 ? 'exhausted' : 'available';
  return item.availability === 'available' ? 'available' : 'unknown';
}
function itemView(item, window, account, entitlement, now) {
  let state = meterState(item), freshness = observation(item.observedAt, account, now);
  const intervalKnown = !item.issues.includes('INVALID_INTERVAL');
  const expired = !window && intervalKnown && item.expiresAt !== null && Date.parse(item.expiresAt) <= now;
  const notYetValid = !window && intervalKnown && item.validFrom !== null && Date.parse(item.validFrom) > now;
  if (expired) state = 'expired';
  else if (notYetValid) state = 'not-yet-valid';
  else if (item.requiresEntitlement && entitlement.state === 'expired') state = 'unavailable';
  if (window && item.resetsAt !== null && Date.parse(item.resetsAt) <= now && freshness.state !== 'missing') freshness = { state: 'stale', reason: 'reset-passed' };
  if (item.requiresEntitlement && entitlement.verificationRequired && freshness.state !== 'missing') freshness = { state: 'stale', reason: 'entitlement-ended' };
  if (item.requiresEntitlement && entitlement.issues.length && freshness.state !== 'missing') freshness = { state: 'cached', reason: 'entitlement-invalid' };
  let currentlyUsable = null;
  if (['available', 'unlimited'].includes(state) && freshness.state === 'fresh' && !item.issues.length) currentlyUsable = true;
  if (['expired', 'not-yet-valid', 'disabled', 'unavailable', 'exhausted'].includes(state) && (freshness.state === 'fresh' || expired || notYetValid)) currentlyUsable = false;
  return { ...structuredClone(item), state, freshness, currentlyUsable };
}
function resourceView(resources, account, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error('INVALID_QUOTA_CLOCK');
  if (!resources) return null;
  const entitlement = structuredClone(resources.entitlement);
  entitlement.verificationRequired = entitlement.state !== 'expired' && entitlement.validUntil !== null && Date.parse(entitlement.validUntil) <= now;
  entitlement.freshness = observation(entitlement.observedAt, account, now);
  if (entitlement.verificationRequired && entitlement.freshness.state !== 'missing') entitlement.freshness = { state: 'stale', reason: 'entitlement-ended' };
  const pools = resources.pools.map(pool => ({ ...structuredClone(pool), windows: pool.windows.map(item => itemView(item, true, account, entitlement, now)), balances: pool.balances.map(item => itemView(item, false, account, entitlement, now)) }));
  const items = pools.flatMap(pool => [...pool.windows, ...pool.balances]);
  const coverage = { fresh: 0, stale: 0, cached: 0, missing: 0 };
  for (const item of items) coverage[item.freshness.state]++;
  return { ...structuredClone(resources), entitlement, pools, coverage, partial: resources.incomplete === true || items.length === 0 || entitlement.issues.length > 0 || items.some(item => item.issues.length > 0 || item.state === 'unknown'),
    // Observations remain observations: no total, max-percent or cross-pool
    // availability is manufactured from constraints or alternative balances.
    hasMeasurements: items.some(item => item.usedPercent !== null || item.remaining !== null || item.total !== null || item.used !== null || item.availability !== 'unknown') };
}
module.exports = { resourceView, FRESH_MS };
