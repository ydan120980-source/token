'use strict';
/**
 * Pricing helpers shared by the settings panel and by node --test.
 * Pure data only: no DOM, no bridge, no writes.
 * Same UMD shape as chart-ui.js so tests can require it directly.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../src/m1/pricing-labels'));
  else root.uiPricing = factory(root.pricingLabels);
})(typeof window === 'undefined' ? this : window, function (labels) {
  const FIELDS = ['inputUncached', 'output', 'cacheRead', 'cacheWrite'];
  const LABELS = { inputUncached: '输入（不含缓存）', output: '输出（含推理）', cacheRead: '缓存读取', cacheWrite: '缓存写入' };
  const ORIGINS = {
    'models-dev': {label:'models.dev 同步',scope:'priced'},
    'mapped': {label:'指定模型映射',scope:'priced'},
    'default-model': {label:'Agent 默认模型',scope:'priced'},
    fallback: {label:'保底估算',scope:'priced'},
    'model-id': {label:'实际模型标识匹配',scope:'priced'},
    manual: { label: '手动规则', scope: 'priced' },
    'official-current-standard': { label: '官方当前 Standard', scope: 'priced' },
    'official-thirdparty-unverified': { label: '第三方价 · 待核实', scope: 'unverified' },
    'reference-unverified': { label: '参考价格 · 待核实', scope: 'unverified' },
    unpriced: { label: '未定价', scope: 'unpriced' }
  };
  // Shared with the cost export (src/m1/pricing-labels.js), so both say the same thing.
  const { REASONS, CAUSES, FIXABLE } = labels;
  function origin(row) { return ORIGINS[row && row.origin] || { label: (row && row.origin) || '未定价', scope: 'unpriced' }; }
  function scope(row) { return origin(row).scope; }
  function priced(row) { return Number.isFinite(row && row.rates && row.rates.inputUncached) && Number.isFinite(row && row.rates && row.rates.output); }
  function formatCount(value) { return Number.isFinite(value) ? value.toLocaleString('zh-CN') : '—'; }
  function formatStamp(value) {
    if (typeof value !== 'string' || !value) return '时间未记录';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
  }
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
        agentIds: (stats.agents || []).slice(), unpricedAgentIds: Object.entries(stats.unpricedAgents || {}).filter(([,tokens])=>tokens>0).sort((a,b)=>b[1]-a[1]).map(([id])=>id), agents: (stats.agents || []).map(agent => (names || {})[agent] || agent), tokens: stats.tokens || 0, pricedTokens: stats.pricedTokens || 0, share: total ? (stats.tokens || 0) / total : null, reasons: stats.reasons || {},
        unpriced: stats.unpriced || null, incomplete: stats.incomplete || {}, unpricedAgents: Object.fromEntries(Object.entries(stats.unpricedAgents || {}).map(([agent, tokens]) => [(names || {})[agent] || agent, tokens])) };
    }).sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
  }
  function pricingGaps(models) {
    return (models || []).filter(item => item.tokens > item.pricedTokens && FIXABLE.some(reason => item.reasons[reason] > 0))
      .map(item => ({ key: item.key, tokens: item.tokens - item.pricedTokens, reasons: FIXABLE.filter(reason => item.reasons[reason] > 0) }))
      .sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
  }
  /**
   * Every used model with tokens left out of the estimate, largest first, split into what a
   * price decision can close (fixable) and what the source did not report (incomplete).
   * Tokens per reason come from the snapshot; an older snapshot without them keeps the
   * model's whole remainder under its one known kind, never an invented split.
   */
  function unpricedUsage(models) {
    return (models || []).filter(item => item.tokens > item.pricedTokens).map(item => {
      const missing = item.tokens - item.pricedTokens, split = item.unpriced && Object.keys(item.unpriced).length ? item.unpriced : null;
      const kinds = split ? Object.entries(split) : [[FIXABLE.find(reason => item.reasons[reason] > 0) || 'usage-incomplete', missing]];
      const groups = kinds.filter(([, tokens]) => tokens > 0).map(([reason, tokens]) => ({ reason, tokens, fixable: FIXABLE.includes(reason),
        causes: reason === 'usage-incomplete' ? Object.entries(item.incomplete || {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]).map(([cause, value]) => ({ cause, tokens: value })) : [] }))
        .sort((a, b) => b.tokens - a.tokens);
      const agents = Object.entries(item.unpricedAgents || {}).filter(([, tokens]) => tokens > 0).sort((a, b) => b[1] - a[1]).map(([agent]) => agent);
      return { key: item.key, provider: item.provider, model: item.model, agentIds: item.unpricedAgentIds?.length ? item.unpricedAgentIds : item.agentIds || [], agents: agents.length ? agents : item.agents, tokens: missing, total: item.tokens, ratio: item.tokens ? missing / item.tokens : null, fixable: groups.some(group => group.fixable), groups };
    }).sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key));
  }
  /** Priced, closable and source-limited token totals for the coverage meter. */
  function unpricedTotals(list) {
    const totals = { fixable: 0, incomplete: 0 };
    for (const item of list || []) for (const group of item.groups) totals[group.fixable ? 'fixable' : 'incomplete'] += group.tokens;
    return totals;
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
  return { FIELDS, LABELS, ORIGINS, REASONS, CAUSES, FIXABLE, remediation:labels.remediation, origin, scope, priced, formatCount, formatStamp, usedModels, pricingGaps, unpricedUsage, unpricedTotals, coverage, entry };
});
