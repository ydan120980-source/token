'use strict';
/* global Chart */
/* Desktop usage bridge or an explicit statistics snapshot; browser demo stays synthetic. */
(() => {
const $ = id => document.getElementById(id);
const bootstrapFailed = window.previewUsage === undefined;
let localSnapshot = new URLSearchParams(location.search).has('demo') ? null : window.previewUsage;
const usageBridge = window.usageBridge;
const realData = localSnapshot?.schemaVersion === 'LocalUsagePreviewV1';
function currentDay() { return window.usageMath.localDay(realData ? localSnapshot.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone); }
let today = currentDay();
let coverageStart = realData ? localSnapshot.coverageStart || today : window.usageMath.shift(today, -180);
const agents = window.agentCatalog.agents;
const categories = [
  ['inputUncached', '输入（不含缓存）', '#597db4'],
  ['outputPlain', '输出（不含推理）', '#6b9c90'],
  ['cacheRead', '缓存读取', '#8a9cac'],
  ['cacheWrite', '缓存写入', '#a18bad'],
  ['reasoning', '推理', '#97a780']
];
let period = 'all', metric = 'tokens', selectedDay = null, enabled = true, sequence = realData ? localSnapshot.sequence : 1;
let trendChart, toastTimer, trendMode = 'flow', trendRange = null, trendBuckets = [], keyboardTrendIndex = 0;
let trendPress = null, trendDragged = false;
const hiddenKey = 'agentusage.trendHidden.v1';
let hiddenSeries = new Set(['cost']);
try { const saved = JSON.parse(localStorage.getItem(hiddenKey)); if (Array.isArray(saved)) hiddenSeries = new Set(saved.filter(key => typeof key === 'string').slice(0, 64)); } catch { /* Default: cost overlay hidden. */ }
let usageStatus = { collecting: false, error: null };
let usageRevision = null;
const templates = [];
function shift(date, days) { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function dates(start, end) { const result = []; for (let day = start; day <= end; day = shift(day, 1)) result.push(day); return result; }
function short(value) { if (value === null || value === undefined) return '未知'; if (value >= 1e9) return (value / 1e9).toFixed(1) + 'B'; if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M'; if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K'; return String(value); }
function money(value, upper = value) { return window.displayValues.cost(value, upper).text; }
function setHeroCost(html) {
  const host = $('totalCost'), previous = host.querySelector('button'), template = document.createElement('template'); template.innerHTML = html;
  if (!previous) { host.replaceChildren(template.content); return; }
  const next = template.content.firstElementChild, expanded = previous.classList.contains('cost-expanded');
  for (const attribute of next.attributes) previous.setAttribute(attribute.name,attribute.value);
  previous.classList.toggle('cost-expanded',expanded); previous.replaceChildren(...next.childNodes);
}
function costHtml(a, label = 'API 等价估算') {
  const value = window.displayValues.cost(a.cost, a.upper, a.coverage);
  const hasRange = value.lower !== null && value.upper > value.lower + .000001;
  const range = value.lower === null ? '未定价' : window.displayValues.usd(value.lower) + (hasRange ? ' — ' + window.displayValues.usd(value.upper) : value.partial ? '+' : '');
  const note = label + ' ' + range + '；定价覆盖 ' + (a.coverage === null ? '未知' : (a.coverage * 100).toFixed(1) + '%') + '。仅包括已定价部分，未知费用不计为零，API 等价估算不代表订阅账单。';
  return '<button class="cost-value" data-cost-lower="' +
    (value.lower ?? '') +
    '" data-cost-upper="' +
    (value.upper ?? '') +
    '" data-cost-coverage="' +
    (a.coverage ?? '') +
    '" data-cost-label="' +
    escapeHtml(label) +
    '" aria-label="' +
    escapeHtml(note) +
    '"><span class="cost-scale"><span class="cost-lower">' +
    (value.lower === null ? '未定价' : window.displayValues.usd(value.lower)) +
    '</span>' +
    (hasRange ? '<span class="cost-extension"><span class="cost-separator" aria-hidden="true"></span><span class="cost-upper" style="--upper-width:' +
    (window.displayValues.usd(value.upper).length * .65) +
    'em">' +
    window.displayValues.usd(value.upper) +
    '</span></span>' : '') +
    (value.partial && value.lower !== null ? '<span class="cost-plus">+</span>' : '') +
    '</span></button>';
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function icon(name) { return '<img src="assets/' + name + '.svg" alt="">'; }
function categoryColor(index) { return document.body.classList.contains('dark') ? ['#77b3db', '#8bd089', '#d18dbc', '#e5bf61', '#c3c5cb'][index] : categories[index][2]; }
for (let offset = 0; !realData && !bootstrapFailed && offset < 181; offset++) {
  const day = shift(today, -offset);
  if (offset > 0 && (offset % 7 === 2 || offset % 11 === 6 || offset > 140 && offset % 5 !== 0)) continue;
  for (const [index, [agent, meta]] of Object.entries(agents).entries()) {
    if (offset === 0 && agent !== 'codex' || offset > 0 && (offset + index) % 4 === 1) continue;
    const totalTokens = offset === 0 ? 1128200 : Math.round((0.5 + Math.abs(Math.sin(offset * .37 + index)) * (offset % 13 === 0 ? 70 : 14)) * 1e6 / (index + 1));
    const inputUncached = offset === 0 ? 128000 : Math.round(totalTokens * .04);
    const output = offset === 0 ? 10200 : Math.round(totalTokens * .02);
    const cacheWrite = offset === 0 ? 0 : Math.round(totalTokens * .005);
    const cacheRead = totalTokens - inputUncached - output - cacheWrite;
    const reasoning = offset === 0 ? 3000 : Math.round(output * .23);
    const cost = agent === 'workbuddy' && offset % 5 === 0 ? null : offset === 0 ? .76 : totalTokens / 1e6 * [.24, .2, .13, .54, .09][index % 5];
    // Synthetic unit rates only shape how the cost is split; the split always sums to it.
    const weights = { inputUncached: inputUncached * 2, output: output * 8, cacheRead: cacheRead * .2, cacheWrite: cacheWrite * 2.5 }, weight = Object.values(weights).reduce((a, b) => a + b, 0);
    const costParts = cost === null ? null : Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, cost * value / weight]));
    templates.push({ date: day, agent, entry: 'unknown', provider: 'synthetic', model: '示例模型 · ' +
      meta.name, totalTokens, inputUncached, output, cacheRead, cacheWrite, reasoning, records: offset === 0 ? 11 : Math.max(1, Math.round(totalTokens / 65000)), estimatedCostUsd: cost, pricedTokens: cost === null ? 0 : totalTokens, costParts, cacheSavingsUsd: cost === null ? null : cost * cacheRead * 1.8 / weight,
      // Like real Codex logs, unreported cache writes leave a bounded estimate.
      estimatedCostUpperUsd: cost === null ? null : agent === 'codex' ? cost * 1.08 : cost, boundedTokens: cost !== null && agent === 'codex' ? totalTokens : 0 });
  }
}
if (realData) templates.push(...localSnapshot.daily);
// Hourly rows cover the whole history; a single-day trend plots them by hour.
const hourlyTemplates = [];
function currentHour() { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: realData ? localSnapshot.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date())); }
function hourlyReady(date) { return date <= today && (!realData || Array.isArray(localSnapshot.hourly)); }
function loadHourly() {
  hourlyTemplates.length = 0;
  if (realData) { hourlyTemplates.push(...(localSnapshot.hourly || [])); return; }
  // Synthetic demo: split each recent day across working hours, exact to the token.
  const fields = ['totalTokens', 'inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'records', 'estimatedCostUsd', 'estimatedCostUpperUsd', 'pricedTokens', 'boundedTokens'];
  for (const row of templates) {
    const last = row.date === today ? currentHour() : 23, hours = [9, 10, 11, 14, 15, 16, 17, 20, 21, 22].filter(hour => hour <= last);
    if (!hours.length) hours.push(last);
    const weights = hours.map((hour, i) => 1 + (hour * 7 + i * 3 + row.totalTokens) % 5), weight = weights.reduce((a, b) => a + b, 0);
    const parts = hours.map(hour => ({ ...row, hour }));
    for (const field of fields) {
      if (row[field] === null || row[field] === undefined) continue;
      const exact = Number.isInteger(row[field]); let used = 0;
      parts.forEach((part, i) => { const value = i === parts.length - 1 ? row[field] - used : exact ? Math.floor(row[field] * weights[i] / weight) : row[field] * weights[i] / weight; part[field] = value; used += value; });
    }
    hourlyTemplates.push(...parts);
  }
}
loadHourly();
function hourlyData() { return !realData && $('demoState').value === 'empty' ? [] : hourlyTemplates; }
const pad = hour => String(hour).padStart(2, '0');
let trendHourly = false;
function displayModel(model) { return model === 'unknown' ? '模型未记录' : model; }
function modelColor(model) { let hash = 0; for (const c of model) hash = (hash * 31 + c.charCodeAt(0)) >>> 0; return ['#5d8dcc', '#599981', '#c18b53', '#bd796a', '#9172b2', '#57a2b4', '#af8e41', '#888fac', '#a1778f', '#72964a'][hash % 10]; }
function entryName(rows) { const entries = new Set(rows.map(r => r.entry)); return entries.size !== 1 ? '多个入口' : ({ desktop: 'Desktop', cli: 'CLI', sdk: 'SDK', export: '用量导出', harness: 'Harness', unknown: '入口未知' }[[...entries][0]] || '入口未知'); }
function data() {
  if (realData) return templates;
  if ($('demoState').value === 'empty') return [];
  return templates.map((r, index) => $('demoState').value === 'partial' && index % 7 === 0 ? { ...r, inputUncached: null, reasoning: null, estimatedCostUsd: null, pricedTokens: 0 } : r);
}
function sum(rows, field) { return rows.reduce((n, row) => n + (row[field] ?? 0), 0); }
function aggregate(rows) { const priced = rows.filter(r => r.estimatedCostUsd !== null); return { total: sum(rows, 'totalTokens'), cost: priced.length ? sum(priced, 'estimatedCostUsd') : null, upper: priced.length ? priced.reduce((n,r) => n +
  (r.estimatedCostUpperUsd ?? r.estimatedCostUsd),0) : null, bounded: sum(rows, 'boundedTokens'), records: sum(rows, 'records'), coverage: sum(rows, 'totalTokens') ? sum(rows, 'pricedTokens') / sum(rows, 'totalTokens') : null }; }
function mix(rows) {
  return window.usageMath.disjointMix(rows);
}
// Which fields each source ever records; refreshed with every render.
let recorded = () => true;
function tiles(rows) { return window.insightsMath.categoryView(rows, recorded); }
function tileText(tile) { return { value: short(tile.value), partial: '≥ ' + short(tile.value), combined: '含在输出中', 'not-recorded': '来源不记录' }[tile.state] ?? '未报告'; }
function tileTitle(tile) {
  return ({ partial: '部分记录未报告' + tile.label + '，显示已报告部分的下限', combined: '来源只记录输出总量，推理已包含其中，无法拆分', 'not-recorded': '这些来源的日志没有单独记录' + tile.label + '，相应 token 已计入其他分类，不按零计算', unknown: '这些记录没有报告' + tile.label + '，不按零计算' }[tile.state] || '') + (tile.note ? '；' + tile.note : '');
}
function tileClass(tile) { return tile.state === 'unknown' ? 'is-unreported' : ['combined', 'not-recorded'].includes(tile.state) ? 'is-structural' : ''; }
function mixHtml(rows) {
  if (!rows.length) return '<p class="empty-message">暂无可用统计，未观测到的值不显示为零。</p>';
  const m = mix(rows);
  return '<div class="stack-bar">' +
    (m.total ? categories.map(([, label], i) => '<span style="background:' +
    categoryColor(i) +
    ';width:' +
    m.values[i] / m.total * 100 +
    '%" title="' +
    label +
    ' ' +
    short(m.values[i]) +
    '"></span>').join('') : '') +
    '</div><div class="mix-legend">' +
    tiles(rows).map((tile, i) => '<span class="' + tileClass(tile) + '" title="' + tileTitle(tile) + '"><i class="swatch" style="background:' + categoryColor(i) + '"></i>' + tile.label + '<b>' + tileText(tile) + '</b></span>').join('') +
    '</div>';
}
// A row with no tokens and no known usage (an empty assistant turn) adds nothing to a list;
// the ledger and record counts keep it.
function used(row) { return row.totalTokens > 0 || ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning'].some(field => (row.knownUsage?.[field] ?? row[field]) > 0); }
function clientHtml(rows, detail = false) {
  if (!rows.length) return '<p class="empty-message">此日暂无用量记录。</p>';
  if (!rows.some(used)) return '<p class="empty-message">此日只有 0 token 的空记录。</p>';
  const totals = aggregate(rows);
  return Object.entries(agents).filter(([key]) => rows.some(r => r.agent === key && used(r))).map(([key, meta]) => {
    const subset = rows.filter(r => r.agent === key), a = aggregate(subset);
    return '<div class="client-row"><div class="client-line">' +
      icon(meta.icon) +
      '<span class="client-name">' +
      meta.name +
      (['codex', 'mimo'].includes(key) ? ' / ' +
      entryName(subset) : '') +
      '</span><div class="client-numbers"><small>' +
      a.records +
      ' 记录</small><small>' +
      costHtml(a, meta.name +
      ' 估算') +
      '</small><span>' +
      short(a.total) +
      '</span></div></div>' +
      [...new Set(subset.map(r => r.model))].filter(model => subset.some(r => r.model === model && used(r))).map(model => {
      const group = subset.filter(r => r.model === model), g = aggregate(group);
      return '<div class="model-line"><span class="model-name">' +
        escapeHtml(displayModel(model)) +
        '</span>' +
        (detail ? '<span class="model-cost">' +
        costHtml(g, displayModel(model) +
        ' 估算') +
        '</span></div>' + modelMetrics(group) : '<div class="share-line"><span style="width:' +
        (totals.total ? g.total / totals.total * 100 : 0) +
        '%"></span></div><span class="share">' +
        (totals.total && g.total > 0 && g.total / totals.total < .005 ? '<1' : (totals.total ? g.total / totals.total * 100 : 0).toFixed(0)) +
        '%</span><span class="model-tokens">' +
        short(g.total) +
        '</span></div>');
    }).join('') + '</div>';
  }).join('');
}
// Same disjoint buckets as the category tiles above, so the two never disagree.
function modelMetrics(group) {
  return '<p class="model-metrics">' + tiles(group).map(tile => '<span class="' + tileClass(tile) + '" title="' + tileTitle(tile) + '">' + tile.label.replace(/（.*）/, '') + (/（(.*)）/.test(tile.label) && tile.key !== 'inputUncached' ? '<em>' + tile.label.match(/（(.*)）/)[1] + '</em>' : '') + ' <b>' + tileText(tile) + '</b></span>').join('') + '</p>';
}
// `skip` leaves one dimension unfiltered, for views that select within that dimension.
function filterRows(rows, skip = null) { const agent = skip === 'agent' ? 'all' : $('agentFilter').value, source = $('sourceFilter').value, model = skip === 'model' ? 'all' : $('modelFilter').value; return rows.filter(r => (agent === 'all' || r.agent === agent) && (source === 'all' || (r.provider || 'unknown') === source) && (model === 'all' || r.model === model)); }
function rangeStart() { return window.usageMath.startFor(today, period, coverageStart); }
function rangeRows(rows) { return filterRows(rows).filter(r => r.date >= rangeStart() && r.date <= today); }
function rangeLabel() { return period === 'all' ? '累计 · ' + coverageStart + ' 至 ' + today : period === 'today' ? '今天 · ' + today : '最近 ' + period + ' 天（含今天）'; }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
function todayEmptyHtml() {
  const message = usageStatus.error || localSnapshot?.previewReadError ? '今日统计读取失败' : usageStatus.collecting ? '正在采集今天的用量…' : !enabled ? '采集已暂停' : '尚未采集到今天的记录';
  return '<div class="today-empty"><span role="status">' + message + '</span>' + (usageBridge ? '<button data-refresh-today ' + (usageStatus.collecting ? 'disabled' : '') + '>' + icon('ui/refresh') + '刷新今日</button>' : '') + '</div>';
}
function renderOverview(rows) {
  const filtered = filterRows(rows), scoped = rangeRows(rows), a = aggregate(scoped), daily = filtered.filter(r => r.date === today), t = aggregate(daily);
  $('historyStart').textContent = rows.length ? coverageStart : '暂无'; $('todayDate').textContent = today;
  $('rangeTitle').textContent = period === 'all' ? '累计' : period === 'today' ? '今天' : '最近 ' + period + ' 天';
  $('totalLabel').textContent = 'Token';
  $('totalTokens').textContent = scoped.length ? short(a.total) : '—'; setHeroCost(costHtml(a));
  window.uiDetail.number($('totalTokens'), 'total-tokens', scoped.length ? a.total : null, v => v === null ? '—' : short(Math.round(v)));
  window.uiDetail.number($('totalCost').querySelector('.cost-lower'), 'total-cost', a.cost, v => v === null ? '未定价' : window.displayValues.usd(v));
  $('priceCoverage').textContent = a.coverage === null ? '尚无可定价记录' : '已匹配价格 · 覆盖 ' + (a.coverage * 100).toFixed(1) + '%' + (a.bounded ? ' · 含估算范围' : '');
  $('recordCount').textContent = scoped.length ? a.records.toLocaleString('zh-CN') : '—';
  window.uiDetail.number($('recordCount'), 'record-count', scoped.length ? a.records : null, v => v === null ? '—' : Math.round(v).toLocaleString('zh-CN'));
  const scope = [$('agentFilter').value === 'all' ? '全部 Agent' : agents[$('agentFilter').value].name];
  if ($('sourceFilter').value !== 'all') scope.push($('sourceFilter').selectedOptions[0].textContent);
  if ($('modelFilter').value !== 'all') scope.push(displayModel($('modelFilter').value));
  $('scopeContext').textContent = scope.join(' · ') + ' · ' + (period === 'all' ? '累计' : period === 'today' ? '今天' : '最近 ' + period + ' 天');
  $('resetUsageScope').hidden = ['agentFilter','sourceFilter','modelFilter'].every(id => $(id).value === 'all');
  const recordedDays = new Set(scoped.map(r => r.date)).size, average = recordedDays ? a.total / recordedDays : 0;
  // Average over recorded days only; today is still in progress, so the delta is "so far".
  const comparison = $('dailyComparison'), summary = $('todaySummary');
  const change = period !== 'today' && recordedDays > 1 && average > 0 && daily.length ? t.total / average - 1 : null, percent = change === null ? '' : (change >= 0 ? '+' : '−') + Math.abs(change * 100).toFixed(0) + '%';
  if (period !== 'today' && recordedDays > 1 && average > 0) {
    const note = '区间日均 ' + short(Math.round(average)) + ' Token（按 ' + recordedDays + ' 个有记录日计算）';
    comparison.innerHTML = '日均 <strong>' + short(Math.round(average)) + '</strong>'; comparison.title = note; comparison.setAttribute('aria-label', note); comparison.hidden = false;
  } else { comparison.textContent = ''; comparison.removeAttribute('title'); comparison.removeAttribute('aria-label'); comparison.hidden = true; }
  // Today so far, compared with the range's daily average (recorded days only).
  summary.innerHTML = daily.length ? '今天 <b>' + short(t.total) + '</b>' + (change === null ? '' : ' · 较日均 ' + percent) : '今天暂无记录';
  summary.title = change === null ? '' : '今天至今 ' + short(t.total) + '，区间日均 ' + short(Math.round(average)) + '（按 ' + recordedDays + ' 个有记录日）';
  // The last 30 days, one rounded bar each: today in the accent, the busiest day darker,
  // a day without records a dotted stub (unknown, not zero).
  const month = dates(shift(today, -29), today), observed = new Set(rows.map(r => r.date)), dayTotals = new Map();
  for (const row of filtered) dayTotals.set(row.date,(dayTotals.get(row.date) || 0) + row.totalTokens);
  const maximum = Math.max(1, ...month.map(day => dayTotals.get(day) || 0));
  $('overviewWeek').innerHTML = month.map(day => { const known = observed.has(day), value = dayTotals.get(day) || 0;
    return '<button data-habit-date="' + day + '" data-tip="' + (known ? value : '') + '" class="week-day' + (day === today ? ' is-today' : '') + (!known ? ' is-unrecorded' : '') + (known && value === maximum && value > 0 ? ' is-peak' : '') + '" aria-label="' + day + '：' + (known ? short(value) + ' Token' : '未记录') + '，查看明细"><i style="--h:' + (known ? Math.max(4, value / maximum * 100) : 0) + '%"></i></button>';
  }).join('');
  $('overviewAxis').innerHTML = '<span>' + month[0].slice(5) + '</span><span>' + month[14].slice(5) + '</span><span>今天</span>';
  $('scopeSummary').textContent = rangeLabel() + ' · ' + scoped.length + ' 条每日聚合 · ' + short(a.total) + ' token · ' + ($('agentFilter').value === 'all' ? '全部 agent' : agents[$('agentFilter').value].name) + ' / ' + ($('modelFilter').value === 'all' ? '全部模型' : displayModel($('modelFilter').value));
  $('totalMix').innerHTML = mixHtml(scoped); $('todayMix').innerHTML = mixHtml(daily);
  $('todayTotals').innerHTML = '<span>Token<strong>' + (daily.length ? short(t.total) : '—') + '</strong></span><span>估算<strong>' + (daily.length ? costHtml(t, '今日估算') : '—') + '</strong></span><span>记录<strong>' + (daily.length ? t.records : '—') + '</strong></span>';
  const todayNumbers = $('todayTotals').querySelectorAll('strong');
  window.uiDetail.number(todayNumbers[0], 'today-tokens', daily.length ? t.total : null, v => v === null ? '—' : short(Math.round(v)));
  window.uiDetail.number(todayNumbers[1].querySelector('.cost-lower'), 'today-cost', t.cost, v => v === null ? '未定价' : window.displayValues.usd(v));
  window.uiDetail.number(todayNumbers[2], 'today-records', daily.length ? t.records : null, v => v === null ? '—' : String(Math.round(v)));
  $('todayClients').innerHTML = daily.length ? clientHtml(daily) : rows.some(r => r.date === today) ? '<p class="empty-message">今天在当前筛选下没有用量记录。</p>' : todayEmptyHtml();
  $('clientChips').innerHTML = Object.entries(agents).map(([key, meta]) => '<button data-source-view="' + key + '">' + icon(meta.icon) + meta.name + '</button>').join('');
  $('updated').textContent = localSnapshot?.previewReadError ? '读取失败 · 保留最后有效快照' : $('demoState').value === 'error' ? '演示读取失败 · 历史保留' : realData ? '快照采集 ' +
    (localSnapshot.collectedAt ? new Date(localSnapshot.collectedAt).toLocaleString('zh-CN') : '时间未记录') : enabled ? '合成数据 · 演示快照 ' +
    sequence : '演示已暂停 · 历史仍可查看';
}
function heatStart() { return $('heatRange').value === today.slice(0, 4) ? today.slice(0, 4) + '-01-01' : shift(today, -364); }
// The calendar always spans a whole year (rolling or calendar) across the card. Weeks
// before the first record collapse into one labelled block; days after today in the
// calendar-year view are empty frames. Both keep unknown history out of the zero scale.
function heatEnd() { return $('heatRange').value === '365' ? today : $('heatRange').value + '-12-31'; }
function renderHeat(rows) {
  hideHeatTooltip();
  const focusedDate = $('heatmap').contains(document.activeElement) ? document.activeElement.dataset.date : null;
  const start = heatStart(), end = heatEnd(), daily = new Map();
  const monday = day => shift(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7)), days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  const origin = monday(start), gapWeeks = rows.length && monday(coverageStart) > origin ? days(origin, monday(coverageStart)) / 7 : 0, gap = gapWeeks >= 2;
  const first = gap ? monday(coverageStart) : start, allDates = dates(first, today), columns = Math.ceil((days(origin, end) + 1) / 7);
  if (selectedDay && (selectedDay < start || selectedDay > today)) selectedDay = null;
  $('heatRange').disabled = false;
  for (const row of filterRows(rows)) daily.set(row.date, (daily.get(row.date) ?? 0) + row.totalTokens);
  const max = Math.max(1, ...allDates.map(d => daily.get(d) || 0)), leading = gap ? 0 : days(origin, start);
  const gapText = start + ' 至 ' + shift(first, -1) + ' 没有记录（可能早于来源保留的历史）';
  let html = (gap ? '<span class="heat-gap' + (gapWeeks < 5 ? ' is-narrow' : '') + '" style="grid-column:1 / span ' + gapWeeks + '" title="' + gapText + '" aria-label="' + gapText + '"><span>' + (gapWeeks >= 10 ? '未观测 · ' + start.slice(0, 7) + ' 至 ' + shift(first, -1).slice(0, 7) : '未观测') + '</span></span>' : '') + '<span class="pad" aria-hidden="true"></span>'.repeat(leading);
  const observedDates = new Set(rows.map(row => row.date));
  for (const day of allDates) {
    const value = daily.get(day) ?? 0, observed = realData ? observedDates.has(day) : day >= coverageStart && rows.length > 0;
    const level = value === 0 ? 0 : value < max * .12 ? 1 : value < max * .33 ? 2 : value < max * .65 ? 3 : 4;
    const title = day + ' · ' + (observed ? value.toLocaleString('zh-CN') + ' token' : '未观测到历史');
    html += '<button data-date="' + day + '" data-tokens="' + (observed ? value : '') + '" data-level="' + level + '" data-observed="' + observed + '" aria-label="' + title + '" aria-pressed="' + (selectedDay === day) + '">' + '</button>';
  }
  html += '<span class="future" aria-hidden="true"></span>'.repeat(Math.max(0, days(today, end)));
  $('heatmap').innerHTML = html;
  $('heatmap').style.setProperty('--heat-columns', String(columns)); $('heatmap').toggleAttribute('data-gap', gap);
  // One label per month at the column holding its first day; a label with less than two
  // columns of room is dropped rather than overlapping its neighbour.
  const labels = [];
  for (let month = start.slice(0, 7) + '-01'; month <= end; month = shift(month.slice(0, 7) + '-28', 7).slice(0, 7) + '-01') {
    const column = Math.floor(days(origin, month < start ? start : month) / 7) + 1; if (labels.at(-1)?.column === column) labels.pop(); labels.push({ text: Number(month.slice(5, 7)) + '月', column });
  }
  labels.forEach((label, i) => { label.span = (labels[i + 1]?.column ?? columns + 1) - label.column; });
  const shown = labels.filter((label, i) => label.span >= 2 || i === labels.length - 1 && label.span >= 1 && columns - label.column >= 1);
  $('heatMonths').innerHTML = shown.map(label => '<span style="grid-column:' + label.column + ' / span ' + Math.max(1, label.span) + '">' + label.text + '</span>').join('');
  $('heatMonths').style.gridTemplateColumns = 'repeat(' + columns + ',minmax(0,1fr))';
  $('heatMonths').hidden = false;
  renderDay(rows); renderActivity(rows);
  if (focusedDate) $('heatmap').querySelector('[data-date="' + focusedDate + '"]')?.focus({ preventScroll: true });
}
function scopeSuffix() {
  const scope = [$('agentFilter').value === 'all' ? null : agents[$('agentFilter').value]?.name, $('sourceFilter').value === 'all' ? null : $('sourceFilter').selectedOptions[0]?.textContent, $('modelFilter').value === 'all' ? null : displayModel($('modelFilter').value)].filter(Boolean);
  return scope.length ? ' · ' + scope.join(' · ') : '';
}
function renderActivity(rows) {
  const start = heatStart(), dayTotals = new Map(), hours = filterRows(hourlyData());
  for (const row of filterRows(rows)) if (row.date >= start && row.date <= today) dayTotals.set(row.date, (dayTotals.get(row.date) || 0) + row.totalTokens);
  window.usageInsights.renderActivity({
    hourlyRows: hours.filter(r => r.date >= start && r.date <= today), dayTotals, start, today, selectedDay, scopeSuffix: scopeSuffix(),
    rangeText: $('heatRange').value === '365' ? '最近一年' : $('heatRange').value + ' 年',
    hoursReady: hourlyReady, dayHourRows: day => hours.filter(r => r.date === day), currentHour,
    clearDay: () => { selectedDay = null; renderHeat(data()); }, agents, short, usd: window.displayValues.usd, icon, escapeHtml
  });
}
function hideHeatTooltip() {
  const tooltip = $('heatTooltip');
  tooltip.classList.remove('visible'); tooltip.setAttribute('aria-hidden', 'true');
  document.querySelector('[aria-describedby="heatTooltip"]')?.removeAttribute('aria-describedby');
}
function showHeatTooltip(button) {
  const tooltip = $('heatTooltip');
  document.querySelector('[aria-describedby="heatTooltip"]')?.removeAttribute('aria-describedby');
  button.setAttribute('aria-describedby', 'heatTooltip');
  const date = button.dataset.date ?? button.dataset.habitDate, tokens = button.dataset.tokens ?? button.dataset.tip;
  tooltip.innerHTML = '<span>' + date + '</span><strong>' + (tokens === '' ? '未观测到记录' : Number(tokens).toLocaleString('zh-CN') + ' <small>Token</small>') + '</strong>';
  const rect = button.getBoundingClientRect();
  tooltip.style.left = '0px'; tooltip.style.top = '0px';
  const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
  const above = rect.top - height - 12;
  tooltip.style.left = left + 'px'; tooltip.style.top = Math.max(8, Math.min(innerHeight - height - 8, above >= 8 ? above : rect.bottom + 12)) + 'px';
  tooltip.classList.add('visible'); tooltip.setAttribute('aria-hidden', 'false');
}
function renderDay(rows) {
  const entering = $('dayDetail').hidden || $('dayDetail').dataset.date !== selectedDay;
  $('dayDetail').hidden = !selectedDay; if (!selectedDay) return;
  $('dayDetail').dataset.date = selectedDay;
  const subset = filterRows(rows).filter(r => r.date === selectedDay), a = aggregate(subset), observed = realData ? rows.some(r => r.date === selectedDay) : selectedDay >= coverageStart && rows.length > 0;
  const dayCategories = '<h4 class="day-subtitle">Token 分类</h4><div class="day-categories">' +
    tiles(subset).map(tile => '<div class="' + tileClass(tile) + '" title="' + tileTitle(tile) + '"><small>' + tile.label + '</small><b>' + (subset.length ? tileText(tile) : '—') + '</b></div>').join('') +
    '</div><h4 class="day-subtitle">Agent 与模型</h4>';
  $('dayDetail').innerHTML = '<header><div><span class="eyebrow">当日明细</span><h3>' +
    selectedDay +
    '</h3></div><button id="closeDay" class="icon-button" aria-label="关闭当日明细">' +
    icon('ui/x') +
    '</button></header><div class="day-content"><div class="day-stats"><div><small>总 token</small><b>' +
    (observed ? short(a.total) : '未知') +
    '</b></div><div><small>API 等价估算</small><b>' +
    costHtml(a, selectedDay +
    ' 估算') +
    '</b></div><div><small>用量记录</small><b>' +
    (observed ? a.records : '未知') +
    '</b></div></div>' +
    (observed ? dayCategories +
    '<div class="day-agent-list">' +
    clientHtml(subset, true) +
    '</div>' : '<p>未观测到该日记录</p>') +
    '</div>';
  if (entering) window.uiMotion.enter($('dayDetail'), 'detail');
  const dayNumbers = $('dayDetail').querySelectorAll('.day-stats b');
  window.uiDetail.number(dayNumbers[0], 'day-tokens', observed ? a.total : null, v => v === null ? '未知' : short(Math.round(v)));
  window.uiDetail.number(dayNumbers[1].querySelector('.cost-lower'), 'day-cost', a.cost, v => v === null ? '未定价' : window.displayValues.usd(v));
  window.uiDetail.number(dayNumbers[2], 'day-records', observed ? a.records : null, v => v === null ? '未知' : String(Math.round(v)));
  $('closeDay').onclick = () => { selectedDay = null; renderHeat(data()); };
}
function colors() { const style = getComputedStyle(document.body); return { text: style.getPropertyValue('--muted').trim(), grid: style.getPropertyValue('--line').trim() }; }
const trendTooltip = document.createElement('div');
trendTooltip.id = 'trendTooltip'; trendTooltip.className = 'chart-tooltip'; trendTooltip.hidden = true;
trendTooltip.setAttribute('role', 'tooltip'); trendTooltip.setAttribute('aria-label', '趋势用量明细');
$('trendCanvas').parentElement.append(trendTooltip);
$('trendCanvas').parentElement.addEventListener('pointerleave', () => { trendTooltip.hidden = true; if(trendChart){trendChart.$hoverIndex=null;trendChart.draw();} });
window.addEventListener('scroll', () => { trendTooltip.hidden = true; if (window.uiFocus?.userScrolling()) for (const id of ['trendOptions', 'trendRangePopover']) if ($(id).matches(':popover-open')) $(id).hidePopover(); }, { passive: true });
function bucketTitle(b) { return !b ? '' : b.hour !== undefined ? b.start.slice(5) + ' ' + pad(b.hour) + ':00 – ' + pad(b.hour + 1) + ':00' : b.start === b.end ? b.start : b.start + ' 至 ' + b.end; }
function renderTrendTooltip({ chart, tooltip }) {
  if (tooltip.opacity === 0) { trendTooltip.hidden = true; return; }
  const index=chart.$hoverIndex??tooltip.dataPoints?.[0]?.dataIndex, bucket=trendBuckets[index];
  const points=chart.data.datasets.filter((_,i)=>chart.isDatasetVisible(i)).map(dataset=>({label:dataset.label,value:dataset.data[index]??null,color:dataset.borderColor,unit:dataset.usageMetric}));
  const missing=bucket && !data().some(row=>row.date>=bucket.start&&row.date<=bucket.end);
  const partial=chart.data.datasets.some(dataset=>dataset.usageBuckets?.[index]?.partial);
  const summary = window.chartUi.tooltipSummary(points.filter(point=>metric==='cost'||point.unit!=='cost'));
  const costPoint = metric==='tokens' ? points.find(point=>point.unit==='cost') : null;
  const value = number => metric === 'cost' ? money(number) : short(number) + ' token';
  trendTooltip.innerHTML = '<div class="chart-tooltip-heading"><strong>' +
    escapeHtml(bucketTitle(bucket)||tooltip.title?.[0]||'') +
    '</strong><span>' +
    (missing?'未记录':summary.total===null?'数值未知':'合计 '+value(summary.total)) +
    '</span></div><div class="chart-tooltip-list">' +
    summary.entries.slice(0,6).map(point => '<div class="chart-tooltip-row"><i style="background:' +
    point.color +
    '"></i><span>' +
    escapeHtml(point.label) +
    '</span><b>' +
    value(point.value) +
    '</b></div>').join('') +
    (costPoint && !missing?'<div class="chart-tooltip-row"><i style="background:'+costPoint.color+'"></i><span>已定价估算</span><b>'+money(costPoint.value)+'</b></div>':'') +
    (summary.entries.length ? '' : '<p>'+(missing?'此日期没有记录，淡线仅连接前后记录。':summary.total===null?'记录存在，但用量或价格未报告。':(trendHourly?'此时段没有用量记录。':'此日期的已记录值为零。'))+'</p>') +
    '</div><div class="chart-tooltip-note">' +
    (summary.entries.length > 6 ? '另有 ' + (summary.entries.length - 6) + ' 个模型，可在模型明细查看；' : '') +
    (summary.zeroCount ? summary.zeroCount +
    ' 项记录为零；' : '') +
    (summary.unknownCount ? summary.unknownCount +
    ' 个值未知；' : '') +
    (partial?'当前聚合含未记录日期；':'') +
    ($('display').value === 'total' ? '当前区间累计值' : trendHourly ? '每小时记录值 · 本地时间' : $('display').value === 'average' ? '30 日平均值' : '每日记录值') +
    (metric === 'cost' ? ' · 已定价部分' : '') +
    '</div>';
  if(missing)trendTooltip.innerHTML='<div class="chart-tooltip-heading"><strong>'+escapeHtml(bucketTitle(bucket))+'</strong><span>未记录</span></div><p>淡线仅连接前后记录，没有此日期的用量数值。</p>';
  const entering = trendTooltip.hidden; trendTooltip.hidden = false; if (entering) window.uiMotion.enter(trendTooltip, 'tooltip');
  const plot = chart.canvas.parentElement, point = { x: chart.canvas.offsetLeft + tooltip.caretX, y: chart.canvas.offsetTop + tooltip.caretY };
  const position = window.chartUi.positionTooltip({ width: plot.clientWidth, height: plot.clientHeight }, { width: trendTooltip.offsetWidth, height: trendTooltip.offsetHeight }, point);
  trendTooltip.style.left = position.x + 'px'; trendTooltip.style.top = position.y + 'px';
}
let revealFrame = 0, trendSeen = false;
function revealTrend() {
  cancelAnimationFrame(revealFrame);
  if (!trendChart || window.uiMotion.mode !== 'full') { if(trendChart)trendChart.$reveal=1; return; }
  const chart=trendChart,start=performance.now();chart.$reveal=0;chart.$revealFrames=0;
  function tick(now) { if(chart!==trendChart || window.uiMotion.mode!=='full'){chart.$reveal=1;chart.draw();return;}chart.$reveal=1-(1-Math.min(1,(now-start)/720))**3;chart.$revealFrames++;chart.draw();if(chart.$reveal<1)revealFrame=requestAnimationFrame(tick); }
  revealFrame=requestAnimationFrame(tick);
}
const curveReveal={id:'curveReveal',beforeDatasetsDraw(chart){const a=chart.chartArea;chart.ctx.save();chart.ctx.beginPath();chart.ctx.rect(a.left-5,a.top-6,(a.right-a.left+10)*(chart.$reveal??1),a.bottom-a.top+12);chart.ctx.clip();},afterDatasetsDraw(chart){chart.ctx.restore();}};
const trendObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)&&!trendSeen){trendSeen=true;revealTrend();}},{threshold:.25});
trendObserver.observe($('trendCanvas'));
window.addEventListener('ui-view-change',event=>{if(event.detail==='usage')trendSeen=false;});
window.addEventListener('unload',()=>{cancelAnimationFrame(revealFrame);trendObserver.disconnect();});
function renderTrend(rows) {
  if(metric==='cost' && trendMode==='flow')trendMode='total';
  for(const button of $('trendModes').querySelectorAll('[data-trend-mode]')){button.hidden=metric==='cost'&&button.dataset.trendMode==='flow';button.setAttribute('aria-pressed',String(button.dataset.trendMode===trendMode));}
  const start = trendRange ? trendRange.start : rangeStart(), end = trendRange ? trendRange.end : today;
  const grouped = filterRows(rows), subset = grouped.filter(r=>r.date>=start && r.date<=end), a = aggregate(subset);
  const chronological = dates(start,end), grain = $('trendGrain').value === 'auto' ? chronological.length>366 ? 'week' : 'day' : $('trendGrain').value;
  const weights = new Map(); for(const r of subset) weights.set(r.model,(weights.get(r.model)||0)+(metric==='cost' ? r.estimatedCostUsd||0 : r.totalTokens));
  const byModel = [...weights].sort((a,b)=>b[1]-a[1]).map(([model])=>model);
  const series = window.usageMath.seriesByModel($('display').value==='total'?subset:grouped,byModel,chronological,$('display').value,metric,coverageStart,realData?new Set(rows.map(r=>r.date)):null);
  const add = lists => chronological.map((_,i)=>{const known=lists.map(v=>v[i]).filter(Number.isFinite);return known.length?known.reduce((s,v)=>s+v,0):null;});
  // One local day plots by hour: hours without records are zero, a recorded
  // hour whose field is unreported stays unknown, exactly like daily buckets.
  const hourly = trendHourly = start === end && hourlyReady(start);
  const hours = hourly ? Array.from({length:(start===today?currentHour():23)+1},(_,hour)=>hour) : [];
  const hourRows = hourly ? filterRows(hourlyData()).filter(r=>r.date===start) : [];
  const perHour = (pick, keep = () => true) => { let running = 0, known = false; return hours.map(hour => { const items = hourRows.filter(r=>r.hour===hour&&keep(r)), values = items.map(pick).filter(Number.isFinite), value = items.length && !values.length ? null : values.reduce((s,v)=>s+v,0); if ($('display').value !== 'total') return value; if (value !== null) { running += value; known = true; } return known || metric !== 'cost' ? running : null; }); };
  const pick = r => metric==='cost' ? r.estimatedCostUsd : r.totalTokens;
  const total = hourly ? perHour(pick) : add([...series.values()]);
  const modelValues = model => hourly ? perHour(pick, r=>r.model===model) : series.get(model);
  let selected = trendMode==='models' ? byModel.slice(0,5).map(model=>({key:model,label:displayModel(model),values:modelValues(model),color:modelColor(model)})) : [{key:'total',label:metric==='cost'?'已定价估算':'总量',values:total,color:document.body.classList.contains('dark')?'#9aabff':'#796be7',unit:metric}];
  if (trendMode==='flow' && metric==='tokens') {
    const fields=[['inputUncached','输入','#5998e0'],['output','输出（含推理）','#63ad95'],['cacheRead','缓存读取','#9575df'],['cacheWrite','缓存写入','#d9ab59']];
    selected=fields.map(([field,label,color])=>({key:field,label,color,unit:'tokens',values:hourly?perHour(r=>r[field]):window.usageMath.seriesByModel(($('display').value==='total'?subset:grouped).map(r=>({...r,model:field,estimatedCostUsd:r[field]??null})),[field],chronological,$('display').value,'cost',coverageStart,realData?new Set(rows.map(r=>r.date)):null).get(field)}));
    const costs=hourly?perHour(r=>r.estimatedCostUsd):window.usageMath.seriesByModel(($('display').value==='total'?subset:grouped).map(r=>({...r,model:'cost'})),['cost'],chronological,$('display').value,'cost',coverageStart,realData?new Set(rows.map(r=>r.date)):null).get('cost');
    selected.push({key:'cost',label:'估算费用（右轴）',color:'#dd7b84',unit:'cost',values:costs});
  }
  if (trendMode==='models' && byModel.length>5) selected.push({key:'other',label:'其他 '+(byModel.length-5)+' 个模型',values:hourly?perHour(pick,r=>!byModel.slice(0,5).includes(r.model)):add(byModel.slice(5).map(m=>series.get(m))),color:'#a3abb8'});
  const bucket = hourly ? values => hours.map((hour,i)=>({label:pad(hour)+':00',start,end,hour,value:values[i],partial:false})) : values => window.chartUi.bucketSeries(chronological,values,grain,$('display').value);
  trendBuckets = bucket(total); if($('newest').checked) trendBuckets.reverse();
  keyboardTrendIndex = Math.max(0,Math.min(keyboardTrendIndex,trendBuckets.length-1));
  const dayList = trendBuckets.map(b=>hourly?b.label:b.start), theme=colors();
  const observedDates=new Set(rows.map(row=>row.date));
  const datasets = selected.map(entry=>{const buckets=bucket(entry.values);if($('newest').checked)buckets.reverse();const values=buckets.map(b=>b.value),blocked=hourly?values.reduce((list,v)=>(list.push(list.at(-1)+Number(!Number.isFinite(v))),list),[0]):window.chartUi.gapPlan(buckets,values,observedDates,coverageStart,$('display').value);
    const kind=context=>window.chartUi.segmentKind(context.p0DataIndex,context.p1DataIndex,blocked,values);
    const secondary=metric==='tokens'&&entry.unit==='cost';return {hidden:hiddenSeries.has(entry.key),label:entry.label,usageMetric:entry.unit||metric,yAxisID:secondary?'yCost':'y',data:values,usageBuckets:buckets,borderColor:entry.color,borderDash:secondary?[5,5]:[],backgroundColor:context=>{const area=context.chart.chartArea;if(!area)return entry.color+'20';const fill=context.chart.ctx.createLinearGradient(0,area.top,0,area.bottom);fill.addColorStop(0,entry.color+(trendMode==='total'?'40':'24'));fill.addColorStop(1,entry.color+'00');return fill;},borderWidth:secondary?2:2.4,fill:secondary?false:'origin',pointRadius:dayList.length===1?4:0,pointHoverRadius:5,pointHoverBorderWidth:2,pointHoverBackgroundColor:entry.color,cubicInterpolationMode:'monotone',tension:.35,spanGaps:true,segment:{borderColor:context=>kind(context)==='unknown'?'transparent':kind(context)==='bridge'?entry.color+'66':entry.color,borderDash:context=>kind(context)==='bridge'?[2,4]:secondary?[5,5]:[],backgroundColor:context=>kind(context)==='recorded'?undefined:'transparent'}};});
  trendTooltip.hidden=true;if(trendChart)trendChart.$hoverIndex=null;
  const crosshair={id:'usageCrosshair',afterDraw(chart){const active=chart.tooltip?.getActiveElements();if(chart.$hoverIndex==null&&!active?.length)return;const x=chart.$hoverIndex!=null?chart.scales.x.getPixelForValue(chart.$hoverIndex):active[0].element.x,{ctx,chartArea:area}=chart;ctx.save();ctx.strokeStyle=theme.text+'66';ctx.lineWidth=1;ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(x,area.top);ctx.lineTo(x,area.bottom);ctx.stroke();ctx.restore();}};
  const gapHover={id:'gapHover',afterEvent(chart,args){const event=args.event,a=chart.chartArea;if(event.type==='mouseout'){chart.$hoverIndex=null;return;}if(event.type!=='mousemove'||event.x<a.left||event.x>a.right||event.y<a.top||event.y>a.bottom)return;const index=Math.max(0,Math.min(trendBuckets.length-1,Math.round(chart.scales.x.getValueForPixel(event.x))));chart.$hoverIndex=index;const active=chart.data.datasets.flatMap((d,i)=>chart.isDatasetVisible(i)&&Number.isFinite(d.data[index])?[{datasetIndex:i,index}]:[]);chart.setActiveElements(active);chart.tooltip.setActiveElements(active,{x:event.x,y:event.y});args.changed=true;renderTrendTooltip({chart,tooltip:{opacity:1,caretX:event.x,caretY:event.y,dataPoints:[{dataIndex:index}]}});}};
  const animation=window.uiMotion.mode==='full'?{duration:650,easing:'easeOutQuart'}:false;
  const config={type:'line',data:{labels:dayList,datasets},plugins:[crosshair,curveReveal,gapHover],options:{animation,responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:'index'},onClick:(event)=>{if(trendDragged)return;const area=trendChart.chartArea;if(event.x>=area.left&&event.x<=area.right&&event.y>=area.top&&event.y<=area.bottom){const index=Math.max(0,Math.min(trendBuckets.length-1,Math.round(trendChart.scales.x.getValueForPixel(event.x)))),b=trendBuckets[index];if(grain==='day'||hourly)goToDay(b.start);else{trendRange={start:b.start,end:b.end};$('trendGrain').value='day';renderTrend(data());}}},plugins:{legend:{display:false},tooltip:{enabled:false,external:renderTrendTooltip}},scales:{x:{grid:{display:false},border:{display:false},ticks:{maxTicksLimit:8,color:theme.text,font:{size:12},callback:(_v,i)=>hourly?dayList[i]:dayList[i]?.slice(5)}},y:{beginAtZero:true,grid:{color:theme.grid+'90',lineWidth:1},border:{display:false},ticks:{maxTicksLimit:5,color:theme.text,font:{size:12},callback:v=>metric==='cost'?'$'+v:short(v)}},yCost:{display:metric==='tokens'&&trendMode==='flow'&&!hiddenSeries.has('cost'),position:'right',beginAtZero:true,grid:{drawOnChartArea:false},border:{display:false},ticks:{maxTicksLimit:5,color:'#c8757e',font:{size:12},callback:v=>'$'+v}}}}};
  for(let i=0;i<datasets.length;i++) datasets[i].usageKey=selected[i].key;
  if(trendChart){
    // Keep both the chart and matching datasets: Chart.js retains presented
    // coordinates and can retarget an interrupted transition instead of
    // treating each new array as a fresh curve rising from zero.
    trendChart.stop();
    const previous=new Map(trendChart.data.datasets.map(d=>[d.usageKey,d])),sameSeries=previous.size===datasets.length&&datasets.every(d=>previous.has(d.usageKey));
    config.data.datasets=datasets.map(next=>previous.has(next.usageKey)?Object.assign(previous.get(next.usageKey),next):next);
    trendChart.setActiveElements([]);trendChart.tooltip.setActiveElements([],{x:0,y:0});
    trendChart.data=config.data;trendChart.options=config.options;config.data.datasets.forEach((dataset,i)=>trendChart.setDatasetVisibility(i,!hiddenSeries.has(dataset.usageKey)));trendChart.config.plugins[0]=crosshair;trendChart.update(window.uiMotion.mode==='full'&&sameSeries?undefined:'none');if(!sameSeries&&trendSeen)revealTrend();
  }else trendChart=new Chart($('trendCanvas'),config);
  $('chartEmpty').hidden=subset.length>0 && datasets.some(d=>d.data.some(Number.isFinite));
  $('trendTotalLabel').textContent=metric==='cost'?'已定价估算':'token';$('trendTotal').hidden=$('trendTotalLabel').hidden=!trendRange;
  $('trendScope').textContent = ($('agentFilter').value === 'all' ? '全部 Agent' : agents[$('agentFilter').value].name) + ' · ' + (trendRange ? (start === end ? start.slice(5) : start.slice(5) + ' – ' + end.slice(5)) + ' · 仅此图' : period === 'all' ? '累计' : period === 'today' ? '今天' : '最近 ' + period + ' 天');
  $('trendTotal').innerHTML=subset.length?metric==='cost'?costHtml(a,'区间估算'):short(a.total):'—';
  window.uiDetail.number(metric==='cost'?$('trendTotal').querySelector('.cost-lower'):$('trendTotal'),'trend-'+metric,subset.length?metric==='cost'?a.cost:a.total:null,v=>v===null?'—':metric==='cost'?window.displayValues.usd(v):short(Math.round(v)));
  // Facts follow the plotted unit: recorded days, or active hours of one day.
  const unitTotals=new Map();for(const row of hourly?hourRows:subset){const v=pick(row);if(Number.isFinite(v)){const key=hourly?row.hour:row.date;unitTotals.set(key,(unitTotals.get(key)||0)+v);}}
  const peak=[...unitTotals].sort((a,b)=>b[1]-a[1])[0],format=v=>metric==='cost'?window.displayValues.usd(v):short(Math.round(v));
  // Footer facts the rest of the page does not show: change against the window just
  // before (same length, and only when it is fully covered), the peak, and the lead model.
  const [changeLabel,peakLabel]=document.querySelectorAll('.trend-insights span');peakLabel.textContent=hourly?'峰值时段':'峰值日';
  const span=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1,whole=!trendRange&&period==='all';
  const recent=hourly?null:whole?{from:shift(today,-29),to:today}:{from:start,to:end},before=hourly?null:{from:shift(recent.from,-(whole?30:span)),to:shift(recent.from,-1)};
  const valueOf=list=>{const values=list.map(pick).filter(Number.isFinite);return values.length?values.reduce((sum,v)=>sum+v,0):null;};
  let now,then,changeNote;
  if(hourly){const last=start===today?currentHour():23,within=r=>r.hour<=last;now=valueOf(hourRows.filter(within));then=hourlyReady(shift(start,-1))?valueOf(filterRows(hourlyData()).filter(r=>r.date===shift(start,-1)&&within(r))):null;changeLabel.textContent=start===today?'较昨天同时段':'较前一天';changeNote=start===today?'今天 00:00 至 '+pad(last+1)+':00 对比昨天同一时段':'';}
  else{const within=(r,w)=>r.date>=w.from&&r.date<=w.to;now=valueOf(grouped.filter(r=>within(r,recent)));then=before.from>=coverageStart?valueOf(grouped.filter(r=>within(r,before))):null;changeLabel.textContent=whole?'近 30 天较前 30 天':'较上一区间';changeNote=recent.from+' 至 '+recent.to+' 对比 '+before.from+' 至 '+before.to;if(before.from<coverageStart)changeNote='上一区间早于记录开始，不做对比';}
  const delta=window.insightsMath.change(now,then);
  $('trendChange').textContent=delta===null?'—':(delta>=0?'+':'−')+Math.abs(delta*100).toFixed(0)+'%';$('trendChange').dataset.direction=delta===null?'':delta>=0?'up':'down';$('trendChange').title=changeNote;
  const leads=new Map();for(const row of hourly?hourRows:subset){const v=pick(row);if(Number.isFinite(v))leads.set(row.model,(leads.get(row.model)||0)+v);}
  const lead=[...leads].sort((x,y)=>y[1]-x[1])[0],leadTotal=[...leads.values()].reduce((sum,v)=>sum+v,0);
  $('trendLead').textContent=lead&&lead[1]>0?displayModel(lead[0])+' · '+(lead[1]/leadTotal*100).toFixed(0)+'%':'—';$('trendLead').title=lead?displayModel(lead[0]):'';
  $('trendPeak').textContent=peak?format(peak[1])+' · '+(hourly?pad(peak[0])+':00':peak[0].slice(5)):'—';$('trendPeak').disabled=!peak;$('trendPeak').dataset.habitDate=peak?hourly?start:peak[0]:'';
  $('trendFrom').value=start;$('trendTo').value=end;$('trendRangeReset').hidden=!trendRange;$('trendRangeFollow').hidden=!trendRange;
  $('trendRangeLabel').textContent=trendRange?start===end?start.slice(5):start.slice(5)+' – '+end.slice(5):period==='all'?'累计':period==='today'?'今天':'最近 '+period+' 天';$('trendRangeButton').title=start===end?start:start+' 至 '+end;$('trendRangeButton').setAttribute('aria-label','趋势时间范围：'+$('trendRangeButton').title);
  $('trendNote').hidden=false;$('trendNote').textContent=hourly?'按小时 · 本地时间'+($('display').value==='total'?' · 当日累计':'')+(metric==='cost'?' · 定价覆盖 '+((a.coverage??0)*100).toFixed(1)+'%':'')+(start===today?' · 截至 '+pad(currentHour())+':00 时段':''):(grain==='week'?'按周':grain==='month'?'按月':'按日')+($('display').value==='average'?' · 30 日均值':$('display').value==='total'?' · 区间累计':' · 已记录用量')+(metric==='cost'?' · 定价覆盖 '+((a.coverage??0)*100).toFixed(1)+'%':'')+(start===end?' · 该日没有小时数据':' · 淡线连接未记录日期');
  $('chartLegend').innerHTML=selected.map(entry=>'<button data-trend-series="'+escapeHtml(entry.key)+'" aria-pressed="'+!hiddenSeries.has(entry.key)+'" title="'+(hiddenSeries.has(entry.key)?'显示':'隐藏')+'这一项"><i class="swatch" style="background:'+entry.color+'"></i>'+escapeHtml(entry.label)+'</button>').join('');
  window.uiMotion.indicators();
}
$('trendModes').addEventListener('click',event=>{const b=event.target.closest('[data-trend-mode]');if(!b||trendMode===b.dataset.trendMode)return;trendMode=b.dataset.trendMode;for(const el of $('trendModes').children){if(!el.dataset.trendMode)continue;el.classList.toggle('active',el===b);el.setAttribute('aria-pressed',String(el===b));}renderTrend(data());});
$('trendGrain').addEventListener('change',()=>renderTrend(data()));
$('trendRangeForm').addEventListener('submit',event=>{event.preventDefault();const start=$('trendFrom').value,end=$('trendTo').value;if(!start||!end||start>end||!datesLimited(start,end)){window.uiRangeCalendar?.warn(!start||!end?'请选择日期':start>end?'结束日期不能早于开始日期':'最多查看 10 年');return;}trendRange={start,end};$('trendRangePopover').hidePopover();renderTrend(data());});
function datesLimited(start,end){return (Date.parse(end)-Date.parse(start))/86400000<=3660;}
$('trendRangeReset').addEventListener('click',()=>{trendRange=null;$('trendRangePopover').hidePopover();renderTrend(data());});
$('trendRangePopover').addEventListener('click',event=>{const button=event.target.closest('[data-trend-preset]');if(!button)return;const preset=button.dataset.trendPreset;trendRange=preset==='page'?null:{start:preset==='today'?today:shift(today,1-Number(preset)),end:today};$('trendRangePopover').hidePopover();renderTrend(data());});
$('trendRangeFollow').addEventListener('click',()=>{trendRange=null;renderTrend(data());$('trendRangeButton').focus();});
$('chartLegend').addEventListener('click',event=>{const b=event.target.closest('[data-trend-series]');if(!b)return;const key=b.dataset.trendSeries,visible=hiddenSeries.has(key);if(visible)hiddenSeries.delete(key);else hiddenSeries.add(key);try{localStorage.setItem(hiddenKey,JSON.stringify([...hiddenSeries]));}catch{/* Not remembered. */}const index=trendChart.data.datasets.findIndex(d=>d.usageKey===key);if(index<0)return;trendChart.setDatasetVisibility(index,visible);if(key==='cost')trendChart.options.scales.yCost.display=visible&&metric==='tokens'&&trendMode==='flow';b.setAttribute('aria-pressed',String(visible));b.title=(visible?'隐藏':'显示')+'这一项';trendChart.update(window.uiMotion.mode==='full'?undefined:'none');});
$('trendCanvas').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Enter','Escape'].includes(event.key)||!trendBuckets.length)return;event.preventDefault();if(event.key==='Escape'){trendChart.tooltip.setActiveElements([],{x:0,y:0});trendTooltip.hidden=true;trendChart.$hoverIndex=null;trendChart.draw();return;}if(event.key==='Enter'){const b=trendBuckets[keyboardTrendIndex];if(b.start===b.end)goToDay(b.start);else{trendRange={start:b.start,end:b.end};$('trendGrain').value='day';renderTrend(data());}return;}keyboardTrendIndex=Math.max(0,Math.min(trendBuckets.length-1,keyboardTrendIndex+(event.key==='ArrowRight'?1:-1)));const element=trendChart.getDatasetMeta(0).data[keyboardTrendIndex];if(element){trendChart.$hoverIndex=keyboardTrendIndex;trendChart.tooltip.setActiveElements([{datasetIndex:0,index:keyboardTrendIndex}],{x:element.x,y:element.y});if(element.skip)renderTrendTooltip({chart:trendChart,tooltip:{opacity:1,caretX:element.x,caretY:trendChart.chartArea.top+40,dataPoints:[{dataIndex:keyboardTrendIndex}]}});trendChart.draw();}});
$('trendCanvas').addEventListener('pointerdown',event=>{if(event.button!==0)return;trendPress={x:event.clientX,y:event.clientY};trendDragged=false;event.currentTarget.setPointerCapture(event.pointerId);});
$('trendCanvas').addEventListener('pointermove',event=>{if(trendPress&&Math.hypot(event.clientX-trendPress.x,event.clientY-trendPress.y)>6)trendDragged=true;});
$('trendCanvas').addEventListener('pointerup',event=>{trendPress=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);});
$('trendCanvas').addEventListener('pointercancel',()=>{trendPress=null;trendDragged=true;});
window.addEventListener('ui-motion-change',()=>{cancelAnimationFrame(revealFrame);if(trendChart){trendChart.$reveal=1;trendChart.stop();trendChart.options.animation=window.uiMotion.mode==='full'?{duration:650,easing:'easeOutQuart'}:false;trendChart.update('none');}});

