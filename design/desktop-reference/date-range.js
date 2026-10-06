'use strict';
// Range calendar for the trend popover. The hidden #trendFrom/#trendTo inputs stay
// the form's value interface; this file only draws the month grid and edits them.
// First click picks a single day (a valid range by itself); a second click extends it.
(() => {
  const $ = id => document.getElementById(id);
  const popover = $('trendRangePopover'), host = $('rangeCalendar'), from = $('trendFrom'), to = $('trendTo'), summary = $('rangeSummary');
  if (!popover || !host) return;
  const WEEK = ['一', '二', '三', '四', '五', '六', '日'];
  let month = null, anchor = null, hover = null, focusDate = null;
  const iso = date => date.toISOString().slice(0, 10);
  const parse = day => new Date(day + 'T12:00:00Z');
  const shift = (day, days) => { const value = parse(day); value.setUTCDate(value.getUTCDate() + days); return iso(value); };
  const shiftMonth = (day, months) => { const value = parse(day.slice(0, 7) + '-01'); value.setUTCMonth(value.getUTCMonth() + months); return iso(value); };
  const span = (a, b) => Math.round((parse(b) - parse(a)) / 86400000) + 1;
  const limits = () => window.usageCalendar || { today: iso(new Date()), min: null, recorded: new Set() };
  const label = day => Number(day.slice(5, 7)) + '月' + Number(day.slice(8)) + '日';
  function describe() {
    const start = from.value, end = to.value;
    if (!start || !end) return '选择开始日期';
    if (anchor && !hover && start === end) return label(start) + ' · 再选一天作为结束，或直接应用单日';
    return start === end ? label(start) + ' · 单日按小时显示' : label(start) + ' – ' + label(end) + ' · ' + span(start, end) + ' 天';
  }
  function render(keepFocus = false) {
    const { today, min, recorded } = limits(), first = month, start = from.value, end = to.value;
    const lead = (parse(first).getUTCDay() + 6) % 7, gridStart = shift(first, -lead);
    const previewEnd = anchor && hover ? (hover < anchor ? anchor : hover) : end, previewStart = anchor && hover ? (hover < anchor ? hover : anchor) : start;
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const day = shift(gridStart, i), outside = day.slice(0, 7) !== first.slice(0, 7), disabled = day > today || (min && day < min);
      const inRange = previewStart && previewEnd && day >= previewStart && day <= previewEnd;
      const classes = ['cal-day', outside && 'is-outside', inRange && 'in-range', day === previewStart && 'range-start', day === previewEnd && 'range-end', day === today && 'is-today', recorded?.has(day) && 'has-usage'].filter(Boolean).join(' ');
      cells += '<button type="button" role="gridcell" class="' + classes + '" data-cal-date="' + day + '" tabindex="' + (day === focusDate ? 0 : -1) + '" aria-selected="' + Boolean(inRange) + '"' + (disabled ? ' disabled' : '') + ' aria-label="' + day + (recorded?.has(day) ? '，有用量记录' : '') + '"><span>' + Number(day.slice(8)) + '</span></button>';
    }
    const canBack = !min || shiftMonth(first, -1) >= min.slice(0, 7) + '-01', canForward = shiftMonth(first, 1) <= today;
    host.innerHTML = '<div class="cal-head"><strong aria-live="polite">' + first.slice(0, 4) + '年' + Number(first.slice(5, 7)) + '月</strong><div class="cal-nav"><button type="button" data-cal-month="-1" aria-label="上个月"' + (canBack ? '' : ' disabled') + '><i class="chev chev-left"></i></button><button type="button" data-cal-month="1" aria-label="下个月"' + (canForward ? '' : ' disabled') + '><i class="chev chev-right"></i></button></div></div>' +
      '<div class="cal-week" aria-hidden="true">' + WEEK.map(d => '<span>' + d + '</span>').join('') + '</div><div class="cal-grid" role="grid" aria-label="选择日期范围">' + cells + '</div>';
    if (summary) summary.textContent = describe();
    if (keepFocus) host.querySelector('[data-cal-date="' + focusDate + '"]')?.focus({ preventScroll: true });
  }
  function choose(day) {
    if (anchor && day !== anchor) { from.value = day < anchor ? day : anchor; to.value = day < anchor ? anchor : day; anchor = null; }
    else { from.value = day; to.value = day; anchor = day; }
    hover = null; focusDate = day; render(true);
  }
  host.addEventListener('click', event => {
    const nav = event.target.closest('[data-cal-month]');
    if (nav) { month = shiftMonth(month, Number(nav.dataset.calMonth)); focusDate = null; render(); return; }
    const cell = event.target.closest('[data-cal-date]'); if (cell && !cell.disabled) choose(cell.dataset.calDate);
  });
  host.addEventListener('pointerover', event => { const cell = event.target.closest('[data-cal-date]'); if (anchor && cell && !cell.disabled && hover !== cell.dataset.calDate) { hover = cell.dataset.calDate; render(); } });
  host.addEventListener('pointerleave', () => { if (hover) { hover = null; render(); } });
  host.addEventListener('keydown', event => {
    const cell = event.target.closest('[data-cal-date]'); if (!cell) return;
    const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next = null;
    if (moves[event.key] !== undefined) next = shift(cell.dataset.calDate, moves[event.key]);
    else if (event.key === 'PageUp' || event.key === 'PageDown') next = shiftMonth(cell.dataset.calDate, event.key === 'PageUp' ? -1 : 1).slice(0, 8) + cell.dataset.calDate.slice(8);
    if (!next) return;
    event.preventDefault();
    const { today, min } = limits(); if (next > today) next = today; if (min && next < min) next = min;
    focusDate = next; if (anchor) hover = next;
    if (next.slice(0, 7) !== month.slice(0, 7)) month = next.slice(0, 7) + '-01';
    render(true);
  });
  // Draw before the popover is shown, so its first frame already has its final size.
  popover.addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') { anchor = null; hover = null; return; }
    const end = to.value || limits().today; month = end.slice(0, 7) + '-01'; focusDate = end; anchor = null; hover = null; render();
  });
  // Popovers open from their trigger, not the middle of the window.
  function anchorTo(panel, trigger) {
    let size = null;
    const place = event => {
      if (event.newState !== 'open') return;
      // Before showing, the panel has no box yet: reuse its last measured size.
      if (panel.matches(':popover-open')) size = { width: panel.offsetWidth, height: panel.offsetHeight };
      const rect = trigger.getBoundingClientRect(), { width, height } = size || { width: parseFloat(getComputedStyle(panel).width) || 320, height: 420 };
      const left = Math.max(12, Math.min(innerWidth - width - 12, rect.left)), below = rect.bottom + 8 + height <= innerHeight - 12;
      panel.style.left = left + 'px'; panel.style.top = (below ? rect.bottom + 8 : Math.max(12, rect.top - 8 - height)) + 'px';
      panel.style.transformOrigin = (rect.left + rect.width / 2 - left) + 'px ' + (below ? 'top' : 'bottom');
    };
    panel.addEventListener('beforetoggle', place); panel.addEventListener('toggle', place);
  }
  anchorTo(popover, $('trendRangeButton'));
  if ($('trendOptions')) anchorTo($('trendOptions'), $('trendOptionsButton'));
  window.uiRangeCalendar = Object.freeze({ render, warn: text => { if (summary) { summary.textContent = text; summary.classList.add('is-warning'); setTimeout(() => summary.classList.remove('is-warning'), 1600); } } });
})();
