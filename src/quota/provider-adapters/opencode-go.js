'use strict';
const { record, fail, percent } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete = false, entitlementState = 'unknown', validUntil = null;
  if (!record(raw.usage)) fail();
  const windows = [];
  for (const [id, label, durationMins] of [['rolling', '滚动窗口', 300], ['weekly', '每周窗口', 10080], ['monthly', '每月窗口', null]]) {
    const meter = raw.usage[id]; if (meter == null) continue;
    if (!record(meter) || percent(meter.percent) === null || !['ok', 'rate-limited'].includes(meter.status)) fail();
    windows.push({ id, label, durationMins, cadence: id === 'rolling' ? 'rolling' : 'calendar', unit: 'percent', usedPercent: meter.percent, availability: meter.status === 'rate-limited' ? 'unavailable' : 'unknown', resetsAt: meter.resetsAt });
  }
  pools.push({ id: 'go', label: 'Go 订阅窗口 · 不含按量余额', scope: 'unknown', windows, balances: [] });
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
