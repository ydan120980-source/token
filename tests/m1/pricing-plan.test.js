'use strict';
// Dry runs, one-click plans, the fallback model and the optional lower bound (owner 2026-11-03,
// docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md). Synthetic records only.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store } = require('../../src/m1/store');

const rates = (extra = {}) => ({ inputUncached: 2e-6, output: 1e-5, cacheRead: 2e-7, cacheWrite: 2.5e-6, provenance: 'official-current-standard', ...extra });
const base = { agent: 'claude', provider: 'router', quality: 'measured', inputUncached: 100, output: 50, cacheRead: 20, cacheWrite: 0, reasoning: 0, totalTokens: 170, date: '2026-11-01', hour: 1, entry: 'cli', sessionKey: 's', usageConflict: false, time: 1 };
function store(t, records, catalog = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-plan-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const value = new Store(dir, {});
  value.state.records = Object.fromEntries(records.map((record, index) => [String(index).padStart(64, 'a'), { ...base, id: String(index).padStart(64, 'a'), ...record }]));
  value.modelCatalog = { ...value.modelCatalog, ...catalog };
  value._snapshot = null;
  return value;
}
const CATALOG = { 'vendor/one-model': rates(), 'vendor/no-cache': rates({ cacheRead: null }), 'vendor/two-model': rates(), 'other/two-model': rates({ output: 2e-5 }), 'ref/anything': rates({ inputUncached: 1e-6, output: 2e-6 }) };

test('a dry run says how much a target would count and writes nothing', t => {
  const value = store(t, [{ model: 'no-cache' }], CATALOG), before = JSON.stringify(value.billing);
  const { results, current, manual } = value.priceTry({ key: 'router/no-cache', targets: ['vendor/one-model', 'vendor/no-cache'] });
  assert.equal(manual, false); assert.equal(current.counted, 0);
  // Picking the same model id is not enough: without a cache rate these records stay out.
  const [whole, missing] = results;
  assert.equal(whole.target, 'vendor/one-model'); assert.equal(whole.coverage.counted, 170); assert.deepEqual(whole.coverage.left, []);
  assert.equal(missing.coverage.counted, 0); assert.equal(missing.coverage.left[0].reason, 'rate-missing');
  assert.equal(JSON.stringify(value.billing), before, 'nothing was saved');
});

test('a dry run names records no price can close', t => {
  const value = store(t, [{ model: 'broken', quality: 'partial', cacheRead: null }, { model: 'broken', usageConflict: true }], CATALOG);
  const coverage = value.priceTry({ key: 'router/broken', targets: ['vendor/one-model'] }).results[0].coverage;
  assert.equal(coverage.counted, 0);
  assert.deepEqual(coverage.left.map(row => row.cause).sort(), ['conflict', 'partial']);
});

test('a manual price wins over a mapping, and the dry run says so', t => {
  const value = store(t, [{ model: 'priced-by-hand' }], CATALOG);
  value.setPrice({ provider: 'router', model: 'priced-by-hand', inputUncached: 1, output: 1, cacheRead: 1, cacheWrite: 1 });
  assert.equal(value.priceTry({ key: 'router/priced-by-hand', targets: ['vendor/one-model'] }).manual, true);
});

test('A maps only when every whole candidate gives one price', t => {
  const value = store(t, [{ model: 'one-model' }, { model: 'two-model' }, { model: 'none-such' }, { model: 'no-cache' }], { 'vendor/one-model': rates(), 'vendor/two-model': rates(), 'other/two-model': rates({ output: 2e-5 }), 'vendor/no-cache': rates({ cacheRead: null }) });
  const plan = value.pricePlan({ auto: true });
  assert.deepEqual(plan.matched.map(item => [item.key, item.target]), [['router/one-model', 'vendor/one-model']]);
  const why = Object.fromEntries(plan.undecided.map(item => [item.key, item.why]));
  assert.equal(why['router/two-model'], 'several-prices'); assert.equal(why['router/none-such'], 'no-candidate'); assert.equal(why['router/no-cache'], 'no-whole-candidate');
  assert.equal(plan.after.counted, 170, 'only the matched model is counted');
  assert.deepEqual(plan.mappings, { 'router/one-model': 'vendor/one-model' });
  assert.deepEqual(value.billing.mappings, {}, 'the plan is not applied');
  assert.equal(value.pricePlan({ auto: false }).after.counted, 0, 'switching A off leaves it uncounted');
});

