'use strict';
// Presentation only; contracts, export and aria labels always hold final values.
(() => {
  const jobs = new Map(), values = new Map(); let frame = 0, scrollJob = null;
  // Gentler peak velocity than cubic-in-out, with no overshoot.
  const ease = p => (1 - Math.cos(Math.PI * p)) / 2;
  function finish(key) { const job = jobs.get(key); if (job) { job.element.textContent = job.format(job.to); jobs.delete(key); if (key.startsWith('hover-cost-')) values.delete(key); else values.set(key, job.to); } }
  function tick(now) {
    frame = 0;
    for (const [key, job] of jobs) {
      if (!job.element.isConnected) { finish(key); continue; }
      job.start ??= now;
      const p = Math.min(1, (now - job.start) / 760), value = job.from + (job.to - job.from) * ease(p);
      values.set(key, value);
      // Text replacement at high refresh rates looks noisy; position/value remains
      // continuous for retargeting, while the readable digits paint at most 30Hz.
      if (job.lastPaint === null || now - job.lastPaint >= 1000 / 30) {
        job.text = job.format(value); job.lastPaint = now;
        if (job.element.textContent !== job.text) job.element.textContent = job.text;
      }
      if (p === 1) finish(key);
    }
    if (scrollJob) {
      const p = Math.min(1, (now - scrollJob.start) / scrollJob.duration);
      window.scrollTo({ top: scrollJob.from + (scrollJob.to - scrollJob.from) * ease(p), behavior: 'instant' });
      if (p === 1) scrollJob = null;
    }
    if (jobs.size || scrollJob) frame = requestAnimationFrame(tick);
  }
  function start() { if (!frame) frame = requestAnimationFrame(tick); }
  function number(element, key, value, format, animate = true) {
    if (!element) return;
    const from = values.get(key), current = jobs.get(key);
    element.dataset.finalValue = value ?? ''; element.setAttribute('aria-label', format(value));
    if (current && current.to === value && animate && window.uiMotion.mode === 'full' && !document.hidden && !element.closest('[hidden]')) {
      current.element = element; current.format = format;
      if (element.textContent !== current.text) element.textContent = current.text; return;
    }
    jobs.delete(key);
    if (value === null || !Number.isFinite(value) || from === undefined || !Number.isFinite(from) || value === from || !animate || window.uiMotion.mode !== 'full' || document.hidden || element.closest('[hidden]')) {
      element.textContent = format(value); values.set(key, value); return;
    }
    element.textContent = format(from); jobs.set(key, { element, from, to:value, format, start:null, lastPaint:null, text:element.textContent }); start();
  }
  function settleNumbers() { for (const key of [...jobs.keys()]) finish(key); }
  function cancelScroll() { scrollJob = null; }
  function scrollTo(top) {
    const from = window.scrollY, to = Math.max(0, Math.min(document.documentElement.scrollHeight - innerHeight, top));
    cancelScroll();
    if (window.uiMotion.mode !== 'full' || Math.abs(to - from) < 2 || document.hidden) { window.scrollTo({ top:to, behavior:'instant' }); return; }
    scrollJob = { from, to, duration:Math.min(900, 520 + Math.abs(to - from) * .14), start:performance.now() }; start();
  }
  function scrollIntoView(element) { if (element) { element.tabIndex = -1; element.focus({preventScroll:true}); scrollTo(element.getBoundingClientRect().top + window.scrollY - (document.body.classList.contains('integrated-titlebar') ? 68 : 24)); } }
  let costId = 0;
  function expandCost(button, expanded) {
    if (!button || !button.matches('.cost-value')) return;
    const upper = button.querySelector('.cost-upper'); if (!upper) return;
    if (button.classList.contains('cost-expanded') === expanded) return;
    const key = button.dataset.numberKey || (button.dataset.numberKey = 'hover-cost-' + ++costId);
    // The range is wider than the figure and scaling does not shrink its layout box, so the
    // hero column keeps the width it had before expanding; otherwise the facts beside it wrap
    // and everything below jumps. The range is scaled into that width instead.
    const hero = button.closest('#totalCost'), column = hero?.closest('.hero-row > .totals');
    if (column) { clearTimeout(column.releaseTimer); if (expanded) column.style.flex = '0 0 ' + column.getBoundingClientRect().width + 'px'; else column.releaseTimer = setTimeout(() => { if (!button.classList.contains('cost-expanded')) column.style.removeProperty('flex'); }, 450); }
    button.classList.toggle('cost-expanded', expanded);
    if (hero && expanded) { const width = button.querySelector('.cost-lower').scrollWidth + upper.scrollWidth + 80; button.style.setProperty('--range-fit',String(Math.min(innerWidth<850?.78:.84,hero.clientWidth/Math.max(1,width)))); }
    // The fixed-width upper slot avoids width changes on every numerical frame.
    if (expanded) { values.set(key, Number(button.dataset.costLower)); number(upper, key, Number(button.dataset.costUpper), window.displayValues.usd); }
    else { finish(key); values.delete(key); }
  }
  document.addEventListener('pointerover', e => { const b = e.target.closest('.cost-value'); if (b && !b.contains(e.relatedTarget)) expandCost(b, true); });
  document.addEventListener('pointerout', e => { const b = e.target.closest('.cost-value'); if (b && !b.contains(e.relatedTarget) && !b.contains(document.activeElement)) expandCost(b, false); });
  document.addEventListener('focusin', e => expandCost(e.target.closest('.cost-value'), true));
  document.addEventListener('focusout', e => { const b = e.target.closest('.cost-value'); if (b && !b.matches(':hover')) expandCost(b, false); });
  document.addEventListener('click', e => { const b = e.target.closest('.cost-value'); if (b) expandCost(b, true); });
  document.addEventListener('click', e => { const a = e.target.closest('a[href^="#"]'); if (!a) return; const hash = a.getAttribute('href').slice(1), target = hash ? document.getElementById(hash) : null; if (!hash || target) { e.preventDefault(); target ? scrollIntoView(target) : scrollTo(0); } });
  window.addEventListener('wheel', cancelScroll, {passive:true});
  window.addEventListener('touchstart', cancelScroll, {passive:true});
  window.addEventListener('pointerdown', cancelScroll);
  window.addEventListener('keydown', e => { if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End','Escape',' '].includes(e.key)) cancelScroll(); if (e.key === 'Escape') document.querySelectorAll('.cost-expanded').forEach(b => expandCost(b,false)); });
  window.addEventListener('resize', cancelScroll);
  window.addEventListener('resize', () => { for (const column of document.querySelectorAll('.hero-row > .totals')) column.style.removeProperty('flex'); });
  // Shared chart tooltips sit beside the pointer, so a tall hit area (a short bar in a
  // full-height column) does not put the tip far from the mark. Keyboard focus has no
  // pointer and anchors above the element instead. Both stay inside the window.
  function placeTooltip(tip, anchor, event) {
    tip.style.left = '0px'; tip.style.top = '0px'; // measure unconstrained by the window edge
    const width = tip.offsetWidth, height = tip.offsetHeight, pointer = event && 'clientX' in event;
    let left, top;
    if (pointer) {
      left = event.clientX + 14; top = event.clientY - height - 10;
      if (left + width > innerWidth - 8) left = event.clientX - width - 14;
      if (top < 8) top = event.clientY + 18;
    } else {
      const rect = anchor.getBoundingClientRect();
      left = rect.left + rect.width / 2 - width / 2; top = rect.top - height - 10;
      if (top < 8) top = rect.bottom + 10;
    }
    tip.style.left = Math.max(8, Math.min(innerWidth - width - 8, left)) + 'px';
    tip.style.top = Math.max(8, Math.min(innerHeight - height - 8, top)) + 'px';
  }
  window.addEventListener('ui-motion-change', () => { settleNumbers(); cancelScroll(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { settleNumbers(); cancelScroll(); } });
  window.addEventListener('unload', () => { cancelAnimationFrame(frame); jobs.clear(); });
  window.uiDetail = Object.freeze({ number, scrollTo, scrollIntoView, settleNumbers, cancelScroll, placeTooltip, get activeCount() { return jobs.size + Number(Boolean(scrollJob)); } });
})();
