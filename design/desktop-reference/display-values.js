'use strict';
// Display only: preserve the lower estimate, its upper bound and unknown values.
((root, factory) => {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.displayValues = factory();
})(typeof window === 'undefined' ? globalThis : window, () => {
  const usd = value => '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function cost(lower, upper = lower, coverage = 1) {
    if (!Number.isFinite(lower)) return { text: '未定价', lower: null, upper: null, partial: true };
    const bound = Number.isFinite(upper) ? Math.max(lower, upper) : lower;
    const partial = bound > lower + .000001 || coverage === null || coverage < .999999;
    return { text: usd(lower) + (partial ? '+' : ''), lower, upper: bound, partial };
  }
  function reset(date, now = Date.now()) {
    const timestamp = Date.parse(date);
    if (!Number.isFinite(timestamp)) return '重置未知';
    const mins = Math.ceil((timestamp - now) / 60000);
    if (mins <= 0) return '待刷新';
    if (mins < 60) return mins + ' 分钟后';
    if (mins < 1440) return Math.floor(mins / 60) + ' 小时' + (mins % 60 ? ' ' + mins % 60 + ' 分钟' : '') + '后';
    const time = new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    return Math.floor(mins / 1440) + ' 天后 ' + time;
  }
  return { usd, cost, reset };
});
