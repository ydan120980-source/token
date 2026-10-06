'use strict';
const FIELDS = ['inputUncached','output','cacheRead','cacheWrite','reasoning'];
const rank = record => (record.measurementQuality || record.quality) === 'measured' ? 2 : (record.measurementQuality || record.quality) === 'partial' ? 1 : 0;
// Select one complete observation. Missing fields may improve, but conflicting
// observations are never combined into a fabricated set of bucket maxima.
function selectUsageSnapshot(previous, incoming) {
  if (!previous) return {record:incoming, issue:incoming.usageConflict ? 'SOURCE_USAGE_CONFLICT' : null};
  if (incoming.totalTokens < previous.totalTokens) return {record:previous, issue:'SOURCE_USAGE_REGRESSION'};
  if (incoming.totalTokens > previous.totalTokens) {
    if (rank(incoming) < rank(previous)) return {record:previous, issue:previous.usageConflict ? 'SOURCE_USAGE_CONFLICT' : null};
    return {record:incoming, issue:incoming.usageConflict ? 'SOURCE_USAGE_CONFLICT' : null};
  }
  const conflict = rank(previous) > 0 && rank(incoming) > 0 && FIELDS.some(field => Number.isFinite(previous[field]) && Number.isFinite(incoming[field]) && previous[field] !== incoming[field]);
  if (conflict || previous.usageConflict || incoming.usageConflict) return {record:previous.usageConflict && previous.quality === 'usage-conflict' ? previous : {...previous,usageConflict:true,measurementQuality:previous.measurementQuality || previous.quality,quality:'usage-conflict'},issue:'SOURCE_USAGE_CONFLICT'};
  if (rank(incoming) < rank(previous)) return {record:previous,issue:null};
  const keepsFields = FIELDS.every(field => !Number.isFinite(previous[field]) || Number.isFinite(incoming[field]));
  const metadataImproves = previous.model === 'unknown' && incoming.model !== 'unknown' || previous.provider === 'unknown' && incoming.provider !== 'unknown';
  const improves = rank(incoming) > rank(previous) || keepsFields && (metadataImproves || FIELDS.some(field => !Number.isFinite(previous[field]) && Number.isFinite(incoming[field])));
  return {record:improves ? incoming : previous, issue:null};
}
function keepIdentity(owner, snapshot) {
  return {...snapshot,id:owner.id,agent:owner.agent,entry:owner.entry,sessionKey:owner.sessionKey};
}
module.exports = {selectUsageSnapshot, keepIdentity};
