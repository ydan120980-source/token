'use strict';
/* global document */
const api = window.agentUsage;
const $ = id => document.getElementById(id);
const labels = { codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode', workbuddy: 'WorkBuddy', mimo: 'MiMo' };
const states = { verified: '本机样本已验证', partial: '部分支持 / 数据不完整', unverified: '尚未完成真实样本验收', 'not-detected': '未检测到', error: '读取失败 · 保留历史' };
let current, period = 'today';
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function format(value) { return value === null || value === undefined ? '未知' : value.toLocaleString('zh-CN'); }
function time(value) { return value ? new Date(value).toLocaleString('zh-CN') : '尚无成功记录'; }
function render() {
  if (!current) return;
  const { snapshot: s } = current;
  $('updated').textContent = '最近采集：' + time(s.collectedAt) + ' · ' + s.timezone;
  $('notice').textContent = current.error || '';
  $('refresh').disabled = current.collecting;
  $('refresh').textContent = current.collecting ? '采集中…' : '刷新统计';
  $('toggle').textContent = current.enabled ? '暂停采集' : '恢复采集';
  $('footerStatus').textContent = current.collecting ? '正在读取本地统计' : current.enabled ? '采集已开启 · 每 15 秒刷新' : '采集已暂停';
  for (const [id, values] of [['agent', Object.keys(labels)], ['model', [...new Set(s.daily.map(row => row.model))].sort()]]) {
    const node = $(id), previous = node.value; node.replaceChildren(element('option', id === 'agent' ? '全部 agent' : '全部模型')); node.firstChild.value = 'all';
    for (const value of values) { const option = element('option', id === 'agent' ? labels[value] : value); option.value = value; node.append(option); }
    node.value = values.includes(previous) ? previous : 'all';
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const since = window.m1Calendar.since(today, period);
  const rows = s.daily.filter(row => row.date >= since && row.date <= today && ($('agent').value === 'all' || row.agent === $('agent').value) && ($('model').value === 'all' || row.model === $('model').value));
  const total = rows.reduce((sum, row) => sum + row.totalTokens, 0), priced = rows.reduce((sum, row) => sum + row.pricedTokens, 0);
  const pricedRows = rows.filter(row => row.estimatedCostUsd !== null);
  $('total').textContent = rows.length ? format(total) : '—';
  $('cost').textContent = pricedRows.length ? '$' + pricedRows.reduce((sum, row) => sum + row.estimatedCostUsd, 0).toFixed(4) : '未定价';
  $('coverage').textContent = '已定价 token 覆盖 ' + (total ? (100 * priced / total).toFixed(1) : '0') + '% · 费用小计';
  $('available').textContent = s.sources.filter(source => source.observedRecords > 0).length + ' / 5';
  $('range').textContent = '历史覆盖起点：' + (s.coverageStart || '暂无') + ' · ' + today;
  const combined = new Map();
  for (const row of rows) {
    const key = [row.agent, row.entry, row.model].join('|');
    if (!combined.has(key)) combined.set(key, { ...row });
    else { const group = combined.get(key); for (const field of ['totalTokens', 'cacheRead', 'reasoning', 'estimatedCostUsd']) group[field] = group[field] === null || row[field] === null ? null : group[field] + row[field]; }
  }
  $('rows').replaceChildren(); $('empty').hidden = rows.length > 0;
  for (const row of [...combined.values()].sort((a, b) => b.totalTokens - a.totalTokens)) {
    const tr = element('tr');
    for (const text of [labels[row.agent] + ' · ' + ({ desktop: 'Desktop', cli: 'CLI', unknown: '入口未知' }[row.entry] || '入口未知'), row.model, format(row.totalTokens), format(row.cacheRead), format(row.reasoning), row.estimatedCostUsd === null ? '未定价' : '$' + row.estimatedCostUsd.toFixed(4)]) tr.append(element('td', text));
    $('rows').append(tr);
  }
  const daily = new Map(); for (const row of rows) daily.set(row.date, (daily.get(row.date) || 0) + row.totalTokens);
  const values = [...daily].slice(-60), maximum = Math.max(1, ...values.map(v => v[1])); $('chart').replaceChildren();
  for (const [date, value] of values) { const column = element('div', undefined, 'chart-column'), bar = element('div', undefined, 'chart-bar'); bar.style.height = (value / maximum * 125) + 'px'; column.title = date + ' · ' + format(value) + ' token'; column.append(bar, element('span', date.slice(5), 'chart-day')); $('chart').append(column); }
  if (!values.length) $('chart').append(element('p', '暂无可用趋势数据', 'empty'));
  $('sourceCards').replaceChildren();
  for (const source of s.sources) {
    const card = element('section', undefined, 'panel source-card'), info = element('div');
    info.append(element('h3', source.label), element('p', states[source.status] || '未验证'), element('p', '最近成功：' + time(source.lastSuccess)));
    info.append(element('p', '本次读取文件 ' + (source.fileCount || 0) + ' · 用量记录 ' + (source.observedRecords || 0) + (source.errors?.length ? ' · ' + source.errors.join(', ') : '')));
    if (Object.keys(source.qualityIssues || {}).length) info.append(element('p', '字段质量问题：' + Object.entries(source.qualityIssues).map(([kind, count]) => kind + ' × ' + count).join('，') + '；这些记录不计价。'));
    const button = element('button', '添加本地目录'); button.addEventListener('click', async () => { try { await api.chooseSource(source.agent); await refreshState(); } catch { $('notice').textContent = '该路径不在本阶段允许的读取范围内。请选择独立的本地用量目录。'; } }); info.append(button);
    card.append(info, element('span', source.realSampleVerified ? '已核对' : '如实标注支持范围', 'source-tag')); $('sourceCards').append(card);
  }
  $('priceInfo').textContent = '固定价目：' + s.priceCatalog.version + ' · 取得日期：' + (s.priceCatalog.obtainedAt?.slice(0, 10) || '暂无') + ' · 运行时不更新';
}
async function refreshState() { try { current = await api.get(); render(); } catch { $('notice').textContent = '读取产品统计失败，请重新启动应用。'; } }
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => { for (const name of ['overview', 'sources', 'settings']) $(name).hidden = name !== button.dataset.view; for (const other of document.querySelectorAll('[data-view]')) other.classList.toggle('selected', other === button); });
for (const button of document.querySelectorAll('[data-period]')) button.addEventListener('click', () => { period = button.dataset.period; for (const other of document.querySelectorAll('[data-period]')) other.classList.toggle('selected', other === button); render(); });
$('agent').addEventListener('change', render); $('model').addEventListener('change', render);
$('refresh').addEventListener('click', async () => { $('refresh').disabled = true; await api.refresh(); await refreshState(); });
$('toggle').addEventListener('click', async () => { await api.setEnabled(!current.enabled); await refreshState(); });
$('export').addEventListener('click', async () => { await api.exportStatistics(); });
$('clear').addEventListener('click', async () => { await api.clearStatistics(); await refreshState(); });
$('quit').addEventListener('click', () => api.quit());
api.onUpdate(refreshState); void refreshState();
