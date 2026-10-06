'use strict';
const FIELDS = ['inputUncached','output','cacheRead','cacheWrite','reasoning'];
const CONFLICT = 'SOURCE_USAGE_CONFLICT', REGRESSION = 'SOURCE_USAGE_REGRESSION';
const rank = record => (record.measurementQuality || record.quality) === 'measured' ? 2 : (record.measurementQuality || record.quality) === 'partial' ? 1 : 0;
const valid = record => rank(record) > 0;
// a keeps every bucket b knows and adds a bucket or known model/provider metadata.
function informs(a, b) {
  const keeps = FIELDS.every(field => !Number.isFinite(b[field]) || Number.isFinite(a[field]));
  const fills = FIELDS.some(field => !Number.isFinite(b[field]) && Number.isFinite(a[field]));
  const metadata = b.model === 'unknown' && a.model !== 'unknown' || b.provider === 'unknown' && a.provider !== 'unknown';
  return keeps && (fills || metadata);
}
const canonical = record => JSON.stringify([record.timestamp,record.model,record.provider,...FIELDS.map(field => record[field])]);
// Select one complete observation. Missing fields may improve, but conflicting
// observations are never combined into a fabricated set of bucket maxima.
// Every merge point folds with this function, so the choice is order-independent:
// valid evidence beats invalid, then the larger total wins (a later snapshot;
// partial totals are lower bounds), then quality and information at equal totals.
function selectUsageSnapshot(previous, incoming) {
  if (!previous) return {record:incoming, issue:incoming.usageConflict ? CONFLICT : null};
  const order = Number(valid(incoming)) - Number(valid(previous)) || incoming.totalTokens - previous.totalTokens;
  if (order < 0) return {record:previous, issue:incoming.totalTokens < previous.totalTokens ? REGRESSION : previous.usageConflict ? CONFLICT : null};
  if (order > 0) return {record:incoming, issue:incoming.usageConflict ? CONFLICT : null};
  const conflict = rank(previous) > 0 && rank(incoming) > 0 && FIELDS.some(field => Number.isFinite(previous[field]) && Number.isFinite(incoming[field]) && previous[field] !== incoming[field]);
  if (conflict || previous.usageConflict || incoming.usageConflict) {
    const base = rank(incoming) > rank(previous) ? incoming : previous;
    return {record:base.usageConflict && base.quality === 'usage-conflict' ? base : {...base,usageConflict:true,measurementQuality:base.measurementQuality || base.quality,quality:'usage-conflict'},issue:CONFLICT};
  }
  if (rank(incoming) !== rank(previous)) return {record:rank(incoming) > rank(previous) ? incoming : previous, issue:null};
  const better = informs(incoming,previous), worse = informs(previous,incoming);
  if (better !== worse) return {record:better ? incoming : previous, issue:null};
  return {record:canonical(incoming) < canonical(previous) ? incoming : previous, issue:null};
}
function keepIdentity(owner, snapshot) {
  return {...snapshot,id:owner.id,agent:owner.agent,entry:owner.entry,sessionKey:owner.sessionKey};
}
module.exports = {selectUsageSnapshot, keepIdentity};
