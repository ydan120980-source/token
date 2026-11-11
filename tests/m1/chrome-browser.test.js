'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { EventEmitter } = require('node:events');
const { openChrome, findChrome } = require('../../src/quota/chrome-browser');
const { ProviderQuotaService, installProviderQuota } = require('../../src/quota/provider-service');
const { sites } = require('../../src/quota/provider-website-login');
test('Chrome uses normal daily tabs with argument boundaries, never a debug port or alternate profile', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-discovery-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = path.join(root, 'Google/Chrome/Application/chrome.exe'); fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.writeFileSync(executable, 'fixture');
  assert.equal(findChrome({ ProgramW6432: root }), executable);
  assert.throws(() => findChrome({}), /CHROME_MISSING/);
  let launched, unref = false;
  await openChrome('https://auth.openai.com/oauth/authorize?state=synthetic&scope=one%20two', { environment: { ProgramW6432: root }, launch: (...args) => { launched = args; const child = new EventEmitter(); child.unref = () => { unref = true; }; queueMicrotask(() => child.emit('spawn')); return child; } });
  assert.deepEqual(launched, [executable, ['--new-tab', 'https://auth.openai.com/oauth/authorize?state=synthetic&scope=one%20two'], { shell: false, detached: true, windowsHide: false, stdio: 'ignore' }]); assert(unref);
  for (const url of ['file:///C:/private', 'javascript:alert(1)', 'http://localhost', 'https://user:password@example.com', 'https://example.com:9443', '--load-extension=x']) await assert.rejects(openChrome(url, { launch: () => assert.fail('invalid URL reached browser') }), /ACTION_INVALID/);
  await assert.rejects(openChrome('https://cursor.com', { environment: {} }), /CHROME_MISSING/);
  await assert.rejects(openChrome('https://cursor.com', { executable, launch: () => { const child = new EventEmitter(); queueMicrotask(() => child.emit('error', Error('PRIVATE_NATIVE_ERROR'))); return child; } }), error => error.message === 'PROVIDER_BROWSER_FAILED');
});
test('all website routes open fixed Chrome URLs without creating connections; IPC errors stay recoverable', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-service-')), service = new ProviderQuotaService(root), handlers = {}, visited = [];
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  let fail = false;
  installProviderQuota({ handle: (name, fn) => { handlers[name] = fn; } }, event => event.trusted, service, async url => { if (fail) throw Error('PROVIDER_CHROME_MISSING'); visited.push(url); });
  const invoke = request => handlers['quota:providerWebsiteLogin']({ trusted: true }, request);
  for (const [adapter, site] of Object.entries(sites)) {
    const result = await invoke({ adapter, alias: '合成', id: null, consent: true }); assert(result.ok); assert.equal(visited.at(-1), site.url); assert.equal(result.state.pendingWebsiteLogin, null); assert.equal(result.state.accounts.length, 0);
  }
  for (const request of [{ adapter: 'cursor-web', alias: '合成', id: null, consent: false }, { adapter: 'cursor-web', alias: '合成', id: null, consent: true, url: 'https://evil.invalid' }, { adapter: 'deepseek-api', alias: '合成', id: null, consent: true }]) assert.equal((await invoke(request)).errorCode, 'PROVIDER_ACTION_INVALID');
  assert.equal(visited.length, Object.keys(sites).length);
  await assert.rejects(handlers['quota:providerWebsiteLogin']({ trusted: false }, {}), /SENDER_REJECTED/);
  fail = true; assert.equal((await invoke({ adapter: 'cursor-web', alias: '合成', id: null, consent: true })).errorCode, 'PROVIDER_CHROME_MISSING');
  fail = false; assert((await invoke({ adapter: 'cursor-web', alias: '合成', id: null, consent: true })).ok);
  service.fixture = true; assert.equal((await invoke({ adapter: 'cursor-web', alias: '合成', id: null, consent: true })).errorCode, 'PROVIDER_FIXTURE_BLOCKED');
});
test('manual browser context is adapter-bound, validates WorkBuddy UA and replaces organization context on token change', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-context-')), contexts = [];
  const { projectResources } = require('../../src/quota/resource-contract'), { routes } = require('../../src/quota/provider-catalog');
  const service = new ProviderQuotaService(root, { run: async (adapter, _token, _signal, context) => { contexts.push(context); return projectResources({ schemaVersion: 'AccountQuotaV2', provider: routes[adapter].provider, fetchedAt: new Date().toISOString(), provenance: { kind: 'synthetic' }, entitlement: {}, pools: [{ id: 'fixture', scope: 'account', windows: [{ id: 'window', unit: 'percent', usedPercent: 10 }], balances: [] }] }); } });
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const request = { adapter: 'workbuddy-web', alias: '合成', credential: 'own_session=SYNTHETIC_TOKEN' };
  for (const fields of [{}, { userAgent: '' }, { userAgent: 'bad\r\nInjected: value' }, { userAgent: 'Synthetic Chrome/150', workspace: 'wrk_foreign' }]) await assert.rejects(service.connect({ ...request, ...fields }), /ACTION_INVALID/);
  await service.connect({ ...request, userAgent: 'Synthetic Chrome/150' }); await service.tail; assert.deepEqual(contexts.at(-1), { userAgent: 'Synthetic Chrome/150' });
  const organization = '11111111-2222-4333-8444-555555555555';
  await service.connect({ adapter: 'claude-web', alias: '合成', credential: 'sessionKey=SYNTHETIC_TOKEN', organization }); await service.tail; assert.deepEqual(contexts.at(-1), { organization });
  const row = service.rows.at(-1); await service.supply(row.id, 'sessionKey=SYNTHETIC_OTHER'); await service.tail; assert.equal(contexts.at(-1), undefined);
  await assert.rejects(service.connect({ ...request, adapter: 'cursor-web', credential: 'WorkosCursorSessionToken=SYNTHETIC_TOKEN', organization }), /ACTION_INVALID/);
  await service.connect({ adapter: 'opencode-web', alias: '合成', credential: '__Host-auth=SYNTHETIC_TOKEN', workspace: 'wrk_selected' }); await service.tail; assert.deepEqual(contexts.at(-1), { workspace: 'wrk_selected' });
  assert(!JSON.stringify(service.state()).includes('wrk_selected'));
});
