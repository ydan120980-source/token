'use strict';
const { record, fail, amount } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete = false, entitlementState = 'unknown', validUntil = null;
  if (typeof raw.is_available !== 'boolean' || !Array.isArray(raw.balance_infos) || raw.balance_infos.length < 1 || raw.balance_infos.length > 10) fail();
  const currencies = new Set();
  for (const entry of raw.balance_infos) {
    if (!record(entry) || !['CNY', 'USD'].includes(entry.currency) || currencies.has(entry.currency) || amount(entry.total_balance) === null) fail();
    currencies.add(entry.currency);
    const availability = raw.is_available ? 'available' : 'unavailable';
    // Total and components overlap. They are separate labelled observations,
    // never amounts to sum into a second balance.
    const balances = [['total', '总可用余额', entry.total_balance, 'unknown'], ['granted', '未到期赠送余额（总额组成）', entry.granted_balance, 'promotional'], ['topup', '充值余额（总额组成）', entry.topped_up_balance, 'purchased']].filter(([, , value]) => value !== undefined).map(([id, label, value, kind]) => {
      if (amount(value) === null) fail(); return { id, label, kind, unit: 'currency', currency: entry.currency, remaining: value, availability };
    });
    pools.push({ id: entry.currency, label: entry.currency + ' · 总额与组成不可相加', scope: 'account', windows: [], balances });
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
