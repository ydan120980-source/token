'use strict';
const { fail } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete, entitlementState = 'unknown', validUntil = null;
  if (raw.length > 100) fail();
  const viewer = raw.map(item => item?.data).find(item => Object.hasOwn(item || {}, 'viewer'))?.viewer;
  if (viewer === null) throw new Error('PROVIDER_AUTH_REQUIRED');
  const usage = viewer?.rpcs?.getUsageInfo;
  if (!Array.isArray(usage?.pools) || usage.pools.length > 100) fail();
  incomplete = true;
  for (const [id, durationMins] of [['GXU_FIVE_HOURLY', 300], ['GXU_WEEKLY', 10080]]) {
    const meter = usage.pools.find(item => item?.poolType === id); if (!meter) continue;
    if (typeof meter.percentageUsed !== 'number' || !Number.isFinite(meter.percentageUsed) || meter.percentageUsed < 0 || meter.percentageUsed > 1) fail();
    pools.push({ id, label: 'Gemini app · ' + (durationMins === 300 ? '5 小时' : '每周'), scope: 'account', windows: [{ id: 'window', unit: 'percent', usedPercent: meter.percentageUsed * 100, durationMins, resetsAt: meter.gxu?.windowRefreshesAt }], balances: [] });
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
