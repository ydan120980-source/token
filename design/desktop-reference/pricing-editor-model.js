'use strict';
/**
 * The settings pricing panel's own calculations, moved verbatim out of the retired
 * pricing-controller.js (M3, 2026-10-25) so the React page and node --test share them.
 * Pure data only: no DOM, no bridge, no writes. Formatting comes from uiPricing / uiPricingView.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./pricing-view'));
  else root.pricingEditorModel = factory(root.uiPricingView);
})(typeof window === 'undefined' ? this : window, function (view) {
  // The list opens on the heaviest models; a search always shows every match.
  const COLLAPSED_ROWS = 8;
  /** A custom rate must remain reachable for editing before the model is used. */
  function withManualRows(models, rows) {
    const out = models.slice();
    for (const row of rows || []) if (row.origin === 'manual' && !out.some(item => item.key === row.provider + '/' + row.model)) out.push({ key: row.provider + '/' + row.model, provider: row.provider, model: row.model, row, manual: true, agents: [], tokens: 0, pricedTokens: 0, share: null });
    return out;
  }
  /** Rows with left-out usage first, filtered by the search, folded to the heaviest eight. */
  function table(models, gaps, query, expanded, pricing) {
    const needle = String(query || '').trim().toLowerCase();
    const byGap = Object.fromEntries(gaps.map(gap => [gap.key, gap])), ordered = [...models].sort((a, b) => (byGap[b.key]?.tokens || 0) - (byGap[a.key]?.tokens || 0));
    const shown = needle ? ordered.filter(item => (item.key + ' ' + item.agents.join(' ') + ' ' + pricing.origin(item.row).label).toLowerCase().includes(needle)) : ordered;
    const folded = !needle && shown.length > COLLAPSED_ROWS;
    return {
      rows: folded && !expanded ? shown.slice(0, COLLAPSED_ROWS) : shown, byGap, folded,
      expandText: expanded ? '收起，只看前 ' + COLLAPSED_ROWS + ' 个' : '展开其余 ' + (shown.length - COLLAPSED_ROWS) + ' 个模型',
      count: models.length ? (needle ? shown.length + ' / ' : '') + models.length : '',
      empty: needle ? '没有匹配的已用模型。' : '采集后显示已使用的模型。'
    };
  }
  /** Share of usage priced, or null when there is no usage yet (shown as unknown, never 0%). */
  function coverageText(value) { return !value || value.ratio === null ? null : (value.ratio * 100).toFixed(value.ratio > .999 && value.ratio < 1 ? 2 : 1) + '%'; }
  /** The meter's three segments as fractions of all usage. */
  function shares(value, totals) {
    const part = tokens => value && value.tokens ? tokens / value.tokens : 0;
    return { priced: part(value ? value.priced : 0), fixable: part(totals.fixable), incomplete: part(totals.incomplete) };
  }
  /** Models with left-out usage head the table; one line says how many and where to look. */
  function attentionText(gaps, totals) { return gaps.length ? gaps.length + ' 个模型有 ' + view.short(totals.fixable + totals.incomplete) + ' Token 未计入估算' : ''; }
  function syncText(sync, pricing) { return sync?.syncing ? '正在更新价格目录…' : sync?.error ? '同步失败，继续使用上次有效价格' : sync?.lastSuccess ? '上次同步 ' + pricing.formatStamp(sync.lastSuccess) : '内置价格可离线使用'; }
  // A row priced through a rule (mapped, default, fallback, matched by id) has no catalog price of its own to bill by.
  function priceTargets(rows, pricing) { return (rows || []).filter(row => pricing.scope(row) === 'priced' && !['mapped', 'default-model', 'fallback', 'model-id'].includes(row.origin)).map(row => row.provider + '/' + row.model); }
  function templateRow(rows, key) { return (rows || []).find(row => row.provider + '/' + row.model === key) || null; }
  /** The sheet's heading for a used model (key) or a custom identifier (null). */
  function editor(key, models, rows, pricing) {
    const item = models.find(model => model.key === key) || null, row = key ? templateRow(rows, key) : null;
    const [provider, ...rest] = (key || '/').split('/');
    return {
      provider: key ? provider : '', model: key ? rest.join('/') : '',
      title: key ? rest.join('/') : '为其他模型添加价格', eyebrow: key ? provider : '手动价格',
      meta: item ? [item.agents.join(' · '), view.short(item.tokens) + ' Token', pricing.origin(item.row).label].filter(Boolean).join(' · ') : '模型尚未出现在记录中时，保存后对之后的采集生效。',
      fill: row && row.origin === 'manual' ? row.rates : row && pricing.priced(row) ? row.rates : null,
      manual: Boolean(row && row.origin === 'manual'), startMode: !key || row?.origin === 'manual' ? 'manual' : 'map'
    };
  }
  function mappingPreview(raw, rows, pricing) {
    const value = String(raw || '').trim(), target = templateRow(rows, value);
    return !value ? '' : target && pricing.priced(target) ? '每百万 Token：' + pricing.FIELDS.map(field => pricing.LABELS[field] + ' ' + (Number.isFinite(target.rates[field]) ? '$' + target.rates[field] : '未知')).join(' · ') : '目录中没有这个可计价模型。';
  }
  function money(value) { return !Number.isFinite(value) ? '未计价' : value > 0 && value < .01 ? '<$0.01' : '$' + value.toFixed(2); }
  function share(coverage) { return !coverage || !coverage.tokens ? '—' : !coverage.counted ? '0%' : view.percent(coverage.counted / coverage.tokens); }
  /** What stays out after a change, one line per reason. */
  function leftLines(left, pricing) { return (left || []).map(row => view.short(row.tokens) + ' Token：' + (row.cause ? pricing.CAUSES[row.cause] || pricing.REASONS['usage-incomplete'] : pricing.REASONS[row.reason] || row.reason)); }
  /** A dry run in plain words: will this count, how much of it, and what stays out. */
  function verdict(coverage, pricing) {
    if (!coverage || !coverage.tokens) return { kind: 'empty', label: '还没有记录', detail: '', left: [] };
    const kind = coverage.counted >= coverage.tokens ? 'full' : coverage.counted > 0 ? 'some' : 'none';
    return { kind, label: kind === 'full' ? '全部可计入' : kind === 'some' ? '可计入 ' + share(coverage) : '不能计入',
      detail: coverage.counted ? view.short(coverage.counted) + ' Token 计入' + (coverage.lower !== null ? '，约 ' + money(coverage.lower) : '') : '一个 Token 都算不进去', left: leftLines(coverage.left, pricing) };
  }
  /** Whether a dry run can be asked: identity plus input and output rates. */
  function probeReady(entry) { return Boolean(entry.provider && entry.model && Number.isFinite(entry.inputUncached) && Number.isFinite(entry.output)); }
  function probeText(result, pricing) {
    const sample = result.sample, impact = result.affectedRecords ? '影响 ' + pricing.formatCount(result.affectedRecords) + ' 条历史记录 · ' + pricing.formatCount(result.affectedTokens) + ' Token' : '当前没有历史记录使用此模型';
    const estimate = sample && Number.isFinite(sample.lower) ? '一条记录试算：$' + sample.lower.toFixed(6) + (sample.upper > sample.lower ? ' – $' + sample.upper.toFixed(6) : '') + '（已应用当前倍率）' : sample ? '示例记录的用量不完整，暂时无法确定费用' : '保存后，新采集记录也会使用此价格';
    const counted = result.coverage && result.coverage.tokens ? verdict(result.coverage, pricing) : null;
    return (counted ? '保存后' + counted.detail + '。' + (counted.left.length ? '仍不能计入 ' + counted.left.join('；') + '。' : '') : '') + impact + '。' + estimate + '。保存前不会改变估算。';
  }
  // A rejected probe is the backend's validation verdict, not a transport failure.
  function probeErrorText(error) { return /PRICE_/.test(String((error && error.message) || '')) ? '请确认模型标识，并填写有效的非负价格。空白缓存费率表示未知。' : '试算不可用，保存仍会由后端校验。'; }
  function resetErrorText(error) { return String(error?.message).includes('PRICE_TARGET_IN_USE') ? '此费率仍被模型映射或默认模型引用。请先解除对应规则，再移除；输入与原规则保留。' : '撤销未完成，输入与原规则保留；请重试移除。'; }
  /** One Agent's rule as editable text; the default is the actual model at multiplier 1. */
  function billingDraft(billing, agent) { const d = billing.defaults[agent] || { multiplier: 1, mode: 'actual' }; return { mode: d.mode === 'default' ? 'default' : 'actual', multiplier: String(d.multiplier), model: d.model || '' }; }
  /** Blank is not zero; a default model must be a complete priced catalog identifier. */
  function billingCheck(draft, rows, pricing) {
    const raw = String(draft.multiplier).trim(), number = Number(raw);
    const valid = raw !== '' && Number.isFinite(number) && number >= 0 && number <= 1000;
    const modelValid = draft.mode !== 'default' || (rows || []).some(r => r.provider + '/' + r.model === String(draft.model).trim() && pricing.scope(r) === 'priced');
    return { valid, modelValid, error: !valid ? '倍率必须为 0–1000 的数字；空白不等于 0。' : !modelValid ? '请选择目录中的完整计费模型标识。' : '' };
  }
  function billingValue(draft) { return { multiplier: Number(draft.multiplier), mode: draft.mode, model: String(draft.model).trim() }; }
  return { COLLAPSED_ROWS, withManualRows, table, coverageText, shares, attentionText, syncText, priceTargets, templateRow, editor, mappingPreview, money, share, leftLines, verdict, probeReady, probeText, probeErrorText, resetErrorText, billingDraft, billingCheck, billingValue };
});
