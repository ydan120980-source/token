'use strict';
const { projectConnections } = require('./connection-state');
function projectResourceConnections(input) {
  const base = projectConnections(input);
  return { ...base, schemaVersion: 'SourceConnectionsV2', rows: base.rows.map(row => {
    if (row.quota.capability !== 'supported' || !Array.isArray(input.quota?.accounts)) return row;
    const accounts = input.quota.accounts.filter(a => a?.provider === row.agent).slice(0, 20);
    const freshness = { fresh: 0, stale: 0, cached: 0, missing: 0 }, resourceCoverage = { fresh: 0, stale: 0, cached: 0, missing: 0 };
    let partialConnections = 0;
    for (const account of accounts) {
      const quota = account.quota, coverage = quota?.coverage;
      if (quota?.partial) partialConnections++;
      if (!coverage) { freshness.missing++; continue; }
      for (const key of Object.keys(resourceCoverage)) resourceCoverage[key] += coverage[key];
      if (!quota.hasMeasurements) { freshness.missing++; continue; }
      if (coverage.stale) freshness.stale++;
      else if (coverage.cached) freshness.cached++;
      else if (coverage.missing) freshness.missing++;
      else if (coverage.fresh) freshness.fresh++;
      else freshness.missing++;
    }
    return { ...row, quota: { ...row.quota, freshness, resourceCoverage, partialConnections } };
  }) };
}
module.exports = { projectResourceConnections };
