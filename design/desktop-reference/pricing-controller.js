'use strict';
/**
 * Settings pricing panel: filter, inspect and override the API-equivalent
 * catalog. All markup comes from uiPricingView and all formatting from
 * uiPricing, so this file only owns state and event wiring.
 * Every write goes through usageBridge; the renderer never edits files.
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
  let rows = [], loading = false, reloadQueued = false, probeTimer = null, probeToken = 0, billing = {autoSync:true,defaults:{},mappings:{}}, limit = 100;

  host.innerHTML = view.panelHtml(pricing);
  // motion.js runs before this panel exists, so its status observer has to be
  // attached again for the two elements this module creates.
  for (const id of ['priceResult', 'priceProbe']) window.uiMotion.observeStatus($(id));

  const templateLabel = document.createElement('label');
  templateLabel.className = 'field price-template-field'; templateLabel.textContent = '从已有模型复制价格（可选）';
  const templateSelect = document.createElement('select');
  templateSelect.id = 'priceTemplate'; templateSelect.setAttribute('aria-label', '价格模板');
  templateLabel.append(templateSelect); $('priceTemplateMount').append(templateLabel);
  const subjectLabel=document.createElement('label');subjectLabel.className='field price-template-field';subjectLabel.textContent='应用到日志中的模型';
  const subjectSelect=document.createElement('select');subjectSelect.id='priceSubject';subjectSelect.setAttribute('aria-label','应用到日志模型');subjectLabel.append(subjectSelect);$('priceForm').querySelector('.price-identity').before(subjectLabel);

  function tab(name, focus = false) {
    for (const button of host.querySelectorAll('[data-price-tab]')) { const selected = button.dataset.priceTab === name; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1; if (selected && focus) button.focus(); }
    for (const pane of host.querySelectorAll('[data-price-pane]')) pane.hidden = pane.dataset.pricePane !== name;
    window.uiSelect?.close();
  }
  host.querySelector('.pricing-tabs').addEventListener('click',event=>{const button=event.target.closest('[data-price-tab]');if(button)tab(button.dataset.priceTab);});
  host.querySelector('.pricing-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...host.querySelectorAll('[data-price-tab]')],index=tabs.indexOf(document.activeElement);tab(tabs[event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length].dataset.priceTab,true);});
  function editor() { if (!$('priceEditor').open) $('priceEditor').showModal(); window.uiSelect?.scan($('priceEditor')); $('priceProvider').focus(); }
  $('closePriceEditor').addEventListener('click',()=>$('priceEditor').close());
  $('newPrice').addEventListener('click',()=>{$('priceProvider').value='';$('priceModel').value='';fill(null);templateSelect.value='';subjectSelect.value='';window.uiSelect?.syncAll();$('resetPrice').disabled=true;$('priceProbe').textContent='';$('priceEditorTitle').textContent='添加模型价格';editor();});

  function templateRow(key) { return rows.find(row => row.provider + '/' + row.model === key) || null; }
  function fill(values) { for (const field of pricing.FIELDS) $('price-' + field).value = values && values[field] != null ? values[field] : ''; }
  function selectedKey() { return { provider: $('priceProvider').value.trim(), model: $('priceModel').value.trim() }; }
  function entry() {
    return pricing.entry($('priceProvider').value, $('priceModel').value,
      Object.fromEntries(pricing.FIELDS.map(field => [field, $('price-' + field).value])));
  }
  function render() {
    const options = { query: $('priceSearch').value, scope: $('priceScope').value, empty: '没有匹配的模型。' };
    const selected = $('priceObserved').checked ? rows.filter(row=>row.observed) : rows;
    const matched = pricing.filter(selected, options);
    $('priceRows').innerHTML = view.rowsHtml(pricing.groups(matched.slice(0,limit), {}), options, pricing);
    $('priceFilterResult').textContent = view.filterResult(Math.min(limit,matched.length), matched.length);
    $('priceMore').hidden = matched.length <= limit;
  }
  function renderTemplates() {
    const previous = templateSelect.value;
    const next = view.templateOptions(rows, previous);
    templateSelect.innerHTML = next.html; templateSelect.value = next.selected; window.uiSelect?.scan(host);
  }
  async function load() {
    if (loading) { reloadQueued = true; return; } loading = true;
    try {
      const data = await bridge.pricing();
      rows = data.models || [];
      billing = data.billing || billing;
      renderBilling(data);
      render(); renderTemplates();
      $('priceCatalogLine').textContent = view.catalogLine(data, [], pricing);
      $('priceCounts').textContent = view.countsText(data, rows);
    } catch {
      $('priceResult').textContent = '价格读取失败，原规则保留。';
    } finally { loading = false; if(reloadQueued){reloadQueued=false;void load();} }
  }
  function renderBilling(data) {
    const esc = view.attr;
    $('priceAuto').checked = billing.autoSync;
    $('priceSyncNow').disabled = Boolean(data.sync?.syncing);
    $('priceSyncState').textContent = data.sync?.syncing ? '正在更新模型目录…' : data.sync?.error ? '同步失败，继续使用上次有效价格' : data.sync?.lastSuccess ? '上次同步 ' + pricing.formatStamp(data.sync.lastSuccess) + ' · ' + data.sync.modelCount + ' 个可计价模型' : '内置价格可离线使用 · 启动后自动更新';
    const names = Object.fromEntries(Object.entries(window.agentCatalog.agents).map(([id,a]) => [id,a.name]));
    // Do not replace an in-progress edit on status/collector notifications.
    if (!$('billingRows').contains(document.activeElement) && !$('billingRows').dataset.dirty) $('billingRows').innerHTML = Object.entries(names).map(([agent,name])=>{const d=billing.defaults[agent]||{multiplier:1,mode:'actual'};return '<article data-billing-agent="'+agent+'"><strong>'+name+'</strong><label class="field">计费模型<select class="billing-mode" aria-label="'+name+' 计费模式"><option value="actual" '+(d.mode==='actual'?'selected':'')+'>实际记录模型</option><option value="default" '+(d.mode==='default'?'selected':'')+'>指定默认模型</option></select></label><label class="field billing-rate">倍率<input class="billing-multiplier" aria-label="'+name+' 倍率" type="number" min="0" max="1000" step="any" value="'+d.multiplier+'"></label><label class="field billing-target" '+(d.mode==='default'?'':'hidden')+'>默认计费模型<input class="billing-model" aria-label="'+name+' 默认模型" list="priceTargets" placeholder="搜索模型" value="'+esc(d.model||'')+'"></label></article>';}).join('');
    const observed = data.observed || [];
    $('mappingCoverage').textContent = observed.filter(r=>r.priced).length+' / '+observed.length+' 已匹配';
    $('mappingRows').innerHTML = observed.map(r=>{const key=r.provider+'/'+r.model;return '<tr><td>'+view.escape(key)+'</td><td>'+view.escape(billing.mappings[key]|| (r.priced ? r.target||key : '待映射'))+'</td><td><button data-map-key="'+esc(key)+'">映射</button>'+(billing.mappings[key]?' <button data-unmap-key="'+esc(key)+'">撤销</button>':'')+'</td></tr>';}).join('') || '<tr><td colspan="3">采集后显示已使用模型</td></tr>';
    $('observedModels').innerHTML = observed.map(r=>'<option value="'+esc(r.provider+'/'+r.model)+'">').join('');
    const subject=subjectSelect.value;subjectSelect.innerHTML='<option value="">自定义模型 · 手动填写标识</option>'+observed.map(r=>'<option value="'+esc(r.provider+'/'+r.model)+'">'+view.escape(r.provider+'/'+r.model)+'</option>').join('');subjectSelect.value=[...subjectSelect.options].some(option=>option.value===subject)?subject:'';
    $('priceTargets').innerHTML = rows.filter(r=>pricing.scope(r)==='priced').map(r=>'<option value="'+esc(r.provider+'/'+r.model)+'">').join('');
    window.uiSelect?.scan(host);
  }
  async function saveConfig(next, text) {
    try { await bridge.saveBilling(next); delete $('billingRows').dataset.dirty; $('priceResult').textContent = text; await load(); }
    catch { $('priceResult').textContent = '配置未保存：请使用目录中的完整计费模型标识和有效倍率。'; }
  }
  $('saveBilling').addEventListener('click',()=>{const defaults={};for(const row of $('billingRows').children) defaults[row.dataset.billingAgent]={multiplier:Number(row.querySelector('.billing-multiplier').value),mode:row.querySelector('.billing-mode').value,model:row.querySelector('.billing-model').value.trim()};void saveConfig({...billing,defaults},'计费配置已保存，历史估算已更新。');});
  $('billingRows').addEventListener('input',()=>{$('billingRows').dataset.dirty='true';});
  $('billingRows').addEventListener('change',event=>{if(event.target.matches('.billing-mode'))event.target.closest('article').querySelector('.billing-target').hidden=event.target.value!=='default';});
  $('mappingForm').addEventListener('submit',event=>{event.preventDefault();const key=$('mappingFrom').value.trim(),target=$('mappingTo').value.trim();void saveConfig({...billing,mappings:{...billing.mappings,[key]:target}},'模型映射已保存，原始模型标识保留。');});
  $('mappingRows').addEventListener('click',event=>{const map=event.target.closest('[data-map-key]')?.dataset.mapKey,unmap=event.target.closest('[data-unmap-key]')?.dataset.unmapKey;if(map){$('mappingFrom').value=map;$('mappingTo').value=billing.mappings[map]||'';window.uiSelect?.syncAll();$('mappingTo-trigger')?.focus();}if(unmap){const mappings={...billing.mappings};delete mappings[unmap];void saveConfig({...billing,mappings},'映射已撤销，恢复实际记录模型计费。');}});
  $('priceAuto').addEventListener('change',async()=>{try{await bridge.autoPrices($('priceAuto').checked);await load();}catch{$('priceResult').textContent='自动同步设置未保存。';}});
  $('priceSyncNow').addEventListener('click',async()=>{ $('priceSyncNow').disabled=true; $('priceSyncState').textContent='正在更新模型目录…';try{await bridge.syncPrices();$('priceResult').textContent='最新模型价格已同步，手动规则和映射保留。';}catch{$('priceResult').textContent='价格同步未完成，现有价格与手动规则保留。';}finally{await load();} });
  $('priceObserved').addEventListener('change',()=>{limit=100;render();});
  $('priceMore').addEventListener('click',()=>{limit+=100;render();});
  /** Dry run: the backend reports what a save would touch, without writing. */
  function probe() {
    const value = selectedKey();
    if (!value.provider || !value.model) { $('priceProbe').textContent = ''; return; }
    const token = ++probeToken;
    // A rejected probe is the backend's validation verdict, not a transport
    // failure, so its message is worth showing verbatim.
    bridge.probePrice(entry()).then(result => {
      if (token !== probeToken) return;
      const sample=result.sample, impact=result.affectedRecords?'影响 '+pricing.formatCount(result.affectedRecords)+' 条历史记录 · '+pricing.formatCount(result.affectedTokens)+' Token':'当前没有历史记录使用此模型';
      const estimate=sample && Number.isFinite(sample.lower)?'一条记录试算：$'+sample.lower.toFixed(6)+(sample.upper>sample.lower?' – $'+sample.upper.toFixed(6):'')+'（已应用当前倍率）':sample?'示例记录的用量不完整，暂时无法确定费用':'保存后，新采集记录也会使用此价格';
      $('priceProbe').textContent=impact+'。'+estimate+'。保存前不会改变估算。';
    }).catch(error => {
      if (token !== probeToken) return;
      const message = String((error && error.message) || '');
      $('priceProbe').textContent = /PRICE_/.test(message)
        ? '请确认模型标识，并填写有效的非负价格。空白缓存费率表示未知。'
        : '试算不可用，保存仍会由后端校验。';
    });
  }
  function scheduleProbe() { clearTimeout(probeTimer); probeTimer = setTimeout(probe, 250); }

  $('priceSearch').addEventListener('input', ()=>{limit=100;render();});
  $('priceScope').addEventListener('change', render);
  $('priceRows').addEventListener('click', async event => {
    const reset = event.target.closest('[data-reset-price]')?.dataset.resetPrice;
    if(reset){const row=templateRow(reset);if(row){try{await bridge.resetPrice({...row,...row.rates});$('priceResult').textContent='手动规则已撤销。';await load();}catch{$('priceResult').textContent='撤销未完成，原规则保留。';}}return;}
    const key = event.target.closest('[data-edit-price]')?.dataset.editPrice;
    const row = key ? templateRow(key) : null;
    if (!row) return;
    $('priceProvider').value = row.provider; $('priceModel').value = row.model;
    fill(row.rates); $('resetPrice').disabled = row.origin !== 'manual';
    $('priceEditorTitle').textContent = '编辑模型价格'; templateSelect.value = '';subjectSelect.value=key; window.uiSelect?.syncAll(); editor(); probe();
  });
  subjectSelect.addEventListener('change',()=>{const row=templateRow(subjectSelect.value);if(row){$('priceProvider').value=row.provider;$('priceModel').value=row.model;fill(row.rates);$('resetPrice').disabled=row.origin!=='manual';scheduleProbe();}});
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
      $('priceResult').textContent = '手动规则已撤销，恢复内置规则；没有内置规则时恢复未定价。';
      $('priceEditor').close();
      await load();
    } catch { $('priceResult').textContent = '撤销未完成，原规则保留。'; }
  });
  // The panel loads once at startup so a read-only view of the catalog is
  // available before the settings page is ever opened.
  // preview.js dispatches ui-view-change on window (not document), covers both
  // the menu and the in-page navigation, and fires only on a real switch.
  window.addEventListener('ui-view-change', event => { if (event.detail === 'settings') void load(); });
  const unsubscribe = bridge.onUpdate(() => { if (!$('settings').hidden) void load(); });
  window.addEventListener('unload', unsubscribe);
  window.uiPricingCtl = Object.freeze({ load, render, entry });
  void load();
})();
