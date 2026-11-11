'use strict';
// The cost page's sections beyond the table (src/m1/cost-insights.js) and the saved
// subscription fees (src/m1/service.js).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const insights = require('../../src/m1/cost-insights');
const costTable = require('../../src/m1/cost-table');
const { Service } = require('../../src/m1/service');
const { fixtures } = require('./fixtures');
const { remove } = require('./temp');

const row = (date, agent, model, tokens, lower, upper = lower, extra = {}) => ({
  date, agent, provider: 'p', model, totalTokens: tokens, inputUncached: tokens * 0.4, output: tokens * 0.1, cacheRead: tokens * 0.5, cacheWrite: 0, reasoning: 0, records: 1,
  pricedTokens: lower === null ? 0 : tokens, boundedTokens: 0, estimatedCostUsd: lower, estimatedCostUpperUsd: lower === null ? null : upper,
  costParts: lower === null ? null : { inputUncached: lower * 0.5, output: lower * 0.4, cacheRead: lower * 0.1, cacheWrite: 0 }, cacheSavingsUsd: lower === null ? null : 1,
  pricingReasons: upper > lower ? { 'context-unreported': 1 } : {}, unpricedTokens: lower === null ? { 'model-unpriced': tokens } : {}, incompleteTokens: {}, ...extra
});

test('months: newest first, a change only against a fully recorded month, the current one against the same days', () => {
  const rows = [row('2026-08-20', 'codex', 'a', 100, 1), row('2026-09-01', 'codex', 'a', 100, 10), row('2026-09-30', 'codex', 'a', 100, 10),
    row('2026-10-01', 'codex', 'a', 100, 6), row('2026-10-05', 'codex', 'a', 100, 6, 9)];
  const list = insights.months(rows, { today: '2026-10-10', coverageStart: '2026-08-15', minimumDays: 7 });
  assert.deepEqual(list.map(m => m.month), ['2026-10', '2026-09', '2026-08']);
  const [october, september, august] = list;
  assert.equal(august.started, false); assert.equal(august.delta, null, 'August starts mid-month: nothing comparable');
  assert.equal(september.delta, null, 'its previous month is not fully recorded');
  assert.equal(october.deltaKind, 'same-days'); assert.equal(october.delta, (12 - 10) / 10, 'October 1-10 against September 1-10');
  assert.equal(october.lower, 12); assert.equal(october.upper, 15);
  // Two days with usage in ten elapsed days; 21 days remain: 21 × 2 / 10 = 4.2 more days at 6 a day.
  assert.equal(october.usageDays, 2); assert.equal(october.projection.remaining, 21);
  assert.ok(Math.abs(october.projection.lower - (12 + 6 * 4.2)) < 1e-9); assert.ok(Math.abs(october.projection.upper - (15 + 7.5 * 4.2)) < 1e-9);
  assert.equal(september.projection, null, 'only the current month is projected');
  assert.equal(insights.months(rows, { today: '2026-10-05', coverageStart: '2026-08-15' })[0].projection, null, 'too few days to project');
  const unpriced = insights.months([row('2026-10-02', 'codex', 'x', 100, null)], { today: '2026-10-20', coverageStart: '2026-10-01' })[0];
  assert.equal(unpriced.lower, null); assert.equal(unpriced.projection, null, 'unpriced stays unknown, not $0');
});

test('waffle cells add up and drop unknown parts; composition keeps tokens to rows priced in full', () => {
  assert.deepEqual(insights.waffle([0.359, 0.041, 0.589, 0.011]), [36, 4, 59, 1]);
  assert.deepEqual(insights.waffle([1 / 3, 1 / 3, 1 / 3]), [34, 33, 33]);
  assert.deepEqual(insights.waffle([null, 0.5, 0.5]), [0, 50, 50]);
  assert.deepEqual(insights.waffle([null, 0]), [0, 0]);
  const rows = [row('2026-10-01', 'codex', 'a', 1000, 10, 14), row('2026-10-09', 'codex', 'a', 1000, 10),
    row('2026-10-02', 'opencode', 'b', 500, 5, 5, { pricedTokens: 250 }), row('2026-10-02', 'gemini', 'c', 800, null)];
  const comp = insights.composition(rows, { from: '2026-10-01' });
  assert.equal(comp.lower, 25); assert.equal(comp.upper, 29); assert.equal(comp.spread, 4);
  assert.deepEqual(comp.reasons.map(r => r.code), ['context-unreported']);
  const input = comp.parts.find(p => p.key === 'inputUncached');
  assert.equal(input.cost, 12.5, 'every priced row counts toward the money');
  assert.equal(input.tokens, 800, 'tokens only from rows priced in full');
  assert.equal(input.perMillion, 10 / 800 * 1e6);
  assert.equal(comp.fullTokens, 2000);
  assert.deepEqual(input.series.map(p => p.date), ['2026-10-01', '2026-10-08'], 'weekly buckets from the range start');
  const none = insights.composition([row('2026-10-02', 'gemini', 'c', 800, null)]);
  assert.equal(none.lower, null); assert.equal(none.parts[0].cost, null); assert.equal(none.parts[0].tokens, null);
});

