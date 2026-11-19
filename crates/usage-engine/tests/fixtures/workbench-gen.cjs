'use strict';
// Runtime parity fixture for the Rust workbench slice. Views depend on the real
// current day, so the Rust test invokes this generator and compares against the
// JS reference in the same run. All homes, names and records are invented.
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const out = process.argv[3];
const { Store } = require(path.join(root, 'src/m1/store'));
const { roots } = require(path.join(root, 'src/m1/policy'));
const { scanSources } = require(path.join(root, 'src/m1/sources'));
const workbench = require(path.join(root, 'src/m1/workbench'));
const adapter = require(path.join(root, 'src/m1/jsonl-adapter'));
const { digest } = require(path.join(root, 'src/m1/normalize'));

const salt = 'e'.repeat(64);
const deviceId = 'workbench-fixture-device';
const home = path.join(out, 'home');
const app = path.join(out, 'app');
const now = Date.now();
const at = days => new Date(now - days * 86400000).toISOString();
const selected = roots(home);
const missingScope = 'b'.repeat(64);
const seedWorkbench = { version: 1, budgets: { [missingScope + ':daily']: 2 }, acknowledged: {} };

function put(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
}
function codexFile(name, id, cwd, model, events) {
  const rows = [{ type: 'session_meta', timestamp: at(40), payload: { id, ...(cwd ? { cwd } : {}), originator: 'cli', model_provider: 'openai' } }];
  rows.push({ type: 'turn_context', timestamp: at(40), payload: { model } });
  for (const [days, total, last] of events) {
    rows.push({ type: 'event_msg', timestamp: at(days), payload: { type: 'token_count', info: { total_token_usage: total, ...(last ? { last_token_usage: last } : {}) } } });
  }
  put(path.join(selected.codex[0], '2026', '11', name + '.jsonl'), rows);
}
const usage = (input, output, cached, reasoning, total) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: cached, reasoning_output_tokens: reasoning, total_tokens: total });
codexFile('alpha', 's-alpha', 'E:/work/alpha', 'gpt-4.1', [
  [0, usage(1000, 200, 400, 50, 1200), usage(1000, 200, 400, 50, 1200)],
  [0, usage(1500, 300, 600, 80, 1800)]
]);
codexFile('beta', 's-beta', 'E:/work/beta', 'gpt-4.1', [[3, usage(500, 100, 200, 10, 600), usage(500, 100, 200, 10, 600)]]);
codexFile('alpha-twin', 's-alpha2', 'E:/other/alpha', 'gpt-4.1', [[1, usage(300, 60, 120, 20, 360), usage(300, 60, 120, 20, 360)]]);
codexFile('no-cwd', 's-nocwd', null, 'mystery-model', [[0, usage(200, 40, 80, 10, 240), usage(200, 40, 80, 10, 240)]]);
codexFile('mystery', 's-mystery', 'E:/work/alpha', 'mystery-model', [[0, usage(100, 20, 40, 5, 120), usage(100, 20, 40, 5, 120)]]);
codexFile('partial', 's-partial', 'E:/work/beta', 'gpt-4.1', [[9, { input_tokens: 100, cached_input_tokens: 10, total_tokens: 110 }, { input_tokens: 100, cached_input_tokens: 10, total_tokens: 110 }]]);
codexFile('old', 's-old', 'E:/work/alpha', 'gpt-4.1', [[40, usage(800, 160, 320, 40, 960), usage(800, 160, 320, 40, 960)]]);
put(path.join(selected.claude[0], 'E--work-alpha', 'cl.jsonl'), [
  { type: 'assistant', sessionId: 'cl-1', cwd: 'E:/work/alpha', timestamp: at(1), uuid: 'u-1', message: { id: 'm-1', model: 'claude-sonnet-4-5', usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5, cache_creation_input_tokens: 2 } } }
]);

