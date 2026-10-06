'use strict';
// Presentation only. Business state, focus and requests never wait for an effect.
(() => {
  const key = 'agentusage.motion.v1', active = new Map(), groups = new Map();
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(0.23, 1, 0.32, 1)';
  let preference = 'system';
  try { const saved = localStorage.getItem(key); if (['system', 'reduced', 'off'].includes(saved)) preference = saved; } catch { /* Storage may be unavailable. */ }
  function mode() { return preference === 'off' ? 'off' : preference === 'reduced' || media.matches ? 'reduced' : 'full'; }
  function stop(element) { const animation = active.get(element); if (animation) { active.delete(element); animation.cancel(); } }
  function cancelAll() { for (const element of [...active.keys()]) stop(element); }
  function enter(element, kind = 'update') {
    if (!element || element.hidden || !element.isConnected || document.hidden || element.closest('[hidden]') || element.closest('dialog:not([open])')) return;
    const current = active.get(element), style = current ? getComputedStyle(element) : null;
    const from = style ? { opacity: style.opacity, transform: style.transform } : { opacity: kind === 'tooltip' ? 0 : kind === 'update' ? .86 : .25, transform: kind === 'page' ? 'translateY(6px)' : kind === 'detail' ? 'translateY(4px)' : 'none' };
    stop(element);
    if (mode() === 'off') return;
    if (mode() === 'reduced') from.transform = 'none';
    const duration = mode() === 'reduced' ? 80 : kind === 'tooltip' ? 100 : ['page', 'detail'].includes(kind) ? 180 : 160;
    const animation = element.animate([from, { opacity: 1, transform: 'none' }], { duration, easing: ease });
    active.set(element, animation);
    animation.finished.then(() => { if (active.get(element) === animation) active.delete(element); }).catch(() => {});
  }
  function update(elements) { for (const element of elements) enter(element); }
  function remove(element) {
    if (mode() === 'off' || !element.getClientRects().length || document.hidden) { element.remove(); return; }
    const rect = element.getBoundingClientRect(), ghost = element.cloneNode(true);
    ghost.removeAttribute('data-connection'); ghost.inert = true; ghost.setAttribute('aria-hidden', 'true'); ghost.classList.add('motion-ghost');
    for (const node of [ghost, ...ghost.querySelectorAll('[id]')]) node.removeAttribute('id');
    Object.assign(ghost.style, { position: 'fixed', top: rect.top + 'px', left: rect.left + 'px', width: rect.width + 'px', height: rect.height + 'px', margin: '0', pointerEvents: 'none', zIndex: '100' });
    element.remove(); document.body.append(ghost);
    const animation = ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: mode() === 'full' ? 'translateY(4px)' : 'none' }], { duration: mode() === 'full' ? 120 : 80, easing: ease });
    active.set(ghost, animation);
    const done = () => { active.delete(ghost); ghost.remove(); };
    animation.finished.then(done, done);
  }
  function select(group) {
    if (!group || !group.getClientRects().length) return;
    const selected = group.querySelector(':scope > button[aria-current="page"], :scope > button[aria-pressed="true"]');
    if (!selected) return;
    let marker = groups.get(group);
    if (!marker) {
      marker = document.createElement('span'); marker.className = 'motion-indicator'; marker.setAttribute('aria-hidden', 'true');
      group.classList.add('motion-group'); group.append(marker); groups.set(group, marker);
    }
    const rect = selected.getBoundingClientRect(), parent = group.getBoundingClientRect();
    marker.style.width = rect.width + 'px'; marker.style.height = rect.height + 'px';
    marker.style.transform = 'translate(' + (rect.left - parent.left + group.scrollLeft) + 'px,' + (rect.top - parent.top + group.scrollTop) + 'px)';
  }
  function indicators() { for (const group of document.querySelectorAll('.topbar nav, #periods, .segment')) select(group); }
  function apply() {
    cancelAll(); document.body.dataset.motion = mode();
    const control = document.getElementById('motionSelect'); if (control) control.value = preference;
    indicators();
    // Cancel native CSS animations too when the system preference changes.
    for (const animation of document.getAnimations()) animation.cancel();
    window.dispatchEvent(new Event('ui-motion-change'));
  }
  function setPreference(value) {
    preference = ['system', 'reduced', 'off'].includes(value) ? value : 'system';
    try { localStorage.setItem(key, preference); } catch { /* Session preference still works. */ }
    apply();
  }
  function busy(element, value) { if (!element) return; element.setAttribute('aria-busy', String(Boolean(value))); element.toggleAttribute('data-busy', Boolean(value)); }
  function cleanup() {
    cancelAll();
    document.getElementById('trendTooltip')?.setAttribute('hidden', '');
    const tooltip = document.getElementById('heatTooltip'); tooltip?.classList.remove('visible'); tooltip?.setAttribute('aria-hidden', 'true');
    document.querySelector('#heatmap [aria-describedby]')?.removeAttribute('aria-describedby');
  }
  function observeStatus(element) { if (element) observer.observe(element, { childList: true, characterData: true, subtree: true }); }
  window.uiMotion = Object.freeze({ enter, update, remove, select, indicators, cancelAll, cleanup, busy, observeStatus, setPreference, get mode() { return mode(); }, get preference() { return preference; }, get activeCount() { return active.size; } });
  const row = document.createElement('div');
  row.innerHTML = '<div><h3>界面动效</h3><p>跟随系统的减少动态效果设置</p></div><select id="motionSelect" aria-label="界面动效"><option value="system">跟随系统</option><option value="reduced">减少动态</option><option value="off">关闭</option></select>';
  document.querySelector('#settings .setting-list').append(row);
  row.querySelector('select').addEventListener('change', event => setPreference(event.target.value));
  media.addEventListener('change', apply);
  window.addEventListener('resize', () => { cleanup(); indicators(); });
  window.addEventListener('scroll', cleanup, { passive: true });
  document.addEventListener('visibilitychange', () => { document.body.toggleAttribute('data-page-hidden', document.hidden); if (document.hidden) { cleanup(); for (const animation of document.getAnimations()) animation.cancel(); } else indicators(); });
  // Status-only observer: does not infer navigation, business state or data changes.
  const observer = new MutationObserver(records => {
    for (const element of new Set(records.map(record => record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target))) {
      if (element.textContent.trim()) enter(element);
    }
  });
  for (const id of ['toast', 'exportResult', 'profileError', 'avatarFileStatus', 'quotaError', 'quotaLoginStatus', 'priceResult', 'codexPreviewResult']) {
    observeStatus(document.getElementById(id));
  }
  window.addEventListener('unload', () => { cancelAll(); observer.disconnect(); media.removeEventListener('change', apply); });
  apply();
})();
