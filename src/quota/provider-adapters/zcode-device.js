'use strict';
const { record, fail, amount } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete, entitlementState = 'unknown', validUntil = null;
  if ([401, 403].includes(raw.code)) throw Error(raw.code === 401 ? 'PROVIDER_AUTH_REQUIRED' : 'PROVIDER_ACCESS_DENIED');
  if (raw.code !== 0 || !Array.isArray(raw.data?.balances) || raw.data.balances.length > 100) fail();
  incomplete = true;
  for (const [index, bucket] of raw.data.balances.entries()) {
    if (!record(bucket)) fail();
    for (const key of ['total_units', 'used_units', 'remaining_units', 'available_units']) if (bucket[key] != null && amount(bucket[key]) === null) fail();
    const unit = bucket.unit_type === 'token' ? 'tokens' : 'unknown', exp = typeof bucket.expires_at === 'number' ? bucket.expires_at > 1e12 ? bucket.expires_at : bucket.expires_at * 1000 : NaN;
    const expiresAt = Number.isSafeInteger(exp) && exp > 0 && exp <= 8640000000000000 ? new Date(exp).toISOString() : null;
    const balances = [{ id: 'book', label: '账面额度（与可用额度不相加）', unit, total: bucket.total_units ?? null, used: bucket.used_units ?? null, remaining: bucket.remaining_units ?? null, expiresAt }];
    if (bucket.available_units != null) balances.push({ id: 'available', label: '可用额度（同一资源包）', unit, remaining: bucket.available_units, expiresAt });
    pools.push({ id: 'bucket-' + index, label: typeof bucket.show_name === 'string' ? bucket.show_name : 'ZCode 额度桶 ' + (index + 1), scope: 'account', windows: [], balances });
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