function previousWindow() {
  if (period === 'all') return null;
  const start = rangeStart(), length = Math.round((Date.parse(today) - Date.parse(start)) / 86400000) + 1, from = shift(start, -length), to = shift(start, -1);
  return { from, to, complete: from >= coverageStart };
}
function renderInsights(rows) {
  const subset = rangeRows(rows), start = rangeStart(), previous = previousWindow();
  const previousRows = previous?.complete ? filterRows(rows).filter(r => r.date >= previous.from && r.date <= previous.to) : null;
  const inRange = list => list.filter(r => r.date >= start && r.date <= today), selected = { agent: $('agentFilter').value, model: $('modelFilter').value };
    window.usageInsights.render({
    rows: subset, previousRows, recorded, rangeText: rangeLabel(), selected, scopeSuffix: scopeSuffix(),
    shareRows: { agent: inRange(filterRows(rows, 'agent')), model: inRange(filterRows(rows, 'model')) },
    compareText: period === 'today' ? '较昨天' : '较前 ' + period + ' 天',
    compareMissing: period === 'all' ? '累计范围，不做对比' : '上一周期早于记录开始，不做对比',
    colorOf: categoryColor, agents, short, usd: window.displayValues.usd, icon, escapeHtml, displayModel
  });
}
function renderModels(rows) {
  const subset = rangeRows(rows), grouped = new Map();
  for (const row of subset) { if (!grouped.has(row.model)) grouped.set(row.model, []); grouped.get(row.model).push(row); }
  const totals = new Map([...grouped].map(([model, items]) => [model, aggregate(items)]));
  const models = [...grouped.keys()].sort((a, b) => totals.get(b).total - totals.get(a).total), total = sum(subset, 'totalTokens');
  $('modelCount').textContent = models.filter(m => m !== 'unknown').length +
    ' 个模型标识' +
    (models.includes('unknown') ? ' · 另有未记录用量' : ''); $('modelRows').innerHTML = models.map(model => { const a = totals.get(model); return '<tr><td>' +
    escapeHtml(displayModel(model)) +
    '<small>' +
    [...new Set(grouped.get(model).map(r => agents[r.agent].name))].join(' / ') +
    '</small></td><td>' +
    short(a.total) +
    '</td><td>' +
    (100 * a.total / total).toFixed(1) +
    '%</td><td>' +
    costHtml(a, displayModel(model) +
    ' 估算') +
    '</td><td>' +
    (a.coverage * 100).toFixed(1) +
    '%</td></tr>'; }).join('') || '<tr><td colspan="5">此筛选条件下暂无模型记录。</td></tr>';
}
function renderSources() {
  if (realData) {
    const issues = {SOURCE_USAGE_REGRESSION:'较旧快照未覆盖已记录用量',SOURCE_USAGE_CONFLICT:'本次扫描发现计量分类冲突；仍有冲突的记录暂停精确定价',DEEPSEEK_FORMAT_UNSUPPORTED:'会话版本暂不支持，保留已有统计',DEEPSEEK_SEED_INVALID:'分叉记录缺少有效继承边界',DEEPSEEK_ENCODING_CONFLICT:'同一会话出现两种编码，请保留一个读取来源',SOURCE_COMPRESSION_INVALID:'压缩记录尚未完整或已损坏，稍后重试',CURSOR_CSV_SCHEMA:'CSV 需要逐请求的时间、模型、输入、输出、缓存读写字段',CURSOR_SOURCE_MODE_CONFLICT:'SDK 和 CSV 无法证明是否重复；当前统计库请沿用一种来源',USAGE_UNREPORTED:'部分调用没有报告用量',SOURCE_ROW_INVALID:'部分记录字段不完整，已保留有效记录',DEEPSEEK_LOG_INCOMPLETE:'会话序列不连续，仅保留有效前缀'};
    const states = { verified: '已验证', partial: '部分支持', unverified: '未验收', 'not-detected': '未检测到', error: '读取失败' };
    $('sourceRows').innerHTML = Object.entries(agents).map(([key, meta]) => { const source = localSnapshot.sources.find(s => s.agent === key); return '<article class="source-row">' +
      icon(meta.icon) +
      '<div class="source-info"><h3>' +
      meta.name +
      '<span class="status">' +
      (states[source?.status] || '未验收') +
      '</span></h3><p>' +
      (source?.observedRecords || 0) +
      ' 条已读取记录 · ' +
      (source?.realSampleVerified ? '有真实样本核对' : '真实样本未验收') +
      '</p><p>最近成功：' +
      (source?.lastSuccess ? escapeHtml(new Date(source.lastSuccess).toLocaleString('zh-CN')) : '暂无') +
      '</p><p>' +
      Object.entries(source?.qualityIssues || {}).map(([kind, count]) => escapeHtml(kind) +
      ' × ' +
      count).join('；') +
      '</p>' +
      '<p>' + escapeHtml(meta.hint) + '</p><p>' + (source?.errors || []).map(code => escapeHtml(issues[code] || '读取暂不可用：' + code)).join('；') + '</p>' + (usageBridge ? '<button data-add-source="' +
      key +
      '">' + (key === 'cursor' ? '选择用量文件' : '选择本地目录') + '</button>' : '') +
      '</div></article>'; }).join(''); return;
  }
  $('sourceRows').innerHTML = Object.entries(agents).map(([key, meta]) => '<article class="source-row">' +
    icon(meta.icon) +
    '<div class="source-info"><h3>' +
    meta.name +
    '<span class="status ' +
    (key === 'workbuddy' ? 'partial' : '') +
    '">' +
    (key === 'workbuddy' ? '部分支持（示例）' : key === 'mimo' ? '真实样本未验收（示例）' : '本机样本已验证（示例）') +
    '</span></h3><p>' +
    (key === 'workbuddy' ? '部分记录缺少定价字段；保留 token，费用显示未定价。' : '只读提取统计字段；不读取正文或认证信息。') +
    '</p><div class="source-fields"><span>最近成功：14:32（示例）</span><span>输入 / 输出 / 缓存 / 推理</span><span>来源版本：预览样本</span></div><button data-add-source="' +
    key +
    '">' +
    icon('ui/folder-plus') +
    '选择本地目录</button></div></article>').join('');
}
function updateCollection() { const interval=usageStatus.refreshIntervalMs??15000;$('usageInterval').value=String(interval);$('usageInterval').disabled=!usageBridge;$('collectionState').textContent = usageBridge ? enabled ? interval ? '本机离线采集 · 每 '+interval/1000+' 秒刷新' : '本机离线采集 · 手动刷新' : '采集已暂停 · 历史保留' : realData ? '本机统计快照 · 只读' : enabled ? '合成数据 · 演示开启' : '合成数据 · 演示暂停';
 $('settingsPause').disabled = realData && !usageBridge; $('settingsPause').textContent = usageBridge ? enabled ? '暂停采集' : '恢复采集' : realData ? '只读快照' : enabled ? '暂停演示采集' : '恢复演示采集';
 // The pause control is a switch, so its state must be exposed with the label.
 $('settingsPause').setAttribute('role', 'switch'); $('settingsPause').setAttribute('aria-checked', String(Boolean(enabled))); }
