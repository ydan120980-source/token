'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { ProviderSecretStore } = require('../../src/quota/provider-secret-store');
const { allowedNavigation, allowedSubframe, selectWebsiteCookies } = require('../../src/quota/provider-website-login');
const { ProviderQuotaService, installProviderQuota } = require('../../src/quota/provider-service');
const { fromProvider } = require('../../src/quota/provider-resources');
const id = '11111111-2222-4333-8444-555555555555';
const request = adapter => ({ adapter, id: null, alias: '合成登录', consent: true });
function encryptedStorage() {
  const key = crypto.randomBytes(32);
  return { isEncryptionAvailable: () => true,
    encryptString: value => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv), data = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
    decryptString: bytes => { const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(); } };
}
function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-login-')), secretStore = new ProviderSecretStore(path.join(root, 'secrets'), encryptedStorage(), { platform: 'win32' });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const run = async adapter => fromProvider(adapter, adapter === 'cursor-web' ? { individualUsage: { plan: { totalPercentUsed: 30 } } } : { balance: { code: 0, data: { balance: '0.29', currency: 'CNY' } } }, new Date().toISOString());
  return { root, secretStore, run, service: new ProviderQuotaService(root, { secretStore, run, ...options }) };
}
test('website sessions accept only own-site HTTPS navigation and unambiguous quota cookies', () => {
  assert(allowedNavigation('cursor-web', 'https://cursor.com/dashboard')); assert(allowedNavigation('cursor-web', 'https://accounts.x.ai/login'));
  for (const url of ['file:///x', 'http://cursor.com', 'https://cursor.com.evil.invalid', 'https://evil@cursor.com', 'https://cursor.com:9443', 'https://localhost', 'cursor://auth']) assert(!allowedNavigation('cursor-web', url));
  assert(!allowedNavigation('deepseek-api', 'https://api.deepseek.com'));
  const good = { name: 'WorkosCursorSessionToken', value: 'SYNTHETIC_ONLY', domain: '.cursor.com', secure: true, expirationDate: Date.now() / 1000 + 3600 };
  const selected = selectWebsiteCookies('cursor-web', [good, { ...good, name: 'tracking', value: 'PRIVATE' }, { ...good, domain: 'evil.invalid' }]);
  assert.equal(selected.credential, 'WorkosCursorSessionToken=SYNTHETIC_ONLY'); assert(selected.expiresAt);
  assert.equal(selectWebsiteCookies('cursor-web', [good, good]), null);
  assert.equal(selectWebsiteCookies('cursor-web', [{ ...good, secure: false }]), null);
  assert.equal(selectWebsiteCookies('cursor-web', [{ ...good, expirationDate: 1 }]), null);
  assert.equal(selectWebsiteCookies('cursor-web', [good, { ...good, name: 'next-auth.session-token' }]), null);
  const mimo = [ { name: 'api-platform_serviceToken', value: 'SYNTHETIC_ONLY', domain: 'platform.xiaomimimo.com', secure: true }, { name: 'userId', value: 'test', domain: '.xiaomimimo.com', secure: true } ];
  assert.equal(selectWebsiteCookies('mimo-web', mimo).credential, 'api-platform_serviceToken=SYNTHETIC_ONLY; userId=test');
  assert.equal(selectWebsiteCookies('mimo-web', mimo.slice(0, 1)), null);
});
test('verified CAPTCHA origins work only as subframes; unrelated Google pages and top-level redirects stay blocked', () => {
  for (const url of ['https://challenges.cloudflare.com/turnstile/v0/widget', 'https://www.google.com/recaptcha/api2/anchor', 'https://recaptcha.google.com/recaptcha/api2/bframe', 'https://www.recaptcha.net/recaptcha/api2/anchor']) { assert(allowedSubframe('claude-web', url)); assert(!allowedNavigation('claude-web', url)); }
  for (const url of ['https://www.google.com/search', 'http://challenges.cloudflare.com', 'https://challenges.cloudflare.com.evil.invalid', 'https://user@challenges.cloudflare.com', 'https://challenges.cloudflare.com:9443', 'file:///private', 'https://localhost']) assert(!allowedSubframe('claude-web', url));
});
test('vault encrypts normalized cookies, binds account and adapter, and rejects corruption/unavailable encryption', t => {
  const { secretStore } = setup(t), secret = 'WorkosCursorSessionToken=SYNTHETIC_SECRET; foreign=PRIVATE';
  secretStore.put(id, 'cursor-web', secret, null);
  assert(!fs.readFileSync(secretStore.file(id)).includes(Buffer.from('SYNTHETIC_SECRET')));
  assert.equal(secretStore.get(id, 'cursor-web').credential, 'WorkosCursorSessionToken=SYNTHETIC_SECRET');
  assert.throws(() => secretStore.get(id, 'mimo-web'), /STORAGE_FAILED/);
  const api = 'aaaaaaaa-2222-4333-8444-555555555555'; secretStore.put(api, 'deepseek-api', 'SYNTHETIC_KEY', null);
  assert.equal(secretStore.get(api, 'deepseek-api').credential, 'SYNTHETIC_KEY'); assert(!fs.readFileSync(secretStore.file(api)).includes(Buffer.from('SYNTHETIC_KEY'))); secretStore.remove(api);
  const other = id.replace(/^1/, 'a'); fs.copyFileSync(secretStore.file(id), secretStore.file(other)); assert.throws(() => secretStore.get(other, 'cursor-web'), /STORAGE_FAILED/);
  fs.writeFileSync(secretStore.file(id), 'corrupt'); assert.throws(() => secretStore.get(id, 'cursor-web'), /STORAGE_FAILED/);
  secretStore.storage.isEncryptionAvailable = () => false; assert.throws(() => secretStore.put(id, 'cursor-web', secret, null), /SECURE_STORAGE_REQUIRED/);
  secretStore.remove(id); assert.equal(secretStore.get(id, 'cursor-web'), null);
});
test('encrypted website credentials survive restart without network, expire and are erased on removal', async t => {
  const { service, root, secretStore, run } = setup(t, { websiteLogin: async () => ({ credential: 'WorkosCursorSessionToken=SYNTHETIC_SECRET', expiresAt: null }) });
  let state = await service.loginWebsite(request('cursor-web')); await service.tail; const row = state.accounts[0];
  assert.equal(state.pendingWebsiteLogin, null); assert.equal(row.remembered, true); assert(!JSON.stringify(service.state()).includes('SYNTHETIC_SECRET')); assert(!fs.readFileSync(service.file, 'utf8').includes('SYNTHETIC_SECRET'));
  await service.close(); let calls = 0;
  const restored = new ProviderQuotaService(root, { secretStore, run: async (...args) => { calls++; return run(...args); } });
  assert.equal(calls, 0); assert.equal(restored.state().accounts[0].credentialReady, true); await restored.refresh(row.id); assert.equal(calls, 1);
  restored.remove(row.id); assert.equal(secretStore.get(row.id, 'cursor-web'), null); await restored.close();
  secretStore.now = () => 0; secretStore.put(id, 'cursor-web', 'WorkosCursorSessionToken=SYNTHETIC_SECRET', '2020-01-01T00:00:00Z'); secretStore.now = Date.now;
  assert.equal(secretStore.get(id, 'cursor-web'), null); assert(!fs.existsSync(secretStore.file(id)));
});
test('website auth failure clears encrypted credentials but preserves observed quota; manual replacement stays memory-only', async t => {
  const { service, secretStore } = setup(t, { websiteLogin: async () => ({ credential: 'WorkosCursorSessionToken=SYNTHETIC_SECRET', expiresAt: null }) });
  await service.loginWebsite(request('cursor-web')); await service.tail; const row = service.rows[0], quota = row.quota;
  service.run = async () => { throw Error('PROVIDER_AUTH_REQUIRED'); }; await service.refresh(row.id);
  assert.equal(row.quota, quota); assert.equal(row.status, 'login-required'); assert.equal(secretStore.get(row.id, row.adapter), null); assert(!service.secrets.has(row.id));
  service.run = async () => quota; row.nextRefreshAt = null; await service.loginWebsite({ ...request('cursor-web'), id: row.id }); await service.tail;
  await service.supply(row.id, 'WorkosCursorSessionToken=SYNTHETIC_MANUAL'); await service.tail; assert.equal(secretStore.get(row.id, row.adapter), null); assert.equal(service.state().accounts[0].remembered, false); await service.close();
});
test('cancel, close, row removal and failed persistence cannot create a late website connection', async t => {
  let resolveLogin; const { service, secretStore } = setup(t, { websiteLogin: () => new Promise(resolve => { resolveLogin = resolve; }) });
  const pending = service.loginWebsite(request('cursor-web')); assert(service.state().pendingWebsiteLogin);
  await assert.rejects(service.loginWebsite(request('mimo-web')), /LOGIN_BUSY/); service.cancelWebsite(); resolveLogin({ credential: 'WorkosCursorSessionToken=SYNTHETIC_SECRET', expiresAt: null }); await assert.rejects(pending, /CANCELED/); assert.equal(service.rows.length, 0);
  service.websiteLogin = async () => ({ credential: 'WorkosCursorSessionToken=SYNTHETIC_SECRET', expiresAt: null }); service.persist = () => { throw Error('PROVIDER_STORAGE_FAILED'); };
  await assert.rejects(service.loginWebsite(request('cursor-web')), /STORAGE_FAILED/); assert.equal(service.rows.length, 0); assert.equal(fs.readdirSync(secretStore.root).length, 0); await service.close();
});
test('website login checks consent, fixture and encryption gates before allocating any window; IPC rejects untrusted senders', async t => {
  let calls = 0; const { service } = setup(t, { fixture: true, websiteLogin: async () => { calls++; } });
  await assert.rejects(service.loginWebsite({ ...request('cursor-web'), consent: false }), /ACTION_INVALID/);
  await assert.rejects(service.loginWebsite({ ...request('cursor-web'), url: 'https://evil.invalid' }), /ACTION_INVALID/);
  await assert.rejects(service.loginWebsite(request('deepseek-api')), /ACTION_INVALID/);
  await assert.rejects(service.loginWebsite(request('cursor-web')), /FIXTURE_BLOCKED/); service.fixture = false; service.secretStore.storage.isEncryptionAvailable = () => false;
  await assert.rejects(service.loginWebsite(request('cursor-web')), /SECURE_STORAGE_REQUIRED/); assert.equal(calls, 0);
  const handlers = {}; installProviderQuota({ handle: (name, fn) => { handlers[name] = fn; } }, event => event.trusted === true, service, () => {});
  await assert.rejects(handlers['quota:providerWebsiteLogin']({}, request('cursor-web')), /SENDER_REJECTED/);
  assert.equal((await handlers['quota:providerWebsiteCancel']({ trusted: true }, 'extra')).errorCode, 'PROVIDER_ACTION_INVALID'); await service.close();
});
test('closing and removal wait for or invalidate login completion, and storage failures do not create plaintext fallback', async t => {
  let resolveLogin; const { service, secretStore } = setup(t, { websiteLogin: () => new Promise(resolve => { resolveLogin = resolve; }) });
  let pending = service.loginWebsite(request('cursor-web')); const rejected = assert.rejects(pending, /CANCELED/), closing = service.close();
  resolveLogin({ credential: 'WorkosCursorSessionToken=SYNTHETIC_SECRET', expiresAt: null }); await rejected; await closing; assert.equal(service.rows.length, 0);
  const next = new ProviderQuotaService(service.root, { secretStore, run: service.run, websiteLogin: async () => ({ credential: 'WorkosCursorSessionToken=SYNTHETIC_SECRET', expiresAt: null }) });
  await next.loginWebsite(request('cursor-web')); await next.tail; const row = next.rows[0];
  next.websiteLogin = () => new Promise(resolve => { resolveLogin = resolve; }); pending = next.loginWebsite({ ...request('cursor-web'), id: row.id }); const removed = assert.rejects(pending, /CANCELED/);
  next.remove(row.id); resolveLogin({ credential: 'WorkosCursorSessionToken=SYNTHETIC_SECRET', expiresAt: null }); await removed; assert.equal(next.rows.length, 0); assert.equal(secretStore.get(row.id, row.adapter), null);
  secretStore.storage.encryptString = () => { throw Error('PRIVATE_SECRET_ERROR'); }; next.websiteLogin = async () => ({ credential: 'WorkosCursorSessionToken=SYNTHETIC_SECRET', expiresAt: null });
  await assert.rejects(next.loginWebsite(request('cursor-web')), error => error.message === 'PROVIDER_SECRET_STORAGE_FAILED'); assert.equal(next.rows.length, 0); assert.equal(fs.readdirSync(secretStore.root).length, 0); await next.close();
});


