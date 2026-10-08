'use strict';
// First-screen focus. At the top of the usage page the API-equivalent hero and its
// seven-day bars are emphasised while the profile row and the today card recede;
// scrolling eases everything into the regular layout, which is the resting state.
// Only scale, translate and opacity change, so layout never moves. Reduced or off
// motion, other pages and hidden documents always get the resting state.
(() => {
  const targets = [['#totalCost', 'hero'], ['#usage .recent-activity', 'week'], ['#usage > .profile', 'profile'], ['#usage > .card.today', 'today']];
  let frame = 0, last = null;
  function apply() {
    frame = 0;
    const page = document.getElementById('usage');
    const active = page && !page.hidden && !document.hidden && window.uiMotion?.mode === 'full';
    // Fully regular after about a third of the window height.
    const progress = active ? Math.min(1, Math.max(0, scrollY / Math.max(200, innerHeight * .34))) : 1;
    const value = Math.round(progress * 1000) / 1000;
    if (value === last) return;
    last = value;
    for (const [selector, part] of targets) {
      const element = document.querySelector(selector); if (!element) continue;
      if (value >= 1) { element.removeAttribute('data-focus'); element.style.removeProperty('--focus'); continue; }
      element.setAttribute('data-focus', part); element.style.setProperty('--focus', String(value));
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
  const reset = () => { last = null; schedule(); };
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', schedule);
  for (const name of ['ui-motion-change', 'ui-view-change']) addEventListener(name, reset);
  document.addEventListener('visibilitychange', reset);
  // Elements re-rendered by the page keep their attributes; a full re-check is cheap.
  addEventListener('load', reset);
  reset();
})();
