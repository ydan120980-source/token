'use strict';
(function(root) {
  function since(today, period) {
    if (period === 'all') return '0000-00-00';
    const date = new Date(today + 'T12:00:00Z');
    if (Number.isNaN(date.valueOf()) || !['today', '7', '30'].includes(period)) throw new Error('INVALID_PERIOD');
    date.setUTCDate(date.getUTCDate() - (period === '7' ? 6 : period === '30' ? 29 : 0));
    return date.toISOString().slice(0, 10);
  }
  const api = { since };
  if (typeof module !== 'undefined') module.exports = api;
  else root.m1Calendar = api;
})(typeof window !== 'undefined' ? window : globalThis);
