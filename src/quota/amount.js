'use strict';
// Exact, non-negative quantities. Values crossing IPC/storage are decimal
// strings; BigInt stays inside arithmetic. Fractional JS numbers are rejected.
const MAX_INTEGER_DIGITS = 36, MAX_SCALE = 18;
function amount(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    value = String(value);
  }
  if (typeof value !== 'string' || value.length > MAX_INTEGER_DIGITS + MAX_SCALE + 1 || !/^\d+(?:\.\d+)?$/.test(value)) return null;
  let [whole, fraction = ''] = value.split('.');
  if (whole.length > MAX_INTEGER_DIGITS || fraction.length > MAX_SCALE) return null;
  whole = whole.replace(/^0+(?=\d)/, ''); fraction = fraction.replace(/0+$/, '');
  return whole + (fraction ? '.' + fraction : '');
}
function aligned(values) {
  const normalized = values.map(amount);
  if (normalized.includes(null)) return null;
  const scale = Math.max(...normalized.map(v => (v.split('.')[1] || '').length));
  return { scale, values: normalized.map(v => { const [whole, fraction = ''] = v.split('.'); return BigInt(whole + fraction.padEnd(scale, '0')); }) };
}
function format(value, scale) {
  const text = value.toString().padStart(scale + 1, '0');
  return amount(scale ? text.slice(0, -scale) + '.' + text.slice(-scale) : text);
}
function subtract(total, ...used) {
  const pair = aligned([total, ...used]);
  if (!pair) return null;
  const result = pair.values.slice(1).reduce((v, next) => v - next, pair.values[0]);
  return result < 0n ? null : format(result, pair.scale);
}
function compare(left, right) {
  const pair = aligned([left, right]);
  return pair ? pair.values[0] < pair.values[1] ? -1 : pair.values[0] > pair.values[1] ? 1 : 0 : null;
}
module.exports = { amount, subtract, compare };
