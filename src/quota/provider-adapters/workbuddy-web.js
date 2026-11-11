'use strict';
const { record, fail, amount } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete, entitlementState = 'unknown', validUntil = null;
  if (raw.code !== 0 || !Array.isArray(raw.data?.Packages) || raw.data.Packages.length > 100) fail();
  incomplete = true;
  for (const [index, item] of raw.data.Packages.entries()) {
    if (!record(item) || item.CapacityUnit !== 'credits' || amount(item.CycleTotalCapacity) === null || amount(item.CycleRemainCapacity) === null || item.CycleFrozenCapacity != null && amount(item.CycleFrozenCapacity) === null) fail();
    const balances = [{ id: 'credits', label: '周期积分 · 冻结部分单列', unit: 'credits', total: item.CycleTotalCapacity, remaining: item.CycleRemainCapacity }];
    if (item.CycleFrozenCapacity != null) balances.push({ id: 'frozen', label: '冻结积分（与余量不可相加）', unit: 'credits', remaining: item.CycleFrozenCapacity, availability: 'unavailable' });
    pools.push({ id: 'package-' + index, label: typeof item.SubscriptionPackageName === 'string' ? item.SubscriptionPackageName : '资源包 ' + (index + 1), scope: 'account', windows: [], balances });
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
