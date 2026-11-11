'use strict';
const { projectResources } = require('../../../src/quota/resource-contract');
const { fromCodex } = require('../../../src/quota/codex-resources');
const NOW = Date.parse('2026-10-19T03:00:00Z');
const iso = offset => new Date(NOW + offset).toISOString();
function raw(provider = 'workbuddy') {
  return { schemaVersion: 'AccountQuotaV2', provider, fetchedAt: iso(0), provenance: { kind: 'synthetic' },
    entitlement: { plan: 'Synthetic plan', state: 'active', observedAt: iso(0), validUntil: iso(86400000) },
    pools: [{ id: 'points', label: 'Synthetic points', scope: 'account', windows: [], balances: [] }] };
}
const cases = {
  proWeekly: () => fromCodex({ rateLimits: { primary: { usedPercent: 35, windowDurationMins: 10080, resetsAt: NOW / 1000 + 86400 } } }, iso(0), 'pro'),
  creditsOnly: () => fromCodex({ rateLimits: { credits: { hasCredits: true, unlimited: false, balance: '9007199254740993.125' } } }, iso(0), 'business'),
  packages: () => {
    const value = raw(); value.entitlement.validUntil = iso(-1);
    value.pools[0].balances = [
      { id: 'cycle', kind: 'subscription', unit: 'credits', total: '100', used: '99.9', remainingMode: 'total-minus-used', requiresEntitlement: true, availability: 'available', expiresAt: iso(3600000) },
      { id: 'gift', kind: 'promotional', unit: 'credits', remaining: '30', expiresAt: iso(-1) },
      { id: 'top-up', kind: 'purchased', unit: 'credits', remaining: '50', availability: 'available', expiresAt: iso(86400000) }
    ]; return projectResources(value);
  },
  groupedModels: () => {
    const value = raw('antigravity'); value.pools = [
      { id: 'gemini', label: 'Gemini Models', modelIds: ['gemini-flash', 'gemini-pro'], windows: [{ id: 'weekly', unit: 'percent', usedPercent: 100, durationMins: 10080, resetsAt: iso(-1) }], balances: [] },
      { id: '3p', label: 'Claude and GPT models', modelIds: ['claude-opus', 'gpt-oss'], windows: [{ id: 'weekly', unit: 'percent', usedPercent: 20, durationMins: 10080, resetsAt: iso(3600000) }], balances: [] }
    ]; return projectResources(value);
  }
};
module.exports = { NOW, iso, raw, cases };
