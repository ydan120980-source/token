'use strict';
// Composition (cost destination, Agent/model share) and habits (weekday x hour,
// efficiency) views. Numbers come from insights-math; this file draws them and owns
// their interaction. Each card keeps a stable frame so controls and indicators
// persist, while its body is replaced and eased in when the data changes.
(function attach(root) {
  const math = root.insightsMath;
  const $ = id => document.getElementById(id);
  const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const COST_LABELS = { inputUncached: '输入', output: '输出', cacheRead: '缓存读取', cacheWrite: '缓存写入' };
  const EASE = 'cubic-bezier(.22, 1, .36, 1)';
  // A non-zero share that would round to zero reads as below the last digit, not 0%.
  const pct = (value, digits = 1) => value === null || value === undefined ? '—' : value > 0 && value * 100 < .5 / 10 ** digits ? '<' + (1 / 10 ** digits) + '%' : (value * 100).toFixed(digits) + '%';
  const pad = hour => String(hour).padStart(2, '0');
  const slotName = (d, h) => WEEKDAYS[d] + ' ' + pad(h) + ':00–' + pad(h + 1) + ':00';
  const state = { shareBy: 'agent', slot: null, ctx: null, activity: null, grid: null, dayHours: null };
  const full = () => (root.uiMotion?.mode ?? 'full') === 'full' && !document.hidden;

  // Amounts below a cent and cheap unit rates keep their magnitude instead of "$0.00".
  function money(usd, value) { return value === null || value === undefined ? '—' : value > 0 && value < 0.005 ? '<$0.01' : usd(value); }
  function unitRate(usd, value) { return value === null || value === undefined ? '—' : value >= 1 || value === 0 ? usd(value) : '$' + (value >= 0.01 ? value.toFixed(3) : value.toPrecision(2)); }
  function number(element, key, value, format) { if (root.uiDetail) root.uiDetail.number(element, key, value, format); else element.textContent = format(value); }
  function empty(text) { return '<p class="insight-empty">' + text + '</p>'; }
  function frame(id, title) {
    const card = $(id);
    if (!card.dataset.ready) {
      card.innerHTML = '<header class="insight-head"><div><h3>' + title + '</h3><p data-sub></p></div><div class="insight-tools" data-tools></div></header><div class="insight-body" data-body></div>';
      card.dataset.ready = 'true';
    }
    return { card, sub: card.querySelector('[data-sub]'), tools: card.querySelector('[data-tools]'), body: card.querySelector('[data-body]') };
  }
  function reveal(element) { root.uiMotion?.enter(element, 'update'); }
  function grow(elements, step = 40) {
    if (!full()) return;
    elements.forEach((element, i) => element.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 560, delay: i * step, easing: EASE, fill: 'backwards' }));
  }
  function sweep(element) { if (full()) element.animate([{ clipPath: 'inset(0 100% 0 0 round 5px)' }, { clipPath: 'inset(0 0 0 0 round 5px)' }], { duration: 700, easing: EASE }); }

  function renderCost(ctx) {
    const f = frame('costCard', '成本去向'), result = math.costDestination(ctx.rows, ctx.recorded), { usd } = ctx;
    f.sub.textContent = 'API 等价估算 · 按各项单价分摊' + ctx.scopeSuffix;
    if (result.total === null) { f.body.innerHTML = empty(ctx.rows.length ? '当前范围没有已定价的用量。' : '当前范围暂无用量。'); reveal(f.body); return; }
    const parts = result.parts.map((part, i) => ({ ...part, label: COST_LABELS[part.key], color: ctx.colorOf(i) })), visible = parts.filter(part => part.value > 0);
    f.body.innerHTML = '<div class="cost-total"><strong data-total></strong><span>' + (result.pricedShare !== null && result.pricedShare < 0.9995 ? '覆盖 ' + pct(result.pricedShare) + ' 的 token；其余未定价，不计入' : '全部 token 已定价') + '</span></div>' +
      '<div class="cost-bar" role="img" aria-label="' + visible.map(part => part.label + ' ' + pct(part.share)).join('，') + '">' + visible.map(part => '<span style="--w:' + (part.share * 100) + '%;--c:' + part.color + '"></span>').join('') + '</div>' +
      '<ul class="cost-parts">' + parts.map(part => '<li style="--c:' + part.color + '"><i></i><span>' + part.label + '</span><b data-part="' + part.key + '"></b><em>' + pct(part.share) + '</em></li>').join('') + '</ul>' +
      '<p class="cost-savings" title="缓存读取若按未缓存输入单价计费需多付的金额"><span>缓存约省下</span><b data-savings></b></p>';
    number(f.body.querySelector('[data-total]'), 'insight-cost-total', result.total, value => money(usd, value));
    for (const part of parts) number(f.body.querySelector('[data-part="' + part.key + '"]'), 'insight-cost-' + part.key, part.value, value => money(usd, value));
    number(f.body.querySelector('[data-savings]'), 'insight-cost-savings', result.savings, value => money(usd, value));
    reveal(f.body); sweep(f.body.querySelector('.cost-bar'));
  }

  function renderShare(ctx) {
    const f = frame('shareCard', '用量占比'), by = state.shareBy, selected = ctx.selected[by], { short, usd } = ctx;
    if (!f.tools.dataset.ready) {
      f.tools.innerHTML = '<button class="insight-clear" data-share-clear hidden></button><div class="insight-toggle segment" role="group" aria-label="占比维度"><button data-share-by="agent">Agent</button><button data-share-by="model">模型</button></div>';
      f.tools.dataset.ready = 'true';
    }
    for (const button of f.tools.querySelectorAll('[data-share-by]')) button.setAttribute('aria-pressed', String(button.dataset.shareBy === by));
    const clear = f.tools.querySelector('[data-share-clear]');
    clear.hidden = selected === 'all'; clear.dataset.shareClear = by; clear.innerHTML = '<span aria-hidden="true">‹</span>' + (by === 'agent' ? '全部 Agent' : '全部模型');
    const name = key => by === 'agent' ? ctx.agents[key]?.name ?? key : ctx.displayModel(key);
    f.sub.textContent = selected === 'all' ? '按 token 排序 · 点击筛选' : '已选 ' + name(selected);
    // The list ignores its own dimension's filter, so the selection stays visible and switchable.
    const items = math.shares(ctx.shareRows[by], by);
    if (!items.length) { f.body.innerHTML = empty('当前范围暂无用量。'); reveal(f.body); root.uiMotion?.select(f.tools.querySelector('.insight-toggle')); return; }
    const top = Math.max(...items.map(item => item.tokenShare));
    f.body.innerHTML = '<ol class="share-list' + (selected === 'all' ? '' : ' has-selection') + '">' + items.map(item => {
      const isOther = item.key === null, agent = by === 'agent' && !isOther ? ctx.agents[item.key] : null, isSelected = !isOther && item.key === selected;
      const label = isOther ? '其他 ' + item.count + ' 个' + (by === 'agent' ? ' Agent' : '模型') : name(item.key);
      const action = isOther ? ' disabled' : isSelected ? ' data-share-clear="' + by + '" aria-pressed="true"' : (by === 'agent' ? ' data-share-agent="' : ' data-model="') + ctx.escapeHtml(item.key) + '" aria-pressed="false"';
      return '<li><button' + action + (isSelected ? ' class="is-selected"' : '') + ' title="' + ctx.escapeHtml(label) + '">' + (agent ? ctx.icon(agent.icon) : '<i class="share-dot"></i>') +
        '<span class="share-name">' + ctx.escapeHtml(label) + '</span><span class="share-track"><span style="--w:' + (top ? item.tokenShare / top * 100 : 0) + '%"></span></span>' +
        '<b>' + short(item.tokens) + '</b><em>' + pct(item.tokenShare, 0) + '</em><small>' + (item.cost === null ? '未定价' : money(usd, item.cost)) + '</small></button></li>';
    }).join('') + '</ol>';
    reveal(f.body); grow([...f.body.querySelectorAll('.share-track span')]);
    root.uiMotion?.select(f.tools.querySelector('.insight-toggle'));
  }

  function slotRows(d, h) { return state.activity.hourlyRows.filter(row => row.hour === h && (new Date(row.date + 'T12:00:00Z').getUTCDay() + 6) % 7 === d); }
  function renderSlot() {
    const panel = $('hourCard').querySelector('.slot-detail'), grid = state.grid, ctx = state.activity;
    for (const cell of $('hourCard').querySelectorAll('.hour-grid button')) cell.setAttribute('aria-pressed', String(Boolean(state.slot) && Number(cell.dataset.d) === state.slot.d && Number(cell.dataset.h) === state.slot.h));
    if (!panel) return;
    markCalendar();
    if (!state.slot) { panel.hidden = true; panel.innerHTML = ''; return; }
    const { d, h } = state.slot, cell = grid.cells[d][h], rows = slotRows(d, h), items = math.shares(rows, 'agent', 4);
    const cost = rows.filter(row => row.estimatedCostUsd !== null && row.estimatedCostUsd !== undefined).reduce((sum, row) => sum + row.estimatedCostUsd, 0);
    panel.innerHTML = '<div class="slot-head"><div><strong>' + slotName(d, h) + '</strong><span>' + (cell.tokens ? cell.days + ' 天有用量 · ' + ctx.short(cell.tokens) + ' token · ' + money(ctx.usd, cost) : '这个时段没有用量') + '</span></div><button class="icon-button" data-slot-close aria-label="关闭时段明细">' + ctx.icon('ui/x') + '</button></div>' +
      (items.length ? '<ol class="slot-list">' + items.map(item => {
        const agent = item.key ? ctx.agents[item.key] : null;
        return '<li>' + (agent ? ctx.icon(agent.icon) : '<i class="share-dot"></i>') + '<span>' + ctx.escapeHtml(agent ? agent.name : '其他 ' + item.count + ' 个 Agent') + '</span><span class="share-track"><span style="--w:' + (item.tokenShare * 100) + '%"></span></span><b>' + ctx.short(item.tokens) + '</b><em>' + pct(item.tokenShare, 0) + '</em></li>';
      }).join('') + '</ol>' : '');
    const opening = panel.hidden; panel.hidden = false;
    if (opening) root.uiMotion?.enter(panel, 'detail'); else reveal(panel);
    grow([...panel.querySelectorAll('.share-track span')]);
  }
  // A chosen slot lights up, in the calendar beside it, the days that used it.
  function markCalendar() {
    const heatmap = $('heatmap'); if (!heatmap) return;
    const dates = state.slot && !state.activity.selectedDay ? new Set(slotRows(state.slot.d, state.slot.h).filter(row => row.totalTokens > 0).map(row => row.date)) : null;
    heatmap.toggleAttribute('data-slot', Boolean(dates));
    for (const cell of heatmap.querySelectorAll('button[data-date]')) cell.classList.toggle('is-match', Boolean(dates?.has(cell.dataset.date)));
  }
  function renderStats(ctx) {
    const host = $('rhythmStats'); if (!host) return;
    const active = [...ctx.dayTotals].filter(([day, value]) => day >= ctx.start && day <= ctx.today && value > 0).length;
    const runs = math.streaks(ctx.dayTotals, ctx.start, ctx.today), peak = math.peakWindow(state.grid.hours);
    const stat = (label, value, title) => '<span class="rhythm-stat"' + (title ? ' title="' + title + '"' : '') + '><small>' + label + '</small><b>' + value + '</b></span>';
    host.innerHTML = stat('活跃', active + ' 天') + stat('当前连续', runs.current + ' 天', runs.current ? '截至 ' + ctx.today + (ctx.dayTotals.get(ctx.today) > 0 ? '' : '（今天尚无用量，不打断连续）') : '') +
      stat('最长连续', runs.longest.length + ' 天', runs.longest.length ? runs.longest.from + ' 至 ' + runs.longest.to : '') +
      (peak ? stat('高峰三小时', pad(peak.start) + '–' + (peak.end ? pad(peak.end) : '24') + ' 点', '这三个小时占范围内 ' + pct(peak.share, 0) + ' 的 token') : '');
  }
  function renderWeek(ctx, f) {
    const grid = state.grid, { short } = ctx;
    f.sub.textContent = '星期 × 小时 · ' + ctx.rangeText + ctx.scopeSuffix;
    if (!grid.max) { state.slot = null; f.body.innerHTML = empty('当前范围暂无按小时的用量。'); reveal(f.body); return; }
    if (state.slot && !grid.cells[state.slot.d][state.slot.h].tokens) state.slot = null;
    const level = tokens => tokens <= 0 ? 0 : Math.min(4, 1 + Math.floor(Math.sqrt(tokens / grid.max) * 4 - 1e-9));
    const peak = grid.peak;
    const cells = grid.cells.map((row, d) => '<span class="hour-day" data-day="' + d + '">' + WEEKDAYS[d].slice(1) + '</span>' + row.map((cell, h) =>
      '<button class="lv' + level(cell.tokens) + '" data-d="' + d + '" data-h="' + h + '" tabindex="-1" aria-label="' + slotName(d, h) + '，' + (cell.tokens ? short(cell.tokens) + ' token，' + cell.days + ' 天' : '无用量') + '"><i style="--s:' + (cell.tokens ? (6 + Math.sqrt(cell.tokens / grid.max) * 14).toFixed(1) : 4) + 'px"></i></button>').join('')).join('');
    const ticks = '<span></span>' + Array.from({ length: 24 }, (_, h) => '<span class="hour-tick" data-hour="' + h + '">' + (h % 6 ? '' : h) + '</span>').join('');
    f.body.innerHTML = '<div class="hours-layout"><div class="hours-main"><div class="hour-scroll"><div class="hour-grid" role="group" aria-label="按星期和小时的用量分布，方向键移动，回车查看明细">' + cells + ticks + '</div></div></div>' +
      '<aside class="hours-side"><div class="insight-facts hour-facts"><button data-slot="' + peak.weekday + ',' + peak.hour + '"><small>最集中的时段</small><b>' + slotName(peak.weekday, peak.hour) + '</b></button><div><small>最活跃的星期</small><b>' + WEEKDAYS[grid.peakWeekday] + '</b></div><div title="一周 168 个小时中有用量的个数"><small>有用量的时段</small><b>' + grid.active + ' / 168</b></div></div><div class="slot-detail" hidden></div></aside></div>';
    // One roving tab stop: the selected slot, otherwise the peak.
    const tabbable = state.slot ? [state.slot.d, state.slot.h] : [peak.weekday, peak.hour];
    for (const cell of f.body.querySelectorAll('.hour-grid button')) cell.tabIndex = Number(cell.dataset.d) === tabbable[0] && Number(cell.dataset.h) === tabbable[1] ? 0 : -1;
    reveal(f.body);
    if (full()) for (const cell of f.body.querySelectorAll('.hour-grid button:not(.lv0)')) cell.firstElementChild.animate([{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: Number(cell.dataset.h) * 14 + Number(cell.dataset.d) * 8, easing: EASE, fill: 'backwards' });
    renderSlot();
  }
  // One chosen day: its 24 hours as bars. Hours after now on today are not yet known.
  function renderDayHours(ctx, f) {
    const day = ctx.selectedDay, { short } = ctx, weekday = WEEKDAYS[(new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7];
    f.sub.textContent = day + ' ' + weekday + ctx.scopeSuffix + ' · 本地时间';
    if (!ctx.hoursReady(day)) { f.body.innerHTML = empty('这一天没有按小时的记录。'); reveal(f.body); return; }
    const rows = ctx.dayHourRows(day), last = day === ctx.today ? ctx.currentHour() : 23;
    const hours = Array.from({ length: 24 }, (_, h) => { const items = rows.filter(row => row.hour === h); return { h, tokens: items.reduce((sum, row) => sum + row.totalTokens, 0), items, future: h > last }; });
    const max = Math.max(...hours.map(hour => hour.tokens)), used = hours.filter(hour => hour.tokens > 0);
    if (!max) { f.body.innerHTML = empty(rows.length ? '这一天只有 0 token 的空记录。' : '这一天没有用量记录。'); reveal(f.body); return; }
    const busiest = used.reduce((a, b) => b.tokens > a.tokens ? b : a);
    f.body.innerHTML = '<div class="hours-layout"><div class="hours-main"><div class="day-hours" role="group" aria-label="' + day + ' 每小时用量，左右方向键逐小时查看">' + hours.map(hour =>
      '<button type="button" tabindex="' + (hour === busiest ? 0 : -1) + '" data-hour="' + hour.h + '" class="' + (hour.future ? 'is-future' : hour.tokens ? '' : 'is-empty') + (hour === busiest ? ' is-peak' : '') + '" aria-label="' + pad(hour.h) + ':00–' + pad(hour.h + 1) + ':00，' + (hour.future ? '尚未到达' : hour.tokens ? short(hour.tokens) + ' token' : '无用量') + '"><i style="--h:' + (hour.tokens / max * 100) + '%"></i></button>').join('') + '</div>' +
      '<div class="day-hour-ticks" aria-hidden="true">' + [0, 6, 12, 18, 23].map(h => '<span style="--at:' + h + '">' + pad(h) + '</span>').join('') + '</div>' +
      '</div><aside class="hours-side"><div class="insight-facts hour-facts"><div><small>最忙的小时</small><b>' + pad(busiest.h) + ':00 · ' + short(busiest.tokens) + '</b></div><div><small>有用量的小时</small><b>' + used.length + ' / ' + (last + 1) + '</b></div><div><small>时间跨度</small><b>' + pad(used[0].h) + ':00–' + pad(used.at(-1).h + 1) + ':00</b></div></div></aside></div>';
    state.dayHours = hours;
    reveal(f.body);
    if (full()) f.body.querySelectorAll('.day-hours i').forEach((bar, i) => bar.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 520, delay: i * 16, easing: EASE, fill: 'backwards' }));
  }
  function renderActivity(ctx) {
    state.activity = ctx; state.grid = math.weekHour(ctx.hourlyRows); state.dayHours = null;
    const f = frame('hourCard', '每小时');
    if (!f.tools.dataset.ready) { f.tools.innerHTML = '<button class="insight-clear" data-day-clear hidden><span aria-hidden="true">‹</span>回到星期 × 小时</button>'; f.tools.dataset.ready = 'true'; }
    f.tools.querySelector('[data-day-clear]').hidden = !ctx.selectedDay;
    renderStats(ctx);
    if (ctx.selectedDay) renderDayHours(ctx, f); else renderWeek(ctx, f);
    markCalendar();
  }

  function renderEfficiency(ctx) {
    const f = frame('efficiencyCard', '效率'), now = math.efficiency(ctx.rows, ctx.recorded), before = ctx.previousRows ? math.efficiency(ctx.previousRows, ctx.recorded) : null, { short, usd } = ctx;
    // Direction is judged only where it is unambiguous: cheaper and more cache hits are better.
    // Active days and daily tokens already appear in the activity and trend cards.
    const metrics = [
      ['cost-day', '日均费用', '按有用量的天数', now.costPerDay, before?.costPerDay, value => money(usd, value), 'lower'],
      ['cost-million', '每百万 token 成本', '已定价部分的综合单价', now.costPerMillion, before?.costPerMillion, value => unitRate(usd, value), 'lower'],
      ['tokens-record', '每条记录 token', '一条记录约为一次模型调用', now.tokensPerRecord, before?.tokensPerRecord, value => short(Math.round(value)), null],
      ['hit-rate', '缓存命中率', '缓存读取占输入侧 token', now.hitRate, before?.hitRate, value => pct(value), 'higher']
    ];
    f.sub.textContent = (before ? ctx.compareText : ctx.compareMissing) + ctx.scopeSuffix;
    f.body.innerHTML = '<div class="efficiency-list">' + metrics.map(([key, label, hint, value, previous, , better]) => {
      const delta = before ? math.change(value, previous) : null, sign = delta === null || Math.abs(delta) < 0.005 ? 0 : Math.sign(delta);
      const tone = !sign || !better ? '' : (sign < 0) === (better === 'lower') ? ' good' : ' bad';
      return '<div><span><small>' + label + '</small><i>' + hint + '</i></span><b data-metric="' + key + '"></b>' +
        (delta === null ? '' : '<em class="delta' + tone + '">' + (sign > 0 ? '↑ ' : sign < 0 ? '↓ ' : '') + (sign ? pct(Math.abs(delta), 0) : '持平') + '</em>') + '</div>';
    }).join('') + '</div>';
    for (const [key, , , value, , format] of metrics) number(f.body.querySelector('[data-metric="' + key + '"]'), 'insight-eff-' + key, value ?? null, value => value === null || value === undefined ? '—' : format(value));
    reveal(f.body);
  }

  function render(ctx) {
    state.ctx = ctx;
    renderCost(ctx); renderShare(ctx); renderEfficiency(ctx);
  }

  // Hover and focus explain a slot; click or Enter pins its breakdown below the grid.
  function tooltip(cell) {
    const tip = $('heatTooltip'), grid = state.grid; if (!tip || !grid) return;
    const d = Number(cell.dataset.d), h = Number(cell.dataset.h), data = grid.cells[d][h];
    tip.innerHTML = '<span>' + slotName(d, h) + '</span><strong>' + (data.tokens ? state.activity.short(data.tokens) + ' <small>Token</small>' : '无用量') + '</strong>' + (data.tokens ? '<span>' + data.days + ' 天有用量</span>' : '');
    const rect = cell.getBoundingClientRect(); tip.style.left = '0px'; tip.style.top = '0px';
    const width = tip.offsetWidth, height = tip.offsetHeight, above = rect.top - height - 10;
    tip.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)) + 'px';
    tip.style.top = (above >= 8 ? above : rect.bottom + 10) + 'px';
    tip.classList.add('visible'); tip.setAttribute('aria-hidden', 'false');
    const card = $('hourCard');
    for (const label of card.querySelectorAll('.hour-day, .hour-tick')) label.classList.toggle('is-active', label.dataset.day === String(d) || label.dataset.hour === String(h));
  }
  function dayTip(bar) {
    const tip = $('heatTooltip'), hour = state.dayHours?.[Number(bar.dataset.hour)], ctx = state.activity; if (!tip || !hour) return;
    const lead = hour.tokens ? math.shares(hour.items, 'agent', 1)[0] : null, agent = lead?.key ? ctx.agents[lead.key] : null;
    tip.innerHTML = '<span>' + pad(hour.h) + ':00–' + pad(hour.h + 1) + ':00</span><strong>' + (hour.future ? '尚未到达' : hour.tokens ? ctx.short(hour.tokens) + ' <small>Token</small>' : '无用量') + '</strong>' + (agent ? '<span>' + ctx.escapeHtml(agent.name) + ' ' + pct(lead.tokenShare, 0) + '</span>' : '');
    const rect = bar.getBoundingClientRect(); tip.style.left = '0px'; tip.style.top = '0px';
    const width = tip.offsetWidth, height = tip.offsetHeight, above = rect.top - height - 10;
    tip.style.left = Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2)) + 'px';
    tip.style.top = (above >= 8 ? above : rect.bottom + 10) + 'px';
    tip.classList.add('visible'); tip.setAttribute('aria-hidden', 'false');
  }
  function untip() {
    const tip = $('heatTooltip'); tip?.classList.remove('visible'); tip?.setAttribute('aria-hidden', 'true');
    for (const label of $('hourCard').querySelectorAll('.is-active')) label.classList.remove('is-active');
  }
  function choose(d, h) {
    state.slot = state.slot && state.slot.d === d && state.slot.h === h ? null : { d, h };
    for (const cell of $('hourCard').querySelectorAll('.hour-grid button')) cell.tabIndex = state.slot && Number(cell.dataset.d) === d && Number(cell.dataset.h) === h ? 0 : -1;
    renderSlot();
  }
  document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-share-by]');
    if (toggle && state.ctx && toggle.dataset.shareBy !== state.shareBy) { state.shareBy = toggle.dataset.shareBy; renderShare(state.ctx); return; }
    const cell = event.target.closest('#hourCard .hour-grid button');
    if (cell) { choose(Number(cell.dataset.d), Number(cell.dataset.h)); return; }
    const fact = event.target.closest('#hourCard [data-slot]');
    if (fact) { const [d, h] = fact.dataset.slot.split(',').map(Number); if (!state.slot || state.slot.d !== d || state.slot.h !== h) choose(d, h); return; }
    if (event.target.closest('[data-slot-close]')) { state.slot = null; renderSlot(); return; }
    if (event.target.closest('[data-day-clear]')) state.activity?.clearDay();
  });
  document.addEventListener('mouseover', event => { const cell = event.target.closest('#hourCard .hour-grid button'); if (cell) tooltip(cell); const bar = event.target.closest('#hourCard .day-hours [data-hour]'); if (bar) dayTip(bar); });
  document.addEventListener('focusin', event => { const bar = event.target.closest?.('#hourCard .day-hours [data-hour]'); if (bar && bar.matches(':focus-visible')) dayTip(bar); });
  document.addEventListener('focusout', event => { if (event.target.closest?.('#hourCard .day-hours [data-hour]')) untip(); });
  document.addEventListener('mouseout', event => { if (event.target.closest('#hourCard .day-hours [data-hour]') && !event.relatedTarget?.closest?.('#hourCard .day-hours [data-hour]')) untip(); });
  document.addEventListener('mouseout', event => { if (event.target.closest('#hourCard .hour-grid button') && !event.relatedTarget?.closest?.('#hourCard .hour-grid button')) untip(); });
  document.addEventListener('focusin', event => { const cell = event.target.closest('#hourCard .hour-grid button'); if (cell && cell.matches(':focus-visible')) tooltip(cell); });
  document.addEventListener('focusout', event => { if (event.target.closest('#hourCard .hour-grid button')) untip(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.slot && $('hourCard').contains(document.activeElement)) { state.slot = null; renderSlot(); return; }
    const bar = event.target.closest('#hourCard .day-hours [data-hour]');
    if (bar && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const bars = [...bar.parentElement.children], index = bars.indexOf(bar), next = bars[event.key === 'Home' ? 0 : event.key === 'End' ? bars.length - 1 : Math.max(0, Math.min(bars.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))];
      bar.tabIndex = -1; next.tabIndex = 0; next.focus(); return;
    }
    const cell = event.target.closest('#hourCard .hour-grid button'); if (!cell) return;
    const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }, move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const d = (Number(cell.dataset.d) + move[0] + 7) % 7, h = (Number(cell.dataset.h) + move[1] + 24) % 24, next = $('hourCard').querySelector('.hour-grid button[data-d="' + d + '"][data-h="' + h + '"]');
    cell.tabIndex = -1; next.tabIndex = 0; next.focus();
  });
  root.usageInsights = { render, renderActivity };
})(window);
