'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const model = require('../../design/desktop-reference/usage-model');
const math = require('../../src/m1/usage-math');
const chart = require('../../design/desktop-reference/chart-ui');
const display = require('../../design/desktop-reference/display-values');
const base = { date: '2026-10-27', agent: 'codex', model: 'alpha', provider: 'openai', totalTokens: 10,
  inputUncached: 5, output: 3, cacheRead: 2, cacheWrite: 0, records: 1,
  estimatedCostUsd: 2, estimatedCostUpperUsd: 3, pricedTokens: 10, boundedTokens: 10 };
const context = { today: '2026-10-28', coverageStart: '2026-01-01', realData: true, hourlyReady: false, currentHour: 12 };
const state = { agent: 'all', source: 'all', model: 'all', period: '7', metric: 'tokens', mode: 'flow',
  display: 'daily', grain: 'day', trendRange: { start: '2026-10-26', end: '2026-10-28' } };
test('usage aggregate retains exact known lower/upper, records and coverage', () => {
  const value = model.aggregate([base, { ...base, totalTokens: 30, estimatedCostUsd: 0,
    estimatedCostUpperUsd: 0, pricedTokens: 0, boundedTokens: 0 }]);
  assert.equal(value.total, 40); assert.equal(value.cost, 2); assert.equal(value.upper, 3);
  assert.equal(value.records, 2); assert.equal(value.coverage, .25); assert.equal(value.partial, false);
});
test('S4 all unknown token totals stay null, a real zero stays zero, a partial total carries its flag', () => {
  assert.equal(model.aggregate([{ ...base, totalTokens: null }]).total, null);
  assert.equal(model.aggregate([{ ...base, totalTokens: 0 }]).total, 0);
  const partial = model.aggregate([base, { ...base, totalTokens: null }]);
  assert.equal(partial.total, 10); assert.equal(partial.partial, true);
  assert.equal(model.aggregate([]).total, null);
});
test('S1 unpriced slot is null and mixed slot sums known fees with partial', () => {
  const unknown = { ...base, estimatedCostUsd: null, estimatedCostUpperUsd: null, pricedTokens: 0 };
  assert.equal(model.aggregate([unknown]).cost, null);
  const mixed = model.aggregate([base, unknown]);
  assert.equal(mixed.cost, 2); assert.equal(mixed.upper, 3); assert.equal(mixed.costPartial, true);
});
test('filters preserve identity without filters, provider/model identity and export range boundaries', () => {
  const rows = [base, { ...base, date: '2026-10-28', agent: 'claude', provider: 'other' }];
  assert.equal(model.filterRows(rows, state), rows);
  assert.deepEqual(model.filterRows(rows, { ...state, source: 'other' }), [rows[1]]);
  assert.deepEqual(model.filterRows(rows, { ...state, agent: 'codex' }), [base]);
  assert.deepEqual(model.within(rows, '2026-10-28', '2026-10-28'), [rows[1]]);
  assert.equal(model.previousWindow('2026-10-28', '2026-10-22', '2026-10-16', '7').complete, false);
  assert.equal(model.previousWindow('2026-10-28', '2026-10-22', '2026-10-15', '7').complete, true);
});
test('strip is always 30 days and distinguishes unobserved, unknown, zero, today and peak', () => {
  const bars = model.strip([base, { ...base, date: '2026-10-25', totalTokens: 0 },
    { ...base, date: '2026-10-26', totalTokens: null }], context.today);
  assert.equal(bars.length, 30); assert.equal(bars[0].key, '2026-09-29');
  assert.equal(bars.at(-1).mark, 'today'); assert.equal(bars.at(-2).mark, 'peak');
  assert.equal(bars.find(bar => bar.key === '2026-10-25').state, 'zero');
  assert.equal(bars.find(bar => bar.key === '2026-10-26').state, 'unpriced');
  assert.equal(bars.at(-1).state, 'unobserved');
});
test('calendar pads Monday origin, disables future, keeps recorded zero and selected date', () => {
  const rows = [base, { ...base, date: '2026-10-28', totalTokens: 0 }];
  const cal = model.calendar(rows, rows, context.today, context.coverageStart, '2026', true, base.date);
  assert.equal(cal.cells[0].key, '2025-12-29'); assert.equal(cal.cells[0].disabled, true);
  assert.equal(cal.cells.find(cell => cell.key === '2026-10-28').level, 0);
  assert.equal(cal.cells.find(cell => cell.key === '2026-10-26').level, null);
  assert.equal(cal.cells.find(cell => cell.key === base.date).selected, true);
  assert.equal(cal.cells.find(cell => cell.key === '2026-10-29').disabled, true);
  assert.equal(model.dates('2024-02-28', '2024-03-01').length, 3);
});
test('S2 flow keeps a reported unknown as hard gap, missing calendar dates as missing, zero as zero', () => {
  const trend = model.trend([{ ...base, inputUncached: null }, { ...base, date: '2026-10-28', inputUncached: 0 }], [], context, state, math, chart);
  assert.deepEqual(trend.entries.find(entry => entry.key === 'inputUncached').values, [null, null, 0]);
  assert.deepEqual(trend.entries.find(entry => entry.key === 'output').values, [null, 3, 3]);
  const buckets = trend.entries.find(entry => entry.key === 'inputUncached').buckets;
  const blocked = chart.gapPlan(buckets, [null, null, 0], trend.observed, context.coverageStart, 'daily');
  assert.equal(chart.segmentKind(0, 2, blocked, [null, null, 0]), 'unknown');
});
test('hourly plots stop at current hour, keep unknown bucket, cumulative uses exact known values', () => {
  const rows = [{ ...base, date: context.today, hour: 1 }, { ...base, date: context.today, hour: 2, estimatedCostUsd: null }];
  const chosen = { ...state, metric: 'cost', mode: 'total', trendRange: { start: context.today, end: context.today } };
  const result = model.trend(rows, rows, { ...context, hourlyReady: true }, chosen, math, chart);
  assert.equal(result.buckets.length, 13); assert.equal(result.entries[0].values[1], 2);
  assert.equal(result.entries[0].values[2], null);
  const cumulative = model.trend(rows, rows, { ...context, hourlyReady: true }, { ...chosen, display: 'total' }, math, chart);
  assert.equal(cumulative.entries[0].values.at(-1), 2);
  const hours = model.dayHours(rows, context.today, context.today, 12, true);
  assert.equal(hours.hours.length, 24); assert.equal(hours.hours[13].future, true);
});
test('model top five plus other preserves full total and cost overlay is independent', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ ...base, model: 'm' + i, totalTokens: i + 1 }));
  const result = model.trend(rows, [], context, { ...state, mode: 'models' }, math, chart);
  assert.equal(result.entries.length, 6); assert.equal(result.entries.at(-1).label, '其他 2 个模型');
  assert.equal(result.entries.reduce((n, entry) => n + entry.values[1], 0), 28);
  const flow = model.trend(rows, [], context, state, math, chart);
  assert.equal(flow.entries.at(-1).key, 'cost'); assert.equal(flow.entries.at(-1).values[1], 14);
});
test('average threshold and weekly partial semantics come from the unchanged shared math', () => {
  const rows = model.dates('2026-10-20', '2026-10-28').map(date => ({ ...base, date }));
  const result = model.trend(rows, [], context, { ...state, display: 'average', mode: 'total' }, math, chart);
  assert.deepEqual(result.entries[0].values, [10, 10, 10]);
  const weekly = model.trend([{ ...base, totalTokens: null }], [], context, { ...state, grain: 'week' }, math, chart);
  assert.equal(weekly.entries[0].buckets[0].partial, true);
});

