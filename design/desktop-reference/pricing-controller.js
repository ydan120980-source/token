'use strict';
/**
 * Settings pricing panel: coverage, used-model gaps and per-model billing.
 * All markup comes from uiPricingView and all formatting from uiPricing, so
 * this file only owns state and event wiring. Every write goes through
 * usageBridge; the renderer never edits files.
 */
(() => {
  const bridge = window.usageBridge, host = document.getElementById('usageMaintenance');
  const pricing = window.uiPricing, view = window.uiPricingView;
  if (!bridge || !pricing || !view) {
    if (host) host.innerHTML = '<p class="notice">成本定价与 Codex 用量维护在桌面应用中可用。</p>';
    return;
  }
  if (!host) return;
  const $ = id => document.getElementById(id);
  const names = Object.fromEntries(Object.entries(window.agentCatalog.agents).map(([id, a]) => [id, a.name]));
  let rows = [], data = null, models = [], gaps = [], loading = false, reloadQueued = false, probeTimer = null, probeToken = 0, billing = { autoSync: true, defaults: {}, mappings: {} };
  let editing = null; // key of the used model in the editor, or null for a custom model

  host.innerHTML = view.panelHtml(pricing);
  // motion.js runs before this panel exists, so its status observer has to be
  // attached again for the elements this module creates.
  for (const id of ['priceResult', 'priceProbe', 'mappingPreview']) window.uiMotion.observeStatus($(id));

  const templateLabel = document.createElement('label');
  templateLabel.className = 'field price-template-field'; templateLabel.textContent = '从目录模型复制价格（可选）';
  const templateSelect = document.createElement('select');
  templateSelect.id = 'priceTemplate'; templateSelect.setAttribute('aria-label', '价格模板');
  templateLabel.append(templateSelect); $('priceTemplateMount').append(templateLabel);

  function templateRow(key) { return rows.find(row => row.provider + '/' + row.model === key) || null; }
  function fill(values) { for (const field of pricing.FIELDS) $('price-' + field).value = values && values[field] != null ? values[field] : ''; }
  function entry() {
    return pricing.entry($('priceProvider').value, $('priceModel').value,
      Object.fromEntries(pricing.FIELDS.map(field => [field, $('price-' + field).value])));
  }
  function mode(name) {
    for (const button of $('priceEditor').querySelectorAll('[data-editor-mode]')) button.setAttribute('aria-pressed', String(button.dataset.editorMode === name));
    for (const pane of $('priceEditor').querySelectorAll('[data-editor-pane]')) pane.hidden = pane.dataset.editorPane !== name;
    window.uiSelect?.close(); window.uiSelect?.scan($('priceEditor')); window.uiMotion.indicators?.();
    if (name === 'manual') scheduleProbe(); else previewMapping();
  }
  $('priceEditor').querySelector('.editor-modes').addEventListener('click', event => { const button = event.target.closest('[data-editor-mode]'); if (button) mode(button.dataset.editorMode); });
  $('closePriceEditor').addEventListener('click', () => $('priceEditor').close());

  /** Opens the sheet for a used model (key) or for a custom identifier (null). */
  function openEditor(key) {
    editing = key; const item = models.find(model => model.key === key) || null, row = key ? templateRow(key) : null;
    const [provider, ...rest] = (key || '/').split('/');
    $('priceProvider').value = key ? provider : ''; $('priceModel').value = key ? rest.join('/') : '';
    $('priceForm').querySelector('.price-identity').hidden = Boolean(key);
    $('priceEditorTitle').textContent = key ? rest.join('/') : '为其他模型添加价格';
    $('priceEditorEyebrow').textContent = key ? provider : '手动价格';
    $('priceEditorMeta').textContent = item ? [item.agents.join(' · '), view.short(item.tokens) + ' Token', pricing.origin(item.row).label].filter(Boolean).join(' · ') : '模型尚未出现在记录中时，保存后对之后的采集生效。';
    fill(row && row.origin === 'manual' ? row.rates : row && pricing.priced(row) ? row.rates : null);
    $('resetPrice').disabled = !row || row.origin !== 'manual';
    $('mappingTo').value = key ? billing.mappings[key] || '' : ''; $('unmapPrice').hidden = !(key && billing.mappings[key]);
    templateSelect.value = ''; $('priceProbe').textContent = ''; $('mappingPreview').textContent = '';
    $('priceEditor').querySelector('.editor-modes').hidden = !key;
    if (!$('priceEditor').open) $('priceEditor').showModal();
    window.uiSelect?.syncAll();
    mode(!key || row?.origin === 'manual' ? 'manual' : 'map');
    if (!key) $('priceProvider').focus();
  }
  $('newPrice').addEventListener('click', () => openEditor(null));

  function render() {
    const query = $('priceSearch').value.trim().toLowerCase();
    const shown = query ? models.filter(item => (item.key + ' ' + item.agents.join(' ') + ' ' + pricing.origin(item.row).label).toLowerCase().includes(query)) : models;
    $('priceRows').innerHTML = view.rowsHtml(shown, { empty: query ? '没有匹配的已用模型。' : '采集后显示已使用的模型。' }, pricing);
    $('priceModelCount').textContent = models.length ? (query ? shown.length + ' / ' : '') + models.length : '';
  }
  function renderSummary() {
    const value = pricing.coverage(window.usageModels), incomplete = value.tokens - value.priced - gaps.reduce((sum, gap) => sum + gap.tokens, 0);
    $('priceCoverageValue').textContent = value.ratio === null ? '—' : (value.ratio * 100).toFixed(value.ratio > .999 && value.ratio < 1 ? 2 : 1) + '%';
    $('priceCoverageBar').style.width = (value.ratio ?? 0) * 100 + '%';
    $('priceCoverageNote').textContent = value.ratio === null ? '采集后显示定价覆盖。' : view.short(value.priced) + ' / ' + view.short(value.tokens) + ' Token 有价格' + (incomplete > 0 ? '；另有 ' + view.short(incomplete) + ' Token 的记录缺少用量字段或存在冲突，无法定价' : '');
    $('priceAttention').hidden = !gaps.length; $('priceGaps').innerHTML = view.gapsHtml(gaps, pricing);
    $('priceCounts').textContent = view.countsText(models, gaps);
  }
  function rebuild() {
    if (!data) return;
    models = pricing.usedModels(data.observed, rows, window.usageModels, billing, names); gaps = pricing.pricingGaps(models);
    render(); renderSummary();
  }
  function renderTemplates() {
    const previous = templateSelect.value, next = view.templateOptions(rows, previous);
    templateSelect.innerHTML = next.html; templateSelect.value = next.selected; window.uiSelect?.scan(host);
  }
  async function load() {
    if (loading) { reloadQueued = true; return; } loading = true;
    try {
      data = await bridge.pricing();
      rows = data.models || []; billing = data.billing || billing;
      renderSync(); renderBilling(); rebuild(); renderTemplates();
      $('priceCatalogLine').textContent = view.catalogLine(data, pricing); $('priceCatalogLine').title = view.catalogTitle(data);
      $('priceTargets').innerHTML = rows.filter(r => pricing.scope(r) === 'priced').map(r => '<option value="' + view.attr(r.provider + '/' + r.model) + '">').join('');
      window.uiSelect?.scan(host);
    } catch {
      $('priceResult').textContent = '价格读取失败，原规则保留。';
    } finally { loading = false; if (reloadQueued) { reloadQueued = false; void load(); } }
  }
  function renderSync() {
    $('priceAuto').checked = billing.autoSync;
    $('priceSyncNow').disabled = Boolean(data.sync?.syncing);
    $('priceSyncState').textContent = data.sync?.syncing ? '正在更新价格目录…' : data.sync?.error ? '同步失败，继续使用上次有效价格' : data.sync?.lastSuccess ? '上次同步 ' + pricing.formatStamp(data.sync.lastSuccess) : '内置价格可离线使用';
  }
  function renderBilling() {
    const esc = view.attr;
    // Do not replace an in-progress edit on status/collector notifications.
    if ($('billingRows').contains(document.activeElement) || $('billingRows').dataset.dirty) return;
    $('billingRows').innerHTML = Object.entries(names).map(([agent, name]) => {
      const d = billing.defaults[agent] || { multiplier: 1, mode: 'actual' };
      return '<article data-billing-agent="' + agent + '"><span class="billing-agent"><img src="assets/' + window.agentCatalog.agents[agent].icon + '.svg" alt="">' + name + '</span><label class="field">计费模型<select class="billing-mode" aria-label="' + name + ' 计费模式"><option value="actual" ' + (d.mode === 'actual' ? 'selected' : '') + '>实际记录模型</option><option value="default" ' + (d.mode === 'default' ? 'selected' : '') + '>指定默认模型</option></select></label><label class="field billing-rate">倍率<input class="billing-multiplier" aria-label="' + name + ' 倍率" type="number" min="0" max="1000" step="any" value="' + d.multiplier + '"></label><label class="field billing-target" ' + (d.mode === 'default' ? '' : 'hidden') + '>默认计费模型<input class="billing-model" aria-label="' + name + ' 默认模型" list="priceTargets" placeholder="搜索模型" value="' + esc(d.model || '') + '"></label></article>';
    }).join('');
  }
  async function saveConfig(next, text) {
    try { await bridge.saveBilling(next); delete $('billingRows').dataset.dirty; $('priceResult').textContent = text; await load(); return true; }
    catch { $('priceResult').textContent = '配置未保存：请使用目录中的完整计费模型标识和有效倍率。'; return false; }
  }
  $('saveBilling').addEventListener('click', () => { const defaults = {}; for (const row of $('billingRows').children) defaults[row.dataset.billingAgent] = { multiplier: Number(row.querySelector('.billing-multiplier').value), mode: row.querySelector('.billing-mode').value, model: row.querySelector('.billing-model').value.trim() }; void saveConfig({ ...billing, defaults }, '计费规则已保存，历史估算已更新。'); });
  $('billingRows').addEventListener('input', () => { $('billingRows').dataset.dirty = 'true'; });
  $('billingRows').addEventListener('change', event => { if (event.target.matches('.billing-mode')) event.target.closest('article').querySelector('.billing-target').hidden = event.target.value !== 'default'; });

  function previewMapping() {
    const target = templateRow($('mappingTo').value.trim());
    $('mappingPreview').textContent = !$('mappingTo').value.trim() ? '' : target && pricing.priced(target) ? '每百万 Token：' + pricing.FIELDS.map(field => pricing.LABELS[field] + ' ' + (Number.isFinite(target.rates[field]) ? '$' + target.rates[field] : '未知')).join(' · ') : '目录中没有这个可计价模型。';
  }
  $('mappingTo').addEventListener('input', previewMapping); $('mappingTo').addEventListener('change', previewMapping);
  $('mappingForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!editing) return;
    const target = $('mappingTo').value.trim();
    if (await saveConfig({ ...billing, mappings: { ...billing.mappings, [editing]: target } }, editing + ' 现按 ' + target + ' 计费，原始模型标识保留。')) $('priceEditor').close();
  });
  $('unmapPrice').addEventListener('click', async () => {
    if (!editing) return; const mappings = { ...billing.mappings }; delete mappings[editing];
    if (await saveConfig({ ...billing, mappings }, '已恢复自动匹配：' + editing + ' 按实际记录模型计费。')) $('priceEditor').close();
  });
  $('priceAuto').addEventListener('change', async () => { try { await bridge.autoPrices($('priceAuto').checked); await load(); } catch { $('priceResult').textContent = '自动同步设置未保存。'; } });
  $('priceSyncNow').addEventListener('click', async () => { $('priceSyncNow').disabled = true; $('priceSyncState').textContent = '正在更新价格目录…'; try { await bridge.syncPrices(); $('priceResult').textContent = '最新模型价格已同步，手动规则和映射保留。'; } catch { $('priceResult').textContent = '价格同步未完成，现有价格与手动规则保留。'; } finally { await load(); } });
  /** Dry run: the backend reports what a save would touch, without writing. */
  function probe() {
    if ($('priceForm').hidden) return;
    const value = entry();
    if (!value.provider || !value.model || !Number.isFinite(value.inputUncached) || !Number.isFinite(value.output)) { $('priceProbe').textContent = ''; return; }
    const token = ++probeToken;
    // A rejected probe is the backend's validation verdict, not a transport
    // failure, so its message is worth showing verbatim.
    bridge.probePrice(value).then(result => {
      if (token !== probeToken) return;
      const sample = result.sample, impact = result.affectedRecords ? '影响 ' + pricing.formatCount(result.affectedRecords) + ' 条历史记录 · ' + pricing.formatCount(result.affectedTokens) + ' Token' : '当前没有历史记录使用此模型';
      const estimate = sample && Number.isFinite(sample.lower) ? '一条记录试算：$' + sample.lower.toFixed(6) + (sample.upper > sample.lower ? ' – $' + sample.upper.toFixed(6) : '') + '（已应用当前倍率）' : sample ? '示例记录的用量不完整，暂时无法确定费用' : '保存后，新采集记录也会使用此价格';
      $('priceProbe').textContent = impact + '。' + estimate + '。保存前不会改变估算。';
    }).catch(error => {
      if (token !== probeToken) return;
      const message = String((error && error.message) || '');
      $('priceProbe').textContent = /PRICE_/.test(message)
        ? '请确认模型标识，并填写有效的非负价格。空白缓存费率表示未知。'
        : '试算不可用，保存仍会由后端校验。';
    });
  }
  function scheduleProbe() { clearTimeout(probeTimer); probeTimer = setTimeout(probe, 250); }

  $('priceSearch').addEventListener('input', render);
  host.addEventListener('click', async event => {
    const reset = event.target.closest('[data-reset-price]')?.dataset.resetPrice;
    if (reset) { const row = templateRow(reset); if (row) { try { await bridge.resetPrice({ ...row, ...row.rates }); $('priceResult').textContent = '手动规则已撤销。'; await load(); } catch { $('priceResult').textContent = '撤销未完成，原规则保留。'; } } return; }
    const key = event.target.closest('[data-edit-price]')?.dataset.editPrice;
    if (key) { openEditor(key); if (!$('priceForm').hidden) probe(); }
  });
  templateSelect.addEventListener('change', () => { const row = templateRow(templateSelect.value); if (row) { fill(row.rates); scheduleProbe(); } });
  for (const field of pricing.FIELDS) $('price-' + field).addEventListener('input', scheduleProbe);
  $('priceProvider').addEventListener('input', scheduleProbe); $('priceModel').addEventListener('input', scheduleProbe);
  $('priceForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await bridge.savePrice(entry());
      $('priceResult').textContent = '手动规则已保存，全部历史按新规则重算。';
      $('resetPrice').disabled = false; templateSelect.value = ''; $('priceEditor').close(); await load();
    } catch { $('priceProbe').textContent = '保存失败，请检查模型标识与非负价格；原规则保留。'; }
  });
  $('resetPrice').addEventListener('click', async event => {
    event.preventDefault();
    try {
      await bridge.resetPrice(entry());
      $('resetPrice').disabled = true; templateSelect.value = '';
      $('priceResult').textContent = '手动规则已撤销，恢复目录规则；没有目录规则时恢复未定价。';
      $('priceEditor').close();
      await load();
    } catch { $('priceResult').textContent = '撤销未完成，原规则保留。'; }
  });
  // The panel loads once at startup so a read-only view of the catalog is
  // available before the settings page is ever opened.
  // preview.js dispatches ui-view-change on window (not document), covers both
  // the menu and the in-page navigation, and fires only on a real switch.
  window.addEventListener('ui-view-change', event => { if (event.detail === 'settings') void load(); });
  window.addEventListener('usage-models', rebuild);
  const unsubscribe = bridge.onUpdate(() => { if (!$('settings').hidden) void load(); });
  window.addEventListener('unload', unsubscribe);
  window.uiPricingCtl = Object.freeze({ load, render, entry });
  void load();
})();
