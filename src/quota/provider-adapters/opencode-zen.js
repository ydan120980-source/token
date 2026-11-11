'use strict';
const { fail, microDollars } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete, entitlementState = 'unknown', validUntil = null;
  const text = raw.balanceMicroCents, negative = typeof text === 'string' && text.startsWith('-'), dollars = microDollars(negative ? text.slice(1) : text);
  if (dollars === null) fail(); incomplete = true;
  pools.push({ id: 'zen-payg', label: 'Zen 按量余额 · 不含 Go 订阅或月预算', scope: 'workspace', windows: [], balances: [{ id: 'balance', label: negative && dollars !== '0' ? '待结清金额（不是可用余额）' : '预付按量余额', kind: 'purchased', unit: 'currency', currency: 'USD', ...(negative && dollars !== '0' ? { used: dollars, availability: 'unavailable' } : { remaining: dollars }) }] });
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
