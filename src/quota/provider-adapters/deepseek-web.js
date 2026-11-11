'use strict';
const { record, fail, amount } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete, entitlementState = 'unknown', validUntil = null;
  if (raw.code !== 0 || raw.data?.biz_code !== 0 || !record(raw.data.biz_data)) fail(); incomplete = true;
  for (const [field, kind, label] of [['normal_wallets', 'purchased', '充值钱包'], ['bonus_wallets', 'promotional', '赠送钱包']]) {
    const wallets = raw.data.biz_data[field]; if (!Array.isArray(wallets) || wallets.length > 100) fail();
    for (const [index, wallet] of wallets.entries()) {
      if (!record(wallet) || !['CNY', 'USD'].includes(wallet.currency) || amount(wallet.balance) === null) fail();
      pools.push({ id: field + '-' + index, label: label + ' · ' + wallet.currency, scope: 'account', windows: [], balances: [{ id: 'balance', kind, unit: 'currency', currency: wallet.currency, remaining: wallet.balance }] });
    }
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
module.exports = { parse };