test('temporary vault restore failure retries on explicit refresh without new login or loss of history', async t => {
  const { service, root, secretStore, run } = setup(t, { websiteLogin: async () => ({ credential: 'WorkosCursorSessionToken=SYNTHETIC_SECRET', expiresAt: null }) });
  await service.loginWebsite(request('cursor-web')); const row = service.rows[0], previous = row.quota; await service.close();
  const decrypt = secretStore.storage.decryptString; secretStore.storage.decryptString = () => { throw Error('transient'); };
  const restored = new ProviderQuotaService(root, { secretStore, run }); t.after(() => restored.close());
  assert.equal(restored.state().accounts[0].credentialRetryable, true); assert.equal(restored.state().accounts[0].credentialReady, false);
  assert.deepEqual(restored.rows[0].quota, previous);
  assert.deepEqual(await restored.refreshAll({ automatic: true }), { success: 0, failed: 0, skipped: 1 });
  secretStore.storage.decryptString = decrypt;
  await restored.refresh(row.id);
  assert.equal(restored.state().accounts[0].credentialReady, true); assert.equal(restored.rows[0].errorCode, null);
});

test('automatic provider batch skips disconnected, busy and cooled rows and never rereads external client credentials', async t => {
  const { service } = setup(t); t.after(() => service.close());
  let reads = 0, prepared = 0;
  service.run = async adapter => { reads++; return fromProvider(adapter, { code: 0, data: { Response: { Data: { Accounts: [{ CapacityType: 1, CapacitySize: '100', CapacityRemain: '50' }] } } } }, new Date().toISOString()); };
  service.prepare = () => { prepared++; throw Error('must not read desktop files automatically'); };
  for (let i = 0; i < 4; i++) { const id = String(i).padStart(8, '0') + '-2222-4333-8444-555555555555'; service.rows.push({ id, adapter: 'workbuddy-desktop', provider: 'workbuddy', alias: 'synthetic', quota: null, status: 'cached', nextRefreshAt: i === 2 ? new Date(Date.now() + 60000).toISOString() : null }); if (i !== 1) service.secrets.set(id, 'SYNTHETIC_SECRET'); service.contexts.set(id, { desktop: { uid: 'synthetic', domain: '' } }); if (i === 3) service.busy.set(id, new AbortController()); }
  assert.deepEqual(await service.refreshAll({ automatic: true }), { success: 1, failed: 0, skipped: 3 });
  assert.equal(reads, 1); assert.equal(prepared, 0);
});


