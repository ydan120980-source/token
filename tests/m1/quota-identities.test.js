'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ConnectionIdentities } = require('../../src/quota/connection-identities');
const { routes } = require('../../src/quota/provider-catalog');
const { ProviderQuotaService } = require('../../src/quota/provider-service');
const { fromProvider } = require('../../src/quota/provider-resources');
const { remove } = require('./temp');
const at = '2026-10-22T00:00:00.000Z', now = () => Date.parse(at);
const organization = '11111111-2222-4333-8444-555555555555';
const quota = () => fromProvider('deepseek-api', { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '10' }] }, at);
const desktop = (uid = 'PRIVATE_USER', enterpriseId = 'PRIVATE_ENTERPRISE') => ({ desktop: { uid, enterpriseId, domain: 'copilot.tencent.com' } });
async function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-synthetic-'));
  const service = new ProviderQuotaService(root, { now, run: async () => quota(), ...options });
  t.after(async () => { await service.close(); await remove(root); }); return { service, root };
}
const connect = async (service, credential = 'PRIVATE_KEY', adapter = 'deepseek-api', extra = {}) => {
  await service.connect({ adapter, alias: 'synthetic', credential, ...extra }); await service.tail; return service.rows.at(-1).id;
};

test('every adapter has conservative memory-only duplicate fields with explicit evidence coverage', () => {
  const identities = new ConnectionIdentities();
  for (const [adapter, route] of Object.entries(routes)) {
    const context = adapter === 'workbuddy-desktop' ? desktop() : adapter === 'zcode-device' ? { zcode: { userId: 'PRIVATE_USER', deviceMid: organization } } : adapter === 'opencode-zen' ? { console: { orgId: 'org_SYNTHETIC' } } : adapter === 'claude-web' ? { organization } : adapter === 'opencode-web' ? { workspace: 'wrk_SYNTHETIC' } : adapter === 'gemini-code-assist' ? 'private-project' : null;
    const token = adapter === 'mimo-web' ? 'api-platform_serviceToken=PRIVATE_KEY; userId=PRIVATE_ID' : route.kind === 'cookie' ? (adapter === 'claude-web' ? 'sessionKey=PRIVATE_KEY' : adapter === 'cursor-web' ? 'WorkosCursorSessionToken=PRIVATE_KEY' : 'auth=PRIVATE_KEY') : 'PRIVATE_KEY';
    identities.observe('one', adapter, token, context); identities.observe('two', adapter, token, context);
    const view = identities.view('one'), supported = !['passive', 'local-report'].includes(route.kind);
    assert.equal(view.duplicateKnown, supported, adapter); assert.deepEqual(view.duplicateAccountIds, supported ? ['two'] : [], adapter);
    assert.equal(view.identityStatus === 'unknown', !supported, adapter);
    identities.forget('one'); identities.forget('two');
  }
  assert.deepEqual(identities.view('missing'), { identityStatus: 'unknown', duplicateKnown: false, duplicateAccountIds: [] }); identities.clear();
});

test('client account evidence survives token rotation but separates accounts, organizations and regions', () => {
  const identities = new ConnectionIdentities();
  identities.observe('a', 'workbuddy-desktop', 'PRIVATE_TOKEN_A', desktop()); identities.observe('b', 'workbuddy-desktop', 'PRIVATE_TOKEN_B', desktop());
  assert.equal(identities.view('a').identityStatus, 'client-bound'); assert.deepEqual(identities.view('a').duplicateAccountIds, ['b']);
  for (const context of [desktop('OTHER_USER'), desktop('PRIVATE_USER', 'OTHER_ENTERPRISE'), { desktop: { uid: 'PRIVATE_USER', domain: 'www.workbuddy.ai' } }, null]) {
    identities.observe('b', 'workbuddy-desktop', 'PRIVATE_TOKEN_B', context); assert.equal(identities.view('a').duplicateKnown, false);
  }
  identities.observe('c', 'workbuddy-web', 'auth=PRIVATE_TOKEN_A', null); assert.equal(identities.view('a').duplicateKnown, false, 'web and desktop identity namespaces are not guessed');
  identities.observe('a', 'cursor-web', 'WorkosCursorSessionToken=PRIVATE_A', { cursor: { subject: 'PRIVATE_SUBJECT' } }); identities.observe('b', 'cursor-web', 'WorkosCursorSessionToken=PRIVATE_B', { cursor: { subject: 'PRIVATE_SUBJECT' } }); assert.equal(identities.view('a').duplicateKnown, true);
  identities.observe('a', 'zcode-device', 'PRIVATE_TOKEN_A', { zcode: { userId: 'PRIVATE_USER', deviceMid: organization } }); identities.observe('b', 'zcode-device', 'PRIVATE_TOKEN_B', { zcode: { userId: 'PRIVATE_USER', deviceMid: organization.replace(/^1/, 'a') } }); assert.equal(identities.view('a').duplicateKnown, true);
  identities.observe('a', 'opencode-zen', 'PRIVATE_TOKEN_A', { console: { orgId: 'org_SYNTHETIC' } }); identities.observe('b', 'opencode-zen', 'PRIVATE_TOKEN_B', { console: { orgId: 'org_SYNTHETIC' } }); assert.equal(identities.view('a').duplicateKnown, false, 'shared workspace is not a shared person');
  identities.clear();
});

