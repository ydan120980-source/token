'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict');
const { adapters } = require('../../src/quota/provider-adapters');
const { routes } = require('../../src/quota/provider-catalog');
const { fromProvider } = require('../../src/quota/provider-resources');
const { observeProvider } = require('../../src/quota/provider-observation');
const baseline = require('./fixtures/provider-adapter-parity.json');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ProviderQuotaService } = require('../../src/quota/provider-service');
const { remove } = require('./temp');

test('all existing HTTP adapters retain baseline exact resources, labels, unknowns and coverage', () => {
  assert.deepEqual(Object.keys(adapters).sort(), Object.entries(routes).filter(([, route]) => route.url).map(([id]) => id).sort());
  assert.deepEqual(baseline.rows.map(row => row.adapter).sort(), Object.keys(adapters).sort());
  for (const row of baseline.rows) {
    const raw = structuredClone(row.raw);
    assert.deepEqual(fromProvider(row.adapter, raw, row.fetchedAt, row.options), row.expected, row.adapter);
    assert.deepEqual(raw, row.raw, 'parser must not mutate raw input');
  }
  assert.throws(() => fromProvider('constructor', {}, baseline.rows[0].fetchedAt), /RESPONSE_INVALID/);
});

test('OAuth adapter uses its usage endpoint directly while website scope selection stays explicit', async () => {
  const calls = [], signal = new AbortController().signal;
  const oauth = await observeProvider('claude-oauth', 'PRIVATE_CREDENTIAL', { signal }, { transport: async (...args) => { calls.push(args); return { five_hour: { utilization: 20 } }; } });
  assert.equal(calls.length, 1);
  assert.equal(oauth.identityContext, undefined);
  assert.equal(oauth.resources.pools[0].windows[0].remainingPercent, 80);
  const org = '11111111-2222-4333-8444-555555555555';
  calls.length = 0;
  const web = await observeProvider('claude-web', 'PRIVATE_CREDENTIAL', { signal }, { transport: async (_adapter, _credential, options) => { calls.push(options); return options.organization ? { five_hour: { utilization: 30 } } : [{ uuid: org }]; } });
  assert.equal(calls.length, 2);
  assert.deepEqual(web.identityContext, { organization: org });
  assert(!JSON.stringify(web.resources).includes(org));
  await assert.rejects(observeProvider('claude-web', 'PRIVATE_CREDENTIAL', { signal }, { transport: async () => [{ uuid: org }, { uuid: 'aaaaaaaa-2222-4333-8444-555555555555' }] }), /ORGANIZATION_REQUIRED/);
});

test('Google bootstrap, WorkBuddy bounded paginator and optional MiMo parts keep their distinct contracts', async () => {
  const signal = new AbortController().signal, calls = [];
  const gemini = await observeProvider('gemini-code-assist', 'PRIVATE_CREDENTIAL', { signal, project: { discover: true } }, {
    transport: async (_adapter, _credential, options) => { calls.push(options); return options.part ? { cloudaicompanionProject: 'synthetic-project' } : { buckets: [{ modelId: 'synthetic', tokenType: 'REQUESTS', remainingFraction: .5 }] }; }
  });
  assert.equal(calls[1].project, 'synthetic-project');
  assert.equal(gemini.identityContext, 'synthetic-project');
  const buddyRaw = baseline.rows.find(row => row.adapter === 'workbuddy-desktop').raw;
  let pages = 0;
  const buddy = await observeProvider('workbuddy-desktop', 'PRIVATE_CREDENTIAL', { signal }, { transport: () => assert.fail('must use paginator'), packages: async () => { pages++; return { raw: buddyRaw, completePackages: true }; } });
  assert.equal(pages, 1); assert.equal(buddy.resources.incomplete, false);
  const transport = async (_adapter, _credential, options) => { if (options.part) throw Error('PROVIDER_TIMEOUT'); return { code: 0, data: { currency: 'CNY', balance: '1.25' } }; };
  const mimo = await observeProvider('mimo-web', 'PRIVATE_CREDENTIAL', { signal }, { transport });
  assert.equal(mimo.resources.incomplete, true);
  assert.equal(mimo.resources.pools[0].balances[0].remaining, '1.25');
  await assert.rejects(observeProvider('mimo-web', 'PRIVATE_CREDENTIAL', { signal }, { transport: async (...args) => { if (args[2].part) throw Error('PROVIDER_AUTH_REQUIRED'); return transport(...args); } }), /AUTH_REQUIRED/);
});

test('provider diagnostics retain only bounded categories and never initiate another request', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-metrics-'));
  t.after(() => remove(root));
  let failed = false, calls = 0;
  const row = baseline.rows.find(row => row.adapter === 'deepseek-api');
  const service = new ProviderQuotaService(root, { now: () => Date.parse(row.fetchedAt), run: async () => {
    calls++; if (failed) throw Error('PROVIDER_RATE_LIMITED'); return row.expected;
  } });
  t.after(() => service.close());
  await service.connect({ adapter: row.adapter, alias: 'PRIVATE_ALIAS', credential: 'PRIVATE_CREDENTIAL' });
  await service.tail; // Connect schedules its first read; it does not await it.
  const id = service.rows[0].id;
  failed = true; await service.refresh(id); await service.refresh(id);
  const metrics = service.diagnostics();
  assert.equal(calls, 2);
  assert.equal(metrics.counters.success, 1); assert.equal(metrics.counters.failed, 1);
  assert.equal(metrics.counters.rateLimited, 1); assert.equal(metrics.counters.skipped, 1);
  assert(!/PRIVATE_|provider-metrics|balance_infos/.test(JSON.stringify(metrics)));
  metrics.counters.success = 100;
  assert.equal(service.diagnostics().counters.success, 1);
});