test('early access-token rejection renews an owned grant once without discarding the login', async t => {
  const { service, secretStore } = setup(t); t.after(() => service.close());
  const expiresAt = new Date(Date.now() + 3600000).toISOString(), context = { console: { orgId: 'org_SYNTHETIC' }, deviceGrant: true, oauth: { clientId: 'opencode-cli', refreshToken: 'SYNTHETIC_REFRESH', expiresAt } };
  const row = { id, adapter: 'opencode-zen', provider: 'opencode', alias: 'synthetic', quota: null, status: 'cached' }; service.rows.push(row); service.secrets.set(id, 'SYNTHETIC_OLD'); service.contexts.set(id, context); service.remembered.set(id, expiresAt); secretStore.put(id, row.adapter, 'SYNTHETIC_OLD', expiresAt, context);
  let forced = 0, reads = 0;
  service.prepare = async (_adapter, _token, _signal, grant, options) => { if (!options?.force) return null; forced++; return { credential: 'SYNTHETIC_NEW', expiresAt, context: grant }; };
  service.run = async (_adapter, credential) => { reads++; if (credential === 'SYNTHETIC_OLD') throw Error('PROVIDER_AUTH_REQUIRED'); return fromProvider('opencode-zen', { balanceMicroCents: '100000000' }, new Date().toISOString()); };
  await service.refresh(id, { automatic: true });
  assert.equal(forced, 1); assert.equal(reads, 2); assert.equal(row.errorCode, null); assert.equal(service.state().accounts[0].credentialReady, true); assert.equal(secretStore.get(id, row.adapter).credential, 'SYNTHETIC_NEW');
  row.nextRefreshAt = null; service.run = async () => { throw Error('PROVIDER_AUTH_REQUIRED'); }; await service.refresh(id, { automatic: true }); assert.equal(forced, 2); assert.equal(row.status, 'login-required'); assert.equal(secretStore.get(id, row.adapter), null);
});