test('original model identity colours survive reordered data and filtering', () => {
  const rows = ['alpha', 'beta', 'gamma'].map((name, index) => ({ ...base, model: name, totalTokens: index + 1 }));
  const read = items => model.trend(items, [], context, { ...state, mode: 'models' }, math, chart).entries;
  const original = new Map(read(rows).map(entry => [entry.key, entry.tone]));
  for (const entry of read(rows.slice().reverse())) assert.equal(entry.tone, original.get(entry.key));
  for (const entry of read(rows.slice(1))) assert.equal(entry.tone, original.get(entry.key));
  assert.equal(model.modelTone('alpha'), 'model:8');
});

test('full trend TipCard preserves ranking, hidden entries, known zero, unknown and separate priced estimate', () => {
  const projected = model.trend([{ ...base, inputUncached: 5, output: null, cacheRead: 8, cacheWrite: 0 }], [], context, state, math, chart);
  const card = model.trendTooltip(projected, { ...state, hidden: [] }, 1, chart, display);
  assert.equal(card.title, base.date); assert.equal(card.aside, '合计 13 token');
  assert.deepEqual(card.rows.map(row => row.key), ['cacheRead', 'inputUncached', 'cost']);
  assert.equal(card.rows[0].tone, 'measure:cacheRead'); assert.equal(card.rows.at(-1).value, '$2.00');
  assert.match(card.note, /1 项记录为零/); assert.match(card.note, /1 个值未知/);
  const hidden = model.trendTooltip(projected, { ...state, hidden: ['cacheRead', 'cost'] }, 1, chart, display);
  assert.equal(hidden.aside, '合计 5 token'); assert.deepEqual(hidden.rows.map(row => row.key), ['inputUncached']);
  const missing = model.trendTooltip(projected, { ...state, hidden: [] }, 0, chart, display);
  assert.equal(missing.aside, '未记录'); assert.deepEqual(missing.rows, []); assert.match(missing.note, /没有此日期的用量数值/);
});

