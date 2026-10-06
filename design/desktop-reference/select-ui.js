'use strict';
// Native selects remain the state/IPC interface. Only their presentation changes.
(() => {
  const controls = new Map(), panel = document.createElement('div');
  panel.id = 'selectPanel'; panel.className = 'select-panel'; panel.setAttribute('popover','manual');
  const search = document.createElement('input'), list = document.createElement('div');
  search.type = 'search'; search.placeholder = '搜索模型或选项'; search.setAttribute('aria-label','搜索选项');
  list.id = 'selectOptions'; list.className = 'select-options'; list.setAttribute('role','listbox'); list.tabIndex = 0;
  panel.append(search, list); document.body.append(panel);
  let current = null, rows = [], active = -1, anchorScroll = 0, limit = 100, nextId = 1;
  const options = control => control.tagName === 'SELECT' ? [...control.options] : [...(document.getElementById(control.dataset.uiList)?.options || [])];
  const caption = control => control.tagName === 'SELECT' ? control.selectedOptions[0]?.textContent || '选择' : control.value || control.placeholder || '选择模型';
  function sync(select) {
    const button = controls.get(select); if (!button) return;
    button.querySelector('span').textContent = caption(select); button.disabled = select.disabled;
    button.title = caption(select);
  }
  function syncAll() { if(current && !current.isConnected)close();for (const select of controls.keys()) { if (!select.isConnected) controls.delete(select); else sync(select); } }
  function close(restore = false) {
    const previous = current; if (!previous) return;
    current = null; controls.get(previous)?.setAttribute('aria-expanded','false'); panel.hidePopover();
    if (restore && controls.get(previous)?.isConnected) controls.get(previous).focus();
  }
  function mark(index) {
    if (!rows.length) return; active = Math.max(0, Math.min(rows.length - 1,index));
    rows.forEach((row,i) => row.classList.toggle('is-active',i === active));
    const id = rows[active].id; list.setAttribute('aria-activedescendant',id); search.setAttribute('aria-activedescendant',id);
    // Scroll only the bounded list, never the page or trigger.
    const row = rows[active]; if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
  }
  function choose(value) {
    const select = current; if (!select) return;
    select.value = value; sync(select); close(true); select.dispatchEvent(new Event('input',{bubbles:true})); select.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function render(preserve = false) {
    if (!current) return;
    const previousScroll = list.scrollTop, previousActive = active;
    list.replaceChildren(); rows = []; active = -1;
    const query = search.value.toLocaleLowerCase();
    const matches = options(current).filter(option=>!option.hidden && (option.textContent || option.value).toLocaleLowerCase().includes(query));
    for (const [i, option] of matches.slice(0,limit).entries()) {
      const row = document.createElement('button'); row.type = 'button'; row.tabIndex = -1; row.id = 'select-option-' + i;
      row.setAttribute('role','option'); row.setAttribute('aria-selected',String(option.value === current.value));
      row.disabled = option.disabled; row.textContent = option.textContent || option.value; row.title = row.textContent;
      row.addEventListener('click', () => choose(option.value)); list.append(row); if (!option.disabled) rows.push(row);
    }
    if (!rows.length) { const empty = document.createElement('p'); empty.textContent = '没有匹配的选项'; list.append(empty); }
    if (matches.length > limit) { const more=document.createElement('p');more.className='select-more';more.textContent='继续滚动加载 · '+matches.length+' 个匹配';list.append(more); }
    if (preserve) { active=previousActive;list.scrollTop=previousScroll; }
    else mark(Math.max(0,rows.findIndex(row => row.getAttribute('aria-selected') === 'true')));
  }
  function open(select) {
    if (select.disabled) return; if (current === select) { close(true); return; } close();
    current = select; anchorScroll = window.scrollY; const trigger = controls.get(select), rect = trigger.getBoundingClientRect();
    (select.closest('dialog,[popover]') || document.body).append(panel);
    search.hidden = options(select).length <= 8; search.value = ''; limit = 100;
    const below = innerHeight - rect.bottom - 16, above = rect.top - 16, available = Math.max(below,above);
    const height = Math.min(360,Math.max(96,available));
    panel.style.maxHeight = height + 'px'; panel.style.width = Math.min(innerWidth - 24,Math.max(rect.width,search.hidden ? 180 : 360)) + 'px';
    panel.style.left = Math.max(12,Math.min(innerWidth - parseFloat(panel.style.width) - 12,rect.left)) + 'px';
    panel.style.top = ''; panel.style.bottom = '';
    if (below >= Math.min(360,available) || below >= above) { panel.style.top = rect.bottom + 6 + 'px'; panel.style.transformOrigin = 'top left'; }
    else { panel.style.bottom = innerHeight - rect.top + 6 + 'px'; panel.style.transformOrigin = 'bottom left'; }
    render(); panel.showPopover(); trigger.setAttribute('aria-expanded','true');
    list.setAttribute('aria-label', trigger.getAttribute('aria-label')); search.hidden ? list.focus() : search.focus(); mark(active);
  }
  function enhance(select) {
    if (controls.has(select) || select.multiple) return;
    if (!select.id) select.id = 'ui-choice-' + nextId++;
    if (select.tagName === 'INPUT') { select.dataset.uiList=select.getAttribute('list');select.removeAttribute('list'); }
    const shell = document.createElement('span'); shell.className = 'select-shell';
    select.before(shell); shell.append(select); select.classList.add('select-native'); select.tabIndex = -1; select.setAttribute('aria-hidden','true');
    const trigger = document.createElement('button'); trigger.type = 'button'; trigger.id = select.id + '-trigger';
    trigger.className = 'select-trigger'; trigger.setAttribute('role','combobox'); trigger.setAttribute('aria-haspopup','listbox'); trigger.setAttribute('aria-controls',list.id); trigger.setAttribute('aria-expanded','false');
    trigger.setAttribute('aria-label',select.getAttribute('aria-label') || select.labels?.[0]?.firstChild?.textContent.trim() || '选择');
    trigger.innerHTML = '<span></span><i aria-hidden="true"></i>'; shell.append(trigger); controls.set(select,trigger); sync(select);
    trigger.addEventListener('click', e => { e.preventDefault(); open(select); });
    trigger.addEventListener('keydown', e => { if (['ArrowDown','ArrowUp'].includes(e.key)) { e.preventDefault(); open(select); } });
    select.addEventListener('change', () => sync(select));
    select.addEventListener('invalid',event=>{event.preventDefault();open(select);});
    new MutationObserver(() => { sync(select); if (current === select) { if (select.disabled) close(true); else render(); } }).observe(select,{childList:true,subtree:true,attributes:true,characterData:true});
  }
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') { close(true); }
    else if (['ArrowDown','ArrowUp','Home','End'].includes(e.key)) { e.preventDefault(); mark(e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : active + (e.key === 'ArrowDown' ? 1 : -1)); }
    else if (e.key === 'Enter') { e.preventDefault(); rows[active]?.click(); }
    else if (search.hidden && e.key.length === 1 && !e.ctrlKey && !e.metaKey) { mark(rows.findIndex(row => row.textContent.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()))); }
  });
  search.addEventListener('input',()=>{limit=100;render();});
  list.addEventListener('scroll',()=>{if(current && list.scrollTop+list.clientHeight>=list.scrollHeight-55 && options(current).length>limit){limit+=100;render(true);}});
  panel.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
  document.addEventListener('pointerdown', e => { if (current && !panel.contains(e.target) && !controls.get(current).contains(e.target)) close(); });
  document.addEventListener('click', e => { if (e.target.closest('[data-view]')) close(); });
  document.addEventListener('close', () => close(),true);
  window.addEventListener('resize', () => close(true)); window.addEventListener('scroll', () => { if (current && window.scrollY !== anchorScroll) close(true); },{passive:true});
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); });
  function scan(root=document) { syncAll(); root.querySelectorAll('select:not([data-agent-control]),input[list]').forEach(enhance); }
  scan();
  window.uiSelect = Object.freeze({ syncAll, close, scan });
})();