test('fresh login replaces undecryptable old ciphertext; failed cache save restores the exact old bytes', async t => {
  const { service, secretStore } = setup(t, { websiteLogin: async () => ({ credential: 'WorkosCursorSessionToken=SYNTHETIC_NEW', expiresAt: null }) }); t.after(() => service.close());
  await service.loginWebsite(request('cursor-web')); const row = service.rows[0], previousQuota = row.quota;
  const damaged = Buffer.from('unreadable encrypted record'); fs.writeFileSync(secretStore.file(row.id), damaged);
  assert.throws(() => secretStore.get(row.id, row.adapter), error => error.stage === 'decrypt');
  const persist = service.persist.bind(service); service.persist = () => { throw Error('PROVIDER_STORAGE_FAILED'); };
  await assert.rejects(service.loginWebsite({ ...request('cursor-web'), id: row.id }), /PROVIDER_STORAGE_FAILED/);
  assert.deepEqual(fs.readFileSync(secretStore.file(row.id)), damaged); assert.equal(row.quota, previousQuota);
  service.persist = persist;
  await service.loginWebsite({ ...request('cursor-web'), id: row.id });
  assert.equal(secretStore.get(row.id, row.adapter).credential, 'WorkosCursorSessionToken=SYNTHETIC_NEW'); assert.equal(service.rows.length, 1);
});

