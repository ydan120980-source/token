'use strict';
// First-screen emphasis and scroll intent.
//
// At the top of the usage page the API-equivalent figure sits slightly larger and eases
// to its resting size over the first part of a scroll. Only that figure scales; nothing
// moves, so positions never shift under the pointer, keyboard focus or scrollIntoView.
// Reduced or off motion, other pages and an expanded estimate range use the resting size.
//
// uiFocus.userScrolling() tells whether the current scroll follows the user's wheel,
// touch, scroll keys or a scrollbar drag (rather than code), so floating panels can close
// on a user scroll without closing on a programmatic one.
(() => {
  let frame = 0, intentAt = -Infinity, pointerDown = false;
  const intent = () => { intentAt = performance.now(); };
  const scrollKeys = new Set(['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ']);
  for (const name of ['wheel', 'touchstart', 'touchmove']) addEventListener(name, intent, { passive: true, capture: true });
  addEventListener('keydown', event => { if (scrollKeys.has(event.key) && !event.target.closest?.('input, textarea, select, [role="listbox"], [role="group"]')) intent(); }, { capture: true });
  // Only a press on the page itself (its scrollbar) starts a drag-scroll; clicks on controls do not.
  addEventListener('pointerdown', event => { if (event.target === document.documentElement) { pointerDown = true; intent(); } }, { capture: true });
  addEventListener('pointerup', () => { if (pointerDown) intent(); pointerDown = false; }, { capture: true });
  const userScrolling = () => pointerDown || performance.now() - intentAt < 900;

  function apply() {
    frame = 0;
    const page = document.getElementById('usage'), cost = document.getElementById('totalCost'); if (!cost) return;
    const active = page && !page.hidden && !document.hidden && window.uiMotion?.mode === 'full';
    const rest = active ? 1 - Math.min(1, Math.max(0, scrollY / Math.min(320, innerHeight * .35))) : 0;
    const ease = rest * rest * (3 - 2 * rest);
    if (ease > .001) cost.style.scale = String(1 + .06 * ease); else cost.style.removeProperty('scale');
  }
  // The cover (profile, figure, 30-day strip, today card) fills the window so the next
  // section starts below the fold. Spare height is shared out by rhythm.css through --cover
  // (strip height and the gaps); the coefficients sum to one, so the activity block's
  // position without it is its position minus the current value, and the result is stable.
  let coverFrame = 0;
  function fitCover() {
    coverFrame = 0;
    const page = document.getElementById('usage'), next = document.getElementById('activityBlock'); if (!page || !next || page.hidden) return;
    const current = parseFloat(page.style.getPropertyValue('--cover')) || 0;
    const natural = next.getBoundingClientRect().top + scrollY - current;
    const cover = Math.round(Math.min(320, Math.max(0, innerHeight + 16 - natural)));
    if (cover !== current) page.style.setProperty('--cover', cover + 'px');
  }
  const scheduleCover = () => { if (!coverFrame) coverFrame = requestAnimationFrame(fitCover); };
  addEventListener('resize', scheduleCover);
  addEventListener('ui-view-change', scheduleCover);
  if (window.ResizeObserver) { const observer = new ResizeObserver(scheduleCover); for (const selector of ['#usage > .profile', '#usage .usage-overview', '#usage .card.today']) { const element = document.querySelector(selector); if (element) observer.observe(element); } }
  scheduleCover();
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  for (const name of ['ui-motion-change', 'ui-view-change']) addEventListener(name, schedule);
  document.addEventListener('visibilitychange', schedule);
  window.uiFocus = Object.freeze({ userScrolling });
  schedule();
})();
