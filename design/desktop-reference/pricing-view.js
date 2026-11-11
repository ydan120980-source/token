'use strict';
/**
 * What the settings pricing panel says, as text and plain data for the React page
 * (ui/src/pages/settings/pricing). No DOM, no bridge, no writes, so node --test can exercise every
 * branch. The panel answers two questions in order: how much of my usage is priced, and what each
 * used model is billed as. A compact table lists the used models, the ones with usage left out of
 * the estimate first; a row opens one sheet that holds why it is left out, what to do, the alias
 * suggestions and the manual rate (UI-SETTINGS-PRICING-20261020.md). Until M3 (2026-10-25) these
 * builders returned the panel's HTML; the wording and formatting are unchanged.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.uiPricingView = factory();
})(typeof window === 'undefined' ? this : window, function () {
  function short(value) { if (!Number.isFinite(value)) return '—'; if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B'; if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M'; if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K'; return String(value); }
  // Catalog rates can carry binary float noise (0.0078000000000000005); display only, never recalculate.
  function usd(value) { return '$' + Number(value.toPrecision(6)); }
  function percent(ratio) { return ratio >= .995 ? '100%' : ratio < .001 ? '<0.1%' : (ratio * 100).toFixed(ratio < .1 ? 1 : 0) + '%'; }
  /** The manual form's field placeholders: input and output are required, a blank cache rate is unknown. */
  function fieldPlaceholder(field, index) { return index < 2 ? '必填' : field === 'cacheWrite' ? '免费填 0，留空为未知' : '留空表示未知'; }
  /** A row's four rates: null for an unknown field (shown as unknown, never $0); unpriced without input and output. */
  function rates(row, pricing) {
    const values = pricing.FIELDS.map(field => row && row.rates ? row.rates[field] : null);
    if (!Number.isFinite(values[0]) || !Number.isFinite(values[1])) return { priced: false, values: [], title: '' };
    return { priced: true, values: values.map(value => Number.isFinite(value) ? usd(value) : null),
      title: pricing.FIELDS.map((field, i) => pricing.LABELS[field] + ' ' + (Number.isFinite(values[i]) ? usd(values[i]) : '未知')).join(' · ') };
  }
  /** One used model's table row: what it is billed as, at what rates, how much it weighs and how much is left out. */
  function row(item, gap, pricing) {
    const origin = pricing.origin(item.row), routed = item.target && item.target !== item.key;
    return {
      key: item.key, model: item.model, detail: [item.provider].concat(item.agents || []).join(' · '), openLabel: item.model + '：价格与处理方法',
      basis: origin.label, scope: origin.scope, routedTo: routed ? item.target : null, rates: rates(item.row, pricing), tokens: short(item.tokens),
      leftOut: gap ? { fixable: Boolean(gap.fixable), text: '未计入 ' + (gap.ratio === null ? short(gap.tokens) : percent(gap.ratio)), title: short(gap.tokens) + ' Token 未计入估算' } : null,
      share: !gap && Number.isFinite(item.share) ? (item.share * 100).toFixed(item.share < .001 ? 2 : 1) + '%' : null
    };
  }
  /** Alias candidates for one model; none means nothing to show. */
  function suggestions(key, value) {
    if (!value?.candidates?.length) return null;
    return {
      title: '匹配建议 · ' + value.total + ' 个候选',
      note: (value.ambiguous ? '存在多个候选，尚未选择。' : '尚未应用此候选。') + '请核对服务商与版本，选择后仍需明确保存。映射不能补齐来源缺失的用量。',
      candidates: value.candidates.map(candidate => ({
        target: candidate.target, reason: candidate.reason,
        provenance: '服务商 ' + candidate.provider + ' · 依据 ' + candidate.origin + (candidate.source ? ' · ' + candidate.source : ''),
        rates: 'USD / 百万 Token：' + [['inputUncached', '输入'], ['output', '输出'], ['cacheRead', '缓存读取'], ['cacheWrite', '缓存写入']].map(([field, label]) => label + ' ' + (Number.isFinite(candidate.rates[field]) ? usd(candidate.rates[field]) : '未知')).join(' · ')
      })),
      more: value.total > value.candidates.length ? '显示前 ' + value.candidates.length + ' 个标识匹配；可在计费模型中搜索完整目录。没有按价格排序。' : null
    };
  }
  /**
   * Why one model's usage is left out of the estimate, each reason with its tokens (incomplete
   * usage names what the source did not report), and what to do. A price decision cannot fill
   * a field the source never wrote, so those reasons point to source management instead.
   */
  function status(item, pricing) {
    if (!item) return null;
    const hasMissingWrite = item.groups.some(g => g.causes && g.causes.some(c => c.cause === 'missing-cacheWrite'));
    const lines = item.groups.flatMap(group => group.causes && group.causes.length
      ? group.causes.map(cause => ({ fixable: false, text: pricing.CAUSES[cause.cause] || pricing.REASONS['usage-incomplete'], tokens: cause.tokens, cause: cause.cause }))
      : [{ fixable: group.fixable, text: pricing.REASONS[group.reason] || group.reason, tokens: group.tokens, cause: null }]);
    const guides = lines.map(line => pricing.remediation(line.fixable ? item.groups.find(g => g.fixable)?.reason : 'usage-incomplete', line.cause));
    const sourceIds = item.agentIds || [];
    // Only usage the source left incomplete is fixed there; a missing price is fixed in this sheet.
    const sources = !lines.some(line => !line.fixable) ? [] : sourceIds.length ? sourceIds.map((id, index) => ({ id, label: '检查 ' + (item.agents[index] || id) })) : [{ id: 'all', label: '查看来源' }];
    return {
      key: item.key, title: '未计入估算', amount: short(item.tokens) + ' Token' + (item.ratio === null ? '' : ' · 占该模型 ' + percent(item.ratio)),
      lines: lines.map(line => ({ fixable: line.fixable, text: line.text + (lines.length > 1 ? ' · ' + short(line.tokens) : '') })),
      guides: guides.map((guide, index) => ({ title: lines[index].text + '：' + guide.summary, steps: guide.steps })),
      checkManual: hasMissingWrite, sources
    };
  }
  /** The coverage legend for the three meter segments; unknown stays out, never 0. */
  function coverageLegend(value, totals) {
    if (!value || value.ratio === null) return { empty: '采集后显示定价覆盖。', items: [], total: '' };
    const items = [{ kind: 'priced', label: '已定价', tokens: short(value.priced) }];
    if (totals.fixable > 0) items.push({ kind: 'fixable', label: '可设置价格', tokens: short(totals.fixable) });
    if (totals.incomplete > 0) items.push({ kind: 'incomplete', label: '来源未报告完整', tokens: short(totals.incomplete) });
    return { empty: null, items, total: '共 ' + short(value.tokens) + ' Token' };
  }
  /** Provenance in one quiet sentence; digests stay in the title for diagnostics. */
  function catalogLine(data, pricing) {
    if (!data) return '';
    const counts = data.counts || {};
    return '价格目录 ' + (String(data.version || '').includes('models-dev') ? 'models.dev 与官方价目' : '内置官方价目') + ' · 更新于 ' + pricing.formatStamp(data.obtainedAt) +
      (Number.isFinite(counts.models) ? ' · ' + pricing.formatCount(counts.models) + ' 个模型' : '') + ' · USD / 百万 Token';
  }
  function catalogTitle(data) {
    if (!data) return '';
    return ['版本 ' + (data.version || '未知'), data.sha256 && '目录 ' + String(data.sha256).slice(0, 10), data.overrideSha256 && '手动规则 ' + String(data.overrideSha256).slice(0, 10)].filter(Boolean).join(' · ');
  }
  function countsText(models, list) {
    if (!models || !models.length) return '';
    return models.length + ' 个已用模型' + (list && list.length ? ' · ' + list.length + ' 个有未计入估算的用量' : ' · 全部已定价');
  }
  /** Catalog and manual rows usable as a manual-price template, plus "do not copy". */
  function templateOptions(models, selected) {
    const options = [{ value: '', label: '不复制' }].concat((models || [])
      .filter(row => !['unpriced', 'reference-unverified', 'official-thirdparty-unverified'].includes(row.origin) && Number.isFinite(row.rates?.inputUncached) && Number.isFinite(row.rates?.output))
      .map(row => ({ value: row.provider + '/' + row.model, label: row.provider + '/' + row.model })));
    // Only echo a remembered selection that still exists, so a dropped model
    // cannot silently keep filling the form with a stale price.
    return { options, selected: (models || []).some(row => row.provider + '/' + row.model === selected) ? selected : '' };
  }
  return { short, usd, percent, fieldPlaceholder, rates, row, suggestions, status, coverageLegend, catalogLine, catalogTitle, countsText, templateOptions };
});