const mapped = { schemaVersion: 'CustomSourceV1', name: '私有工具', template: 'mapped', mode: 'per-request', mapping: { id: 'id', session: 'session', time: 'timestamp', model: 'model', provider: 'provider', input: 'usage.input', output: 'usage.output', cacheRead: 'usage.read', cacheWrite: 'usage.write', reasoning: 'usage.reason', total: 'usage.total' }, filters: [], timeUnit: 'iso', inputSemantics: 'inclusive', outputIncludesReasoning: true };
const customId = 'custom-11111111-1111-4111-8111-111111111111';
const customEvent = { id: 'call-1', session: 'cs', timestamp: at(1), model: 'gpt-4.1', provider: 'openai', usage: { input: 100, output: 20, read: 40, write: 0, reason: 0, total: 120 } };
const customRoot = path.join(home, 'custom-outside');
fs.mkdirSync(customRoot, { recursive: true });
const customSource = { id: customId, name: '私有工具', definition: { ...mapped, name: '私有工具' }, roots: [customRoot], version: 1, enabled: true, archived: false, files: {}, diagnostics: {} };

fs.mkdirSync(app, { recursive: true });
fs.writeFileSync(path.join(app, 'statistics.json'), JSON.stringify({ version: 1, deviceId, salt, sequence: 0, records: {}, statuses: {} }));
fs.writeFileSync(path.join(app, 'workbench.json'), JSON.stringify(seedWorkbench));

function mask(view) {
  const copy = JSON.parse(JSON.stringify(view));
  for (const row of copy.sources || []) row.lastSuccess = null;
  return copy;
}
function captureError(fn) {
  try { fn(); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; }
}