function render() { syncCalendar(); const rows = data(); recorded = window.insightsMath.recordedFields(templates); window.usageCalendar = { today, min: coverageStart, recorded: new Set(filterRows(rows).map(r => r.date)) }; renderOverview(rows); renderHeat(rows); renderTrend(rows); renderInsights(rows); renderModels(rows); updateCollection(); window.uiSelect?.syncAll(); window.uiSegments?.syncAll(); window.uiMotion.indicators(); }
function view(name) {
  if ($('main').dataset.currentView === name) return;
  // Save the actual presentation position before hiding a long page clamps scrollY.
  window.dispatchEvent(new Event('ui-view-leave'));
  window.uiDetail.settleNumbers(); window.uiDetail.cancelScroll(); window.uiMotion.cleanup(); hideHeatTooltip(); trendTooltip.hidden = true;
  $('main').dataset.currentView = name;
  for (const key of ['usage', 'sources', 'settings', 'quota']) $(key).hidden = key !== name;
  for (const button of document.querySelectorAll('[data-view]')) button.toggleAttribute('aria-current', button.dataset.view === name);
  document.querySelector('[data-view="' + name + '"]').setAttribute('aria-current', 'page');
  if (name === 'usage') render();
  window.dispatchEvent(new CustomEvent('ui-view-change',{detail:name}));
  window.uiDetail.scrollTo(0); window.uiMotion.indicators(); window.uiMotion.enter($(name), 'page');
}
function setTheme(value) { document.body.classList.toggle('dark', value === 'dark'); $('themeSelect').value = value; $('theme').setAttribute('aria-label', value === 'dark' ? '切换浅色外观' : '切换深色外观'); $('theme').innerHTML = icon(value === 'dark' ? 'ui/moon' : 'ui/sun'); applyHeatPalette(); render(); }
function fillSources() { const previous=$('sourceFilter').value,list=[...new Set(templates.filter(r=>$('agentFilter').value==='all'||r.agent===$('agentFilter').value).map(r=>r.provider||'unknown'))].sort();$('sourceFilter').innerHTML='<option value="all">全部来源</option>'+list.map(value=>'<option value="'+escapeHtml(value)+'">'+escapeHtml(value==='unknown'?'来源未报告':value)+'</option>').join('');$('sourceFilter').value=list.includes(previous)?previous:'all'; }
function fillModels() { const previous = $('modelFilter').value, list = [...new Set(templates.filter(r => ($('agentFilter').value === 'all' || r.agent === $('agentFilter').value) && ($('sourceFilter').value==='all'||(r.provider||'unknown')===$('sourceFilter').value)).map(r => r.model))].sort(); $('modelFilter').innerHTML = '<option value="all">全部模型</option>' +
  list.map(m => '<option value="' +
  escapeHtml(m) +
  '">' +
  escapeHtml(displayModel(m)) +
  '</option>').join(''); $('modelFilter').value = list.includes(previous) ? previous : 'all'; }
