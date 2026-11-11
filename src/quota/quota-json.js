'use strict';
// Preserve numeric amount lexemes before JS rounding. Percentages remain finite
// numbers, while money/count fields cross normalization as exact decimal text.
const AMOUNTS = new Set(['balance', 'balanceMicroCents', 'cashBalance', 'giftBalance', 'used', 'limit', 'remaining', 'total_capacity_size', 'total_capacity_used', 'CycleTotalCapacity', 'CycleRemainCapacity', 'CycleFrozenCapacity', 'total_units', 'used_units', 'remaining_units', 'available_units', 'CycleCapacitySize', 'CycleCapacityRemain', 'CapacitySize', 'CapacityRemain', 'usedMicroCents', 'limitMicroCents']);
function quotaJSON(text) {
  return JSON.parse(text, (key, value, context) => typeof value === 'number' && AMOUNTS.has(key) ? context?.source ?? (Number.isSafeInteger(value) ? String(value) : null) : value);
}
module.exports = { quotaJSON };
