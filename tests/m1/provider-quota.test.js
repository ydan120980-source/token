'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { fromProvider } = require('../../src/quota/provider-resources');
const { readProvider } = require('../../src/quota/provider-http');
const { quotaJSON } = require('../../src/quota/quota-json');
const { normalizeCredential } = require('../../src/quota/provider-credentials');
const { ProviderQuotaService, installProviderQuota, runWorker } = require('../../src/quota/provider-service');
const { remove } = require('./temp');
const NOW = Date.parse('2026-10-19T12:00:00Z'), at = new Date(NOW).toISOString();
const balance = () => fromProvider('deepseek-api', { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '9007199254740993.125', granted_balance: '0.125', topped_up_balance: '9007199254740993' }] }, at);
test('actual isolated quota worker rejects unknown capabilities without any network request', async () => {
  await assert.rejects(runWorker('not-a-provider', 'synthetic-secret-key', new AbortController().signal), /PROVIDER_CREDENTIAL_REQUIRED/);
});
test('provider resources preserve exact balances, overlap and availability, without guessing entitlement', () => {
  const value = balance(); assert.equal(value.pools[0].balances[0].remaining, '9007199254740993.125'); assert.equal(value.entitlement.state, 'unknown'); assert.equal(value.entitlement.validUntil, null);
  const blocked = fromProvider('deepseek-api', { is_available: false, balance_infos: [{ currency: 'USD', total_balance: '8.2' }] }, at); assert.equal(blocked.pools[0].balances[0].availability, 'unavailable');
  const points = fromProvider('workbuddy-credit', { total_capacity_size: 100, total_capacity_used: 25 }, at); assert.equal(points.pools[0].balances[0].remaining, '75'); assert.equal(points.pools[0].balances[0].expiresAt, null);
  const conflict = fromProvider('workbuddy-credit', { total_capacity_size: 10, total_capacity_used: 20 }, at); assert.equal(conflict.pools[0].balances[0].remaining, null); assert(conflict.pools[0].balances[0].issues.includes('AMOUNT_CONFLICT'));
  assert.throws(() => fromProvider('workbuddy-credit', { total_capacity_size: 9007199254740992, total_capacity_used: 0 }, at));
  assert.throws(() => fromProvider('deepseek-api', { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '1' }, { currency: 'CNY', total_balance: '2' }] }, at));
});
test('Go windows and regional experimental limits retain resets and unknown fields', () => {
  const value = fromProvider('opencode-go', { usage: { rolling: { status: 'ok', percent: 40, resetsAt: '2026-10-19T13:00:00Z' }, monthly: { status: 'rate-limited', percent: 60 } } }, at);
  assert.equal(value.pools[0].windows.length, 2); assert.equal(value.pools[0].windows[1].durationMins, null); assert.equal(value.pools[0].windows[1].availability, 'unavailable');
  assert.throws(() => fromProvider('opencode-go', { usage: {} }, at), /QUOTA_UNAVAILABLE/);
  assert.throws(() => fromProvider('opencode-go', { usage: { rolling: { percent: 150, status: 'ok' } } }, at));
  const zai = fromProvider('zai-cn', { code: 200, data: { limits: [{ type: 'CREDIT_LIMIT', percentage: 0, nextResetTime: NOW + 1000 }, { type: 'NEW_UNKNOWN', percentage: 9 }] } }, at);
  assert.equal(zai.provenance.kind, 'undocumented-api'); assert.equal(zai.pools.length, 1); assert.equal(zai.pools[0].windows[0].usedPercent, 0); assert.equal(zai.pools[0].windows[0].durationMins, null);
  assert.throws(() => fromProvider('zai-global', { data: { limits: [] } }, at), /QUOTA_UNAVAILABLE/);
});
function transport(status, body, capture, delay = 0) {
  return (url, options, callback) => {
    capture.push({ url, options }); const request = new EventEmitter(); request.destroy = () => {};
    setTimeout(() => { const response = new EventEmitter(); response.statusCode = status; response.destroy = () => {}; callback(response); if (status === 200) { response.emit('data', Buffer.from(body)); response.emit('end'); } }, delay); return request;
  };
}
test('quota transport fixes GET endpoint and auth scope, refuses redirects, limits, timeouts and aborts', async () => {
  const calls = [], key = 'synthetic-secret-key';
  assert.deepEqual(await readProvider('workbuddy-credit', key, { get: transport(200, '{"total_capacity_size":10}', calls) }), { total_capacity_size: '10' });
  assert.equal(calls[0].url, 'https://www.workbuddy.cn/openapi/v2/credit'); assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + key);
  for (const [status, code] of [[301, 'REDIRECT_REJECTED'], [401, 'AUTH_REQUIRED'], [403, 'ACCESS_DENIED'], [429, 'RATE_LIMITED'], [500, 'REQUEST_FAILED']]) await assert.rejects(readProvider('deepseek-api', key, { get: transport(status, key, []) }), error => error.message === 'PROVIDER_' + code && !error.message.includes(key));
  await assert.rejects(readProvider('deepseek-api', key, { get: transport(200, 'x'.repeat(524289), []) }), /OUTPUT_LIMIT/);
  await assert.rejects(readProvider('zai-cn', key, { get: transport(200, '{}', [], 20), timeoutMs: 1 }), /TIMEOUT/);
  await assert.rejects(readProvider('https://evil.invalid', key), /CREDENTIAL_REQUIRED/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(readProvider('deepseek-api', key, { signal: abort.signal }), /CANCELED/);
});

