'use strict';
const { record, fail, amount } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete, entitlementState = 'unknown', validUntil = null;
  const balance = raw.balance;
  if ([balance?.code, raw.plan?.code, raw.usage?.code].includes(401)) throw new Error('PROVIDER_AUTH_REQUIRED');
  if (balance?.code === 403) throw new Error('PROVIDER_ACCESS_DENIED');
  if (balance?.code !== 0 || !record(balance.data) || amount(balance.data.balance) === null || !/^[A-Z]{3}$/.test(balance.data.currency || '')) fail();
  const balances = [['total', '总余额', balance.data.balance, 'unknown'], ['cash', '付费组成（包含在总额中）', balance.data.cashBalance, 'purchased'], ['gift', '赠送组成（包含在总额中）', balance.data.giftBalance, 'promotional']].filter(([, , value]) => value !== undefined && value !== null).map(([id, label, value, kind]) => { if (amount(value) === null) fail(); return { id, label, kind, unit: 'currency', currency: balance.data.currency, remaining: value }; });
  pools.push({ id: 'api-money', label: '普通 API 余额 · 总额与组成不相加', scope: 'account', windows: [], balances });
  const detail = raw.plan?.code === 0 && record(raw.plan.data) ? raw.plan.data : null;
  if (detail) { plan = detail.planCode; validUntil = detail.currentPeriodEnd; if (detail.expired === true) entitlementState = 'expired'; }
  const items = raw.usage?.code === 0 && Array.isArray(raw.usage.data?.monthUsage?.items) ? raw.usage.data.monthUsage.items : null;
  if (items && items.length <= 100) {
    const windows = items.map((item, index) => { if (!record(item) || amount(item.limit) === null || amount(item.used) === null) fail(); return { id: 'credits-' + index, label: typeof item.name === 'string' ? item.name : 'Token Plan Credits', unit: 'credits', total: item.limit, used: item.used, remainingMode: 'total-minus-used', requiresEntitlement: true, resetsAt: detail?.currentPeriodEnd }; });
    if (windows.length) pools.push({ id: 'token-plan', label: 'Token Plan Credits · 与 API 金额独立', scope: 'account', windows, balances: [] });
  } else if (items) fail();
  incomplete = !detail || !items || !items.length;
  return { pools, plan, incomplete, entitlementState, validUntil };
}
async function read({ adapter, credential, signal, project, transport }) {
  const raw = { balance: await transport(adapter, credential, { signal, project }), plan: null, usage: null };
  for (const part of ['plan', 'usage']) {
    try { raw[part] = await transport(adapter, credential, { signal, part }); }
    catch (error) { if (signal.aborted || ['PROVIDER_AUTH_REQUIRED', 'PROVIDER_ACCESS_DENIED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_REDIRECT_REJECTED'].includes(error.message)) throw error; }
  }
  return { raw };
}
module.exports = { parse, read };