$('agentFilter').innerHTML = '<option value="all">全部 Agent</option>' + Object.entries(agents).map(([key, a]) => '<option value="' + key + '">' + a.name + '</option>').join(''); fillSources(); fillModels(); renderSources(); publishAgentUsage();
$('heatRange').innerHTML = '<option value="365">最近一年</option><option value="' + today.slice(0, 4) + '">' + today.slice(0, 4) + ' 年</option>';
if (realData) $('display').value = 'daily';
let restoredView = 'usage';
try {
  const saved = JSON.parse(sessionStorage.getItem('agentusage-preview.reload.v1')); sessionStorage.removeItem('agentusage-preview.reload.v1');
  if (saved) {
    if (['all', '30', '7', 'today'].includes(saved.period)) period = saved.period;
    if (['tokens', 'cost'].includes(saved.metric)) metric = saved.metric;
    if (saved.agent === 'all' || Object.hasOwn(agents, saved.agent)) $('agentFilter').value = saved.agent;
    fillSources(); if ([...$('sourceFilter').options].some(o=>o.value===saved.source)) $('sourceFilter').value=saved.source;
    fillModels(); if ([...$('modelFilter').options].some(o => o.value === saved.model)) $('modelFilter').value = saved.model;
    if (['daily', 'average', 'total'].includes(saved.display)) $('display').value = saved.display;
    $('newest').checked = saved.newest === true;
    if (typeof saved.selectedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.selectedDay) && saved.selectedDay >= heatStart() && saved.selectedDay <= today) selectedDay = saved.selectedDay;
    if (['usage', 'sources', 'settings', 'quota'].includes(saved.view)) restoredView = saved.view;
    if (saved.dark === true) { document.body.classList.add('dark'); $('themeSelect').value = 'dark'; $('theme').setAttribute('aria-label', '切换浅色外观'); $('theme').innerHTML = icon('ui/moon'); }
    for (const b of document.querySelectorAll('[data-period]')) b.setAttribute('aria-pressed', String(b.dataset.period === period));
    for (const b of document.querySelectorAll('[data-metric]')) b.setAttribute('aria-pressed', String(b.dataset.metric === metric));
  }
} catch { /* Invalid transient navigation state uses defaults. */ }
$('dataBadge').textContent = bootstrapFailed ? '统计读取失败 · 未载入数据' : localSnapshot?.previewReadError ? '读取失败 · 历史保留' : realData ? '本机快照 · 日志模型名' : '合成数据 · 示例模型';
if (realData) $('demoState').parentElement.hidden = true;
$('sourceNotice').textContent = realData ? '这里展示已保存的 M1 来源状态。当前预览不会重新扫描来源或修改目录。' : '合成样本演示；目录选择不会访问本机文件。';
$('collectionHelp').textContent = usageBridge ? '只读五类本地来源的用量字段；暂停后保留已保存统计。本地采集与账号额度各自独立：模型名按日志字段展示，统计不会自动归属到账号。' : realData ? '预览只读已保存统计。模型名按日志字段展示，路由别名不能证明服务端实际模型。' : '仅演示暂停与恢复，不影响正式采集服务；当前是合成数据与示例模型，不能用来判断你的实际使用。';
$('exportHelp').textContent = realData ? '导出本机统计快照的白名单字段；不包含原始记录或身份信息。' : '只导出合成统计，模型名称明确标为示例。';
if (realData) { $('refresh').innerHTML = icon('ui/refresh') + '重新载入'; $('sourceRefresh').textContent = '重新载入状态'; }
const profileKey = 'agentusage-preview.profile.v1';
let profile = { name: 'ydan120980', bio: '记录每一次 AI 协作', tone: 'indigo', photo: null }, profileDraft, avatarReadToken = 0;
try { const saved = JSON.parse(localStorage.getItem(profileKey)); if (saved && typeof saved.name === 'string' && saved.name.trim() && saved.name.length <= 48) profile = { name: saved.name,
 bio: typeof saved.bio === 'string' ? saved.bio.slice(0, 80) : '',
 tone: ['indigo', 'teal', 'coral'].includes(saved.tone) ? saved.tone : 'indigo',
        photo: typeof saved.photo === 'string' && /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(saved.photo) && saved.photo.length < 750000 ? saved.photo : null };
      } catch { /* Invalid preview preferences use defaults. */ }