test('manual cookies discard foreign fields, reject ambiguous identities and never become bearer auth', async () => {
  const mimo = 'Cookie: api-platform_serviceToken=synthetic-token; userId=synthetic-user; tracking=PRIVATE_FOREIGN_VALUE';
  assert.equal(normalizeCredential('mimo-web', mimo), 'api-platform_serviceToken=synthetic-token; userId=synthetic-user');
  assert.equal(normalizeCredential('mimo-web', 'api-platform_serviceToken=token'), null);
  assert.equal(normalizeCredential('cursor-web', 'WorkosCursorSessionToken=a; next-auth.session-token=b'), null);
  assert.equal(normalizeCredential('cursor-web', 'WorkosCursorSessionToken=a\r\nx=y'), null);
  const calls = []; await readProvider('mimo-web', mimo, { get: transport(200, '{}', calls), part: 'usage' });
  assert.equal(calls[0].url, 'https://platform.xiaomimimo.com/api/v1/tokenPlan/usage');
  assert.equal(calls[0].options.headers.Authorization, undefined); assert(!calls[0].options.headers.Cookie.includes('FOREIGN'));
  await assert.rejects(readProvider('cursor-web', 'WorkosCursorSessionToken=synthetic-token', { part: 'https://evil.invalid' }), /ACTION_INVALID/);
});

