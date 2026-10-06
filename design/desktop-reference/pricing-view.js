'use strict';
/**
 * Markup builders for the settings pricing panel.
 * Pure string output only: no DOM, no bridge, no writes, so node --test can
 * exercise every branch. The controller owns all event wiring.
 * Same UMD shape as pricing-data.js and chart-ui.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.uiPricingView = factory();
})(typeof window === 'undefined' ? this : window, function () {
  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escape(value) { return String(value).replace(/[&<>"']/g, character => ESCAPES[character]); }
  function attr(value) { return escape(value).replace(/\s+/g, ' '); }
  function fieldLabels(pricing) { return pricing.FIELDS.map(field => pricing.LABELS[field]); }
  /** The static shell. Ids are contract: the UI tests and the controller both use them. */
  function panelHtml(pricing) {
    const labels = fieldLabels(pricing);
    const inputs = pricing.FIELDS.map((field, index) =>
      '<label class="field">' + escape(labels[index]) +
      '<input id="price-' + field + '" type="number" step="any" min="0" max="100000" ' +
      (index < 2 ? 'required' : '') + ' placeholder="' + (index < 2 ? 'USD / 1M' : '留空表示未知') + '"></label>').join('');
    const scopes = pricing.SCOPES.map(scope =>
      '<option value="' + attr(scope.value) + '">' + escape(scope.label) + '</option>').join('');
    return '<details class="block" id="pricingPanel"><summary>成本定价 <span id="priceCounts" class="muted"></span></summary><div class="card pricing-card">' +
      '<header class="pricing-sync"><div><h3>模型价格</h3><p id="priceSyncState" role="status"></p></div><div class="pricing-sync-actions"><label class="switch-label"><input type="checkbox" id="priceAuto">自动同步</label><button id="priceSyncNow">立即同步</button></div></header>' +
      '<nav class="pricing-tabs" role="tablist" aria-label="成本定价"><button id="priceTabCatalog" data-price-tab="catalog" role="tab" aria-selected="true" aria-controls="pricePaneCatalog">模型价格</button><button id="priceTabBilling" data-price-tab="billing" role="tab" aria-selected="false" tabindex="-1" aria-controls="pricePaneBilling">计费配置</button><button id="priceTabMapping" data-price-tab="mapping" role="tab" aria-selected="false" tabindex="-1" aria-controls="pricePaneMapping">模型映射</button></nav>' +
      '<section id="pricePaneCatalog" data-price-pane="catalog" role="tabpanel" aria-labelledby="priceTabCatalog"><div class="price-filters"><input id="priceSearch" aria-label="查找模型价格" type="search" placeholder="搜索模型或服务商"><select id="priceScope" aria-label="价格状态">' + scopes + '</select><label class="switch-label"><input type="checkbox" id="priceObserved" checked>已用模型</label><button id="newPrice" class="primary">添加规则</button></div>' +
      '<div class="table-scroll price-table"><table><thead><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存读取</th><th>缓存写入</th><th>价格来源</th></tr></thead><tbody id="priceRows"></tbody></table></div><div class="price-table-footer"><span id="priceFilterResult"></span><span>USD / 百万 Token</span><button id="priceMore" hidden>显示更多</button></div></section>' +
      '<section id="pricePaneBilling" data-price-pane="billing" role="tabpanel" aria-labelledby="priceTabBilling" hidden><div class="pricing-section-heading"><div><h3>按 Agent 配置计费</h3><p>默认使用日志中的实际模型，倍率为 1。</p></div><button class="primary" id="saveBilling">保存配置</button></div><div id="billingRows" class="billing-cards"></div></section>' +
      '<section id="pricePaneMapping" data-price-pane="mapping" role="tabpanel" aria-labelledby="priceTabMapping" hidden><div class="pricing-section-heading"><div><h3>选择路由实际使用的模型</h3><p>映射只影响费用估算，保留日志中的原始模型名称。</p></div><span id="mappingCoverage"></span></div><form id="mappingForm" class="mapping-form"><label class="field">日志模型<input id="mappingFrom" aria-label="日志模型" required placeholder="选择已用模型" list="observedModels"></label><span class="mapping-arrow" aria-hidden="true">→</span><label class="field">按此模型计费<input id="mappingTo" aria-label="计费模型" required placeholder="搜索计费模型" list="priceTargets"></label><button class="primary" type="submit">保存映射</button></form><div class="table-scroll mapping-table"><table><thead><tr><th>日志模型</th><th>当前计费模型</th><th></th></tr></thead><tbody id="mappingRows"></tbody></table></div></section>' +
      '<datalist id="observedModels"></datalist><datalist id="priceTargets"></datalist><p id="priceResult" role="status"></p><details class="pricing-help"><summary>价格依据与计费说明</summary><p>当前 API 等价价格，单位 USD / 百万 Token；订阅与实际账单可能不同。空白费率表示未知，明确免费请填写 0。</p><p id="priceCatalogLine"></p></details></div>' +
      '<dialog id="priceEditor" class="price-editor" aria-labelledby="priceEditorTitle"><header><div><p class="editor-eyebrow">手动定价</p><h2 id="priceEditorTitle">为模型设置价格</h2></div><button type="button" id="closePriceEditor" aria-label="关闭价格编辑">×</button></header><form id="priceForm"><p class="editor-intro">先确认日志模型，再填写每百万 Token 的美元价格。保存后会更新此模型的历史估算。</p><div class="price-grid price-identity"><label class="field">服务商标识<input id="priceProvider" required maxlength="99" placeholder="例如 openai"></label><label class="field">日志中的模型名称<input id="priceModel" required maxlength="179" placeholder="例如 gpt-6.1-sol"></label></div><div id="priceTemplateMount"></div><div class="editor-rate-heading"><strong>每百万 Token 的价格</strong><span>USD</span></div><div class="price-grid">' + inputs + '</div><p id="priceProbe" role="status"></p><footer class="editor-actions"><button id="resetPrice" type="button" disabled>移除手动价格</button><button class="primary" id="savePrice" type="submit">保存价格</button></footer></form></dialog></details>';
  }
  /**
   * One row per model, with a provider heading row per group so a long catalog
   * stays scannable. Manual rows gain an inline reset so a specific rule can be
   * dropped without loading it into the form first.
   */
  function rowsHtml(groups, options, pricing) {
    const settings = options || {};
    const rowHtml = row => {
      const origin = pricing.origin(row), key = row.provider + '/' + row.model;
      const rates = pricing.FIELDS.map(field =>
        '<td>' + escape(pricing.formatRate(row.rates ? row.rates[field] : null)) + '</td>').join('');
      const manual = row.origin === 'manual';
      return '<tr data-price-row="' + attr(key) + '">' +
        '<td>' + escape(row.provider) + '<small>' + escape(row.model) + '</small></td>' + rates +
        '<td><span class="price-origin price-origin-' + attr(pricing.scope(row)) + '">' + escape(origin.label) + '</span>' +
        '<br><button data-edit-price="' + attr(key) + '">编辑</button>' +
        (manual ? ' <button data-reset-price="' + attr(key) + '">撤销</button>' : '') +
        '</td></tr>';
    };
    const heading = group =>
      '<tr class="price-group"><td colspan="6">' + escape(group.provider) +
      '<small>' + group.rows.length + ' 个模型' +
      (group.unpriced ? ' · 未定价 ' + group.unpriced : '') +
      (group.unverified ? ' · 待核实 ' + group.unverified : '') + '</small></td></tr>';
    const body = (groups || []).map(group => heading(group) + group.rows.map(rowHtml).join('')).join('');
    if (!body) return '<tr class="price-empty"><td colspan="6">' + escape(settings.empty || '没有匹配的模型。') + '</td></tr>';
    return body;
  }
  /** Version provenance, shown so a stale catalog is visible instead of implied. */
  function catalogLine(data, daily, pricing) {
    if (!data) return '';
    const counts = data.counts || {};
    const parts = ['计价依据 ' + (data.version || '未知版本')];
    parts.push('获取于 ' + pricing.formatStamp(data.obtainedAt));
    if (data.sha256) parts.push('目录 ' + String(data.sha256).slice(0, 10));
    if (data.overrideSha256) parts.push('手动规则 ' + String(data.overrideSha256).slice(0, 10));
    if (Number.isFinite(counts.models)) parts.push('模型 ' + pricing.formatCount(counts.models));
    if (Number.isFinite(counts.priced)) parts.push('已定价 ' + pricing.formatCount(counts.priced));
    if (Number.isFinite(counts.unpriced)) parts.push('未定价 ' + pricing.formatCount(counts.unpriced));
    if (Number.isFinite(counts.manual)) parts.push('手动 ' + pricing.formatCount(counts.manual));
    return parts.join(' · ');
  }
  function countsText(data, rows) {
    if (!data) return '';
    const counts = data.counts || {};
    const priced = Number.isFinite(counts.priced) ? counts.priced : 0;
    const models = Number.isFinite(counts.models) ? counts.models : (rows ? rows.length : 0);
    return models ? priced + ' / ' + models + ' 已定价' : '';
  }
  /**
   * The gap panel answers "which rule is actually missing", so it reports the
   * collected records that fell back to a gap together with their token weight,
   * never just the set of models that exist in the catalog.
   */
  function gapsHtml(gaps, pricing) {
    if (!gaps || !gaps.records) return '当前统计没有已保存记录，计价情况会在采集后显示。';
    const lines = ['已保存记录 ' + pricing.formatCount(gaps.records) + ' 条。'];
    if (!gaps.reasons.length) lines.push('全部按当前规则计价，没有缺口。');
    else lines.push('缺口：' + gaps.reasons.map(entry => escape(entry.label) + ' ' + pricing.formatCount(entry.count) + ' 条').join('；') + '。');
    if (gaps.unpriced.length) {
      lines.push('未定价模型：' + gaps.unpriced.slice(0, 12).map(entry =>
        '<button data-edit-price="' + attr(entry.key) + '">' + escape(entry.key) + '</button> ' +
        pricing.formatCount(entry.count) + ' 条').join('；') +
        (gaps.unpriced.length > 12 ? '；其余 ' + (gaps.unpriced.length - 12) + ' 个已省略' : '') + '。');
    }
    return lines.join('<br>');
  }
  function templateOptions(models, selected) {
    const options = ['<option value="">手动输入</option>'].concat((models || [])
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
  function filterResult(shown, total) {
    if (!Number.isFinite(total) || shown === total) return shown + ' 个模型';
    return '筛选后 ' + shown + ' / ' + total + ' 个模型';
  }
  return { escape, attr, panelHtml, rowsHtml, catalogLine, countsText, gapsHtml, templateOptions, filterResult };
});