test('vault reports encryption and replacement stages without sensitive exception text, preserving the old file', t => {
  const { secretStore } = setup(t); secretStore.put(id, 'deepseek-api', 'SYNTHETIC_OLD', null); const original = fs.readFileSync(secretStore.file(id));
  const encrypt = secretStore.storage.encryptString; secretStore.storage.encryptString = () => { throw Error('PRIVATE_SECRET'); };
  assert.throws(() => secretStore.put(id, 'deepseek-api', 'SYNTHETIC_NEW', null), error => error.stage === 'encrypt' && !String(error).includes('PRIVATE_SECRET'));
  secretStore.storage.encryptString = encrypt;
  const rename = fs.renameSync; fs.renameSync = (source, target) => { if (target === secretStore.file(id)) { const error = Error('PRIVATE_PATH'); error.code = 'EPERM'; throw error; } return rename(source, target); };
  try { assert.throws(() => secretStore.put(id, 'deepseek-api', 'SYNTHETIC_NEW', null), error => error.stage === 'replace' && error.storageCode === 'EPERM' && !String(error).includes('PRIVATE_PATH')); }
  finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(secretStore.file(id)), original); assert.equal(fs.readdirSync(secretStore.root).length, 1);
});


test('replacing a login cleans up only the former owned CLI home after the new vault and cache commit', async t => {
  const oldHome = '11111111-2222-4333-8444-555555555555', newHome = '66666666-7777-4888-8999-000000000000', forgotten = [];
  let clientHome = oldHome;
  const { service, secretStore } = setup(t, { websiteLogin: async () => ({ credential: 'WorkosCursorSessionToken=SYNTHETIC_NEW', expiresAt: null, context: { clientHome } }), forgetClient: (_adapter, context) => forgotten.push(context.clientHome) }); t.after(() => service.close());
  await service.loginWebsite(request('cursor-web')); const row = service.rows[0];
  fs.writeFileSync(secretStore.file(row.id), 'synthetic broken ciphertext'); clientHome = newHome;
  await service.loginWebsite({ ...request('cursor-web'), id: row.id });
  assert.deepEqual(forgotten, [oldHome]); assert.equal(secretStore.get(row.id, row.adapter).context.clientHome, newHome);
});