test('TipCard caps six known rows and preserves unknown cost without zero fabrication', () => {
  const bucket = { start: base.date, end: base.date, partial: true };
  const projection = { buckets: [bucket], observed: new Set([base.date]), hourly: false,
    entries: Array.from({ length: 8 }, (_, index) => ({ key: String(index), label: 'm' + index, unit: 'cost',
      values: [index + 1], buckets: [bucket], tone: model.modelTone('m' + index) })) };
  const card = model.trendTooltip(projection, { ...state, metric: 'cost', hidden: [] }, 0, chart, display);
  assert.equal(card.rows.length, 6); assert.equal(card.rows[0].key, '7'); assert.match(card.note, /另有 2 个模型/);
  assert.match(card.note, /当前聚合含未记录日期/); assert.equal(card.aside, '合计 $36.00');
  projection.entries.forEach(entry => { entry.values = [null]; });
  const unknown = model.trendTooltip(projection, { ...state, metric: 'cost', hidden: [] }, 0, chart, display);
  assert.equal(unknown.aside, '数值未知'); assert.equal(unknown.rows.length, 0);
  assert.match(unknown.note, /价格未报告/); assert.match(unknown.note, /8 个值未知/);
});

test('page projection keeps partial today records, zero/unknown calendar and non-clipping dual numeric scales', () => {
  const rows = [{ ...base, date: context.today, inputUncached: 12, totalTokens: null },
    { ...base, date: '2026-10-26', totalTokens: 0 }, base];
  const full = { ...state, hidden: [], selectedDay: null, slot: null, heatRange: '365', palette: 'orange' };
  const input = { ...context, rows, allRows: rows, hourlyRows: [], hourlyReady: () => false, recorded: () => true,
    sessionCounts: {}, sources: [{ agent: 'codex', observedRecords: 1 }], enabled: false };
  const globals = { usageMath: math, chartUi: chart, displayValues: display,
    insightsMath: require('../../src/m1/insights-math'), agents: { codex: { name: 'Codex' } } };
  const view = model.project(input, full, globals);
  assert.equal(view.today.empty, ''); assert.equal(view.today.tokens, null);
  assert.equal(view.today.clients.length, 1); assert.equal(view.sourceCount, 1);
  assert.equal(view.calendar.cells.find(cell => cell.key === '2026-10-26').tip.aside, '0 Token');
  assert.equal(view.calendar.cells.find(cell => cell.key === context.today).tip.aside, '未知');
  for (const side of ['left', 'right']) {
    const ticks = view.trend.ticks[side], peak = Math.max(0, ...view.trend.entries.filter(entry => entry.axis === side)
      .flatMap(entry => entry.values.filter(Number.isFinite)));
    assert(ticks.at(-1).value >= peak); assert(ticks.length <= 5); assert.equal(ticks[0].value, 0);
    assert(ticks.at(-1).value - peak < ticks[1].value + 1e-9);
  }
  assert(view.trend.ticks.right.every(tick => tick.label.startsWith('$')));
  assert.equal(model.project(input, { ...full, hidden: ['cost'] }, globals).trend.ticks.right.length, 0);
});

test('S4 unknown totals remain hard gaps in total and model trends, including cumulative origin', () => {
  for (const mode of ['total', 'models']) for (const display of ['daily', 'total']) {
    const trend = model.trend([{ ...base, totalTokens: null }], [], context, { ...state, mode, display }, math, chart);
    assert.equal(trend.entries[0].values[1], null, mode + '/' + display);
    assert.equal(trend.aggregate.total, null);
  }
  const chosen = { ...state, mode: 'total', display: 'total', trendRange: { start: context.today, end: context.today } };
  const rows = [{ ...base, date: context.today, hour: 0, totalTokens: null }];
  const hourly = model.trend(rows, rows, { ...context, hourlyReady: true }, chosen, math, chart);
  assert.equal(hourly.entries[0].values[0], null);
});

test('S4 unknown totals stay unknown in model shares, activity cells, hours and the recent strip', () => {
  const rows = [{ ...base, date: context.today, totalTokens: null }];
  const full = { ...state, hidden: [], selectedDay: context.today, slot: null, heatRange: '365', palette: 'orange' };
  const input = { ...context, rows, allRows: rows, hourlyRows: [{ ...rows[0], hour: 2 }], hourlyReady: () => true,
    recorded: () => true, sessionCounts: {}, sources: [], enabled: false };
  const globals = { usageMath: math, chartUi: chart, displayValues: display,
    insightsMath: require('../../src/m1/insights-math'), agents: { codex: { name: 'Codex' } } };
  const view = model.project(input, full, globals), row = view.today.clients[0].models[0];
  assert.equal(row.fraction, null); assert.equal(row.share, null);
  assert.match(view.hero.bars.at(-1).label, /未知/); assert.doesNotMatch(view.hero.bars.at(-1).label, /未观测/);
  const cell = view.activity.cells.find(cell => cell.key === '2:2');
  assert.equal(cell.level, null); assert.equal(cell.tip.aside, '未知'); assert.equal(view.activity.empty, '');
  assert.equal(view.activity.hours.draw, true); assert.equal(view.activity.hours.hours[2].value, null);
  const mixed = model.project({ ...input, rows: [...rows, { ...base, date: context.today, model: 'beta' }],
    allRows: [...rows, { ...base, date: context.today, model: 'beta' }] }, full, globals);
  assert.equal(mixed.today.clients[0].models.find(row => row.key === 'alpha').fraction, null);
});
