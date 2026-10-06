'use strict';
// The original select remains the single filter value and the saved-state interface.
// Chips carry logo and name, wrap instead of scrolling, list Agents with recorded
// usage first and dim the rest, so new adapters add chips without a scrollbar.
(() => {
  const select = document.getElementById('agentFilter'), group = document.createElement('div');
  group.id = 'agentPicker'; group.className = 'agent-picker'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Agent 筛选');
  const assets = {all:'ui/layout-grid', ...Object.fromEntries(Object.entries(window.agentCatalog.agents).map(([id,a]) => [id,a.icon]))};
  const catalogOrder = [...select.options].map(option => option.value);
  select.before(group); select.hidden = true; select.setAttribute('data-agent-control', '');
  for (const option of select.options) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.agent = option.value; button.title = option.textContent; button.setAttribute('aria-label', option.textContent);
    const image = document.createElement('img'); image.src = 'assets/' + assets[option.value] + '.svg'; image.alt = '';
    const name = document.createElement('span'); name.className = 'agent-chip-name'; name.textContent = option.value === 'all' ? '全部' : option.textContent;
    button.append(image, name); group.append(button);
    button.addEventListener('click', () => { if (select.value !== option.value) { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); } sync(); });
  }
  function sync() { for (const button of group.children) { const active = button.dataset.agent === select.value; button.setAttribute('aria-pressed', String(active)); button.tabIndex = active ? 0 : -1; } }
  function usage(totals) {
    if (!totals) return;
    const rank = id => id === 'all' ? Infinity : totals[id] || 0;
    const buttons = [...group.children].sort((a, b) => rank(b.dataset.agent) - rank(a.dataset.agent) || catalogOrder.indexOf(a.dataset.agent) - catalogOrder.indexOf(b.dataset.agent));
    for (const button of buttons) {
      const empty = button.dataset.agent !== 'all' && !totals[button.dataset.agent];
      button.classList.toggle('is-empty', empty); button.title = button.getAttribute('aria-label') + (empty ? ' · 暂无记录' : '');
    }
    group.append(...buttons);
  }
  group.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...group.children], index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  });
  select.addEventListener('change', sync); sync();
  usage(window.agentUsageTotals); window.addEventListener('agent-usage', event => usage(event.detail));
})();
