'use strict';
// The original select remains the single filter value and the saved-state interface.
(() => {
  const select = document.getElementById('agentFilter'), group = document.createElement('div');
  group.id = 'agentPicker'; group.className = 'agent-picker'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', 'Agent 筛选');
  const assets = {all:'ui/layout-grid', ...Object.fromEntries(Object.entries(window.agentCatalog.agents).map(([id,a]) => [id,a.icon]))};
  select.before(group); select.hidden = true; select.setAttribute('data-agent-control', '');
  for (const option of select.options) {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.agent = option.value; button.title = option.textContent; button.setAttribute('aria-label', option.textContent);
    const image = document.createElement('img'); image.src = 'assets/' + assets[option.value] + '.svg'; image.alt = ''; button.append(image); group.append(button);
    button.addEventListener('click', () => { if (select.value !== option.value) { select.value = option.value; select.dispatchEvent(new Event('change', { bubbles: true })); } sync(); });
  }
  function sync() { for (const button of group.children) { const active = button.dataset.agent === select.value; button.setAttribute('aria-pressed', String(active)); button.tabIndex = active ? 0 : -1; } }
  group.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault(); const buttons = [...group.children], index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus(); buttons[next].click();
  });
  select.addEventListener('change', sync); sync();
})();
