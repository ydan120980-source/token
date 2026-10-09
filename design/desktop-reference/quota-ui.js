'use strict';
(() => {
  const byId = id => document.getElementById(id), bridge = window.quotaBridge;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const statuses = { ready: '已更新', cached: '上次缓存', refreshing: '正在刷新', error: '读取失败 · 保留上次结果', 'login-required': '需要重新登录', 'login-failed': '登录未完成', connecting: '等待官方授权' };
  const errors = { LOGIN_REQUIRED: '需要重新登录', CODEX_REQUEST_TIMEOUT: '读取超时', RATE_LIMITED: '服务限流 · 15 分钟冷却', CODEX_EXECUTABLE_REQUIRED: '请选择官方 CLI', CODEX_PROCESS_UNAVAILABLE: 'CLI 无法启动', SYSTEM_CREDENTIAL_STORE_REQUIRED: '系统凭据存储不可用', CODEX_PROTOCOL_INVALID: '服务响应无效', CODEX_PROTOCOL_LIMIT: '服务响应超限', CODEX_REQUEST_FAILED: '服务读取失败 · 60 秒冷却' };
  let detailId = null;
  let state = { accounts: [], pendingLogin: null, executableAvailable: Boolean(bridge) }, example = false, requesting = false;
  const at = date => date && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString('zh-CN', { hour12: false }) : '服务未返回';
  function animateQuota(container, quota, key) {
    container.querySelectorAll('.quota-segments').forEach((bar, index) => window.quotaProgress.set(bar, quota?.windows[index]?.remainingPercent));
    container.querySelectorAll('.quota-window-title strong').forEach((element,index) => {
      const value = quota?.windows[index]?.remainingPercent;
      window.uiDetail.number(element, key + '-' + index, Number.isFinite(value) ? value : null, v => '剩余 ' + (v === null ? '未知' : v.toLocaleString('zh-CN',{maximumFractionDigits:1}) + '%'));
    });
  }
  function remaining(window) { return !Number.isFinite(window.remainingPercent) ? '未知' : window.remainingPercent.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + '%'; }
  function duration(mins) { return mins === null ? '额度窗口' : mins === 10080 ? '每周' : mins % 60 === 0 ? mins / 60 + ' 小时' : mins + ' 分钟'; }
  const image = name => '<img src="assets/ui/' + name + '.svg" alt="">';
  function quotaWindows(quota, limit = Infinity) {
    return (quota?.windows || []).slice(0, limit).map(w => {
      const unknown = w.remainingPercent === null || !Number.isFinite(w.remainingPercent);
      const percent = unknown ? null : Math.max(0, Math.min(100, w.remainingPercent));
      const label = w.name === 'codex' ? duration(w.durationMins) : w.name + ' · ' + duration(w.durationMins);
      return '<div class="quota-window"><div class="quota-window-title"><span>' + esc(label) + '</span><strong>剩余 ' + remaining(w) + '</strong></div><div class="quota-segments' + (unknown ? ' unknown' : percent < 20 ? ' low' : '') + '" role="progressbar" aria-label="' + esc(label) + '剩余"' + (unknown ? ' aria-valuetext="未知"' : ' aria-valuenow="' + percent + '" aria-valuemin="0" aria-valuemax="100"') + '>' + '<span class="quota-track" aria-hidden="true">' + '<i></i>'.repeat(50) + '</span><span class="quota-fill" aria-hidden="true" style="clip-path:inset(0 ' + (100-(percent??0)) + '% 0 0)">' + '<i></i>'.repeat(50) + '</span>' + '</div><div class="quota-reset" title="重置 ' + esc(at(w.resetsAt)) + '">' + image('refresh') + '<span>' + esc(window.displayValues.reset(w.resetsAt)) + '</span></div></div>';
    }).join('') || '<div class="quota-no-data">额度未知</div>';
  }
  function accountStatus(account) {
    return account.errorCode ? errors[account.errorCode] || '操作未完成' : account.duplicateKnown ? '重复连接' : statuses[account.status] || '待连接';
  }
  function disabledRefresh(account) { return !bridge || example || account.busy || Date.parse(account.nextRefreshAt) > Date.now() || account.status === 'connecting'; }
  function age(quota) {
    const fetched = Date.parse(quota?.fetchedAt);
    if (!Number.isFinite(fetched)) return '未更新';
    const mins = Math.max(0, Math.floor((Date.now() - fetched) / 60000));
    return mins < 1 ? '刚刚' : mins < 60 ? mins + ' 分钟前' : mins < 1440 ? Math.floor(mins / 60) + ' 小时前' : Math.floor(mins / 1440) + ' 天前';
  }
  function accountHeading(account) {
    return '<div class="quota-agent-title"><img src="assets/agents/codex.svg" alt=""><h2>Codex</h2><span class="quota-plan">' + esc((account.plan || '未知').toUpperCase()) + '</span></div>';
  }
  // Preserve presentation nodes and focus across age ticks and quota updates.
  function reconcile(target, html) {
    const template = document.createElement('template'); template.innerHTML = html;
    function node(old, next) {
      if (!old || old.nodeType !== next.nodeType || old.nodeName !== next.nodeName) { const copy = next.cloneNode(true); if (old) old.replaceWith(copy); return copy; }
      if (next.nodeType === Node.TEXT_NODE) { if (old.data !== next.data) old.data = next.data; return old; }
      if (next.nodeType !== Node.ELEMENT_NODE) return old;
      for (const attr of [...old.attributes]) if (!next.hasAttribute(attr.name) && !(old.tagName === 'DETAILS' && attr.name === 'open')) old.removeAttribute(attr.name);
      for (const attr of next.attributes) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
      children(old, next); return old;
    }
    function children(old, next) {
      const incoming = [...next.childNodes];
      incoming.forEach((child, index) => { const previous = old.childNodes[index]; const result = node(previous, child); if (!previous) old.append(result); });
      while (old.childNodes.length > incoming.length) old.lastChild.remove();
    }
    children(target, template.content);
  }
  function renderDetail() {
    const dialog = byId('quotaDetailDialog');
    if (!detailId) return;
    const account = state.accounts.find(a => a.id === detailId);
    if (!account) { dialog.close(); detailId = null; return; }
    const quota = account.quota, cached = account.status !== 'ready' || !Number.isFinite(Date.parse(quota?.fetchedAt)) || Date.now() - Date.parse(quota?.fetchedAt) > 10 * 60000;
    const diagnosticsOpen = dialog.querySelector('.quota-diagnostics')?.open;
    const active = dialog.contains(document.activeElement) ? document.activeElement.matches('.quota-diagnostics summary') ? 'diagnostics' : document.activeElement.dataset.quotaRefresh ? 'refresh' : document.activeElement.dataset.quotaRemove ? 'remove' : 'close' : null;
    reconcile(byId('quotaDetailContent'), '<header class="quota-panel-top"><strong title="' + esc(account.alias) + '">' + esc(account.alias || '账号详情') + '</strong><div><button class="icon-button" data-quota-refresh="' + esc(account.id) + '" aria-label="刷新"' + (disabledRefresh(account) ? ' disabled' : '') + '>' + image('refresh') + '</button><button class="icon-button" data-quota-close aria-label="关闭账号详情">' + image('x') + '</button></div></header><section class="quota-panel-windows">' + accountHeading(account) + quotaWindows(quota) + (quota?.resetCredits === null || quota?.resetCredits === undefined ? '' : '<div class="quota-credits">重置次数 <b>' + esc(quota.resetCredits) + '</b></div>') + '</section><div class="quota-panel-status"><span>' + esc(accountStatus(account)) + '</span><span title="' + esc(at(quota?.fetchedAt)) + '">' + age(quota) + '</span></div>' + (account.errorCode ? '<p class="quota-panel-error" role="status">' + esc(errors[account.errorCode] || '操作未完成') + (Date.parse(account.nextRefreshAt) > Date.now() ? ' · 可重试 ' + esc(at(account.nextRefreshAt)) : '') + '</p>' : '') + (account.duplicateKnown ? '<p class="quota-panel-error">同一账号的重复连接，额度不可叠加。</p>' : '') + '<details class="quota-diagnostics"><summary>连接信息</summary><dl class="value-facts"><div><dt>数据状态</dt><dd>' + (cached ? '缓存 · 待验证' : '已更新') + '</dd></div><div><dt>最近成功</dt><dd>' + esc(at(quota?.fetchedAt)) + '</dd></div><div><dt>最近尝试</dt><dd>' + esc(at(account.lastAttempt)) + '</dd></div></dl></details><div class="quota-panel-actions"><button data-quota-remove="' + esc(account.id) + '"' + (!bridge || example || account.busy ? ' disabled' : '') + '>移除连接</button></div>');
    dialog.querySelector('.quota-diagnostics').open = Boolean(diagnosticsOpen);
    animateQuota(dialog, quota, 'quota-panel-' + account.id);
    if (active) dialog.querySelector(active === 'close' ? '[data-quota-close]' : active === 'diagnostics' ? '.quota-diagnostics summary' : '[data-quota-' + active + ']')?.focus({ preventScroll: true });
  }
  function renderQuota() {
    const activeCard = document.activeElement?.closest('[data-connection]');
    const focusId = activeCard?.dataset.connection, focusAction = document.activeElement?.hasAttribute('data-quota-details') ? 'details' : 'refresh';
    byId('quotaNotice').textContent = example ? '示例额度 · 合成数据' : '';
    byId('quotaSummary').textContent = state.accounts.length + ' 个连接' + (example ? ' · 示例' : '') + (state.lastBatch ? ' · 成功 ' + state.lastBatch.success + ' / 失败 ' + state.lastBatch.failed + ' / 跳过 ' + state.lastBatch.skipped : '');
    byId('quotaEmpty').hidden = state.accounts.length > 0;
    const container = byId('quotaCards'), existing = new Map([...container.children].map(card => [card.dataset.connection, card]));
    const incoming = state.accounts.map(account => {
      const quota = account.quota;
      const html = '<article class="card quota-card" data-connection="' + esc(account.id) + '"><header>' + accountHeading(account) + '<button class="quota-details icon-button" data-quota-details="' + esc(account.id) + '" aria-label="账号详情">' + image('dots') + '</button></header><div class="quota-alias" title="' + esc(account.alias) + '">' + esc(account.alias || 'Codex 账号') + '</div><div class="quota-widget-windows">' + quotaWindows(quota, 2) + '</div><footer><span class="quota-status" title="' + esc(accountStatus(account) + ' · ' + at(quota?.fetchedAt)) + '">' + esc(accountStatus(account)) + '</span><button data-quota-refresh="' + esc(account.id) + '" aria-label="刷新"' + (disabledRefresh(account) ? ' disabled' : '') + '>' + image('refresh') + '<span>' + age(quota) + '</span></button>' + ((quota?.windows.length || 0) > 2 ? '<button data-quota-details="' + esc(account.id) + '" class="quota-more">+' + (quota.windows.length - 2) + '</button>' : '') + '</footer></article>';
      let card = existing.get(account.id);
      if (!card) { const template = document.createElement('template'); template.innerHTML = html; card = template.content.firstElementChild; container.append(card); window.uiMotion.enter(card, 'detail'); }
      else { const template = document.createElement('template'); template.innerHTML = html; const next = template.content.firstElementChild; const changed = JSON.stringify(account.quota?.windows || []) !== card.dataset.windows; reconcile(card, next.innerHTML); if (changed) window.uiMotion.enter(card.querySelector('.quota-widget-windows')); }
      card.dataset.windows = JSON.stringify(account.quota?.windows || []);
      animateQuota(card, quota, 'quota-card-' + account.id);
      window.uiMotion.busy(card.querySelector('[data-quota-refresh]'), account.busy);
      existing.delete(account.id); return card;
    });
    for (const card of existing.values()) window.uiMotion.remove(card);
    incoming.forEach((card, index) => { if (container.children[index] !== card) container.insertBefore(card, container.children[index] || null); });
    if (focusId) [...byId('quotaCards').querySelectorAll('[data-connection]')].find(card => card.dataset.connection === focusId)?.querySelector('[data-quota-' + focusAction + ']')?.focus({ preventScroll: true });
    renderDetail(); window.uiMotion.busy(byId('quotaRefreshAll'), state.operationBusy && !state.pendingLogin);
    window.uiSelect?.syncAll();
    window.uiMotion.busy(byId('quotaLoginStart'), Boolean(state.pendingLogin) || (requesting && byId('quotaLoginDialog').open));
    byId('quotaAdd').disabled = !bridge || example || Boolean(state.pendingLogin) || requesting || !state.executableAvailable;
    byId('quotaRefreshAll').disabled = !bridge || example || requesting || !state.accounts.length || Boolean(state.pendingLogin);
    byId('quotaInterval').disabled = !bridge || example;
    byId('quotaInterval').value = state.autoRefresh === '1min' ? '60000' : 'off';
    byId('quotaChoose').disabled = Boolean(state.operationBusy) || requesting;
    byId('quotaChoose').hidden = !bridge; byId('quotaExample').hidden = Boolean(bridge);
    if (state.pendingLogin) { byId('quotaLoginStatus').textContent = '请在官方浏览器页面完成授权，完成后会读取额度。'; byId('quotaCancel').hidden = false; }
    else { byId('quotaCancel').hidden = true; if (byId('quotaLoginDialog').open && byId('quotaLoginStatus').textContent) { byId('quotaLoginStatus').textContent = state.accounts.some(a => a.status === 'login-failed') ? '登录未完成，可关闭后重试。' : '连接流程结束，请查看账号卡片的状态。'; byId('quotaLoginStart').disabled = false; } }
    // A damaged cache is quarantined instead of blocking start-up; explain the
    // empty list so the user knows why the accounts disappeared.
    if (state.recovered && !requesting) {
      byId('quotaError').textContent = '检测到受损的 ' + state.recovered.file + (state.recovered.quarantined ? '，已移入数据目录下的 quarantine 文件夹' : '，且无法移入 quarantine') + '，账号列表已重置，请重新连接。';
    }
  }
  async function action(fn) { if (requesting) return; requesting = true; byId('quotaError').textContent = ''; renderQuota(); try { const result = await fn(); if (result?.state) state = result.state; if (!result?.ok) byId('quotaError').textContent = result?.error || '操作失败，上次数据保留。'; } catch { byId('quotaError').textContent = '桌面连接失败，上次数据保留。'; } finally { requesting = false; renderQuota(); if (byId('quotaLoginDialog').open && !state.pendingLogin) { byId('quotaLoginStart').disabled = false; if (byId('quotaError').textContent) byId('quotaLoginStatus').textContent = byId('quotaError').textContent; } } }
  async function refreshAll() { if (!bridge || example) return; await action(() => bridge.refreshAll()); }
  byId('quotaAdd').onclick = () => { byId('quotaAlias').value = ''; byId('quotaLoginStatus').textContent = ''; byId('quotaLoginStart').disabled = false; byId('quotaLoginDialog').showModal(); };
  byId('quotaLoginStart').onclick = () => { byId('quotaLoginStart').disabled = true; void action(() => bridge.login(byId('quotaAlias').value.trim() || 'Codex 账号')); };
  async function closeLogin() { if (bridge && (state.pendingLogin || requesting)) { try { const result = await bridge.cancel(); if (result?.state) state = result.state; } catch { byId('quotaError').textContent = '取消失败，请关闭应用终止本次连接。'; } } byId('quotaLoginDialog').close(); renderQuota(); }
  byId('quotaClose').onclick = closeLogin; byId('quotaCancel').onclick = closeLogin;
  byId('quotaLoginDialog').addEventListener('cancel', event => { event.preventDefault(); void closeLogin(); });
  byId('quotaRefreshAll').onclick = refreshAll;
  byId('quotaChoose').onclick = () => action(() => bridge.chooseExecutable());
  function accountAction(event) {
    const details = event.target.closest('[data-quota-details]'), refresh = event.target.closest('[data-quota-refresh]'), remove = event.target.closest('[data-quota-remove]');
    if (details) { detailId = details.dataset.quotaDetails; renderDetail(); byId('quotaDetailDialog').showModal(); }
    if (event.target.closest('[data-quota-close]')) byId('quotaDetailDialog').close();
    if (refresh && !refresh.disabled) void action(() => bridge.refresh(refresh.dataset.quotaRefresh));
    if (remove && !remove.disabled) void action(() => bridge.remove(remove.dataset.quotaRemove));
  }
  byId('quotaCards').onclick = accountAction;
  byId('quotaDetailContent').onclick = accountAction;
  byId('quotaDetailDialog').addEventListener('close', () => { detailId = null; });

  byId('quotaInterval').onchange = () => { const value = byId('quotaInterval').value === 'off' ? 'off' : '1min'; void action(() => bridge.setAutoRefresh(value)); };
  byId('quotaExample').onclick = () => {
    example = !example; byId('quotaExample').textContent = example ? '返回未连接状态' : '查看示例卡片';
    const fetchedAt = new Date().toISOString();
    state.accounts = example ? ['个人 · 示例', '工作 · 示例'].map((alias, i) => ({ id: 'example-' + i, alias, plan: i ? 'Pro · 示例' : 'Plus · 示例', status: i ? 'cached' : 'ready', quota: { fetchedAt, resetCredits: i ? null : 2, windows: [{ name: 'codex', durationMins: 300, usedPercent: i ? 84 : 36, remainingPercent: i ? 16 : 64, resetsAt: new Date(Date.now() + 2 * 3600000).toISOString() }, { name: 'codex', durationMins: 10080, usedPercent: i ? null : 42, remainingPercent: i ? null : 58, resetsAt: null }] } })) : []; renderQuota();
  };
  renderQuota();
  const ageTimer = setInterval(renderQuota, 30000); // Local display only; never requests quota.
  let unsubscribe;
  window.addEventListener('unload', () => { clearInterval(ageTimer); unsubscribe?.(); });
  if (bridge) { unsubscribe = bridge.onUpdate(async () => { try { const result = await bridge.get(); if (result.ok) { state = result.state; renderQuota(); } } catch { /* Window may be closing. */ } }); void action(() => bridge.get()); document.querySelector('[data-view="quota"]').click(); byId('quotaExample').hidden = true; document.querySelector('.local-badge').textContent = '数据保存在本机'; document.title = 'Agent Usage · Codex 额度'; }
})();