function avatarMarkup(value) { return value.photo ? '<img src="' + value.photo + '" alt="个人头像">' : '<span>' + escapeHtml(value.name.slice(0, 2).toUpperCase()) + '</span>'; }
function showProfile() { $('profileName').textContent = profile.name; $('profileBio').textContent = profile.bio; $('profileAvatar').dataset.tone = profile.tone; $('profileAvatar').innerHTML = avatarMarkup(profile); }
function showDraft() { $('avatarPreview').dataset.tone = profileDraft.tone; $('avatarPreview').innerHTML = avatarMarkup(profileDraft); for (const b of document.querySelectorAll('[data-avatar]')) b.setAttribute('aria-pressed', String(b.dataset.avatar === profileDraft.tone && !profileDraft.photo)); }
function resetAvatarInput() { avatarReadToken++; $('avatarFile').value = ''; $('avatarFileName').textContent = profileDraft.photo ? '当前使用自定义图片' : '选择头像图片'; $('avatarFileStatus').textContent = '图片仅在本机处理和保存。'; $('avatarFile').setAttribute('aria-busy', 'false'); $('saveProfile').disabled = false; }
function openProfile() { profileDraft = { ...profile }; $('nameInput').value = profile.name; $('bioInput').value = profile.bio; resetAvatarInput(); $('profileError').textContent = ''; showDraft(); $('profileDialog').showModal(); }
for (const id of ['editProfile', 'profileAvatar', 'settingsProfile']) $(id).addEventListener('click', openProfile);
$('nameInput').addEventListener('input', () => { profileDraft.name = $('nameInput').value || 'YD'; showDraft(); });
$('avatarFile').addEventListener('change', async () => {
  const file = $('avatarFile').files[0]; if (!file) return;
  const token = ++avatarReadToken, draft = profileDraft;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 512 * 1024) { resetAvatarInput(); $('profileError').textContent = '请选择最大 512 KB 的 PNG、JPEG 或 WebP 图片，原头像未改变。'; return; }
  $('avatarFileName').textContent = file.name; $('avatarFileStatus').textContent = '正在检查图片…'; $('profileError').textContent = ''; $('saveProfile').disabled = true; $('avatarFile').setAttribute('aria-busy', 'true');
  try {
    const photo = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('IMAGE_READ_FAILED')); reader.readAsDataURL(file); });
    await new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = photo; });
    if (token !== avatarReadToken || draft !== profileDraft || !$('profileDialog').open) return;
    profileDraft.photo = photo; showDraft(); $('avatarFileStatus').textContent = '已选 ' + Math.ceil(file.size / 1024) + ' KB · 保存资料后生效，仅保存在本机。';
  } catch { if (token === avatarReadToken) { resetAvatarInput(); $('profileError').textContent = '图片无法读取或解码，请换一张，原头像未改变。'; } }
  finally { if (token === avatarReadToken) { $('saveProfile').disabled = false; $('avatarFile').setAttribute('aria-busy', 'false'); } }
});
$('resetAvatar').addEventListener('click', () => { profileDraft.photo = null; resetAvatarInput(); $('profileError').textContent = ''; showDraft(); });
$('profileDialog').addEventListener('close', () => { avatarReadToken++; });
$('saveProfile').addEventListener('click', () => { if (!$('nameInput').value.trim()) { $('nameInput').reportValidity(); return; } profileDraft.name = $('nameInput').value.trim(); profileDraft.bio = $('bioInput').value.trim(); try { localStorage.setItem(profileKey,
 JSON.stringify(profileDraft)); } catch { $('profileError').textContent = '本地存储空间不足，请使用默认头像。'; return; } profile = { ...profileDraft }; showProfile(); $('profileDialog').close(); toast('名称和头像已保存到本机。'); });