test('subscriptions compare a window with the fee; coverage groups what is left out; cache keeps unknown rates unknown', () => {
  const rows = [row('2026-09-03', 'codex', 'a', 100, 40, 70), row('2026-09-04', 'claude', 'b', 100, 50), row('2026-09-04', 'gemini', 'c', 100, null), row('2026-10-01', 'codex', 'a', 100, 99)];
  const subs = insights.subscriptions(rows, { from: '2026-09-01', to: '2026-09-30', fees: { codex: 20, claude: 0, opencode: 15 }, agents: ['codex', 'claude', 'opencode', 'gemini'] });
  const by = Object.fromEntries(subs.map(s => [s.agent, s]));
  assert.equal(by.codex.ratioLower, 2); assert.equal(by.codex.ratioUpper, 3.5);
  assert.equal(by.claude.fee, null, 'a zero fee is no fee'); assert.equal(by.claude.ratioLower, null);
  assert.equal(by.gemini.lower, null); assert.equal(by.gemini.ratioLower, null);
  assert.equal(by.opencode.tokens, 0, 'an Agent with a fee and no usage stays listed'); assert.equal(by.opencode.lower, null);
  const items = costTable.table([...rows, row('2026-10-02', 'opencode', 'd', 300, null, null, { unpricedTokens: { 'usage-incomplete': 300 }, incompleteTokens: { 'missing-cacheRead': 300 }, cacheRead: null })]);
  const cov = insights.coverage(items);
  assert.deepEqual(cov.gaps.map(g => [g.code, g.title, g.tokens]), [['incomplete', '来源没有报告完整', 300], ['model-unpriced', '没有价格', 100]]);
  assert.equal(cov.gaps[1].fixable, true); assert.equal(cov.gaps[0].fixable, false);
  assert.equal(cov.range.spread, 30); assert.deepEqual(cov.range.reasons.map(r => r.code), ['context-unreported']);
  const cached = insights.cache(items), d = cached.models.find(m => m.model === 'd');
  assert.equal(d.hitRate, null); assert.equal(d.reported, false, 'an unreported cache read has no rate');
  assert.ok(Math.abs(cached.hitRate - 0.5 / 0.9) < 1e-9, 'overall rate from models reporting both buckets');
});

test('subscription fees persist per Agent and reject anything else', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-subscription-')), source = fixtures(path.join(root, 'home')), dir = path.join(root, 'usage');
  const service = new Service(dir, source.roots);
  try {
    assert.deepEqual(service.get().subscriptions, {});
    assert.deepEqual(service.setSubscription('codex', 20).subscriptions, { codex: 20 });
    service.setSubscription('claude', 99.999);
    const saved = fs.readFileSync(path.join(dir, 'preferences.json'), 'utf8');
    for (const [agent, fee] of [['nobody', 10], ['codex', 0], ['codex', -1], ['codex', Infinity], ['codex', '20'], ['codex', 1e6]]) assert.throws(() => service.setSubscription(agent, fee), /SUBSCRIPTION_INVALID/);
    assert.equal(fs.readFileSync(path.join(dir, 'preferences.json'), 'utf8'), saved, 'a rejected value is not written');
    service.setSubscription('codex', null);
    const restarted = new Service(dir, source.roots);
    assert.deepEqual(restarted.get().subscriptions, { claude: 100 }); await restarted.close();
  } finally { await service.close(); await remove(root); }
});
