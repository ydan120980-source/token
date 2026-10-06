'use strict';
// Presentation only: aria and the quota contract always expose the confirmed value.
(() => {
  const bars = new Map();
  const replayAfter = 60000;
  const clip = value => 'inset(0 ' + (100 - value) + '% 0 0)';
  function settle(bar, state) {
    state.animation?.cancel(); state.animation = null;
    state.value = state.target; state.layer.style.clipPath = clip(state.target ?? 0);
    bar.removeAttribute('data-progress-moving');
  }
  function move(bar, state, from) {
    const current = state.animation ? getComputedStyle(state.layer).clipPath : clip(from);
    state.animation?.cancel(); state.layer.style.clipPath = clip(state.target);
    if (window.uiMotion.mode !== 'full' || document.hidden || from === state.target) { settle(bar, state); return; }
    // A gentle accelerating/decelerating fill. Retarget from the live clip, never zero.
    const animation = state.layer.animate([{ clipPath: current }, { clipPath: clip(state.target) }], { duration: 820, easing: 'cubic-bezier(.42,0,.2,1)' });
    state.animation = animation; state.value = state.target; state.lastAnimatedAt = Date.now(); bar.setAttribute('data-progress-moving', '');
    animation.finished.then(() => { if (state.animation === animation) settle(bar, state); }).catch(() => {});
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const state = bars.get(entry.target);
      if (!state) continue;
      if (!entry.isIntersecting) { state.visible = false; settle(entry.target,state); continue; }
      if (state.visible) continue;
      state.visible = true;
      if (state.target === null || state.entered && Date.now() - state.lastAnimatedAt < replayAfter) continue;
      state.entered = true; move(entry.target, state, 0);
    }
  }, { threshold: .5 });
  function set(bar, value) {
    if (!bar) return;
    for (const [old, state] of bars) if (!old.isConnected) { state.animation?.cancel(); observer.unobserve(old); bars.delete(old); }
    const target = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
    let state = bars.get(bar);
    if (!state) { state = { layer: bar.querySelector('.quota-fill'), target, value: target, entered: false, visible: false, lastAnimatedAt: 0, animation: null }; bars.set(bar, state); observer.observe(bar); settle(bar, state); }
    else if (state.target !== target) { const from = state.value; state.target = target; if (target === null || !bar.getClientRects().length) settle(bar, state); else { state.entered = true; move(bar, state, from ?? 0); } }
    else if (!state.animation) state.layer.style.clipPath = clip(target ?? 0);
  }
  function settleAll() { for (const [bar, state] of bars) settle(bar, state); }
  window.addEventListener('ui-motion-change', settleAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) settleAll(); });
  window.addEventListener('unload', () => { settleAll(); observer.disconnect(); bars.clear(); });
  window.quotaProgress = Object.freeze({ set });
})();