test('B prices only what has no usable price of its own, and is labelled apart', t => {
  const value = store(t, [{ model: 'none-such' }, { provider: 'vendor', model: 'one-model' }], CATALOG), saved = value.estimate(Object.values(value.state.records)[1]).lower;
  const plan = value.pricePlan({ auto: false, fallback: 'ref/anything' });
  assert.deepEqual(plan.fallback.models.map(item => item.key), ['router/none-such']);
  assert.equal(plan.after.fallbackTokens, 170); assert(plan.after.fallbackUsd > 0);
  value.setBilling({ ...value.billing, fallback: 'ref/anything' });
  const [unpriced, priced] = Object.values(value.state.records);
  assert.equal(value.estimate(unpriced).fallback, true);
  assert.equal(value.estimate(priced).lower, saved, 'a model with its own price keeps it');
  assert.equal(value.estimate(priced).fallback, undefined);
  assert.equal(value.pricing().models.find(row => row.model === 'none-such').origin, 'fallback');
  assert.throws(() => value.setBilling({ ...value.billing, fallback: 'nobody/no-model' }), /PRICE_SETTING_INVALID/);
  value.setPrice({ provider: 'mine', model: 'floor', inputUncached: 1, output: 1, cacheRead: 1, cacheWrite: 1 });
  value.setBilling({ ...value.billing, fallback: 'mine/floor' });
  assert.throws(() => value.setPrice({ provider: 'mine', model: 'floor', inputUncached: 1, output: 1 }, true), /PRICE_TARGET_IN_USE/, 'a fallback in use cannot lose its price');
});

test('C is off until asked, floors incomplete records on what they reported, and never conflicts', t => {
  const records = [{ provider: 'vendor', model: 'one-model', quality: 'partial', output: null, totalTokens: 120 }, { provider: 'vendor', model: 'one-model', usageConflict: true }, { provider: 'vendor', model: 'one-model', quality: 'invalid-cache' }];
  const value = store(t, records, CATALOG), [partial, conflict, contradiction] = Object.values(value.state.records);
  assert.equal(value.estimate(partial).lower, null, 'off by default');
  assert.equal(value.pricePlan({ auto: false }).after.floorTokens, 0);
  const plan = value.pricePlan({ auto: false, partial: true });
  assert.equal(plan.after.floorTokens, 120); assert.equal(plan.floor.tokens, 120);
  value.setBilling({ ...value.billing, partialLowerBound: true });
  const floor = value.estimate(partial);
  assert.equal(floor.lowerBound, true); assert.equal(floor.reason, 'usage-lower-bound');
  assert.equal(floor.lower, 100 * 2e-6 + 20 * 2e-7, 'only the reported fields, output stays unknown');
  assert.equal(partial.output, null, 'the record is not filled in');
  assert.equal(value.estimate(conflict).lower, null); assert.equal(value.estimate(contradiction).lower, null);
  assert.deepEqual(new Set(value.pricePlan({ auto: false, partial: true }).after.left.map(row => row.cause)), new Set(['conflict', 'invalid-cache']));
});

test('saved billing without the new options stays as it was', t => {
  const value = store(t, [], CATALOG);
  assert.deepEqual(value.validateBilling({ autoSync: true, defaults: {}, mappings: {} }), { autoSync: true, defaults: {}, mappings: {} });
  assert.deepEqual(value.validateBilling({ autoSync: true, defaults: {}, mappings: {}, fallback: null, partialLowerBound: false }), { autoSync: true, defaults: {}, mappings: {} });
});
