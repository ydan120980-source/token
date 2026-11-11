'use strict';
const { record, fail, percent } = require('../provider-adapter-helpers');

function parse(raw) {
  const pools = []; let plan = null, incomplete, entitlementState = 'unknown', validUntil = null;
  incomplete = true;
  for (const [id, label, durationMins] of [['five_hour', '5 小时订阅窗口', 300], ['seven_day', '7 天订阅窗口', 10080], ['seven_day_sonnet', 'Sonnet 周窗口', 10080], ['seven_day_opus', 'Opus 周窗口', 10080], ['seven_day_routines', 'Routines 周窗口', 10080]]) {
    const meter = raw[id]; if (meter == null) continue;
    if (!record(meter) || percent(meter.utilization) === null) fail();
    pools.push({ id, label, scope: 'account', windows: [{ id: 'window', unit: 'percent', durationMins, usedPercent: meter.utilization, resetsAt: meter.resets_at }], balances: [] });
  }
  return { pools, plan, incomplete, entitlementState, validUntil };
}
async function read({ adapter, credential, signal, project, transport }) {
  const raw = await transport(adapter, credential, { signal, project });
  if (!Array.isArray(raw) || raw.length > 100) throw Error('PROVIDER_RESPONSE_INVALID');
  const organizations = raw.filter(row => typeof row?.uuid === 'string' && /^[a-f0-9-]{36}$/i.test(row.uuid));
  const selected = project?.organization ? organizations.find(row => row.uuid === project.organization) : organizations.length === 1 ? organizations[0] : null;
  if (!selected) throw Error('PROVIDER_ORGANIZATION_REQUIRED');
  return { raw: await transport(adapter, credential, { signal, organization: selected.uuid }), identityContext: { organization: selected.uuid } };
}
module.exports = { parse, read };
