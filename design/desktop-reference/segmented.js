'use strict';
// A short option list reads better as a visible choice than as a menu. The native
// select stays the single state and change-event interface; only presentation moves.
(() => {
  const synced = new Set();
  function attach(select, kind) {
    const group = document.createElement('div');
    group.className = kind === 'swatch' ? 'swatch-group' : 'segment segment-select';
    group.setAttribute('role', 'radiogroup'); group.setAttribute('aria-label', select.getAttribute('aria-label') || '选择');
    select.before(group); select.hidden = true; select.tabIndex = -1;
    const buttons = () => [...group.querySelectorAll(':scope > button')];
    function build() {
      // Keep motion.js's sliding indicator, which lives inside the group.
      const marker = group.querySelector(':scope > .motion-indicator');
      group.replaceChildren(...[...select.options].map(option => {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.value = option.value;
        button.setAttribute('role', 'radio'); button.title = option.textContent;
        if (kind === 'swatch') { button.className = 'swatch-choice'; button.style.setProperty('--swatch', option.dataset.swatch || 'currentColor'); button.setAttribute('aria-label', option.textContent); }
        else button.textContent = option.textContent;
        return button;
      }), ...(marker ? [marker] : []));
      sync();
    }
    function sync() {
      window.uiMotion?.indicators?.();
      for (const button of buttons()) { const on = button.dataset.value === select.value; button.setAttribute('aria-checked', String(on)); button.setAttribute('aria-pressed', String(on)); button.tabIndex = on ? 0 : -1; }
    }
    function choose(button, focus) {
      if (!button) return; if (focus) button.focus();
      if (select.value !== button.dataset.value) { select.value = button.dataset.value; select.dispatchEvent(new Event('change', { bubbles: true })); }
      sync();
    }
    group.addEventListener('click', event => choose(event.target.closest('button'), false));
    group.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const list = buttons(), index = list.findIndex(b => b.dataset.value === select.value);
      const step = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      choose(list[event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : (index + step + list.length) % list.length], true);
    });
    select.addEventListener('change', sync);
    new MutationObserver(build).observe(select, { childList: true });
    synced.add(sync); build(); return group;
  }
  for (const select of document.querySelectorAll('select[data-custom-control]')) attach(select, select.dataset.customControl);
  window.uiSegments = Object.freeze({ attach, syncAll: () => synced.forEach(sync => sync()) });
})();
