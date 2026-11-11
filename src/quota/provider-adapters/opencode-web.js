'use strict';
const { record, fail, microDollars, amount } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete, entitlementState = 'unknown', validUntil = null;
  const meters = raw.access?.meters; if (!record(meters)) fail(); incomplete = true;
  const windows = [];
  for (const [id, durationMins] of [['fiveHour', 300], ['week', 10080], ['month', null]]) {
    const meter = meters[id]; if (meter == null) continue;
    if (!record(meter) || amount(meter.usedMicroCents) === null || amount(meter.limitMicroCents) === null) fail();
    // Preserve exact micro-cents as currency strings; no floating arithmetic.
    windows.push({ id, unit: 'currency', currency: 'USD', total: microDollars(meter.limitMicroCents), used: microDollars(meter.usedMicroCents), remainingMode: 'total-minus-used', durationMins, resetsAt: meter.resetsAt || (id === 'month' ? raw.access.endsAt : null) });
  }
  pools.push({ id: 'console-go', label: '所选工作区 Go 订阅约束', scope: 'workspace', windows, balances: [] });
  return { pools, plan, incomplete, entitlementState, validUntil };
}
async function read({ adapter, credential, signal, project, transport }) {
  const raw = await transport(adapter, credential, { signal, project });
  if (!Array.isArray(raw) || raw.length > 100) throw Error('PROVIDER_RESPONSE_INVALID');
  const workspaces = raw.filter(row => /^(?:wrk_|org_)[A-Za-z0-9_-]{1,100}$/.test(row?.id || ''));
  const selected = project?.workspace ? workspaces.find(row => row.id === project.workspace) : workspaces.length === 1 ? workspaces[0] : null;
  if (!selected) throw Error('PROVIDER_ORGANIZATION_REQUIRED');
  return { raw: await transport(adapter, credential, { signal, project: { workspace: selected.id }, part: 'usage' }), identityContext: { workspace: selected.id } };
}
module.exports = { parse, read };
