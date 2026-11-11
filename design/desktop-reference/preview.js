'use strict';
// Usage data/action host. M9 App owns shell DOM; this module publishes saved facts and settings.
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
let templates = [];
let enabled = true, sequence = realData ? localSnapshot.sequence : 1;
let usageStatus = { collecting: false, error: null }, usageRevision = null, lastCollectionKey = '', usageRenderDirty = false;
let refreshing = false, hostReadError = null, revision = 0, hostSnapshot = null;
const hiddenKey = 'agentusage.trendHidden.v1';
const state = { period: 'all', metric: 'tokens', agent: 'all', source: 'all', model: 'all', mode: 'flow',
  display: 'daily', grain: 'auto', trendRange: null, selectedDay: null, heatRange: '365', palette: 'orange', slot: null, hidden: ['cost'] };
try { const saved = JSON.parse(localStorage.getItem(hiddenKey)); if (Array.isArray(saved)) state.hidden = saved.filter(key => typeof key === 'string').slice(0, 64); } catch { /* Default cost overlay. */ }
try { const saved = localStorage.getItem('agentusage.heatColor'); if (['orange', 'blue', 'green', 'mono'].includes(saved)) state.palette = saved; } catch { /* Existing default. */ }
function shift(date, days) { return window.usageModel.shift(date, days); }
const short = window.usageModel.short;
const displayModel = window.usageModel.displayModel;
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function icon(name) { return '<img src="assets/' + name + '.svg" alt="">'; }
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
if (realData) templates = localSnapshot.daily;
let hourlyTemplates = [];
function currentHour() { return Number(new Intl.DateTimeFormat('en-GB', { timeZone: realData ? localSnapshot.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date())); }
function hourlyReady(date) { return date <= today && (!realData || Array.isArray(localSnapshot.hourly)); }
function loadHourly() {
  if (realData) { hourlyTemplates=localSnapshot.hourly||[];return; }
  hourlyTemplates=[];
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
let demoState = 'normal';
function hourlyData() { return !realData && demoState === 'empty' ? [] : hourlyTemplates; }
function data() {
  if (realData) return templates;
  if (demoState === 'empty') return [];
  return templates.map((r, index) => demoState === 'partial' && index % 7 === 0 ? { ...r, inputUncached: null, reasoning: null, estimatedCostUsd: null, pricedTokens: 0 } : r);
}

let recorded = () => true;
const filterRows = (rows, skip = null) => window.usageModel.filterRows(rows, state, skip);
function rangeRows(rows) {
  const filtered = filterRows(rows);
  return state.period === 'all' ? filtered : window.usageModel.within(filtered,
    window.usageMath.startFor(today, state.period, coverageStart), today);
}
function normalizeFilters() {
  if (state.agent !== 'all' && !Object.hasOwn(agents, state.agent)) state.agent = 'all';
  const available = templates.filter(row => state.agent === 'all' || row.agent === state.agent);
  if (state.source !== 'all' && !available.some(row => (row.provider || 'unknown') === state.source)) state.source = 'all';
  if (state.model !== 'all' && !available.some(row => row.model === state.model &&
      (state.source === 'all' || (row.provider || 'unknown') === state.source))) state.model = 'all';
}
function invalidate() {
  revision++; hostSnapshot = null;
  window.dispatchEvent(new Event('usage-host-change'));
}
function filters() { return { period: state.period, agent: state.agent, source: state.source, model: state.model }; }
function setUsage(patch) {
  const previous = JSON.stringify(state), oldFilters = JSON.stringify(filters());
  if (patch.period && ['all', '30', '7', 'today'].includes(patch.period) && patch.period !== state.period) {
    state.period = patch.period; state.trendRange = null;
  }
  for (const key of ['agent', 'source', 'model']) if (typeof patch[key] === 'string') state[key] = patch[key];
  normalizeFilters();
  if (['tokens', 'cost'].includes(patch.metric)) state.metric = patch.metric;
  if (['flow', 'total', 'models'].includes(patch.mode)) state.mode = patch.mode;
  if (state.metric === 'cost' && state.mode === 'flow') state.mode = 'total';
  if (['daily', 'average', 'total'].includes(patch.display)) state.display = patch.display;
  if (['auto', 'day', 'week', 'month'].includes(patch.grain)) state.grain = patch.grain;
  if (Object.hasOwn(patch, 'trendRange')) {
    const span = patch.trendRange;
    if (span === null || span && /^\d{4}-\d{2}-\d{2}$/.test(span.start) && /^\d{4}-\d{2}-\d{2}$/.test(span.end) &&
        span.start <= span.end && window.usageModel.dayCount(span.start, span.end) <= 3660) state.trendRange = span;
  }
  if (patch.heatRange === '365' || patch.heatRange === today.slice(0, 4)) state.heatRange = patch.heatRange;
  if (Object.hasOwn(patch, 'selectedDay')) {
    const day = patch.selectedDay;
    if (day === null || typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today) {
      state.selectedDay = day; state.slot = null;
    }
  }
  const min = state.heatRange === '365' ? shift(today, -364) : state.heatRange + '-01-01';
  if (state.selectedDay && state.selectedDay < min) state.selectedDay = null;
  if (Object.hasOwn(patch, 'slot')) state.slot = patch.slot;
  if (['orange', 'blue', 'green', 'mono'].includes(patch.palette)) {
    state.palette = patch.palette; applyHeatPalette();
    try { localStorage.setItem('agentusage.heatColor', state.palette); } catch { /* Session only. */ }
  }
  if (Array.isArray(patch.hidden)) {
    state.hidden = patch.hidden.filter(key => typeof key === 'string').slice(0, 64);
    try { localStorage.setItem(hiddenKey, JSON.stringify(state.hidden)); } catch { /* Session only. */ }
  }
  if (previous === JSON.stringify(state)) return;
  if (oldFilters !== JSON.stringify(filters())) window.dispatchEvent(new Event('usage-filter-change'));
  render(true);
}
let projectedUsage = null;
function getUsage() {
  if (hostSnapshot) return hostSnapshot;
  const rows = data(), hourlyRows = hourlyData();
  // Pane, label and outline events do not change statistical facts. Compare the
  // actual saved session counts rather than rebuilding every chart for each event.
  // A missing count remains null, so a real null -> zero response still updates.
  const sessionCounts = {};
  for (const date of new Set([today, state.selectedDay].filter(Boolean))) {
    for (const agent of ['all', ...Object.keys(agents)]) sessionCounts[date + ':' + agent] =
      window.sessionsUi?.count({ agent, date, model: state.model }) ?? null;
  }
  const basis = [templates, hourlyRows, localSnapshot?.sources, today, coverageStart, JSON.stringify(state), currentHour(), JSON.stringify(sessionCounts), demoState];
  const statusKey = () => JSON.stringify([enabled, Boolean(usageStatus.collecting) || refreshing, Boolean(usageStatus.error || localSnapshot?.previewReadError || demoState === 'error')]);
  if (!projectedUsage || !basis.every((value, index) => value === projectedUsage.basis[index]) || projectedUsage.status !== null && projectedUsage.status !== statusKey()) {
  const projectStart = performance.now();
  const view = window.usageModel.project({ rows, hourlyRows, allRows: templates, today, coverageStart,
    realData, recorded, currentHour: currentHour(), hourlyReady, sessionCounts,
    sources: realData ? localSnapshot.sources || [] : null, collecting: Boolean(usageStatus.collecting) || refreshing,
    enabled, error: Boolean(usageStatus.error || localSnapshot?.previewReadError || demoState === 'error')
  }, state, { usageMath: window.usageMath, insightsMath: window.insightsMath,
    displayValues: window.displayValues, chartUi: window.chartUi, agents });
  projectedUsage = { basis, view, status: view.today.records === null ? statusKey() : null,
    recorded: [...new Set(filterRows(rows).map(row => row.date))] };
  performance.clearMeasures('usage:project'); performance.measure('usage:project', { start: projectStart, end: performance.now() });
  }
  const view = projectedUsage.view;
  hostSnapshot = { revision, state: { ...state, hidden: [...state.hidden] }, view,
    loading: Boolean(localSnapshot?.loading), busy: Boolean(usageStatus.collecting) || refreshing,
    error: hostReadError || (usageStatus.error ? /^[A-Z][A-Z0-9_]+$/.test(usageStatus.error) ? '最近采集没有完成' : usageStatus.error :
      localSnapshot?.previewReadError ? '读取失败，保留最后有效快照。' : demoState === 'error' ? '演示读取失败，历史保留。' : null),
    recovery: recoveryNotice(localSnapshot), today, coverageStart,
    recorded: projectedUsage.recorded };
  return hostSnapshot;
}
window.usageHost = Object.freeze({ get: getUsage, set: setUsage, filters, invalidate, version: () => revision, refresh: refreshUsage,
  export: () => window.settingsUi?.openExport(), sources: () => view('sources'), cost: () => view('cost'),
  openSessions(agent = state.agent) { window.sessionsHost?.drillDown(agent, 'today'); view('sessions'); },
  selectDay(day) { setUsage({ selectedDay: day }); window.usageUi?.locate('day'); },
  closeDay() { setUsage({ selectedDay: null }); },
  selectTrend(index) {
    const bucket = getUsage().view.trend.buckets[index]; if (!bucket) return;
    if (bucket.start === bucket.end) window.usageHost.selectDay(bucket.start);
    else setUsage({ trendRange: { start: bucket.start, end: bucket.end }, grain: 'day' });
  },
  applyTrendRange(from, to) {
    const buckets = getUsage().view.trend.buckets;
    if (buckets[from] && buckets[to]) setUsage({ trendRange: { start: buckets[from].start, end: buckets[to].end }, grain: 'day' });
  },
  preset(key) { setUsage({ trendRange: key === 'page' ? null :
    { start: key === 'today' ? today : shift(today, 1 - Number(key)), end: today } }); },
});
window.addEventListener('sessions-change', () => {
  if ($('main').dataset.currentView === 'usage') invalidate();
  // The aggregate page can be prepared while hidden. A summary that arrives
  // then must invalidate its snapshot too, without eagerly reprojecting charts
  // for every hidden pane/outline event. The next visible render reads it fresh.
  else hostSnapshot = null;
});

function toast(message) { window.appShell.toast(message); }
function recoveryNotice(snapshot) {
  // A damaged state file is moved to quarantine/ and the app keeps running with
  // empty defaults. Say so plainly instead of silently showing zero usage.
  const files = Array.isArray(snapshot?.recovered) ? snapshot.recovered : [];
  if (!files.length) return null;
  const where = files.some(entry => entry.quarantined) ? '已移入数据目录下的 quarantine 文件夹' : '无法移入 quarantine，请手动检查';
  return '检测到受损的数据文件（' + files.map(entry => entry.file).join('、') + '），' + where + '，本次以空数据启动，原文件未被改写。';
}
function renderSources() {
  window.sourcesHost?.notice(recoveryNotice(localSnapshot));
  window.sourcesHost?.update(realData ? localSnapshot.sources : null);
}
function updateCollection() { const interval=usageStatus.refreshIntervalMs??15000;window.appShell.collectionState( usageBridge ? enabled ? interval ? '本机离线采集 · 每 '+interval/1000+' 秒刷新' : '本机离线采集 · 手动刷新' : '采集已暂停 · 历史保留' : realData ? '本机统计快照 · 只读' : enabled ? '合成数据 · 演示开启' : '合成数据 · 演示暂停');
 settingsChanged(); }
function navBadge(name, count, title) { window.appShell.badge(name, count, title); }
window.usageData = { ready: () => !localSnapshot?.loading, rows: () => data(), hourly: () => hourlyData(),
  sources: () => realData ? localSnapshot.sources || [] : null, today: () => today, coverageStart: () => coverageStart,
  recorded: () => recorded, subscriptions: () => ({ ...(usageStatus.subscriptions || {}) }),
  collection: () => ({ error: usageStatus.error || null, diagnostic: usageStatus.diagnostic || null,
    collecting: Boolean(usageStatus.collecting), checkedAt: usageStatus.checkedAt || null, enabled: usageStatus.enabled !== false }),
  badge: navBadge, displayModel, short, icon, escapeHtml, toast, view: name => view(name),
  showModel(model) { const agent = state.agent !== 'all' && !templates.some(row => row.model === model && row.agent === state.agent) ? 'all' : state.agent;
    setUsage({ agent, source: 'all', model }); view('usage'); },
  showAgent(agent) { setUsage({ agent, model: 'all' }); view('usage'); }
};
function render() {
  usageRenderDirty = false; syncCalendar();
  recorded = window.insightsMath.recordedFields(templates);
  const rows = data(), filtered = filterRows(rows);
  window.usageCalendar = { today, min: coverageStart, recorded: new Set(filtered.map(row => row.date)) };
  window.appShell.facts(rows.length ? coverageStart : '暂无', localSnapshot?.previewReadError ? '读取失败 · 保留最后有效快照' : demoState === 'error' ?
    '演示读取失败 · 历史保留' : realData ? '快照采集 ' + (localSnapshot.collectedAt ? new Date(localSnapshot.collectedAt).toLocaleString('zh-CN') : '时间未记录') :
      enabled ? '合成数据 · 演示快照 ' + sequence : '演示已暂停 · 历史仍可查看');
  updateCollection(); invalidate();
  window.dispatchEvent(new Event('usage-data-change'));
}
function view(name) {
  if (name === 'workbench') name = 'cost';
  if (window.appShell.get().view === name) return;
  window.appShell.navigate(name);
  if (name === 'usage') render();
}
const themeKey = 'agentusage.theme.v1', darkScheme = matchMedia('(prefers-color-scheme: dark)');
let themePreference = 'system';
function applyTheme() { window.appShell.theme(themePreference === 'dark' || themePreference === 'system' && darkScheme.matches); }
function setTheme(value) { themePreference = value; try { localStorage.setItem(themeKey, value); } catch { /* Kept for this session. */ } applyTheme(); applyHeatPalette(); render(); settingsChanged(); }
applyTheme();
darkScheme.addEventListener('change', () => { if (themePreference === 'system') { applyTheme(); applyHeatPalette(); render(); } });
function applyHeatPalette() { const palette = { orange: ['#f3c29e', '#e8955d', '#ce713b', '#914b28'], blue: ['#afc8e5', '#789cc9', '#506fa7', '#304d80'],
 green: ['#bcd5c3', '#8cb498', '#5c8e6c', '#386349'], mono: ['#dadcde', '#a8adb2', '#6d747d', '#333a43'] }[state.palette];
  // Higher usage always reads as more contrast: dark on light, bright on dark.
  if (document.body.classList.contains('dark')) palette.reverse();
  palette.forEach((color, i) => document.documentElement.style.setProperty('--heat' +
  (i +
  1), color)); }
let restoredView = 'quota';
try { const start = localStorage.getItem('agentusage.startView'); if (['usage', 'cost', 'sessions', 'sources', 'settings', 'quota'].includes(start)) restoredView = start; } catch { /* The default start page. */ }
try {
  const saved = JSON.parse(sessionStorage.getItem('agentusage-preview.reload.v1'));
  sessionStorage.removeItem('agentusage-preview.reload.v1');
  if (saved) {
    if (['all', '30', '7', 'today'].includes(saved.period)) state.period = saved.period;
    if (['tokens', 'cost'].includes(saved.metric)) state.metric = saved.metric;
    if (saved.agent === 'all' || Object.hasOwn(agents, saved.agent)) state.agent = saved.agent;
    if (typeof saved.source === 'string') state.source = saved.source;
    if (typeof saved.model === 'string') state.model = saved.model;
    if (['daily', 'average', 'total'].includes(saved.display)) state.display = saved.display;
    if (typeof saved.selectedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(saved.selectedDay) &&
      saved.selectedDay >= shift(today, -364) && saved.selectedDay <= today) state.selectedDay = saved.selectedDay;
    if (saved.view === 'workbench') restoredView = 'cost';
    else if (['usage', 'cost', 'sessions', 'sources', 'settings', 'quota'].includes(saved.view)) restoredView = saved.view;
  }
} catch { /* Invalid transient state uses defaults. */ }
normalizeFilters();
if (state.metric === 'cost') state.mode = 'total';

renderSources(); publishAgentUsage();
window.appShell.notice({ hidden: true, text: localSnapshot?.loading ? '正在读取本地统计…' : bootstrapFailed ? '统计读取失败 · 未载入数据' : localSnapshot?.previewReadError ? '读取失败 · 历史保留' : realData ? '本机快照 · 日志模型名' : '合成数据 · 示例模型' });
window.sourcesHost?.notice(realData && !usageBridge ? '这里展示已保存的 M1 来源状态。当前预览不会重新扫描来源或修改目录。' : !realData ? '合成样本演示；目录选择不会访问本机文件。' : '');
const exportHelp = realData ? '导出本机统计快照的白名单字段；不包含原始记录或身份信息。' : '只导出合成统计，模型名称明确标为示例。';

const profileKey = window.profileModel.KEY;
let profile = (() => { try { return window.profileModel.parse(localStorage.getItem(profileKey)); } catch { return { ...window.profileModel.DEFAULT }; } })();
function showProfile() { window.appShell.profile(profile); }
showProfile();
async function refreshPreview() {
  if (realData) {
    try { sessionStorage.setItem('agentusage-preview.reload.v1', JSON.stringify({ ...filters(), metric: state.metric,
      selectedDay: state.selectedDay, display: state.display, view: $('main').dataset.currentView })); } catch { /* Reload still works. */ }
    location.reload(); return;
  }
  refreshing = true; invalidate();
  try { await new Promise(resolve => setTimeout(resolve, 650)); sequence++; render(); toast('合成快照已刷新；没有扫描源文件。'); }
  finally { refreshing = false; invalidate(); }
}
async function refreshUsage() {
  if (refreshing || usageStatus.collecting) return;
  window.uiDetail.cancelScroll();
  if (!usageBridge) return refreshPreview();
  refreshing = true; invalidate();
  try { applyUsageState(await usageBridge.refresh(usageRevision)); }
  catch { toast('采集失败，历史数据已保留。'); }
  finally { refreshing = false; invalidate(); }
}
// The demo directory sheet moved into the React sources page (M4).
window.addEventListener('source-catalog', () => { normalizeFilters(); invalidate(); window.dispatchEvent(new Event('agent-options')); });
async function exportStatistics({ range, sources }) {
  const daily = range === 'all' ? data() : rangeRows(data());
  if (usageBridge) {
    try { const result = await usageBridge.exportStatistics({ ...localSnapshot, daily, sources: sources ? localSnapshot.sources : [] }); return { kind: result.saved ? 'saved' : 'canceled', message: result.saved ? '统计已导出（' + result.rows + ' 条聚合记录）。' : '已取消导出。' }; }
    catch { return { kind: 'failed', message: '导出失败，请选择可写的本地目录。' }; }
  }
  const payload = { schemaVersion: 'DesignPreviewV1', targetUsageContract: 'UsageSnapshotV1', demo: !realData, dataKind: realData ? 'saved-local-statistics' : 'synthetic', sequence,
   generatedAt: new Date().toISOString(), timezone: realData ? localSnapshot.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone, coverageStart, daily, pricing: realData ? localSnapshot.priceCatalog : { kind: 'synthetic', currency: 'USD' } };
  if (sources) payload.sources = realData ? localSnapshot.sources : Object.keys(agents).map(agent => ({ agent, status: 'unverified', demo: true }));
  const json = JSON.stringify(payload, null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' })); const link = document.createElement('a'); link.href = url;
  link.download = realData ? 'AgentUsage-local-statistics.json' : 'AgentUsage-synthetic-preview.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { kind: 'preview', json, message: '统计 JSON 已生成（' + daily.length + ' 条' + (realData ? '本机聚合' : '合成') + '记录）。' };
}
function settingsChanged() { window.dispatchEvent(new Event('settings-host-change')); }
window.settingsHost = Object.freeze({
  theme: Object.freeze({ get: () => themePreference, set: value => setTheme(['system', 'light', 'dark'].includes(value) ? value : 'system') }),
  collection: Object.freeze({
    get: () => ({ mode: usageBridge ? 'desktop' : realData ? 'snapshot' : 'demo', enabled: Boolean(enabled), intervalMs: usageStatus.refreshIntervalMs ?? 15000 }),
    async setEnabled(value) { if (usageBridge) { try { applyUsageState(await usageBridge.setEnabled(Boolean(value))); } catch { toast('采集状态更新失败。'); settingsChanged(); } return; } if (realData) return; enabled = Boolean(value); render(); toast(enabled ? '演示采集状态已恢复。' : '演示采集状态已暂停；历史仍可查看。'); settingsChanged(); },
    async setInterval(value) { if (!usageBridge) return; try { applyUsageState(await usageBridge.setRefreshInterval(Number(value))); toast(enabled ? '自动刷新设置已保存。' : '频率已保存；采集暂停中，恢复采集后生效。'); } catch { toast('刷新设置未保存。'); updateCollection(); } }
  }),
  profile: Object.freeze({ get: () => ({ ...profile }), save(value) { try { localStorage.setItem(profileKey, JSON.stringify(value)); } catch { return { ok: false, error: 'storage' }; } profile = { ...value }; showProfile(); settingsChanged(); toast('名称和头像已保存到本机。'); return { ok: true }; } }),
  demo: Object.freeze({ available: !realData, get: () => demoState, set(value) { demoState = ['normal', 'partial', 'empty', 'error'].includes(value) ? value : 'normal'; render(true); settingsChanged(); window.dispatchEvent(new Event('demo-state-change')); } }),
  exportHelp, exportStatistics, toast
});
applyHeatPalette(); render(); if (restoredView !== 'usage') view(restoredView);
function publishAgentUsage() {
  const totals = {}, models = {};
  for (const row of templates) {
    totals[row.agent] = (totals[row.agent] || 0) + row.totalTokens;
    // The pricing panel weighs each used model by its recorded and priced tokens.
    const key = (row.provider || 'unknown') + '/' + row.model, stats = models[key] ||= { tokens: 0, pricedTokens: 0, records: 0, agents: [], reasons: {}, unpriced: {}, incomplete: {}, unpricedAgents: {} };
    stats.tokens += row.totalTokens; stats.pricedTokens += row.pricedTokens || 0; stats.records += row.records || 0;
    if (!stats.agents.includes(row.agent)) stats.agents.push(row.agent);
    for (const [reason, count] of Object.entries(row.pricingReasons || {})) stats.reasons[reason] = (stats.reasons[reason] || 0) + count;
    for (const [reason, tokens] of Object.entries(row.unpricedTokens || {})) stats.unpriced[reason] = (stats.unpriced[reason] || 0) + tokens;
    for (const [cause, tokens] of Object.entries(row.incompleteTokens || {})) stats.incomplete[cause] = (stats.incomplete[cause] || 0) + tokens;
    if (row.totalTokens > (row.pricedTokens || 0)) stats.unpricedAgents[row.agent] = (stats.unpricedAgents[row.agent] || 0) + row.totalTokens - (row.pricedTokens || 0);
  }
  window.agentUsageTotals = totals; window.usageModels = models;
  window.dispatchEvent(new CustomEvent('agent-usage', { detail: totals })); window.dispatchEvent(new CustomEvent('usage-models', { detail: models }));
}
function applyUsageState(next) {
  if(Number.isSafeInteger(next.snapshotRevision)&&Number.isSafeInteger(usageRevision)&&next.snapshotRevision<usageRevision)return;
  const hydrationStart = performance.now();
  if (!next.snapshot) next = { ...next, snapshot: localSnapshot };
  const changed = sequence !== next.snapshot.sequence, previousDay = today;
  const snapshotChanged = !Number.isSafeInteger(next.snapshotRevision) || usageRevision !== next.snapshotRevision;
  if (!snapshotChanged && localSnapshot) next = { ...next, snapshot: localSnapshot };
  usageRevision = next.snapshotRevision;
  window.agentCatalog.install(next.snapshot.sourceCatalog);
  localSnapshot = next.snapshot; syncCalendar(); usageStatus = next; sequence = localSnapshot.sequence;
  enabled = next.enabled; coverageStart = localSnapshot.coverageStart || today; hostReadError = null;
  if (snapshotChanged) { templates = localSnapshot.daily; loadHourly(); normalizeFilters(); renderSources(); publishAgentUsage(); }
  updateCollection();
  const collectionKey = JSON.stringify([next.error || null, next.diagnostic || null, Boolean(next.collecting), next.enabled !== false, next.checkedAt || null]);
  if (collectionKey !== lastCollectionKey) { lastCollectionKey = collectionKey; window.dispatchEvent(new Event('usage-collection')); }
  const recovery = recoveryNotice(next.snapshot);
  // The worker reports an internal code (COLLECTION_FAILED and the like); show what it means
  // and keep the code in the tooltip for diagnosis.
  const errorCode = /^[A-Z][A-Z0-9_]+$/.test(next.error || '') ? next.error : '';
  // A failed collection links to its reason in the Sources page's 需要处理 list (UI-COLLECTION-DIAGNOSTIC-20261022.md).
  // Rebuilt only when the message changes, so a focused 查看原因 survives periodic updates.
  const badge = next.error ? (errorCode ? '最近采集没有完成' : next.error) : '';
  window.appShell.notice({
    text: badge || (recovery ? '数据已恢复 · 部分文件受损' : next.collecting ? '正在读取本地统计…' : '本机离线统计 · 已更新'),
    title: errorCode ? '错误代码 ' + errorCode : '', hidden: !next.error && !recovery, attention: Boolean(badge)
  });

  window.sourcesHost?.collection(next);
  if (snapshotChanged || previousDay !== today) usageRenderDirty = true;
  if ($('main').dataset.currentView === 'usage' && !document.hidden) {
    if (usageRenderDirty) render(changed); else invalidate();
  } else {
    invalidate();
    if (snapshotChanged || previousDay !== today) {
      recorded = window.insightsMath.recordedFields(templates);
      window.dispatchEvent(new Event('usage-data-change'));
    }
  }
  performance.clearMeasures('usage:hydrate');
  performance.measure('usage:hydrate', { start: hydrationStart, end: performance.now() });
}
function syncCalendar() {
  const previousYear = today.slice(0, 4); today = currentDay();
  if (previousYear !== today.slice(0, 4) && state.heatRange !== '365') state.heatRange = today.slice(0, 4);
}
function checkCalendar() { if (document.visibilityState !== 'hidden' && today !== currentDay()) render(); }
const calendarTimer = setInterval(checkCalendar, 30000);
window.addEventListener('focus', checkCalendar);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden') { checkCalendar(); if (usageRenderDirty && $('main').dataset.currentView === 'usage') render(); }
});
window.addEventListener('unload', () => clearInterval(calendarTimer));
if (usageBridge) {
  let reading = false, again = false;
  async function loadUsage() {
    if (reading) { again = true; return; } reading = true;
    try { do { again = false; applyUsageState(await usageBridge.get(usageRevision)); } while (again); }
    catch { hostReadError = '本地统计暂不可用 · 请重试';
      window.appShell.notice({ text: hostReadError, hidden: false, role: 'alert' });
      invalidate(); toast('读取统计失败，历史数据已保留。'); }
    finally { reading = false; }
  }
  const unsubscribe = usageBridge.onUpdate(loadUsage); window.addEventListener('unload', unsubscribe); void loadUsage();
}
})();
