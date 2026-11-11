'use strict';
const { instant } = require('../resource-contract');
const { record, fail, amount } = require('../provider-adapter-helpers');

function parse(raw, { completePackages = false } = {}) {
  const pools = []; let plan = null, incomplete, entitlementState = 'unknown', validUntil = null;
  if ([401, 403].includes(raw.code)) throw Error(raw.code === 401 ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_ACCESS_DENIED');
  const accounts = raw.data?.Response?.Data?.Accounts;
  if (raw.code !== 0 || !Array.isArray(accounts) || accounts.length > require('../workbuddy-package-contract').MAX_PACKAGES || raw.data.Response.Error) fail();
  incomplete = completePackages !== true; // Only the bounded paginator can confirm termination.
  const wireTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + '+08:00' : instant(value) ? value : null;
  for (const [index, item] of accounts.entries()) {
    if (!record(item) || !Number.isInteger(item.CapacityType) || item.CapacityType < 0) fail();
    const monthly = item.CapacityType === 4, total = item[monthly ? 'CycleCapacitySize' : 'CapacitySize'], remaining = item[monthly ? 'CycleCapacityRemain' : 'CapacityRemain'];
    if (total != null && amount(total) === null || remaining != null && amount(remaining) === null) fail();
    const ends = wireTime(monthly ? item.CycleEndTime : item.ExpiredTime || item.CycleEndTime);
    const itemView = { id: 'credits', label: monthly ? '周期积分' : '积分包', unit: 'credits', total: total ?? null, remaining: remaining ?? null, ...(monthly ? { resetsAt: ends } : { expiresAt: ends }) };
    pools.push({ id: 'package-' + index, label: typeof item.PackageName === 'string' ? item.PackageName : '客户端资源包 ' + (index + 1), scope: 'account', windows: monthly ? [itemView] : [], balances: monthly ? [] : [itemView] });
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
async function read({ credential, signal, project, packages }) {
  return packages(credential, { signal, project });
}
module.exports = { parse, read };
