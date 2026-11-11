'use strict';
const { record, fail, amount } = require('../provider-adapter-helpers');
const { createHash } = require('node:crypto');

function parse(raw) {
  const pools = []; let plan = null, incomplete = false, entitlementState = 'unknown', validUntil = null;
  if (!Array.isArray(raw.buckets) || raw.buckets.length > 100) fail();
  const ids = new Set();
  for (const bucket of raw.buckets) {
    if (!record(bucket) || typeof bucket.modelId !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(bucket.modelId) || typeof bucket.tokenType !== 'string' || bucket.tokenType.length > 80) fail();
    const id = createHash('sha256').update(bucket.modelId + '\0' + bucket.tokenType).digest('hex').slice(0, 32); if (ids.has(id)) fail(); ids.add(id);
    const windows = [];
    if (bucket.remainingFraction !== undefined) { if (typeof bucket.remainingFraction !== 'number' || !Number.isFinite(bucket.remainingFraction) || bucket.remainingFraction < 0 || bucket.remainingFraction > 1) fail(); windows.push({ id: 'fraction', label: '该模型额度比例', unit: 'percent', usedPercent: (1 - bucket.remainingFraction) * 100, resetsAt: bucket.resetTime }); }
    if (bucket.remainingAmount !== undefined) { if (amount(bucket.remainingAmount) === null) fail(); windows.push({ id: 'amount', label: '同一约束余量 · 不与比例相加', unit: bucket.tokenType === 'REQUESTS' ? 'requests' : bucket.tokenType === 'TOKENS' ? 'tokens' : 'unknown', remaining: bucket.remainingAmount, resetsAt: bucket.resetTime }); }
    pools.push({ id, label: bucket.modelId + ' · ' + bucket.tokenType, scope: 'project', modelIds: [bucket.modelId], windows, balances: [] });
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
async function read({ adapter, credential, signal, project, transport }) {
  if (project?.discover === true) {
    const bootstrap = await transport(adapter, credential, { signal, part: 'bootstrap' });
    if (bootstrap?.isClientUnsupported === true) throw Error('PROVIDER_CLIENT_UNSUPPORTED');
    const selected = bootstrap?.cloudaicompanionProject;
    project = typeof selected === 'string' ? selected : typeof selected?.id === 'string' ? selected.id : { discover: true };
  }
  return { raw: await transport(adapter, credential, { signal, project }), identityContext: typeof project === 'string' ? project : undefined };
}
module.exports = { parse, read };
