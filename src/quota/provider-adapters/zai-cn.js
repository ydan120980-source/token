'use strict';
const { record, fail, percent } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan, incomplete = false, entitlementState = 'unknown', validUntil = null;
  if (raw.success === false || raw.code !== undefined && raw.code !== 200 && raw.code !== 0 || !record(raw.data) || !Array.isArray(raw.data.limits) || raw.data.limits.length > 100) fail();
  plan = typeof raw.data.planName === 'string' ? raw.data.planName : null;
  for (const [index, meter] of raw.data.limits.entries()) {
    if (!record(meter)) fail();
    if (!['TOKENS_LIMIT', 'CREDIT_LIMIT', 'TIME_LIMIT'].includes(meter.type)) { incomplete = true; continue; }
    if (percent(meter.percentage) === null) fail();
    const resetsAt = typeof meter.nextResetTime === 'number' && Number.isSafeInteger(meter.nextResetTime) && meter.nextResetTime > 0 && meter.nextResetTime <= 8640000000000000 ? new Date(meter.nextResetTime).toISOString() : null;
    pools.push({ id: 'limit-' + index, label: meter.type, scope: 'account', windows: [{ id: 'window', label: meter.type, unit: 'percent', usedPercent: meter.percentage, resetsAt }], balances: [] });
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
