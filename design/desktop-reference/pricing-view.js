'use strict';
/**
 * Markup builders for the settings pricing panel.
 * Pure string output only: no DOM, no bridge, no writes, so node --test can
 * exercise every branch. The controller owns all event wiring.
 * The panel answers three questions in order: how much of my usage is priced,
 * which used models need a decision, and what each used model is billed as.
 * The full public catalog is reachable only as a search target, never as a list.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.uiPricingView = factory();
})(typeof window === 'undefined' ? this : window, function () {
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escape(value) { return String(value).replace(/[&<>"']/g, character => ESCAPES[character]); }
  function attr(value) { return escape(value).replace(/\s+/g, ' '); }
  function short(value) { if (!Number.isFinite(value)) return '—'; if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B'; if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M'; if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K'; return String(value); }
  /** The static shell. Ids are contract: the UI tests and the controller both use them. */
  function panelHtml(pricing) {
    const inputs = pricing.FIELDS.map((field, index) =>
      '<label class="field">' + escape(pricing.LABELS[field]) +
      '<input id="price-' + field + '" type="number" step="any" min="0" max="100000" inputmode="decimal" ' +
      (index < 2 ? 'required' : '') + ' placeholder="' + (index < 2 ? '必填' : '留空表示未知') + '"></label>').join('');
    return '<section class="block pricing-panel" id="pricingPanel" aria-labelledby="pricingTitle">' +
      '<div class="block-heading"><h2 id="pricingTitle">成本定价</h2><span id="priceCounts" class="muted"></span></div>' +
      '<div class="card pc-card">' +
      '<header class="pc-summary"><div class="pc-coverage"><div class="pc-coverage-figure"><strong id="priceCoverageValue">—</strong><span>的用量已定价</span></div><div class="pc-meter" aria-hidden="true"><i id="priceCoverageBar"></i></div><p id="priceCoverageNote"></p></div>' +
      '<div class="pc-sync"><p id="priceSyncState" role="status"></p><div class="pc-sync-actions"><label class="switch"><input type="checkbox" id="priceAuto" role="switch"><span class="switch-track" aria-hidden="true"></span>自动同步</label><button id="priceSyncNow">立即同步</button></div></div></header>' +
      '<section class="pc-attention" id="priceAttention" hidden aria-labelledby="priceAttentionTitle"><h3 id="priceAttentionTitle">需要处理</h3><div id="priceGaps"></div></section>' +
      '<section class="pc-models" aria-labelledby="priceModelsTitle"><div class="pc-section-head"><h3 id="priceModelsTitle">已用模型 <span id="priceModelCount" class="muted"></span></h3><input id="priceSearch" type="search" placeholder="筛选模型或服务商" aria-label="筛选已用模型"></div>' +
      '<div class="pc-table" role="table" aria-label="已用模型与计费依据"><div class="pc-row pc-head" role="row"><span role="columnheader">模型</span><span role="columnheader">计费依据</span><span role="columnheader" title="输入 · 输出 · 缓存读取 · 缓存写入">每百万 Token 价格</span><span role="columnheader">用量</span><span role="columnheader"><span class="sr-only">操作</span></span></div><div id="priceRows" role="rowgroup"></div></div>' +
      '<div class="pc-foot"><button id="priceExpand" class="text-button pc-expand" type="button" aria-controls="priceRows" aria-expanded="false" hidden></button><button id="newPrice" class="text-button" type="button">为其他模型添加价格</button></div></section>' +
      '<details class="pc-billing" id="billingSection"><summary><span><strong>Agent 计费规则</strong><small>倍率与默认计费模型，默认按日志中的实际模型、倍率 1</small></span><img src="assets/ui/chevron-down.svg" alt=""></summary><div id="billingRows" class="billing-list"></div><div class="pc-billing-actions"><button class="primary" id="saveBilling">保存规则</button></div></details>' +
      '<p id="priceResult" role="status"></p></div>' +
      '<p id="priceCatalogLine" class="pc-footnote"></p><datalist id="priceTargets"></datalist>' +
      '<dialog id="priceEditor" class="price-editor" aria-labelledby="priceEditorTitle"><header><div><p class="editor-eyebrow" id="priceEditorEyebrow">计费方式</p><h2 id="priceEditorTitle">设置价格</h2><p id="priceEditorMeta" class="editor-meta"></p></div><button type="button" id="closePriceEditor" class="sheet-close" aria-label="关闭价格编辑"><img src="assets/ui/x.svg" alt=""></button></header>' +
      '<div class="segment editor-modes" role="group" aria-label="计费方式"><button type="button" data-editor-mode="map" aria-pressed="true">按目录模型计费</button><button type="button" data-editor-mode="manual" aria-pressed="false">手动价格</button></div>' +
      '<form id="mappingForm" class="editor-pane" data-editor-pane="map"><p class="editor-intro">适用于路由别名或代理模型：费用按所选目录模型计算，日志中的模型名称保持不变。</p><label class="field">计费模型<input id="mappingTo" aria-label="计费模型" list="priceTargets" placeholder="搜索目录模型" required></label><p id="mappingPreview" class="editor-note" role="status"></p><footer class="editor-actions"><button type="button" id="unmapPrice" hidden>恢复自动匹配</button><button class="primary" type="submit">按此模型计费</button></footer></form>' +
      '<form id="priceForm" class="editor-pane" data-editor-pane="manual" hidden><div class="price-grid price-identity" hidden><label class="field">服务商标识<input id="priceProvider" required maxlength="99" placeholder="例如 openai"></label><label class="field">模型标识<input id="priceModel" required maxlength="179" placeholder="例如 gpt-6.1-sol"></label></div><div id="priceTemplateMount"></div><div class="editor-rate-heading"><strong>每百万 Token 价格</strong><span>USD</span></div><div class="price-grid">' + inputs + '</div><p id="priceProbe" role="status"></p><footer class="editor-actions"><button id="resetPrice" type="button" disabled>移除手动价格</button><button class="primary" id="savePrice" type="submit">保存价格</button></footer></form></dialog></section>';
  }
  function rates(row, pricing) {
    const values = pricing.FIELDS.map(field => row && row.rates ? row.rates[field] : null);
    if (!Number.isFinite(values[0]) || !Number.isFinite(values[1])) return '<span class="pc-rates is-empty">未定价</span>';
    const format = value => Number.isFinite(value) ? '$' + value : '—';
    return '<span class="pc-rates" title="' + attr(pricing.FIELDS.map((field, i) => pricing.LABELS[field] + ' ' + (Number.isFinite(values[i]) ? '$' + values[i] : '未知')).join(' · ')) + '">' + values.map(format).join('<i> · </i>') + '</span>';
  }
  /** One row per used model: what it is billed as, at what rates, and how much it weighs. */
  function rowsHtml(models, options, pricing) {
    const settings = options || {};
    if (!models || !models.length) return '<div class="pc-empty">' + escape(settings.empty || '采集后显示已使用的模型。') + '</div>';
    return models.map(item => {
      const origin = pricing.origin(item.row), scope = origin.scope, routed = item.target && item.target !== item.key;
      return '<div class="pc-row" role="row" data-price-row="' + attr(item.key) + '">' +
        '<span class="pc-model" role="cell"><b>' + escape(item.model) + '</b><small>' + escape([item.provider].concat(item.agents || []).join(' · ')) + '</small></span>' +
        '<span class="pc-basis" role="cell"><span class="pc-badge pc-' + attr(scope) + '">' + escape(origin.label) + '</span>' + (routed ? '<small title="' + attr(item.target) + '">按 ' + escape(item.target) + '</small>' : '') + '</span>' +
        '<span role="cell">' + rates(item.row, pricing) + '</span>' +
        '<span class="pc-usage" role="cell">' + short(item.tokens) + (Number.isFinite(item.share) ? '<small>' + (item.share * 100).toFixed(item.share < .001 ? 2 : 1) + '%</small>' : '') + '</span>' +
        '<span class="pc-act" role="cell"><button type="button" data-edit-price="' + attr(item.key) + '">调整</button>' +
        (item.manual ? '<button type="button" class="text-button" data-reset-price="' + attr(item.key) + '">撤销手动</button>' : '') + '</span></div>';
    }).join('');
  }
  /** Gaps the user can close with a decision, largest unpriced weight first. */
  function gapsHtml(gaps, pricing) {
    if (!gaps || !gaps.length) return '';
    return gaps.map(gap => '<div class="pc-gap"><span class="pc-gap-icon" aria-hidden="true"></span><span class="pc-gap-text"><b>' + escape(gap.key) + '</b><small>' + escape(gap.reasons.map(reason => pricing.REASONS[reason] || reason).join('；')) + ' · 未定价 ' + short(gap.tokens) + ' Token</small></span><button type="button" data-edit-price="' + attr(gap.key) + '">设置计费</button></div>').join('');
  }
  /** Provenance in one quiet sentence; digests stay in the title for diagnostics. */
  function catalogLine(data, pricing) {
    if (!data) return '';
    const counts = data.counts || {};
    return '价格目录 ' + (String(data.version || '').includes('models-dev') ? 'models.dev 与官方价目' : '内置官方价目') + ' · 更新于 ' + pricing.formatStamp(data.obtainedAt) +
      (Number.isFinite(counts.models) ? ' · ' + pricing.formatCount(counts.models) + ' 个模型' : '') + ' · 单位 USD / 百万 Token。API 等价估算，订阅与实际账单可能不同；空白费率表示未知，免费请填 0。';
  }
  function catalogTitle(data) {
    if (!data) return '';
    return ['版本 ' + (data.version || '未知'), data.sha256 && '目录 ' + String(data.sha256).slice(0, 10), data.overrideSha256 && '手动规则 ' + String(data.overrideSha256).slice(0, 10)].filter(Boolean).join(' · ');
  }
  function countsText(models, gaps) {
    if (!models || !models.length) return '';
    return models.length + ' 个已用模型' + (gaps && gaps.length ? ' · ' + gaps.length + ' 个待处理' : ' · 全部已定价');
  }
  function templateOptions(models, selected) {
    const options = ['<option value="">不复制</option>'].concat((models || [])
      .filter(row => !['unpriced','reference-unverified','official-thirdparty-unverified'].includes(row.origin) && Number.isFinite(row.rates?.inputUncached) && Number.isFinite(row.rates?.output))
      .map(row => {
        const key = row.provider + '/' + row.model;
        return '<option value="' + attr(key) + '">' + escape(key) + '</option>';
      }));
    const html = options.join('');
    // Only echo a remembered selection that still exists, so a dropped model
    // cannot silently keep filling the form with a stale price.
    return { html, selected: (models || []).some(row => row.provider + '/' + row.model === selected) ? selected : '' };
  }
  return { escape, attr, short, panelHtml, rowsHtml, gapsHtml, catalogLine, catalogTitle, countsText, templateOptions };
});
