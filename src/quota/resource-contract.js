'use strict';
const { amount, subtract } = require('./amount');
const PROVIDERS = new Set(Object.keys(require('../m1/agent-catalog').agents));
const AVAILABILITY = ['unknown', 'available', 'unavailable', 'disabled', 'unlimited'];
const UNITS = ['percent', 'credits', 'currency', 'tokens', 'requests', 'unknown'];
const MAX_POOLS = 100, MAX_ITEMS = 200;
const ISSUES = ['UNKNOWN_UNIT', 'MISSING_CURRENCY', 'INVALID_AMOUNT', 'INVALID_PERCENT', 'INVALID_TIME', 'INVALID_DURATION', 'AMOUNT_CONFLICT', 'INVALID_INTERVAL'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const oneOf = (value, choices, fallback) => choices.includes(value) ? value : fallback;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\x00-\x1f]/.test(value) ? value : null;
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : null;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function normalizeMeter(raw, issues) {
  const unit = oneOf(raw.unit, UNITS, 'unknown');
  if (unit === 'unknown') issues.add('UNKNOWN_UNIT');
  const currency = typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : null;
  if (unit === 'currency' && !currency) issues.add('MISSING_CURRENCY');
  const quantities = {};
  for (const key of ['total', 'used', 'remaining', 'reserved']) {
    quantities[key] = amount(raw[key]);
    if (raw[key] !== undefined && raw[key] !== null && quantities[key] === null) issues.add('INVALID_AMOUNT');
  }
  const remainingMode = oneOf(raw.remainingMode, ['reported-only', 'total-minus-used', 'total-minus-used-minus-reserved'], 'reported-only');
  let remainingSource = quantities.remaining === null ? null : oneOf(raw.remainingSource, ['reported', 'total-minus-used', 'total-minus-used-minus-reserved'], 'reported');
  // The adapter must explicitly declare the provider's subtraction semantics.
  // A missing/invalid reported remainder never silently invokes this derivation.
  if (raw.remaining === undefined && remainingMode !== 'reported-only' && unit !== 'unknown' && (unit !== 'currency' || currency)) {
    const parts = remainingMode === 'total-minus-used' ? [quantities.used] : [quantities.used, quantities.reserved];
    quantities.remaining = subtract(quantities.total, ...parts);
    if (quantities.remaining !== null) remainingSource = remainingMode;
    else if (quantities.total !== null && parts.every(v => v !== null)) issues.add('AMOUNT_CONFLICT');
  }
  const usedPercent = nonnegative(raw.usedPercent);
  if (raw.usedPercent !== undefined && raw.usedPercent !== null && usedPercent === null) issues.add('INVALID_PERCENT');
  return { unit, currency: unit === 'currency' ? currency : null, ...quantities, remainingMode, remainingSource, usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent) };
}
function normalizeItem(raw, fetchedAt, window) {
  const issues = new Set(Array.isArray(raw.issues) ? raw.issues.filter(v => ISSUES.includes(v)) : []);
  const meter = normalizeMeter(raw, issues);
  for (const field of window ? ['observedAt', 'resetsAt'] : ['observedAt', 'validFrom', 'expiresAt']) if (raw[field] !== undefined && raw[field] !== null && !instant(raw[field])) issues.add('INVALID_TIME');
  const shared = { id: raw.id, label: text(raw.label), ...meter, availability: oneOf(raw.availability, AVAILABILITY, 'unknown'), requiresEntitlement: raw.requiresEntitlement === true,
    observedAt: raw.observedAt === undefined ? fetchedAt : instant(raw.observedAt), issues: [...issues].sort() };
  if (!window) {
    const validFrom = instant(raw.validFrom), expiresAt = instant(raw.expiresAt);
    if (validFrom && expiresAt && expiresAt <= validFrom) shared.issues = [...new Set([...shared.issues, 'INVALID_INTERVAL'])].sort();
    return { ...shared, kind: oneOf(raw.kind, ['subscription', 'purchased', 'promotional', 'unknown'], 'unknown'), validFrom, expiresAt };
  }
  const durationMins = nonnegative(raw.durationMins);
  if (raw.durationMins !== undefined && raw.durationMins !== null && (durationMins === null || durationMins === 0)) shared.issues = [...new Set([...shared.issues, 'INVALID_DURATION'])].sort();
  return { ...shared, role: oneOf(raw.role, ['primary', 'secondary', 'other'], 'other'), cadence: oneOf(raw.cadence, ['rolling', 'fixed', 'calendar', 'unknown'], 'unknown'),
    durationMins: durationMins > 0 ? durationMins : null, resetsAt: instant(raw.resetsAt) };
}
function validList(list, maximum) {
  return Array.isArray(list) && list.length <= maximum && list.every(v => record(v) && identifier(v.id)) && new Set(list.map(v => v.id)).size === list.length;
}
function projectResources(raw) {
  if (!record(raw) || raw.schemaVersion !== 'AccountQuotaV2' || !PROVIDERS.has(raw.provider)) return null;
  // Desktop WorkBuddy pagination retains each returned package as its own pool.
  // Other providers retain their original bounds; no cross-pool aggregation.
  const maxPools = raw.provider === 'workbuddy' ? 1000 : MAX_POOLS, maxItems = raw.provider === 'workbuddy' ? 2000 : MAX_ITEMS;
  if (!validList(raw.pools, maxPools)) return null;
  if (!raw.pools.every(pool => validList(pool.windows, MAX_ITEMS) && validList(pool.balances, MAX_ITEMS))) return null;
  if (raw.pools.some(pool => pool.modelIds !== undefined && (!Array.isArray(pool.modelIds) || pool.modelIds.length > 100 || !pool.modelIds.every(identifier)))) return null;
  if (raw.pools.reduce((n, pool) => n + pool.windows.length + pool.balances.length, 0) > maxItems) return null;
  const fetchedAt = instant(raw.fetchedAt), entitlement = record(raw.entitlement) ? raw.entitlement : {}, provenance = record(raw.provenance) ? raw.provenance : {};
  const entitlementIssues = new Set(Array.isArray(entitlement.issues) ? entitlement.issues.filter(v => v === 'INVALID_TIME') : []);
  for (const field of ['observedAt', 'validUntil', 'cancelAt']) if (entitlement[field] !== undefined && entitlement[field] !== null && !instant(entitlement[field])) entitlementIssues.add('INVALID_TIME');
  return { schemaVersion: 'AccountQuotaV2', provider: raw.provider, fetchedAt, incomplete: raw.incomplete === true,
    provenance: { kind: oneOf(provenance.kind, ['official-cli', 'official-api', 'undocumented-api', 'passive', 'legacy-cache', 'synthetic', 'unknown'], 'unknown'), version: text(provenance.version) },
    entitlement: { plan: text(entitlement.plan), state: oneOf(entitlement.state, ['active', 'trial', 'grace', 'expired', 'unknown'], 'unknown'), observedAt: instant(entitlement.observedAt), validUntil: instant(entitlement.validUntil), cancelAt: instant(entitlement.cancelAt), issues: [...entitlementIssues] },
    pools: raw.pools.map(pool => ({ id: pool.id, label: text(pool.label), scope: oneOf(pool.scope, ['account', 'workspace', 'project', 'unknown'], 'unknown'), modelIds: [...new Set(pool.modelIds || [])].sort(),
      windows: pool.windows.map(v => normalizeItem(v, fetchedAt, true)), balances: pool.balances.map(v => normalizeItem(v, fetchedAt, false)) })),
    resetCredits: Number.isSafeInteger(raw.resetCredits) && raw.resetCredits >= 0 ? raw.resetCredits : null };
}
module.exports = { projectResources, instant, text, identifier };
