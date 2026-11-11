'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { amount, subtract, compare } = require('../../src/quota/amount');
const { projectResources, instant } = require('../../src/quota/resource-contract');
const { fromCodex, toLegacy } = require('../../src/quota/codex-resources');
const { resourceView, FRESH_MS } = require('../../src/quota/resource-state');
const { projectResourceConnections } = require('../../src/quota/resource-connections');
const { NOW, iso, raw, cases } = require('./fixtures/quota-resources');
const ready = { status: 'ready', busy: false, errorCode: null };
const view = (snapshot, account = ready, now = NOW) => resourceView(snapshot, account, now);
function balance(change) { const value = raw(); value.pools[0].balances.push({ id: 'balance', unit: 'credits', ...change }); return projectResources(value); }

test('amounts remain exact beyond float precision; invalid values never become zero', () => {
  assert.equal(amount('00012.3400'), '12.34'); assert.equal(amount(0), '0');
  assert.equal(subtract('9007199254740993.125', '9007199254740993', '0.1'), '0.025');
  assert.equal(compare('9007199254740993', '9007199254740992'), 1);
  for (const value of [null, undefined, '', ' 1', '1e3', '-1', 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'.repeat(37), '0.' + '1'.repeat(19)]) assert.equal(amount(value), null);
  assert.equal(subtract('1', '2'), null); assert.equal(subtract('1', null), null);
  // Independent integer-cent oracle exercises many carries, borrows and scales.
  let seed = 1789;
  for (let i = 0; i < 1000; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0; const total = seed;
    seed = (seed * 1664525 + 1013904223) >>> 0; const used = seed % (total + 1);
    const cents = n => Math.floor(n / 100) + '.' + String(n % 100).padStart(2, '0');
    assert.equal(subtract(cents(total), cents(used)), amount(cents(total - used)));
  }
});

test('normalization is bounded, idempotent, whitelist-only and explicit about subtraction', () => {
  const input = raw(); input.accessToken = 'SECRET'; input.accountId = 'SECRET';
  input.pools[0].balances = [{ id: 'a', unit: 'credits', total: '0.3', used: '0.1', reserved: '0.1', remainingMode: 'total-minus-used-minus-reserved', auth: 'SECRET' }];
  const value = projectResources(input), meter = value.pools[0].balances[0];
  assert.equal(meter.remaining, '0.1'); assert.equal(meter.remainingSource, 'total-minus-used-minus-reserved');
  assert.deepEqual(projectResources(JSON.parse(JSON.stringify(value))), value); assert(!JSON.stringify(value).includes('SECRET'));
  assert.equal(balance({ total: '100', used: '20' }).pools[0].balances[0].remaining, null);
  assert.equal(balance({ total: '100', used: '20', remaining: null, remainingMode: 'total-minus-used' }).pools[0].balances[0].remaining, null);
  const bad = balance({ total: '1', used: '2', remainingMode: 'total-minus-used' });
  assert.equal(bad.pools[0].balances[0].remaining, null); assert(bad.pools[0].balances[0].issues.includes('AMOUNT_CONFLICT'));
  assert.deepEqual(projectResources(bad), bad);
  for (const mutate of [v => { v.pools = {}; }, v => { v.pools.push(v.pools[0]); }, v => { v.pools[0].balances = Array(201).fill({ id: 'x' }); }, v => { v.pools[0].modelIds = [null]; }]) { const v = raw(); mutate(v); assert.equal(projectResources(v), null); }
  assert.equal(instant('2026-02-30T00:00:00Z'), null); assert.equal(instant('2026-10-19 03:00:00'), null);
  assert.equal(instant('2026-10-19T11:00:00+08:00'), iso(0));
  for (const id of Object.keys(require('../../src/m1/agent-catalog').agents)) assert(projectResources(raw(id)), 'provider ID must match the source catalogue: ' + id);
});

test('Codex has actual windows, not plan-name windows; empty/missing/disabled capacity stays distinct', () => {
  const pro = cases.proWeekly(), legacy = toLegacy(pro);
  assert.equal(pro.entitlement.state, 'unknown'); assert.equal(pro.entitlement.validUntil, null);
  assert.deepEqual(legacy.windows.map(w => [w.kind, w.durationMins]), [['primary', 10080]]);
  const fresh = fromCodex({ rateLimits: {} }, iso(0), 'pro'); assert.equal(fresh.pools[0].windows.length, 0); assert.equal(view(fresh).hasMeasurements, false);
  const absent = fromCodex({ rateLimits: null, rateLimitsByLimitId: {} }, iso(0), 'pro'); assert.equal(absent.pools.length, 0); assert.equal(view(absent).hasMeasurements, false); assert.equal(view(absent).partial, true);
  const malformed = fromCodex({ rateLimits: { primary: { usedPercent: NaN, windowDurationMins: Infinity, resetsAt: Infinity } } }, iso(0));
  assert.equal(view(malformed).partial, true); assert.deepEqual(malformed.pools[0].windows[0].issues, ['INVALID_DURATION', 'INVALID_PERCENT', 'INVALID_TIME']);
  assert.deepEqual(projectResources(JSON.parse(JSON.stringify(malformed))), malformed);
  assert.equal(view(balance({ remaining: '0' })).pools[0].balances[0].state, 'exhausted');
  assert.equal(view(balance({ remaining: null })).pools[0].balances[0].state, 'unknown');
  assert.equal(view(balance({ availability: 'unlimited' })).pools[0].balances[0].state, 'unlimited');
  assert.equal(view(balance({ availability: 'disabled', remaining: '100' })).pools[0].balances[0].state, 'disabled');
  for (const raw of [{}, { rateLimitsByLimitId: [] }, { rateLimits: { primary: [] } }, { rateLimitsByLimitId: { a: null } }]) assert.throws(() => fromCodex(raw, iso(0)), /CODEX_PROTOCOL_INVALID/);
});

test('membership end, cancellation, package expiry and reset are independent without mutating observations', () => {
  const packages = cases.packages(), before = JSON.stringify(packages), projected = view(packages), [cycle, gift, purchased] = projected.pools[0].balances;
  assert.equal(projected.entitlement.verificationRequired, true); assert.equal(projected.entitlement.state, 'active');
  assert.equal(cycle.remaining, '0.1'); assert.equal(cycle.freshness.reason, 'entitlement-ended'); assert.equal(cycle.currentlyUsable, null);
  assert.equal(gift.state, 'expired'); assert.equal(gift.remaining, '30'); assert.equal(gift.currentlyUsable, false);
  assert.equal(purchased.state, 'available'); assert.equal(purchased.currentlyUsable, true);
  assert.equal(JSON.stringify(packages), before);
  const cancel = raw(); cancel.entitlement.cancelAt = iso(-1); cancel.pools[0].balances.push({ id: 'cycle', unit: 'credits', remaining: '10', availability: 'available', requiresEntitlement: true });
  assert.equal(view(projectResources(cancel)).pools[0].balances[0].currentlyUsable, true);
  cancel.entitlement.state = 'expired'; assert.equal(view(projectResources(cancel)).pools[0].balances[0].state, 'unavailable');
  const future = view(balance({ remaining: '5', validFrom: iso(1), expiresAt: iso(1000) })); assert.equal(future.pools[0].balances[0].state, 'not-yet-valid');
  const invalid = view(balance({ remaining: '5', validFrom: iso(1000), expiresAt: iso(-1000) })); assert.equal(invalid.partial, true); assert.equal(invalid.pools[0].balances[0].currentlyUsable, null);
  assert.equal(view(balance({ remaining: '5' })).pools[0].balances[0].currentlyUsable, null);
});

test('freshness is per resource; stale resets do not refill, hide sibling pools or sum their capacity', () => {
  const grouped = cases.groupedModels(), projected = view(grouped);
  assert.deepEqual(projected.coverage, { fresh: 1, stale: 1, cached: 0, missing: 0 });
  assert.equal(projected.pools[0].windows[0].remainingPercent, 0); assert.equal(projected.pools[0].windows[0].currentlyUsable, null);
  assert.equal(projected.pools[1].windows[0].remainingPercent, 80); assert.equal(projected.pools[1].windows[0].currentlyUsable, true);
  assert.equal(projected.pools[1].modelIds.length, 2); assert.equal(Object.hasOwn(projected, 'total'), false);
  const credits = cases.creditsOnly(); assert.equal(view(credits).hasMeasurements, true); assert.equal(toLegacy(credits).windows.length, 0);
  assert.equal(view(credits, { ...ready, status: 'cached' }).coverage.cached, 1);
  assert.equal(view(credits, { ...ready, status: 'error', errorCode: 'RATE_LIMITED' }).coverage.cached, 1);
  assert.equal(view(credits, ready, NOW + FRESH_MS + 1).coverage.stale, 1);
  assert.equal(view(credits, ready, NOW - 60001).coverage.missing, 1);
  const availability = view(balance({ unit: 'currency', currency: 'USD', remaining: '25', availability: 'unavailable' })); assert.equal(availability.pools[0].balances[0].currentlyUsable, false);
  assert.equal(view(balance({ unit: 'unknown', remaining: '25' })).partial, true);
});

test('V2 source overview counts credits-only observations without exposing amounts, account labels or identities', () => {
  const accounts = [
    { provider: 'codex', id: 'PRIVATE_ID', alias: 'PRIVATE_ALIAS', plan: 'PRIVATE_PLAN', ...ready, quota: view(cases.creditsOnly()) },
    { provider: 'codex', status: 'cached', quota: view(cases.proWeekly(), { status: 'cached' }) }
  ];
  const result = projectResourceConnections({ catalog: { codex: { name: 'Codex' }, workbuddy: { name: 'WorkBuddy' } }, quota: { accounts }, now: NOW });
  assert.equal(result.schemaVersion, 'SourceConnectionsV2'); assert.deepEqual(result.rows[0].quota.freshness, { fresh: 1, stale: 0, cached: 1, missing: 0 });
  assert.equal(result.rows[1].quota.capability, 'not-integrated');
  for (const privateValue of ['PRIVATE_', '9007199254740993', 'purchased-credits', 'remaining', 'pools']) assert(!JSON.stringify(result).includes(privateValue));
});
