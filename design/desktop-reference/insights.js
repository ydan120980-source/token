'use strict';
// Composition (cost destination, Agent/model share) and habits (weekday x hour,
// efficiency) views. Numbers come from insights-math; this file only draws them.
(function attach(root) {
  const math = root.insightsMath;
  const $ = id => document.getElementById(id);
  const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const COST_LABELS = { inputUncached: '输入', output: '输出', cacheRead: '缓存读取', cacheWrite: '缓存写入' };
  const pct = (value, digits = 1) => value === null || value === undefined ? '—' : (value * 100).toFixed(digits) + '%';
  const pad = hour => String(hour).padStart(2, '0');
  let shareBy = 'agent', last = null;

  function empty(text) { return '<p class="insight-empty">' + text + '</p>'; }
  function header(title, sub, extra = '') { return '<header class="insight-head"><div><h3>' + title + '</h3>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + extra + '</header>'; }

  function renderCost(ctx) {
    const result = math.costDestination(ctx.rows, ctx.recorded), { usd } = ctx;
    if (result.total === null) { $('costCard').innerHTML = header('成本去向', 'API 等价估算') + empty(ctx.rows.length ? '当前范围没有已定价的用量。' : '当前范围暂无用量。'); return; }
    const parts = result.parts.map((part, i) => ({ ...part, label: COST_LABELS[part.key], color: ctx.colorOf(i) }));
    const visible = parts.filter(part => part.value > 0);
    $('costCard').innerHTML = header('成本去向', 'API 等价估算 · 按各项单价分摊') +
      '<div class="cost-total"><strong>' + usd(result.total) + '</strong><span>' + (result.pricedShare !== null && result.pricedShare < 0.9995 ? '覆盖 ' + pct(result.pricedShare) + ' 的 token；其余未定价，不计入' : '全部 token 已定价') + '</span></div>' +
      '<div class="cost-bar" role="img" aria-label="' + visible.map(part => part.label + ' ' + pct(part.share)).join('，') + '">' + visible.map(part => '<span style="--w:' + (part.share * 100) + '%;--c:' + part.color + '"></span>').join('') + '</div>' +
      '<ul class="cost-parts">' + parts.map(part => '<li style="--c:' + part.color + '"><i></i><span>' + part.label + '</span><b>' + usd(part.value) + '</b><em>' + pct(part.share) + '</em></li>').join('') + '</ul>' +
      '<div class="insight-facts"><div><small>缓存命中率</small><b>' + pct(result.hitRate) + '</b></div><div title="缓存读取若按未缓存输入单价计费需多付的金额"><small>缓存约省下</small><b>' + (result.savings === null ? '—' : usd(result.savings)) + '</b></div></div>';
  }

  function renderShare(ctx) {
    const items = math.shares(ctx.rows, shareBy), { short, usd } = ctx;
    const toggle = '<div class="insight-toggle" role="group" aria-label="占比维度">' + [['agent', 'Agent'], ['model', '模型']].map(([key, label]) => '<button data-share-by="' + key + '" aria-pressed="' + (shareBy === key) + '">' + label + '</button>').join('') + '</div>';
    if (!items.length) { $('shareCard').innerHTML = header('用量占比', '', toggle) + empty('当前范围暂无用量。'); return; }
    const top = Math.max(...items.map(item => item.tokenShare));
    $('shareCard').innerHTML = header('用量占比', '按 token 排序 · 点击筛选', toggle) + '<ol class="share-list">' + items.map(item => {
      const isOther = item.key === null, agent = shareBy === 'agent' && !isOther ? ctx.agents[item.key] : null;
      const name = isOther ? '其他 ' + item.count + ' 个' + (shareBy === 'agent' ? ' Agent' : '模型') : agent ? agent.name : ctx.displayModel(item.key);
      const action = isOther ? '' : shareBy === 'agent' ? ' data-share-agent="' + ctx.escapeHtml(item.key) + '"' : ' data-model="' + ctx.escapeHtml(item.key) + '"';
      return '<li><button' + action + (isOther ? ' disabled' : '') + ' title="' + ctx.escapeHtml(name) + '">' + (agent ? ctx.icon(agent.icon) : '<i class="share-dot"></i>') +
        '<span class="share-name">' + ctx.escapeHtml(name) + '</span><span class="share-track"><span style="--w:' + (top ? item.tokenShare / top * 100 : 0) + '%"></span></span>' +
        '<b>' + short(item.tokens) + '</b><em>' + pct(item.tokenShare, 0) + '</em><small>' + (item.cost === null ? '未定价' : usd(item.cost)) + '</small></button></li>';
    }).join('') + '</ol>';
  }

  function renderHours(ctx) {
    const grid = math.weekHour(ctx.hourlyRows), { short } = ctx;
    if (!grid.max) { $('hourCard').innerHTML = header('活跃时段', ctx.rangeText + ' · 本地时间') + empty('当前范围暂无按小时的用量。'); return; }
    const level = tokens => tokens <= 0 ? 0 : Math.min(4, 1 + Math.floor(Math.sqrt(tokens / grid.max) * 4 - 1e-9));
    const cells = grid.cells.map((row, d) => '<span class="hour-day">' + WEEKDAYS[d] + '</span>' + row.map((cell, h) =>
      '<i class="lv' + level(cell.tokens) + '" title="' + WEEKDAYS[d] + ' ' + pad(h) + ':00–' + pad(h + 1) + ':00 · ' + (cell.tokens ? short(cell.tokens) + ' token · ' + cell.days + ' 天' : '无用量') + '"></i>').join('')).join('');
    const ticks = '<span></span>' + Array.from({ length: 24 }, (_, h) => '<span>' + (h % 3 ? '' : h) + '</span>').join('');
    const peak = grid.peak;
    $('hourCard').innerHTML = header('活跃时段', ctx.rangeText + ' · 本地时间') +
      '<div class="hour-scroll"><div class="hour-grid" role="img" aria-label="按星期和小时的用量分布，峰值在' + WEEKDAYS[peak.weekday] + ' ' + pad(peak.hour) + ' 点">' + cells + ticks + '</div></div>' +
      '<div class="insight-facts"><div><small>最集中的时段</small><b>' + WEEKDAYS[peak.weekday] + ' ' + pad(peak.hour) + ':00–' + pad(peak.hour + 1) + ':00</b></div><div><small>最常用的钟点</small><b>' + pad(grid.peakHour) + ':00–' + pad(grid.peakHour + 1) + ':00</b></div><div><small>最活跃的星期</small><b>' + WEEKDAYS[grid.peakWeekday] + '</b></div><div><small>有用量的时段</small><b>' + grid.active + ' / 168</b></div></div>';
  }

  function renderEfficiency(ctx) {
    const now = math.efficiency(ctx.rows, ctx.recorded), before = ctx.previousRows ? math.efficiency(ctx.previousRows, ctx.recorded) : null, { short, usd } = ctx;
    // Direction is judged only where it is unambiguous: cheaper and more cache hits are better.
    const metrics = [
      ['日均费用', '按有用量的天数', now.costPerDay, before?.costPerDay, value => usd(value), 'lower'],
      ['每百万 token 成本', '已定价部分的综合单价', now.costPerMillion, before?.costPerMillion, value => usd(value), 'lower'],
      ['每条记录 token', '一条记录约为一次模型调用', now.tokensPerRecord, before?.tokensPerRecord, value => short(Math.round(value)), null],
      ['缓存命中率', '缓存读取占输入侧 token', now.hitRate, before?.hitRate, value => pct(value), 'higher'],
      ['活跃天数', '有用量的日期', now.activeDays, before?.activeDays, value => value + ' 天', null]
    ];
    const compare = before ? ctx.compareText : ctx.compareMissing;
    $('efficiencyCard').innerHTML = header('效率', compare) + '<div class="efficiency-grid">' + metrics.map(([label, hint, value, previous, format, better]) => {
      const delta = before ? math.change(value, previous) : null, sign = delta === null || Math.abs(delta) < 0.005 ? 0 : Math.sign(delta);
      const tone = !sign || !better ? '' : (sign < 0) === (better === 'lower') ? ' good' : ' bad';
      return '<div title="' + hint + '"><small>' + label + '</small><b>' + (value === null || value === undefined ? '—' : format(value)) + '</b>' +
        (delta === null ? '' : '<em class="delta' + tone + '">' + (sign > 0 ? '↑ ' : sign < 0 ? '↓ ' : '') + (sign ? pct(Math.abs(delta), 0) : '持平') + '</em>') + '</div>';
    }).join('') + '</div>';
  }

  function render(ctx) {
    last = ctx;
    renderCost(ctx); renderShare(ctx); renderHours(ctx); renderEfficiency(ctx);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-share-by]');
    if (button && last && button.dataset.shareBy !== shareBy) { shareBy = button.dataset.shareBy; renderShare(last); }
  });
  root.usageInsights = { render };
})(window);