showProfile();
function goToDay(date) { selectedDay = date; renderHeat(data()); window.uiDetail.scrollIntoView($('dayDetail')); }
document.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.dataset.view) view(button.dataset.view);
  if (button.dataset.period && button.dataset.period !== period) { period = button.dataset.period; trendRange = null; for (const b of document.querySelectorAll('[data-period]')) b.setAttribute('aria-pressed', String(b === button)); render(true); }
  if (button.dataset.metric) { metric = button.dataset.metric; for (const b of document.querySelectorAll('[data-metric]')) b.setAttribute('aria-pressed', String(b === button)); renderTrend(data()); window.uiMotion.indicators(); }
  if (button.dataset.date) { selectedDay = button.dataset.date; for (const cell of $('heatmap').querySelectorAll('button')) cell.setAttribute('aria-pressed', String(cell === button)); renderDay(data()); renderActivity(data()); }
  if (button.hasAttribute('data-refresh-today')) void refreshUsage();
  if (button.dataset.model) { $('modelFilter').value = button.dataset.model; render(true); }
  if (button.hasAttribute('data-reset-model')) { $('modelFilter').value = 'all'; render(true); }
  if (button.dataset.habitDate) goToDay(button.dataset.habitDate);
  if (button.dataset.shareAgent) { $('agentFilter').value = button.dataset.shareAgent; $('agentFilter').dispatchEvent(new Event('change')); }
  if (button.dataset.shareClear === 'agent') { $('agentFilter').value = 'all'; $('agentFilter').dispatchEvent(new Event('change')); }
  if (button.dataset.shareClear === 'model') { $('modelFilter').value = 'all'; render(true); }
  if (button.dataset.avatar) { profileDraft.tone = button.dataset.avatar; profileDraft.photo = null; resetAvatarInput(); $('profileError').textContent = ''; showDraft(); }
  if (button.hasAttribute('data-export')) { $('exportResult').textContent = ''; $('jsonPreview').hidden = true; $('jsonPreview').open = false; $('exportDialog').showModal(); }
  if (button.dataset.sourceView) view('sources');
  if (button.dataset.addSource && !usageBridge) { $('sourceDialogText').textContent = agents[button.dataset.addSource].name + ' · 选择只读的用量来源目录。'; $('sourceDialog').showModal(); }
});
$('overviewWeek').addEventListener('pointerover', event => { const button = event.target.closest('[data-habit-date]'); if (button) showHeatTooltip(button); });
$('overviewWeek').addEventListener('pointerleave', hideHeatTooltip);
$('overviewWeek').addEventListener('focusin', event => { const button = event.target.closest('[data-habit-date]'); if (button?.matches(':focus-visible')) showHeatTooltip(button); });
$('overviewWeek').addEventListener('focusout', hideHeatTooltip);
$('heatmap').addEventListener('pointerover', event => { const button = event.target.closest('[data-date]'); if (button) showHeatTooltip(button); });
$('heatmap').addEventListener('pointerleave', hideHeatTooltip);
$('heatmap').addEventListener('focusin', event => { const button = event.target.closest('[data-date]'); if (button) showHeatTooltip(button); });
$('heatmap').addEventListener('focusout', hideHeatTooltip);
window.addEventListener('scroll', hideHeatTooltip, { passive: true, capture: true });
window.addEventListener('resize', hideHeatTooltip);
$('heatmap').addEventListener('keydown', event => {
  const buttons = [...$('heatmap').querySelectorAll('button')], index = buttons.indexOf(event.target); if (index < 0) return;
  if (event.key === 'Escape') { hideHeatTooltip(); return; }
  const shifts = { ArrowRight: 7, ArrowLeft: -7, ArrowDown: 1, ArrowUp: -1 };
  let next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : shifts[event.key] !== undefined ? index + shifts[event.key] : null;
  if (next !== null) { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, next))].focus(); }
});
for (const id of ['display', 'newest', 'modelFilter', 'heatRange', 'demoState']) $(id).addEventListener('change', () => { window.uiMotion.cleanup(); render(true); });
$('agentFilter').addEventListener('change', () => { window.uiMotion.cleanup(); fillSources(); fillModels(); render(true); });
$('resetUsageScope').addEventListener('click', () => { $('agentFilter').value = 'all'; $('sourceFilter').value = 'all'; $('modelFilter').value = 'all'; $('agentFilter').dispatchEvent(new Event('change')); });
$('sourceFilter').addEventListener('change', () => { window.uiMotion.cleanup(); fillModels(); render(true); });
$('usageInterval').addEventListener('change',async()=>{if(!usageBridge)return;try{applyUsageState(await usageBridge.setRefreshInterval(Number($('usageInterval').value)));toast(enabled?'自动刷新设置已保存。':'频率已保存；采集暂停中，恢复采集后生效。');}catch{toast('刷新设置未保存。');updateCollection();window.uiSelect?.syncAll();}});
function applyHeatPalette() { const palette = { orange: ['#f3c29e', '#e8955d', '#ce713b', '#914b28'], blue: ['#afc8e5', '#789cc9', '#506fa7', '#304d80'],
 green: ['#bcd5c3', '#8cb498', '#5c8e6c', '#386349'], mono: ['#dadcde', '#a8adb2', '#6d747d', '#333a43'] }[$('heatColor').value];
  // Higher usage always reads as more contrast: dark on light, bright on dark.
  if (document.body.classList.contains('dark')) palette.reverse();
  palette.forEach((color, i) => document.documentElement.style.setProperty('--heat' +
  (i +
  1), color)); }
