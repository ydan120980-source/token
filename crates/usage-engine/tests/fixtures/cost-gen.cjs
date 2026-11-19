'use strict';

const table = require('../../../../src/m1/cost-table');
const insights = require('../../../../src/m1/cost-insights');
const math = require('../../../../src/m1/insights-math');
const { costExport } = require('../../../../src/m1/cost-export');

const cases = [];
const add = (operation, args, expected) => cases.push({ operation, args, expected: JSON.stringify(expected) });
const row = (date, agent, provider, model, tokens, lower, upper = lower, extra = {}) => ({
  date, agent, provider, model, totalTokens: tokens, inputUncached: tokens * 0.4, output: tokens * 0.1,
  cacheRead: tokens * 0.5, cacheWrite: 0, reasoning: 0, records: 1, pricedTokens: lower === null ? 0 : tokens,
  boundedTokens: upper > lower ? tokens : 0, estimatedCostUsd: lower, estimatedCostUpperUsd: upper,
  costParts: lower === null ? null : { inputUncached: lower * 0.6, output: lower * 0.3, cacheRead: lower * 0.1, cacheWrite: 0 },
  cacheSavingsUsd: lower === null ? null : 1, pricingReasons: upper > lower ? { 'cache-write-unreported': 1 } : {},
  unpricedTokens: lower === null ? { 'model-unpriced': tokens } : {}, incompleteTokens: {}, ...extra
});
const rows = [
  row('2026-10-01', 'claude', 'anthropic', 'sonnet', 1000, 2, 2.5, { cacheWrite: null }),
  row('2026-10-02', 'opencode', 'anthropic', 'sonnet', 500, 1, 1.25, { cacheWrite: null, pricingReasons: { 'cache-write-unreported': 2, 'context-unreported': 3 } }),
  row('2026-10-02', 'codex', 'openai', 'sol', 3000, 3, null),
  row('2026-10-02', 'codex', 'openai', 'mini', 4000, null),
  row('2026-10-03', 'opencode', 'deepseek', 'flash', 900, null, null, { inputUncached: null, cacheRead: null, unpricedTokens: { 'usage-incomplete': 900 }, incompleteTokens: { 'total-mismatch': 600 } }),
  row('2026-10-03', 'opencode', 'deepseek', 'flash', 100, 0.1),
  row('2026-10-03', 'codex', '', '=HYPERLINK("x")', 1, 0.03125),
  row('2026-10-03', 'codex', 'openai', 'unknown', 1, 0),
  row('2026-10-04', 'codex', 'openai', '@audit,\nrecord', 5, -0.00001),
  row('2026-10-05', 'codex', 'openai', 'big', 1e21, 1e21)
];
const previousRows = [row('2026-09-01', 'codex', 'openai', 'sol', 3500, null)];
const agentName = id => ({ codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode' })[id] || id;
const modelName = model => model;
if (process.argv[2] === 'table') {
  for (const options of [{}, { by: 'agent', previousRows }, { previousRows: [] }]) {
    const items = table.table(rows, options);
    add('table', [rows, options], items);
    for (const order of ['cost', 'tokens']) add('sort', [items, order], table.sort(items, order));
    for (const top of [0, 2, 6, items.length - 1]) add('fold', [items, top], table.fold(items, top));
    const range = '2026-10-01 至 2026-10-05';
    add('csv', [items, options.by || 'model', range], table.csv(items, { by: options.by, range, agentName, modelName }));
  }
  add('table', [[], {}], table.table([]));
  const series = Array.from({ length: 200 }, (_, index) => ({ date: String(index), tokens: index % 2, cost: null }));
  for (const max of [0, 90, 200]) add('points', [series, max], table.points(series, max));
}

if (process.argv[2] === 'export') {
  const snapshot = { daily: rows, sourceCatalog: { codex: { name: '@Synthetic, Codex' }, opencode: { name: '' } } };
  for (const request of [
    { by: 'model', from: null, to: null }, { by: 'agent', rows: [{ tokens: 1 }] },
    { by: 'agent', from: '2026-10-02', to: '2026-10-03', previousFrom: '2026-10-01', previousTo: '2026-10-01' },
    { by: 'model', from: '2026-10-03', to: '2026-10-03' }, { by: 'model', from: '2026-99-01', to: '2026-99-99' },
    null, {}, [], { by: 'session' }, { by: 'model', from: '2026-10-03', to: '2026-10-01' },
    { by: 'model', from: 'not-a-date', to: '2026-10-01' }, { by: 'model', from: '2026-10-01', to: null },
    { by: 'model', from: 1, to: 2 }, { by: 'model', previousFrom: '2026-10-01' }
  ]) {
    try { add('export', [snapshot, request], costExport(snapshot, request)); }
    catch (error) { add('export', [snapshot, request], { error: error.message }); }
  }
  add('export', [{ daily: null }, { by: 'agent' }], costExport({ daily: null }, { by: 'agent' }));
}

if (process.argv[2] === 'insights') {
  const monthly = [row('2026-08-20', 'codex', 'p', 'a', 100, 1), row('2026-09-01', 'codex', 'p', 'a', 100, 10), row('2026-09-30', 'codex', 'p', 'a', 100, 10),
    row('2026-10-01', 'codex', 'p', 'a', 100, 6), row('2026-10-05', 'codex', 'p', 'a', 100, 6, 9)];
  for (const [entries, options] of [
    [monthly, { today: '2026-10-10', coverageStart: '2026-08-15', minimumDays: 7 }],
    [monthly, { today: '2026-10-05', coverageStart: '2026-08-15' }],
    [monthly, { today: '2026-10-31', coverageStart: '2026-07-01' }],
    [[row('2026-10-02', 'codex', 'p', 'x', 100, null)], { today: '2026-10-20', coverageStart: '2026-10-01' }],
    [[row('2024-02-29', 'codex', 'p', 'x', 100, 0)], { today: '2024-03-31', coverageStart: '2024-02-01' }],
    [[], { today: '2026-10-05' }], [[], {}]
  ]) add('months', [entries, options], insights.months(entries, options));
  for (const fractions of [[0.359, 0.041, 0.589, 0.011], [1 / 3, 1 / 3, 1 / 3], [null, 0.5, 0.5], [null, 0]]) {
    for (const cells of [0, 7, 100]) add('waffle', [fractions, cells], insights.waffle(fractions, cells));
  }
  const comp = rows.slice(0, 9).concat(row('2026-10-09', 'codex', 'p', 'a', 1000, 10, 10, { pricedTokens: 50 }));
  for (const [entries, options] of [[comp, { from: '2026-10-01' }], [comp, { from: '2026-10-03' }], [comp, { bucket: 'day' }], [[rows[3]], {}], [[], {}]]) {
    add('composition', [entries, options], insights.composition(entries, options));
    add('total', [entries], insights.total(entries));
  }
  for (const options of [{}, { from: '2026-10-01', to: '2026-10-02', fees: { codex: 20, claude: 0, gemini: 15 }, agents: ['codex', 'claude', 'gemini', 'gemini'] }]) {
    add('subscriptions', [comp, options], insights.subscriptions(comp, options));
  }
  for (const items of [table.table(comp), table.table([rows[3]]), []]) {
    add('coverage', [items], insights.coverage(items));
    add('cache', [items], insights.cache(items));
  }
  add('monthEnd', ['2024-02-01'], insights.monthEnd('2024-02-01'));
  add('shift', ['2026-01-01', -1], insights.shift('2026-01-01', -1));
}

if (process.argv[2] === 'math') {
  const metrics = [
    { ...rows[2], reasoning: 10, cacheWrite: null, knownRecords: { inputUncached: 1, output: 1, reasoning: 1, cacheRead: 1 } },
    { ...rows[0], reasoning: null, cacheWrite: 25 },
    { ...rows[1], agent: 'claude', reasoning: null, cacheWrite: null, knownRecords: { inputUncached: 1, output: 1, cacheRead: 1, cacheWrite: 1 }, knownUsage: { cacheWrite: 35 } },
    { ...rows[4], reasoning: 90, output: null, knownRecords: { reasoning: 1, outputPlain: 1 }, knownUsage: { outputPlain: 20 } },
    { ...rows[3], agent: 'override', knownRecords: {} },
    { ...rows[7], agent: 'zero', totalTokens: 0, inputUncached: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, pricedTokens: 0, records: 0 }
  ];
  const fields = ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'outputPlain'];
  const recorded = math.recordedFields(metrics);
  const keys = ['codex', 'claude', 'opencode', 'override', 'zero', 'nobody'];
  add('recorded', [metrics, keys, fields], keys.map(agent => fields.map(field => recorded(agent, field))));
  for (const entries of [[], metrics, metrics.slice(0, 1), metrics.slice(1, 3), metrics.slice(2, 3), metrics.slice(3, 4), metrics.slice(4, 5), metrics.slice(5)]) {
    for (const name of ['categoryView', 'cacheHitRate', 'costDestination', 'efficiency']) {
      add(name, [entries, metrics], math[name](entries, recorded));
    }
  }
  const sameTokens = [row('2026-10-02', 'codex', 'p', 'B', 5, 0), row('2026-10-02', 'codex', 'p', 'a', 5, null), row('2026-10-02', 'claude', 'p', null, 5, null)];
  for (const entries of [[], rows, sameTokens]) for (const by of ['agent', 'model']) for (const limit of [0, 2, 6]) {
    add('shares', [entries, by, limit], math.shares(entries, by, limit));
  }
  const hourly = [
    { date: '2026-10-05', hour: 0, totalTokens: 3, records: 2 },
    { date: '2026-10-05', hour: 0, totalTokens: 2, records: 1 },
    { date: '2026-10-12', hour: 0, totalTokens: 1 },
    { date: '2026-10-11', hour: 23, totalTokens: 6 },
    { date: '2026-10-12', hour: 1, totalTokens: 0, records: 2 }
  ];
  for (const entries of [[], hourly]) add('weekHour', [entries], math.weekHour(entries));
  const totals = { '2026-10-01': 5, '2026-10-02': 5, '2026-10-03': 5, '2026-10-05': 1, '2026-10-06': 0, '2026-10-07': 2, '2026-10-08': 3 };
  for (const [entries, start, end] of [
    [totals, '2026-09-30', '2026-10-08'], [totals, '2026-09-30', '2026-10-09'], [totals, '2026-09-30', '2026-10-10'],
    [{}, '2026-10-01', '2026-10-08'], [totals, '2026-10-07', '2026-10-08'], [totals, '2026-10-08', '2026-10-07']
  ]) add('streaks', [entries, start, end], math.streaks(new Map(Object.entries(entries)), start, end));
  const hours = Array(24).fill(0); hours[23] = 6; hours[0] = 3; hours[1] = 1; hours[12] = 5;
  for (const [buckets, width] of [[hours, 3], [hours, 1], [hours, 0], [Array(24).fill(5), 3], [Array(24).fill(0), 3]]) {
    add('peakWindow', [buckets, width], math.peakWindow(buckets, width));
  }
  for (const [current, previous] of [[12, 10], [0, 10], [null, 10], [10, 0], [10, null], [10, -1]]) {
    add('change', [current, previous], math.change(current, previous));
  }
}

process.stdout.write(JSON.stringify(cases));
