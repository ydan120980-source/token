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
    'model-unpriced': '价格目录中没有此模型',
    'price-unverified': '只有待核实的参考价，不计入估算',
    'time-tariff-unreported': '高峰 / 空闲费率 · 显示当前价范围',
    'usage-incomplete': '用量字段不完整或冲突',
    'rate-missing': '目录缺少该模型的部分费率',
    'cache-write-unreported': '缓存写入未报告 · 显示范围',
    'context-unreported': '请求上下文长度未报告 · 显示范围',
    'reasoning-unreported': '推理输出数量未报告 · 显示范围',
    'long-context': '已应用长上下文费率',
    exact: '桶字段已匹配'
  };
  function origin(row) { return ORIGINS[row && row.origin] || { label: (row && row.origin) || '未定价', scope: 'unpriced' }; }
  function scope(row) { return origin(row).scope; }
  function priced(row) { return Number.isFinite(row && row.rates && row.rates.inputUncached) && Number.isFinite(row && row.rates && row.rates.output); }
  function formatCount(value) { return Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'; }
  function formatStamp(value) {
    if (typeof value !== 'string' || !value) return '时间未记录';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
  }
  // Reasons a user decision can close: a price, a verified price or a missing rate.
  // Incomplete usage fields cannot be fixed by pricing and stay out of the action list.
  const FIXABLE = ['model-unpriced', 'price-unverified', 'rate-missing'];
  /**
   * Joins the models seen in collected records with their resolved price row and
   * their recorded weight, heaviest first. `usage` is keyed by provider/model.
   */
  function usedModels(observed, catalogRows, usage, billing, names) {
    const byKey = new Map((catalogRows || []).map(row => [row.provider + '/' + row.model, row]));
    const total = Object.values(usage || {}).reduce((sum, stats) => sum + (stats.tokens || 0), 0);
    return (observed || []).map(item => {
      const key = item.provider + '/' + item.model, stats = (usage || {})[key] || {}, row = byKey.get(key) || { provider: item.provider, model: item.model, rates: {}, origin: 'unpriced' };
      return { key, provider: item.provider, model: item.model, row, target: item.target || null, mapped: Boolean(billing && billing.mappings && billing.mappings[key]), manual: row.origin === 'manual',
        agents: (stats.agents || []).map(agent => (names || {})[agent] || agent), tokens: stats.tokens || 0, pricedTokens: stats.pricedTokens || 0, share: total ? (stats.tokens || 0) / total : null, reasons: stats.reasons || {} };
    }).sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
  }
  function pricingGaps(models) {
    return (models || []).filter(item => item.tokens > item.pricedTokens && FIXABLE.some(reason => item.reasons[reason] > 0))
      .map(item => ({ key: item.key, tokens: item.tokens - item.pricedTokens, reasons: FIXABLE.filter(reason => item.reasons[reason] > 0) }))
      .sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
  }
  function coverage(usage) {
    const all = Object.values(usage || {});
    const tokens = all.reduce((sum, stats) => sum + (stats.tokens || 0), 0), priced = all.reduce((sum, stats) => sum + (stats.pricedTokens || 0), 0);
    return { tokens, priced, ratio: tokens ? priced / tokens : null };
  }
  /** Builds a validated-by-backend entry out of raw form strings. */
  function entry(provider, model, values) {
    return {
      provider: String(provider || '').trim(), model: String(model || '').trim(),
      ...Object.fromEntries(FIELDS.map(field => [field, values[field] === '' || values[field] === null || values[field] === undefined ? null : Number(values[field])]))
    };
  }
  return { FIELDS, LABELS, ORIGINS, REASONS, FIXABLE, origin, scope, priced, formatCount, formatStamp, usedModels, pricingGaps, coverage, entry };
});
