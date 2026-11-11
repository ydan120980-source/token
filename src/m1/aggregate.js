'use strict';
// One aggregate row: tokens add up, a field stays null once any record lacks it,
// and cost counts priced records only.
function add(map, key, base, record, estimate) {
  let row = map.get(key);
  if (!row) {
    row = { ...base, agent: record.agent, entry: record.entry, provider: record.provider, model: record.model, totalTokens: 0, inputUncached: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, records: 0, pricedRecords: 0, pricedTokens: 0, estimatedCostUsd: 0, estimatedCostUpperUsd: 0, boundedTokens: 0, pricingReasons: {}, unpricedTokens: {}, incompleteTokens: {}, knownUsage: {}, knownRecords: {}, partialRecords: 0, costParts: { inputUncached: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cacheSavingsUsd: 0 };
    map.set(key, row);
  }
  row.totalTokens += record.totalTokens; row.records++;
  if (record.quality !== 'measured' || record.usageConflict) row.partialRecords++;
  for (const field of ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) row[field] = row[field] === null || record[field] === null || record.usageConflict ? null : row[field] + record[field];
  for (const field of ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'outputPlain']) {
    const count = field === 'outputPlain' ? record.output !== null && record.reasoning !== null && record.reasoning <= record.output ? record.output - record.reasoning : null : record[field];
    if (!record.usageConflict && Number.isFinite(count)) { row.knownUsage[field] = (row.knownUsage[field] || 0) + count; row.knownRecords[field] = (row.knownRecords[field] || 0) + 1; }
  }
  row.pricingReasons[estimate.reason] = (row.pricingReasons[estimate.reason] || 0) + 1;
  // Unpriced tokens by reason, and incomplete usage by its cause, so the pricing panel can
  // name the model and the missing field instead of one unexplained remainder.
  if (estimate.lower === null) {
    row.unpricedTokens[estimate.reason] = (row.unpricedTokens[estimate.reason] || 0) + record.totalTokens;
    if (estimate.cause) row.incompleteTokens[estimate.cause] = (row.incompleteTokens[estimate.cause] || 0) + record.totalTokens;
  }
  if (estimate.lower !== null) {
    row.estimatedCostUsd += estimate.lower; row.estimatedCostUpperUsd += estimate.upper; row.pricedRecords++; row.pricedTokens += record.totalTokens; if (estimate.upper > estimate.lower || estimate.lowerBound) row.boundedTokens += record.totalTokens;
    for (const field of Object.keys(row.costParts)) row.costParts[field] += estimate.parts[field]; row.cacheSavingsUsd += estimate.savings;
  }
}
module.exports = {add};