test('credential equality is scoped, cookie order independent, and different tokens do not prove different accounts', () => {
  const identities = new ConnectionIdentities();
  identities.observe('a', 'mimo-web', 'userId=PRIVATE_ID; api-platform_serviceToken=PRIVATE_TOKEN', null); identities.observe('b', 'mimo-web', 'api-platform_serviceToken=PRIVATE_TOKEN; userId=PRIVATE_ID', null);
  assert.equal(identities.view('a').duplicateKnown, true); assert.equal(identities.view('a').identityStatus, 'credential-match');
  identities.observe('a', 'zai-cn', 'PRIVATE_KEY', null); identities.observe('b', 'zai-global', 'PRIVATE_KEY', null); assert.equal(identities.view('a').duplicateKnown, false);
  for (const adapter of ['claude-web', 'opencode-web', 'gemini-code-assist']) { identities.observe('a', adapter, adapter === 'claude-web' ? 'sessionKey=PRIVATE_KEY' : adapter === 'opencode-web' ? 'auth=PRIVATE_KEY' : 'PRIVATE_KEY', null); assert.equal(identities.view('a').identityStatus, 'unknown', adapter); }
  identities.observe('a', 'gemini-code-assist', 'PRIVATE_KEY', 'private-project-a'); identities.observe('b', 'gemini-code-assist', 'PRIVATE_KEY', 'private-project-b'); assert.equal(identities.view('a').duplicateKnown, false);
  identities.clear();
});

test('service publishes identity only after valid saved observations; getters/cache never reveal keys or digests', async t => {
  const { service, root } = await setup(t); const a = await connect(service), b = await connect(service), c = await connect(service, 'OTHER_PRIVATE_KEY');
  const state = service.state(); assert.deepEqual(state.accounts.find(row => row.id === a).duplicateAccountIds, [b]); assert.equal(state.accounts.find(row => row.id === c).duplicateKnown, false);
  state.accounts[0].duplicateAccountIds.push('MUTATION'); assert.deepEqual(service.state().accounts[0].duplicateAccountIds, [b]);
  const digest = service.identities.entries.get(a).digest;
  for (const value of [JSON.stringify(service.state()), fs.readFileSync(service.file, 'utf8')]) assert(!/PRIVATE_KEY|identityContext|digest/.test(value) && !value.includes(digest));
  const before = fs.readFileSync(service.file); service.state(); service.state(); assert.deepEqual(fs.readFileSync(service.file), before);
  const restored = new ProviderQuotaService(root, { now, run: () => assert.fail('restart network') }); t.after(() => restored.close()); assert(restored.state().accounts.every(row => !row.duplicateKnown && row.identityStatus === 'unknown'));
  const persist = service.persist.bind(service); let saves = 0;
  service.persist = rows => { if (++saves === 2) throw Error('PROVIDER_STORAGE_FAILED'); return persist(rows); };
  const failed = await connect(service); assert.equal(service.state().accounts.find(row => row.id === failed).errorCode, 'PROVIDER_STORAGE_FAILED'); assert.equal(service.identities.entries.has(failed), false);
});

