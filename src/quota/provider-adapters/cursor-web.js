'use strict';
const { record, fail, percent, cents } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan, incomplete, entitlementState = 'unknown', validUntil = null;
  incomplete = true; plan = raw.membershipType;
  const individual = record(raw.individualUsage) ? raw.individualUsage : {}, planUsage = record(individual.plan) ? individual.plan : {};
  for (const [id, field, label] of [['auto', 'autoPercentUsed', 'Auto / Composer 服务端比例'], ['api', 'apiPercentUsed', '其他模型服务端比例'], ['reported-total', 'totalPercentUsed', '服务端总体口径（与分池不可相加）']]) {
    if (planUsage[field] === undefined || planUsage[field] === null) continue; if (percent(planUsage[field]) === null) fail();
    pools.push({ id, label, scope: 'account', windows: [{ id: 'reported', unit: 'percent', usedPercent: planUsage[field], resetsAt: raw.billingCycleEnd }], balances: [] });
  }
  for (const [id, meter, scope, label] of [['plan-budget', individual.plan, 'account', '接口金额约束（历史口径）'], ['personal-cap', individual.overall, 'account', '个人消费上限约束'], ['team-pool', raw.teamUsage?.pooled, 'workspace', '共享团队约束（不可与个人约束相加）'], ['on-demand', individual.onDemand, 'account', '按需消费上限余量 · 非预付余额']]) {
    if (!record(meter) || meter.used == null && meter.limit == null) continue;
    const used = meter.used == null ? null : cents(meter.used), total = meter.limit == null ? null : cents(meter.limit);
    if (meter.used != null && used === null || meter.limit != null && total === null) fail();
    pools.push({ id, label, scope, windows: [{ id: 'budget', label, unit: 'currency', currency: 'USD', total, used, remainingMode: 'total-minus-used', resetsAt: raw.billingCycleEnd }], balances: [] });
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