try { const saved = localStorage.getItem('agentusage.heatColor'); if ([...$('heatColor').options].some(o => o.value === saved)) $('heatColor').value = saved; } catch { /* Default palette. */ }
$('heatColor').addEventListener('change', () => { applyHeatPalette(); try { localStorage.setItem('agentusage.heatColor', $('heatColor').value); } catch { /* Not remembered. */ } }); applyHeatPalette();
$('settingsPause').addEventListener('click', async () => { if (usageBridge) { try { applyUsageState(await usageBridge.setEnabled(!enabled)); } catch { toast('采集状态更新失败。'); } return; } if (realData) return; enabled = !enabled; render(); toast(enabled ? '演示采集状态已恢复。' : '演示采集状态已暂停；历史仍可查看。'); });
async function refreshPreview() { if (realData) { try { sessionStorage.setItem('agentusage-preview.reload.v1', JSON.stringify({ period, metric, selectedDay,
 agent: $('agentFilter').value, source:$('sourceFilter').value, model: $('modelFilter').value, display: $('display').value, newest: $('newest').checked,
 dark: document.body.classList.contains('dark'),
        view: document.querySelector('[data-view][aria-current="page"]').dataset.view }));
      } catch { /* Reload still works without preference storage. */ }
      location.reload(); return; }
      const button = $('refresh'); button.disabled = true;
      button.innerHTML = icon('ui/refresh') +
  '刷新中…'; await new Promise(resolve => setTimeout(resolve, 650)); sequence++; render(); button.disabled = false; button.innerHTML = icon('ui/refresh') +
  '刷新'; toast('合成快照已刷新；没有扫描源文件。'); }