test('credential replacement, auth errors, removal, cancellation and close cannot retain or resurrect duplicate membership', async t => {
  const { service } = await setup(t); const a = await connect(service), b = await connect(service);
  let resolve; service.run = () => new Promise(done => { resolve = done; });
  await service.supply(a, 'REPLACED_PRIVATE_KEY'); assert.equal(service.state().accounts.find(row => row.id === b).duplicateKnown, false);
  service.cancel(a); resolve(quota()); await service.tail; assert.equal(service.identities.entries.has(a), false);
  service.rows.find(row => row.id === a).nextRefreshAt = null; service.run = async () => quota(); await service.supply(a, 'PRIVATE_KEY'); await service.tail; assert.equal(service.state().accounts.find(row => row.id === b).duplicateKnown, true);
  service.run = async () => { throw Error('PROVIDER_AUTH_REQUIRED'); }; await service.refresh(a); assert.equal(service.state().accounts.find(row => row.id === b).duplicateKnown, false);
  service.remove(b); assert.equal(service.identities.entries.size, 0);
  service.run = () => new Promise(done => { resolve = done; }); const pending = connect(service); await new Promise(done => setImmediate(done)); const late = service.rows.at(-1).id; service.remove(late); resolve(quota()); await pending; assert.equal(service.identities.entries.size, 0);
  await service.close(); assert.equal(service.identities.entries.size, 0);
});

test('worker-selected private scope is used only for memory matching and never enters quota/cache', async t => {
  const selected = { organization };
  const resources = fromProvider('claude-web', { five_hour: { utilization: 20 } }, at);
  const { service } = await setup(t, { run: async () => ({ resources, identityContext: selected }) });
  const a = await connect(service, 'sessionKey=PRIVATE_KEY', 'claude-web'), b = await connect(service, 'sessionKey=PRIVATE_KEY', 'claude-web');
  assert.deepEqual(service.state().accounts.find(row => row.id === a).duplicateAccountIds, [b]);
  for (const value of [JSON.stringify(service.state()), fs.readFileSync(service.file, 'utf8')]) assert(!value.includes(organization));
  selected.organization = 'aaaaaaaa-2222-4333-8444-555555555555'; await service.refresh(b); assert.equal(service.state().accounts.find(row => row.id === a).duplicateKnown, false);
});

test('client login validates before grouping, rollback retains old identity and changed-client errors clear membership', async t => {
  const vault = new Map(), secretStore = { available: () => true, get: id => vault.get(id), snapshot: id => vault.get(id) || null, restore: (id, value) => value ? vault.set(id, value) : vault.delete(id), put: (id, _adapter, credential, expiresAt, context) => vault.set(id, { credential, expiresAt, context }), remove: id => vault.delete(id) };
  let context = desktop(), token = 'PRIVATE_TOKEN_A';
  const resources = () => fromProvider('workbuddy-desktop', { code: 0, data: { Response: { Data: { Accounts: [{ CapacityType: 1, CapacityRemain: '10' }] } } } }, at);
  const { service } = await setup(t, { secretStore, clientLogin: async () => ({ credential: token, context }), run: async () => resources() });
  const request = { adapter: 'workbuddy-desktop', alias: 'synthetic', consent: true, id: null };
  await service.loginWebsite(request, true); const a = service.rows[0].id; token = 'PRIVATE_TOKEN_B'; await service.loginWebsite(request, true); const b = service.rows[1].id;
  assert.deepEqual(service.state().accounts[0].duplicateAccountIds, [b]);
  for (const value of [JSON.stringify(service.state()), fs.readFileSync(service.file, 'utf8')]) assert(!/PRIVATE_USER|PRIVATE_ENTERPRISE|PRIVATE_TOKEN/.test(value));
  const persist = service.persist.bind(service), savedQuota = service.rows[0].quota;
  service.persist = () => { throw Error('PROVIDER_STORAGE_FAILED'); }; context = desktop('OTHER_USER'); token = 'PRIVATE_TOKEN_C';
  await assert.rejects(service.loginWebsite({ ...request, id: a }, true), /STORAGE_FAILED/); assert.equal(service.rows[0].quota, savedQuota); assert.equal(vault.get(a).credential, 'PRIVATE_TOKEN_A'); assert.equal(service.state().accounts[0].duplicateKnown, true); service.persist = persist;
  service.prepare = async () => { throw Error('PROVIDER_CLIENT_ACCOUNT_CHANGED'); }; await service.refresh(a); assert.equal(service.state().accounts[0].identityStatus, 'unknown'); assert.equal(service.state().accounts[1].duplicateKnown, false);
  context = desktop(); token = 'PRIVATE_TOKEN_D'; await service.loginWebsite({ ...request, id: a }, true); assert.equal(service.state().accounts[1].duplicateKnown, true);
  service.prepare = async () => ({ credential: 'PRIVATE_RENEWED', context: desktop(), expiresAt: null }); service.run = async () => { throw Error('PROVIDER_TIMEOUT'); }; await service.refresh(a); assert.equal(service.state().accounts[1].duplicateKnown, false, 'an unvalidated renewal cannot retain old evidence');
});