(async () => {
  const store = new Store(app, selected);
  store.setPrice({ provider: 'openai', model: 'gpt-4.1', inputUncached: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
  store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'passed' });
  const customRecord = adapter.parse(customEvent, { id: customId, definition: mapped }, store.state.salt).record;
  store.commitCustom(customSource, [customRecord]);
  const alphaId = digest(salt, 'project:e:/work/alpha');
  store.saveWorkbench({ kind: 'budget', project: 'all', period: 'monthly', limitUsd: 0.000001 });
  store.saveWorkbench({ kind: 'budget', project: alphaId, period: 'total', limitUsd: 1000000 });
  store.saveWorkbench({ kind: 'budget', project: 'unknown', period: 'total', limitUsd: 5 });

  const expected = { salt, deviceId, seedWorkbench, alphaId, missingScope, customSource, customEvent, views: {}, errors: {}, units: {} };
  const monthly = store.workbench({});
  const total = store.workbench({ period: 'total' });
  expected.views.monthly = mask(monthly);
  expected.views.total = mask(total);
  expected.views.daily = mask(store.workbench({ period: 'daily' }));
  expected.views.weekly = mask(store.workbench({ period: 'weekly' }));
  expected.views.alphaTotal = mask(store.workbench({ project: alphaId, period: 'total' }));
  expected.views.unknownMonthly = mask(store.workbench({ project: 'unknown' }));
  expected.views.csvMonthly = workbench.csv(monthly);
  expected.views.csvTotal = workbench.csv(total);

  const unpriced = monthly.issues.find(issue => issue.code === 'USAGE_UNPRICED');
  expected.ackTarget = { id: unpriced.id, fingerprint: unpriced.fingerprint };
  expected.views.ackOn = mask(store.saveWorkbench({ kind: 'acknowledge', id: unpriced.id, fingerprint: unpriced.fingerprint, acknowledged: true, project: 'all', period: 'monthly' }));
  expected.views.ackOff = mask(store.saveWorkbench({ kind: 'acknowledge', id: unpriced.id, fingerprint: unpriced.fingerprint, acknowledged: false, project: 'all', period: 'monthly' }));
  const exceeded = monthly.budgetOverview.issues.find(issue => issue.code === 'BUDGET_EXCEEDED');
  expected.views.ackBudget = mask(store.saveWorkbench({ kind: 'acknowledge', id: exceeded.id, fingerprint: exceeded.fingerprint, acknowledged: true, project: 'all', period: 'monthly' }));
  const scopeMissing = monthly.budgetOverview.issues.find(issue => issue.code === 'BUDGET_SCOPE_MISSING');
  expected.views.ackScopeMissing = mask(store.saveWorkbench({ kind: 'acknowledge', id: scopeMissing.id, fingerprint: scopeMissing.fingerprint, acknowledged: true, project: missingScope, period: 'daily' }));
  expected.views.budgetDeleted = mask(store.saveWorkbench({ kind: 'budget', project: 'all', period: 'monthly', limitUsd: null }));

  expected.errors.scopeInvalid = captureError(() => store.saveWorkbench({ kind: 'budget', project: 'c'.repeat(64), period: 'monthly', limitUsd: 5 }));
  expected.errors.stale = captureError(() => store.saveWorkbench({ kind: 'acknowledge', id: '0'.repeat(64), fingerprint: '0'.repeat(64), acknowledged: true, project: 'all', period: 'monthly' }));
  expected.errors.requestInvalid = captureError(() => store.workbench({ project: 'bad!' }));
  expected.errors.settingInvalid = captureError(() => store.saveWorkbench({ kind: 'other' }));
  expected.errors.budgetKeyInvalid = captureError(() => store.saveWorkbench({ kind: 'budget', project: 'all', period: 'monthly', limitUsd: 5, extra: true }));

  const reopened = new Store(app, selected);
  expected.views.reopened = mask(reopened.workbench({ period: 'total' }));

  const today = store.snapshot().today;
  expected.units.today = today;
  expected.units.range = ['daily', 'weekly', 'monthly', 'total'].map(period => ({ period, span: workbench.range(today, period) }));
  const totals = [
    { records: 2, lower: 1, upper: 2, unpricedRecords: 0 },
    { records: 1, lower: null, upper: null, unpricedRecords: 1 },
    { records: 3, lower: 0.25, upper: 0.25, unpricedRecords: 2 },
    { records: 0, lower: null, upper: null, unpricedRecords: 0 }
  ];
  expected.units.budget = [];
  for (const totalRow of totals) for (const limit of [null, 0.5, 1, 1.5, 2, 3]) {
    expected.units.budget.push({ total: totalRow, limit, result: workbench.budget(totalRow, limit) });
  }
  expected.units.settings = [
    { value: { version: 2, budgets: {}, acknowledged: {} }, result: captureError(() => workbench.settings({ version: 2, budgets: {}, acknowledged: {} })) },
    { value: { version: 1, budgets: { 'all:yearly': 1 }, acknowledged: {} }, result: captureError(() => workbench.settings({ version: 1, budgets: { 'all:yearly': 1 }, acknowledged: {} })) },
    { value: { version: 1, budgets: { 'all:monthly': 0 }, acknowledged: {} }, result: captureError(() => workbench.settings({ version: 1, budgets: { 'all:monthly': 0 }, acknowledged: {} })) },
    { value: { version: 1, budgets: {}, acknowledged: { zz: '0'.repeat(64) } }, result: captureError(() => workbench.settings({ version: 1, budgets: {}, acknowledged: { zz: '0'.repeat(64) } })) },
    { value: seedWorkbench, result: captureError(() => workbench.settings(seedWorkbench)) }
  ];
  expected.units.request = [
    { value: {}, result: captureError(() => workbench.request({})) },
    { value: { period: 'yearly' }, result: captureError(() => workbench.request({ period: 'yearly' })) },
    { value: { project: 5 }, result: captureError(() => workbench.request({ project: 5 })) },
    { value: { period: 'total', project: 'unknown' }, result: captureError(() => workbench.request({ period: 'total', project: 'unknown' })) }
  ];
  const names = ['未知项目', 'álpha', 'alpha', 'Alpha', 'beta', '项目乙', '项目甲'];
  const pairs = [['a', 'A'], ['alpha', 'Alpha'], ['álpha', 'alpha'], ['未知项目', 'alpha'], ['beta', '未知项目'], ['a-b', 'ab'], ['2', '10'], ['all:daily', 'all:monthly'], ['a'.repeat(64), 'unknown:total'], ['项目甲', '项目乙'], ['Z', 'a'], ['a', 'a ']];
  expected.units.collation = { names, sorted: [...names].sort((a, b) => a.localeCompare(b)), pairs: pairs.map(([a, b]) => ({ a, b, cmp: a.localeCompare(b) })) };
  fs.writeFileSync(path.join(out, 'expected.json'), JSON.stringify(expected));
})().catch(error => { console.error(error); process.exit(1); });