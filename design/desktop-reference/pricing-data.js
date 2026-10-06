'use strict';
/**
 * Pricing helpers shared by the settings panel and by node --test.
 * Pure data only: no DOM, no bridge, no writes.
 * Same UMD shape as chart-ui.js so tests can require it directly.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.uiPricing = factory();
})(typeof window === 'undefined' ? this : window, function () {
  const FIELDS = ['inputUncached', 'output', 'cacheRead', 'cacheWrite'];
  const LABELS = { inputUncached: '输入（不含缓存）', output: '输出（含推理）', cacheRead: '缓存读取', cacheWrite: '缓存写入' };
  const ORIGINS = {
    'models-dev': {label:'models.dev 同步',scope:'priced'},
    'mapped': {label:'指定模型映射',scope:'priced'},
    'default-model': {label:'Agent 默认模型',scope:'priced'},
    'model-id': {label:'实际模型标识匹配',scope:'priced'},
    manual: { label: '手动规则', scope: 'priced' },
    'official-current-standard': { label: '官方当前 Standard', scope: 'priced' },
    'official-thirdparty-unverified': { label: '第三方价 · 待核实', scope: 'unverified' },
    'reference-unverified': { label: '参考价格 · 待核实', scope: 'unverified' },
    unpriced: { label: '未定价', scope: 'unpriced' }
  };
  const REASONS = {
    'model-unpriced': '模型 / provider 无规则',
    'price-unverified': '参考费率未核实 · 不计入估算',
    'time-tariff-unreported': '高峰 / 空闲费率 · 显示当前价范围',
    'usage-incomplete': '用量字段不完整或冲突',
    'rate-missing': '缺少必要费率',
    'cache-write-unreported': '缓存写入未报告 · 显示范围',
    'context-unreported': '请求上下文长度未报告 · 显示范围',
    'reasoning-unreported': '推理输出数量未报告 · 显示范围',
    'long-context': '已应用长上下文费率',
    exact: '桶字段已匹配'
  };
  const SCOPES = [
    { value: 'all', label: '全部状态' },
    { value: 'priced', label: '已定价' },
    { value: 'unverified', label: '待核实' },
    { value: 'unpriced', label: '未定价' }
  ];
  function origin(row) { return ORIGINS[row && row.origin] || { label: (row && row.origin) || '未定价', scope: 'unpriced' }; }
  function scope(row) { return origin(row).scope; }
  function priced(row) { return Number.isFinite(row && row.rates && row.rates.inputUncached) && Number.isFinite(row && row.rates && row.rates.output); }
  function isOfficial(row) { return String((row && row.origin) || '').indexOf('official') === 0; }
  function formatRate(value) { return Number.isFinite(value) ? String(value) : '未知 / 未单列'; }
  function formatCount(value) { return Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'; }
  function formatStamp(value) {
    if (typeof value !== 'string' || !value) return '时间未记录';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
  }
  function filter(models, options) {
    const settings = options || {};
    const query = String(settings.query || '').trim().toLowerCase();
    const wanted = settings.scope || 'all';
    return (models || []).filter(row => {
      if (wanted !== 'all' && scope(row) !== wanted) return false;
      if (!query) return true;
      return (row.provider + '/' + row.model + ' ' + origin(row).label).toLowerCase().indexOf(query) >= 0;
    });
  }
  /** Groups matches by provider, keeping providers and models in a stable order. */
  function groups(models, options) {
    const rows = filter(models, options).slice().sort((a, b) => a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));
    const byProvider = new Map();
    for (const row of rows) {
      if (!byProvider.has(row.provider)) byProvider.set(row.provider, []);
      byProvider.get(row.provider).push(row);
    }
    return [...byProvider].map(([provider, list]) => ({ provider, rows: list, unpriced: list.filter(row => scope(row) === 'unpriced').length, unverified: list.filter(row => scope(row) === 'unverified').length }));
  }
  /**
   * Reads pricing reasons out of the projected daily rows, so the panel reports
   * which gaps actually cost the user coverage instead of which models exist.
   */
  function gaps(daily) {
    const reasons = new Map(), unpriced = new Map();
    let records = 0;
    for (const row of daily || []) {
      records += Number.isFinite(row.records) ? row.records : 0;
      for (const [reason, count] of Object.entries(row.pricingReasons || {})) {
        if (reason === 'exact' || !Number.isFinite(count) || count <= 0) continue;
        reasons.set(reason, (reasons.get(reason) || 0) + count);
      }
      const missing = (row.pricingReasons || {})['model-unpriced'];
      if (Number.isFinite(missing) && missing > 0) {
        const key = row.provider + '/' + row.model;
        unpriced.set(key, (unpriced.get(key) || 0) + missing);
      }
    }
    return {
      records,
      reasons: [...reasons].sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, label: REASONS[reason] || reason, count })),
      unpriced: [...unpriced].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }))
    };
  }
  /** Turns a dry-run probe into one sentence the editor can show. */
  function probeText(probe) {
    if (!probe) return '';
    const parts = [];
    parts.push(probe.affectedRecords ? '将影响 ' + formatCount(probe.affectedRecords) + ' 条已保存记录（' + formatCount(probe.affectedTokens) + ' token）' : '当前没有已保存记录使用该模型');
    if (probe.previous) parts.push('当前依据：' + (ORIGINS[probe.origin] ? ORIGINS[probe.origin].label : probe.origin));
    if (probe.sample) {
      // A blocked reason (unpriced / unverified / incomplete usage) carries a
      // null estimate; saying '0.000000 USD' there would read as a real price.
      const label = REASONS[probe.sample.reason] || probe.sample.reason;
      if (!Number.isFinite(probe.sample.lower)) parts.push('试算：' + label + '，无语义金额');
      else {
        const upper = Number.isFinite(probe.sample.upper) && probe.sample.upper !== probe.sample.lower ? '（范围上限 ' + probe.sample.upper.toFixed(6) + ' USD）' : '';
        parts.push('试算：' + label + '，' + probe.sample.lower.toFixed(6) + ' USD' + upper);
      }
    }
    parts.push('试算不写入任何文件。');
    return parts.join('；');
  }
  /** Builds a validated-by-backend entry out of raw form strings. */
  function entry(provider, model, values) {
    return {
      provider: String(provider || '').trim(), model: String(model || '').trim(),
      ...Object.fromEntries(FIELDS.map(field => [field, values[field] === '' || values[field] === null || values[field] === undefined ? null : Number(values[field])]))
    };
  }
  return { FIELDS, LABELS, ORIGINS, REASONS, SCOPES, origin, scope, priced, isOfficial, filter, groups, formatRate, formatCount, formatStamp, gaps, probeText, entry };
});
