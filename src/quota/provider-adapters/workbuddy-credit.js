'use strict';
const { fail, amount } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete = false, entitlementState = 'unknown', validUntil = null;
  if (amount(raw.total_capacity_size) === null || amount(raw.total_capacity_used) === null) fail();
  pools.push({ id: 'personal-aggregate', label: '有效与用尽资源包聚合 · 不含逐包有效期', scope: 'account', windows: [], balances: [{ id: 'credits', label: '当前周期积分', unit: 'credits', total: raw.total_capacity_size, used: raw.total_capacity_used, remainingMode: 'total-minus-used' }] });
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