test('IPC exposes only allowed storage stages and OS codes, never raw exception text or paths', async t => {
  const { service } = setup(t), handlers = {}; t.after(() => service.close());
  installProviderQuota({ handle: (name, fn) => { handlers[name] = fn; } }, () => true, service, () => {});
  service.loginWebsite = async () => { const error = Error('PROVIDER_SECRET_STORAGE_FAILED'); error.stage = 'replace'; error.storageCode = 'EPERM'; error.cause = Error('PRIVATE_PATH_AND_SECRET'); throw error; };
  const result = await handlers['quota:providerClientLogin']({}, request('workbuddy-desktop'));
  assert.equal(result.errorStage, 'replace'); assert.equal(result.storageCode, 'EPERM'); assert(!JSON.stringify(result).includes('PRIVATE'));
  service.loginWebsite = async () => { const error = Error('PROVIDER_SECRET_STORAGE_FAILED'); error.stage = 'PRIVATE_PATH'; error.storageCode = 'PRIVATE_SECRET'; throw error; };
  const redacted = await handlers['quota:providerClientLogin']({}, request('workbuddy-desktop')); assert.equal(redacted.errorStage, null); assert.equal(redacted.storageCode, null);
});


test('automatic and explicit refresh skip a reconnecting row while independent rows continue', async t => {
  const { service } = setup(t, { websiteLogin: async () => ({ credential: 'WorkosCursorSessionToken=SYNTHETIC_NEW', expiresAt: null }) }); t.after(() => service.close());
  await service.loginWebsite(request('cursor-web')); await service.loginWebsite(request('cursor-web'));
  const [first, second] = service.rows; let release, reads = 0;
  service.websiteLogin = () => new Promise(resolve => { release = resolve; });
  const login = service.loginWebsite({ ...request('cursor-web'), id: first.id });
  const run = service.run; service.run = async (...args) => { reads++; return run(...args); };
  await service.refresh(first.id); assert.equal(reads, 0);
  assert.deepEqual(await service.refreshAll({ automatic: true }), { success: 1, failed: 0, skipped: 1 }); assert.equal(reads, 1); assert.equal(second.status, 'ready');
  release({ credential: 'WorkosCursorSessionToken=SYNTHETIC_NEW', expiresAt: null }); await login;
  assert.equal(first.status, 'ready'); assert.equal(reads, 2); assert.equal(service.busy.size, 0);
});
