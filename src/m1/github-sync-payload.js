'use strict';
// What may leave this machine when the person syncs to their own private repository (owner 2026-11-04,
// docs/m2/GITHUB-AND-UPDATE-20261104.md): one row per day, Agent and model with its figures, nothing else. The list is
// written out so a new snapshot field stays home until someone adds it here. Unknown stays null, never zero.
const FIELDS = Object.freeze(['totalTokens', 'inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'records', 'estimatedCostUsd', 'estimatedCostUpperUsd']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const known = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
function payload(snapshot, device, syncedAt) {
  if (!Array.isArray(snapshot?.daily)) throw new Error('GITHUB_SYNC_SNAPSHOT_INVALID');
  // A person's own source has a name they chose and lives only here.
  const catalog = snapshot.sourceCatalog ?? {};
  const days = snapshot.daily.filter(row => DATE.test(row?.date) && !catalog[row.agent]?.custom && !String(row.agent).startsWith('custom-')).map(row => {
    const out = { date: row.date, agent: String(row.agent), model: String(row.model ?? '模型未记录').slice(0, 200) };
    for (const field of FIELDS) out[field] = known(row[field]);
    return out;
  });
  return { schemaVersion: 'AgentUsageSyncV1', device, syncedAt, timezone: typeof snapshot.timezone === 'string' ? snapshot.timezone : null, days };
}
module.exports = { payload, FIELDS };