test('Google quota uses only fixed read-only POST with explicit project, never an API key inference call', async () => {
  const calls = []; let posted;
  const post = (...args) => { const request = transport(200, '{"buckets":[]}', calls)(...args); request.end = body => { posted = body; }; return request; };
  await readProvider('gemini-code-assist', 'synthetic-oauth-token', { post, project: 'synthetic-project' });
  assert.equal(calls[0].url, 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota'); assert.equal(calls[0].options.method, 'POST'); assert.deepEqual(JSON.parse(posted), { project: 'synthetic-project' });
  await assert.rejects(readProvider('gemini-code-assist', 'synthetic-oauth-token', { post, project: '../bad' }), /ACTION_INVALID/); assert.equal(calls.length, 1);
});

test('numeric JSON lexemes preserve fractional money and huge credit counts before rounding', () => {
  const raw = quotaJSON('{"used":9007199254740993.125,"limit":9007199254740994.125,"balance":0.29,"autoPercentUsed":0.36}');
  assert.equal(raw.used, '9007199254740993.125'); assert.equal(raw.balance, '0.29'); assert.equal(raw.autoPercentUsed, 0.36);
  const value = fromProvider('cursor-web', { membershipType: 'pro', individualUsage: { plan: { ...raw } } }, at);
  const budget = value.pools.find(pool => pool.id === 'plan-budget').windows[0]; assert.equal(budget.used, '90071992547409.93125'); assert.equal(budget.remaining, '0.01');
  assert.equal(value.pools.find(pool => pool.id === 'auto').windows[0].usedPercent, 0.36); assert.equal(value.incomplete, true);
});

test('Gemini pools remain per model and unit; MiMo membership expiry never expires independent API money', () => {
  const gemini = fromProvider('gemini-code-assist', { buckets: [{ modelId: 'gemini-pro', tokenType: 'REQUESTS', remainingAmount: '9007199254740993', remainingFraction: 0.5, resetTime: '2026-10-20T00:00:00Z' }, { modelId: 'gemini-flash', tokenType: 'NEW_UNIT', remainingAmount: '10' }] }, at);
  assert.equal(gemini.pools.length, 2); assert.equal(gemini.pools[0].windows[0].remainingPercent, 50); assert.equal(gemini.pools[0].windows[1].remaining, '9007199254740993'); assert.equal(gemini.pools[1].windows[0].unit, 'unknown');
  assert.throws(() => fromProvider('gemini-code-assist', { buckets: [{ modelId: 'gemini', tokenType: 'REQUESTS', remainingFraction: 2 }] }, at));
  const raw = { balance: { code: 0, data: { balance: '5.5', currency: 'CNY' } }, plan: { code: 0, data: { planCode: 'TOKEN_PLAN', expired: true, currentPeriodEnd: '2026-10-18 12:00:00' } }, usage: { code: 0, data: { monthUsage: { items: [{ name: 'credits', used: '10', limit: '100' }] } } } };
  const value = fromProvider('mimo-web', raw, at); assert.equal(value.entitlement.state, 'expired'); assert.equal(value.entitlement.validUntil, null); assert(value.entitlement.issues.includes('INVALID_TIME')); assert.equal(value.pools[0].balances[0].requiresEntitlement, false); assert.equal(value.pools[1].windows[0].requiresEntitlement, true); assert.equal(value.pools[1].windows[0].remaining, '90');
  const view = require('../../src/quota/resource-state').resourceView(value, { status: 'ready' }, NOW);
  assert.equal(view.pools[1].windows[0].state, 'unavailable'); assert.equal(view.pools[1].windows[0].remaining, '90'); assert.equal(view.pools[0].balances[0].remaining, '5.5'); assert.equal(view.pools[0].balances[0].freshness.state, 'fresh');
  assert.equal(fromProvider('mimo-web', { balance: raw.balance }, at).incomplete, true);
  assert.throws(() => fromProvider('mimo-web', { ...raw, usage: { code: 401 } }, at), /AUTH_REQUIRED/);
});

test('Google context and normalized cookies stay in memory and disappear on removal/auth failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-provider-context-')); const calls = [];
  const service = new ProviderQuotaService(root, { now: () => NOW, run: async (adapter, token, _signal, project) => { calls.push({ adapter, token, project }); if (adapter === 'gemini-code-assist') return fromProvider(adapter, { buckets: [{ modelId: 'gemini', tokenType: 'REQUESTS', remainingAmount: '9' }] }, at); return fromProvider(adapter, { individualUsage: { plan: { totalPercentUsed: 25 } } }, at); } });
  try {
    await service.connect({ adapter: 'gemini-code-assist', alias: 'Google', credential: 'synthetic-oauth-token', project: 'private-google-project' }); await service.tail;
    const id = service.rows[0].id; assert.equal(calls[0].project, 'private-google-project'); assert(!fs.readFileSync(service.file, 'utf8').includes('private-google-project')); assert(!JSON.stringify(service.state()).includes('synthetic-oauth-token'));
    service.remove(id); assert.equal(service.contexts.size, 0); assert.equal(service.secrets.size, 0);
    await service.connect({ adapter: 'cursor-web', alias: 'Cursor', credential: 'WorkosCursorSessionToken=synthetic-token; foreign=PRIVATE_FOREIGN' }); await service.tail; assert.equal(calls[1].token, 'WorkosCursorSessionToken=synthetic-token');
    service.run = async () => { throw Error('PROVIDER_AUTH_REQUIRED'); }; await service.refresh(service.rows[0].id); assert.equal(service.secrets.size, 0);
  } finally { await service.close(); await remove(root); }
});
test('connections persist no credentials, retain last success on failure, restart without network, and require fresh explicit credentials', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-provider-')); let now = NOW, calls = 0, error = null;
  const service = new ProviderQuotaService(root, { now: () => now, run: async () => { calls++; if (error) throw new Error(error); return balance(); } });
  try {
    await service.connect({ adapter: 'deepseek-api', alias: 'API 账号', credential: 'synthetic-secret-key' }); await service.tail; const state = service.state(), id = state.accounts[0].id;
    assert.equal(state.accounts[0].quota.pools[0].balances[0].freshness.state, 'fresh'); assert(!JSON.stringify(state).includes('synthetic-secret-key')); assert(!fs.readFileSync(service.file, 'utf8').includes('synthetic-secret-key'));
    error = 'PROVIDER_RATE_LIMITED'; now += 1000; await service.refresh(id); assert.equal(service.state().accounts[0].quota.fetchedAt, at); assert.equal(service.state().accounts[0].quota.pools[0].balances[0].freshness.state, 'cached');
    await service.refresh(id); assert.equal(calls, 2);
    const restarted = new ProviderQuotaService(root, { now: () => now, run: () => assert.fail('startup network') }); assert.equal(restarted.state().accounts[0].credentialReady, false); assert.equal(restarted.state().accounts[0].status, 'cached'); assert.throws(() => restarted.refresh(id), /CREDENTIAL_REQUIRED/); await restarted.close();
    error = 'PROVIDER_AUTH_REQUIRED'; now += 16 * 60000; await service.refresh(id); assert.equal(service.state().accounts[0].credentialReady, false); assert.equal(service.state().accounts[0].quota.entitlement.state, 'unknown');
  } finally { await service.close(); await remove(root); }
});
test('storage failure does not publish fetched quota and removal cannot resurrect in-flight connections', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-provider-race-')); let release;
  const service = new ProviderQuotaService(root, { now: () => NOW, run: () => new Promise(resolve => { release = resolve; }) });
  try {
    const pending = service.connect({ adapter: 'deepseek-api', alias: 'test', credential: 'synthetic-secret-key' });
    await new Promise(resolve => setImmediate(resolve)); const id = service.rows[0].id;
    service.remove(id); release(balance()); await pending; await service.tail; assert.equal(service.state().accounts.length, 0); assert.equal(JSON.parse(fs.readFileSync(service.file)).connections.length, 0);
    const next = service.connect({ adapter: 'deepseek-api', alias: 'save fail', credential: 'synthetic-secret-key' }); await new Promise(resolve => setImmediate(resolve));
    const persist = service.persist.bind(service); service.persist = () => { throw new Error('PROVIDER_STORAGE_FAILED'); }; release(balance()); await next; await service.tail;
    assert.equal(service.state().accounts[0].quota, null); assert.equal(service.state().accounts[0].errorCode, 'PROVIDER_STORAGE_FAILED'); service.persist = persist;
  } finally { await service.close(); await remove(root); }
});
test('sender-guarded capability getters are memory-only and arbitrary IPC endpoints/credential extras rejected', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-provider-ipc-')), service = new ProviderQuotaService(root), handlers = new Map();
  try {
    installProviderQuota({ handle: (channel, callback) => handlers.set(channel, callback) }, event => event.allowed, service, () => assert.fail('unexpected browser'));
    await assert.rejects(handlers.get('quota:providers')({ allowed: false }), /SENDER_REJECTED/);
    const result = await handlers.get('quota:providers')({ allowed: true }); assert.equal(result.state.capabilities.filter(row => row.mode !== 'planned').length, 10); assert(result.state.capabilities.filter(row => row.mode === 'planned').every(row => row.adapters.length === 0)); assert.equal(result.state.accounts.length, 0); assert.equal(fs.existsSync(service.file), false);
    const denied = await handlers.get('quota:providerConnect')({ allowed: true }, { adapter: 'deepseek-api', alias: 'test', credential: 'synthetic-secret-key', url: 'https://evil.invalid' }); assert.equal(denied.ok, false); assert.equal(service.state().accounts.length, 0);
  } finally { await service.close(); await remove(root); }
});