async function refreshUsage() { if (!usageBridge) return refreshPreview(); window.uiMotion.busy($('refresh'), true); window.uiMotion.busy($('sourceRefresh'), true); try { $('refresh').disabled = true;
 applyUsageState(await usageBridge.refresh()); } catch { toast('采集失败，历史数据已保留。'); } finally { $('refresh').disabled = false; window.uiMotion.busy($('refresh'), false); window.uiMotion.busy($('sourceRefresh'), false); } }
$('refresh').addEventListener('click', refreshUsage); $('sourceRefresh').addEventListener('click', refreshUsage);
$('theme').addEventListener('click', () => setTheme(document.body.classList.contains('dark') ? 'light' : 'dark')); $('themeSelect').addEventListener('change', () => setTheme($('themeSelect').value));
$('selectDirectory').addEventListener('click', () => { const name = $('demoDirectory').value.trim(); if (!name) { $('demoDirectory').setCustomValidity('请输入演示目录名称'); $('demoDirectory').reportValidity();
 return; } $('demoDirectory').setCustomValidity(''); $('sourceDialog').close(); toast('已应用演示目录名称；没有读取或保存本机路径。'); });
$('demoDirectory').addEventListener('input', () => $('demoDirectory').setCustomValidity(''));
$('download').addEventListener('click', async () => {
  const daily = $('exportRange').value === 'all' ? data() : rangeRows(data());
  if (usageBridge) {
    if ($('download').disabled) return;
    $('download').disabled = true; window.uiMotion.busy($('download'), true); $('exportResult').textContent = '正在导出统计…';
    try { const result = await usageBridge.exportStatistics({ ...localSnapshot, daily, sources: $('exportSources').checked ? localSnapshot.sources : [] }); $('exportResult').textContent = result.saved ? '统计已导出（' + result.rows + ' 条聚合记录）。' : '已取消导出。'; }
    catch { $('exportResult').textContent = '导出失败，请选择可写的本地目录。'; }
    finally { $('download').disabled = false; window.uiMotion.busy($('download'), false); }
    return;
  }
  const payload = { schemaVersion: 'DesignPreviewV1', targetUsageContract: 'UsageSnapshotV1', demo: !realData, dataKind: realData ? 'saved-local-statistics' : 'synthetic', sequence,
   generatedAt: new Date().toISOString(), timezone: realData ? localSnapshot.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone, coverageStart, daily, pricing: realData ? localSnapshot.priceCatalog : { kind: 'synthetic', currency: 'USD' } };
  if ($('exportSources').checked) payload.sources = realData ? localSnapshot.sources : Object.keys(agents).map(agent => ({ agent, status: 'unverified', demo: true }));
  const json = JSON.stringify(payload, null, 2); $('exportJson').value = json; $('jsonPreview').hidden = false;
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a'); link.href = url;
   link.download = realData ? 'AgentUsage-local-statistics.json' : 'AgentUsage-synthetic-preview.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); $('exportResult').textContent = '统计 JSON 已生成（' +
    daily.length +
    ' 条' +
    (realData ? '本机聚合' : '合成') +
    '记录）。';
});
Chart.defaults.font.family = 'Segoe UI'; render(); if (restoredView !== 'usage') view(restoredView);
// The Agent picker orders and dims its chips by recorded usage across all dates.
function publishAgentUsage() {
  const totals = {}, models = {};
  for (const row of templates) {
    totals[row.agent] = (totals[row.agent] || 0) + row.totalTokens;
    // The pricing panel weighs each used model by its recorded and priced tokens.
    const key = (row.provider || 'unknown') + '/' + row.model, stats = models[key] ||= { tokens: 0, pricedTokens: 0, records: 0, agents: [], reasons: {} };
    stats.tokens += row.totalTokens; stats.pricedTokens += row.pricedTokens || 0; stats.records += row.records || 0;
    if (!stats.agents.includes(row.agent)) stats.agents.push(row.agent);
    for (const [reason, count] of Object.entries(row.pricingReasons || {})) stats.reasons[reason] = (stats.reasons[reason] || 0) + count;
  }
  window.agentUsageTotals = totals; window.usageModels = models;
  window.dispatchEvent(new CustomEvent('agent-usage', { detail: totals })); window.dispatchEvent(new CustomEvent('usage-models', { detail: models }));
}
function applyUsageState(state) {
  // The main process omits an unchanged snapshot body; keep the one we hold.
  if (!state.snapshot) state = { ...state, snapshot: localSnapshot };
  const changed = sequence !== state.snapshot.sequence, previousDay = today;
  const snapshotChanged = !Number.isSafeInteger(state.snapshotRevision) || usageRevision !== state.snapshotRevision;
  usageRevision = state.snapshotRevision;
  localSnapshot = state.snapshot; syncCalendar(); usageStatus = state; sequence = localSnapshot.sequence; enabled = state.enabled; coverageStart = localSnapshot.coverageStart || today;
  if (snapshotChanged) { templates.length = 0; for (const row of localSnapshot.daily) templates.push(row); loadHourly(); fillSources(); fillModels(); renderSources(); publishAgentUsage(); }
  updateCollection();
  window.uiSelect?.syncAll();
  $('dataBadge').textContent = state.error || (state.collecting ? '正在读取本地统计…' : '本机离线统计 · 已更新');
  $('dataBadge').hidden = !state.error;
  $('dataBadge').setAttribute('role', 'status');
  $('refresh').disabled = state.collecting; window.uiMotion.busy($('refresh'), state.collecting); window.uiMotion.busy($('sourceRefresh'), state.collecting); const refreshLabel = state.collecting ? '正在采集…' : '刷新统计', every = state.refreshIntervalMs ?? 15000; $('refresh').innerHTML = icon('ui/refresh') + '<span class="sr-only">' + refreshLabel + '</span>'; $('refresh').title = refreshLabel + (state.collecting ? '' : every ? ' · 每 ' + (every >= 60000 ? every / 60000 + ' 分钟' : every / 1000 + ' 秒') + '自动刷新（设置中修改）' : ' · 自动刷新已关闭'); $('refresh').setAttribute('aria-label', refreshLabel);
  if ($('main').dataset.currentView === 'usage') {
    if (snapshotChanged || previousDay !== today) render(changed);
    else if ($('todayClients').querySelector('.today-empty')) $('todayClients').innerHTML = todayEmptyHtml();
  }
}
function syncCalendar() {
  const previousYear = today.slice(0, 4); today = currentDay();
  if (previousYear !== today.slice(0, 4)) {
    const currentYear = $('heatRange').value !== '365';
    $('heatRange').innerHTML = '<option value="365">最近一年</option><option value="' + today.slice(0, 4) + '">' + today.slice(0, 4) + ' 年</option>';
    if (currentYear) $('heatRange').value = today.slice(0, 4);
  }
}
function checkCalendar() {
  if (document.visibilityState !== 'hidden' && today !== currentDay()) render();
}
const calendarTimer = setInterval(checkCalendar, 30000);
window.addEventListener('focus', checkCalendar);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') hideHeatTooltip(); else checkCalendar(); });
window.addEventListener('unload', () => clearInterval(calendarTimer));
if (usageBridge) {
  $('sourceNotice').textContent = '只读取五类本地来源的用量字段。添加目录后暂停采集，确认后恢复。';
  $('sourceRows').addEventListener('click', async event => { const button = event.target.closest('[data-add-source]'); if (button) { try { applyUsageState(await usageBridge.chooseSource(button.dataset.addSource)); } catch { toast('该目录不可读取或与产品数据目录重叠。'); } } });
  let reading = false, again = false;
  async function loadUsage() { if (reading) { again = true; return; } reading = true; try { do { again = false; applyUsageState(await usageBridge.get(usageRevision)); } while (again); } catch { toast('读取统计失败，历史数据已保留。'); } finally { reading = false; } }
  const unsubscribe = usageBridge.onUpdate(loadUsage); window.addEventListener('unload', unsubscribe); void loadUsage();
}
})();
