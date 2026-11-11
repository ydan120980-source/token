'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { readBounded, readClientCredential, createClientLogin } = require('../../src/quota/provider-client-login');
const { fromProvider } = require('../../src/quota/provider-resources');
const { quotaJSON } = require('../../src/quota/quota-json');
const { selectWebsiteCookies, selectPlatformToken } = require('../../src/quota/provider-website-login');
const { capabilities } = require('../../src/quota/provider-catalog');
const { ProviderQuotaService, installProviderQuota } = require('../../src/quota/provider-service');
const { ProviderSecretStore } = require('../../src/quota/provider-secret-store');
const { createHash } = require('node:crypto');
function home(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'login-parity-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
function write(root, relative, value) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; }
const now = () => new Date().toISOString();

test('successful ZCode empty bucket response preserves encrypted login and unknown quota through restart without a new request', async t => {
  const root = home(t), storage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).map(byte => byte ^ 127), decryptString: value => value.map(byte => byte ^ 127).toString() };
  const secretStore = new ProviderSecretStore(path.join(root, 'secrets'), storage, { platform: 'win32' });
  let reads = 0, empty = true;
  const run = async () => { reads++; return fromProvider('zcode-device', { code: 0, data: { balances: empty ? [] : [{ unit_type: 'token', remaining_units: '42' }] } }, now()); };
  const service = new ProviderQuotaService(root, { secretStore, run, clientLogin: async () => ({ credential: 'SYNTHETIC_ZCODE_LOGIN', expiresAt: null, context: { zcode: { userId: 'SYNTHETIC_USER', deviceMid: '11111111-2222-4333-8444-555555555555' } } }) }); t.after(() => service.close());
  await service.loginWebsite({ adapter: 'zcode-device', alias: 'synthetic', id: null, consent: true }, true);
  const row = service.state().accounts[0]; assert.equal(row.status, 'ready'); assert.equal(row.remembered, true); assert.equal(row.credentialReady, true); assert.equal(row.quota.hasMeasurements, false); assert.equal(row.quota.partial, true); assert.deepEqual(row.quota.pools, []); assert.equal(row.quota.entitlement.state, 'unknown');
  assert.equal(require('../../src/quota/connection-state').quotaLabel(require('../../src/quota/connection-state').quotaFreshness(row)), '额度未知');
  await service.close(); const restored = new ProviderQuotaService(root, { secretStore, run }); t.after(() => restored.close());
  assert.equal(reads, 1); assert.equal(restored.state().accounts[0].credentialReady, true); assert.equal(restored.state().accounts[0].quota.hasMeasurements, false);
  empty = false; await restored.refresh(row.id); assert.equal(reads, 2); assert.equal(restored.state().accounts[0].quota.pools[0].balances[0].remaining, '42');
  assert.throws(() => fromProvider('zcode-device', { code: 0, data: {} }, now()), /RESPONSE_INVALID/); assert.throws(() => fromProvider('zcode-device', { code: 401, data: { balances: [] } }, now()), /AUTH_REQUIRED/);
  assert.throws(() => fromProvider('opencode-go', { usage: {} }, now()), /QUOTA_UNAVAILABLE/);
});
test('all ten Agents expose a connection route and every provider source remains explicit', () => {
  const all = capabilities().filter(row => row.mode !== 'planned'); assert.equal(all.length, 10);
  for (const item of all) assert(item.provider === 'codex' || item.adapters.some(route => route.websiteLogin || route.clientLogin), item.provider);
  assert(all.find(row => row.provider === 'gemini').adapters.some(row => row.id === 'gemini-web'));
});
test('explicit client import reads only fixed bounded contracts, rejects expired, missing scopes, links and executable config', t => {
  const root = home(t); write(root, '.claude/.credentials.json', { claudeAiOauth: { accessToken: 'SYNTHETIC_CLAUDE', scopes: ['user:profile'], expiresAt: Date.now() + 3600000 } });
  assert.equal(readClientCredential('claude-oauth', root).credential, 'SYNTHETIC_CLAUDE');
  write(root, '.claude/.credentials.json', { claudeAiOauth: { accessToken: 'SYNTHETIC_CLAUDE', scopes: ['user:inference'] } }); assert.equal(readClientCredential('claude-oauth', root), null);
  write(root, '.gemini/oauth_creds.json', { access_token: 'SYNTHETIC_GOOGLE', expiry_date: 1 }); assert.equal(readClientCredential('gemini-code-assist', root), null);
  write(root, '.gemini/oauth_creds.json', { access_token: 'SYNTHETIC_GOOGLE', expiry_date: Date.now() + 3600000 }); assert.deepEqual(readClientCredential('gemini-code-assist', root).context, { discover: true });
  assert.equal(readClientCredential('deepseek-api', root, { DEEPSEEK_API_KEY: 'SYNTHETIC_KEY', OTHER: 'FOREIGN' }).credential, 'SYNTHETIC_KEY');
  write(root, '.local/share/opencode/auth.json', { 'opencode-go': { type: 'api', key: 'SYNTHETIC_GO_KEY' } }); assert.equal(readClientCredential('opencode-go', root).credential, 'SYNTHETIC_GO_KEY');
  write(root, '.config/bigmodel/api_key', 'SYNTHETIC_CN_KEY\n'); assert.equal(readClientCredential('zai-cn', root).credential, 'SYNTHETIC_CN_KEY'); assert.equal(readClientCredential('zai-global', root), null);
  const large = write(root, 'large.json', ' '.repeat(1024 * 1024 + 1)); assert.equal(readBounded(large), null);
  const script = write(root, 'config.js', 'throw new Error("must not execute")'); assert.equal(readBounded(script), null);
  if (process.platform === 'win32') { fs.symlinkSync(root, path.join(root, 'linked'), 'junction'); assert.equal(readBounded(path.join(root, 'linked/.gemini/oauth_creds.json')), null); fs.unlinkSync(path.join(root, 'linked')); }
});
test('client connect has no background import or fixture side effects; existing account reuse starts no executable', async t => {
  const root = home(t); let reads = 0, jobs = 0;
  const options = { root: path.join(root, 'own'), toolsRoot: path.join(root, 'tools'), environment: () => ({ platform: 'win32', home: root }), read: () => { reads++; return { credential: 'SYNTHETIC_EXISTING', expiresAt: null }; }, job: () => { jobs++; } };
  const client = createClientLogin(options); assert.equal(reads, 0);
  assert.equal((await client.login('claude-oauth', new AbortController().signal)).credential, 'SYNTHETIC_EXISTING'); assert.equal(reads, 1); assert.equal(jobs, 0);
  await assert.rejects(createClientLogin({ ...options, fixture: true }).login('claude-oauth', new AbortController().signal), /FIXTURE_BLOCKED/); assert.equal(reads, 1);
});

test('Antigravity keeps isolated file-token mode and forwards only the current CLI Google URL to the browser', async t => {
  const root = home(t), toolsRoot = path.join(root, 'tools'), executable = path.join(toolsRoot, 'antigravity/agy.exe'); fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.copyFileSync(process.execPath, executable);
  write(toolsRoot, 'antigravity/active.json', { agent: 'antigravity', version: '1.4.2', executable, executableHash: createHash('sha256').update(fs.readFileSync(executable)).digest('hex'), js: false });
  const url = 'https://accounts.google.com/o/oauth2/auth?' + new URLSearchParams({ client_id: 'SYNTHETIC-CLIENT.apps.googleusercontent.com', redirect_uri: 'https://antigravity.google/oauth-callback', response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', scope: 'openid', state: 's'.repeat(32) }), opened = [];
  const client = createClientLogin({ root: path.join(root, 'owned'), toolsRoot, environment: () => ({ home: path.join(root, 'external') }), job: async () => ({ code: 0, errorCode: null, reaped: true, stdout: '1.4.2' }), loginJob: async (_pin, args, options) => { assert.deepEqual(args, []); assert.equal(options.env.SSH_TTY, 'agentusage-scoped'); assert.equal(options.env.GEMINI_FORCE_FILE_STORAGE, undefined); assert.equal(options.env.HOME, options.cwd); assert.throws(() => options.onAuthUrl(url.replace('&response_type=code', '')), /RESPONSE_INVALID/); await options.onAuthUrl(url); return { code: 1, reaped: true }; }, openBrowser: async value => opened.push(value) });
  await assert.rejects(client.login('antigravity-cli', new AbortController().signal), /LOGIN_FAILED/); assert.deepEqual(opened, [url]);
});
test('official login uses an independently owned directory; only its own grant renews and removal cleans it', async t => {
  const root = home(t), toolsRoot = path.join(root, 'tools'), executable = path.join(toolsRoot, 'claude/native.exe'); fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.copyFileSync(process.execPath, executable);
  write(toolsRoot, 'claude/active.json', { agent: 'claude', version: '2.1.303', executable, executableHash: createHash('sha256').update(fs.readFileSync(executable)).digest('hex'), js: false });
  const jobs = [], renewals = [], result = { code: 0, errorCode: null, reaped: true, stdout: '2.1.303 (Claude Code)' };
  const client = createClientLogin({ root: path.join(root, 'owned'), toolsRoot, environment: () => ({ platform: 'win32', home: path.join(root, 'external') }), job: async (_pin, args, options) => { jobs.push({ args, options }); return result; }, loginJob: async (_pin, args, options) => { jobs.push({ args, options }); write(options.cwd, '.claude/.credentials.json', { claudeAiOauth: { accessToken: 'SYNTHETIC_ACCESS', refreshToken: 'SYNTHETIC_OWN_REFRESH', scopes: ['user:profile'], expiresAt: Date.now() + 35000 } }); return result; }, renew: async (...args) => { renewals.push(args); return { credential: 'SYNTHETIC_RENEWED', refreshToken: 'SYNTHETIC_ROTATED', expiresAt: new Date(Date.now() + 3600000).toISOString() }; } });
  const value = await client.login('claude-oauth', new AbortController().signal, '11111111-2222-4333-8444-555555555555');
  assert.deepEqual(jobs[1].args, ['auth', 'login', '--claudeai']); assert.equal(jobs[1].options.env.HOME, jobs[1].options.cwd); assert.notEqual(jobs[1].options.env.HOME, root); assert.equal(jobs[1].options.env.CLAUDE_CONFIG_DIR, path.join(jobs[1].options.cwd, '.claude')); assert.equal(jobs[1].options.env.ANTHROPIC_API_KEY, undefined);
  assert(value.context.clientHome); assert.equal(value.context.oauth.refreshToken, 'SYNTHETIC_OWN_REFRESH');
  assert.equal(await client.prepare('claude-oauth', 'SYNTHETIC_EXTERNAL', new AbortController().signal, null), null); assert.equal(renewals.length, 0);
  const prepared = await client.prepare('claude-oauth', value.credential, new AbortController().signal, value.context); assert.equal(prepared.context.oauth.refreshToken, 'SYNTHETIC_ROTATED'); assert.equal(renewals[0][1], 'SYNTHETIC_OWN_REFRESH');
  assert.equal(await client.prepare('claude-oauth', prepared.credential, new AbortController().signal, prepared.context), null);
  await client.prepare('claude-oauth', prepared.credential, new AbortController().signal, prepared.context, { force: true }); assert.equal(renewals.length, 2, 'an early 401 may force one owned-grant renewal before recorded expiry');
  client.forget('claude-oauth', value.context); assert(!fs.existsSync(jobs[1].options.cwd)); assert(fs.existsSync(executable));
});
test('website extraction scopes all billing cookies to own origin, keeps platform tokens out of cookie headers', () => {
  const cookie = { name: 'own_session', value: 'SYNTHETIC_ONLY', domain: '.workbuddy.cn', secure: true };
  assert.equal(selectWebsiteCookies('workbuddy-web', [cookie, { ...cookie, domain: '.codebuddy.cn', name: 'foreign' }]).credential, 'own_session=SYNTHETIC_ONLY');
  assert.equal(selectWebsiteCookies('claude-web', [{ ...cookie, name: 'sessionKey', domain: '.claude.ai' }]).credential, 'sessionKey=SYNTHETIC_ONLY');
  assert.equal(selectPlatformToken('{"value":"SYNTHETIC_PLATFORM_TOKEN"}').credential, 'SYNTHETIC_PLATFORM_TOKEN'); assert.equal(selectPlatformToken('{"password":"PRIVATE"}'), null);
});
test('new source parsers preserve exact values and reject ambiguous/missing data rather than inventing zero', () => {
  const at = now(), claude = fromProvider('claude-oauth', { five_hour: { utilization: 22, resets_at: '2026-10-21T00:00:00Z' }, seven_day_opus: { utilization: 0 } }, at); assert.equal(claude.pools.length, 2); assert.equal(claude.pools[0].windows[0].remainingPercent, 78);
  const buddy = fromProvider('workbuddy-web', quotaJSON('{"code":0,"data":{"Packages":[{"CapacityUnit":"credits","CycleTotalCapacity":9007199254740993.125,"CycleRemainCapacity":"20.125","CycleFrozenCapacity":"1.1"}]}}'), at); assert.equal(buddy.pools[0].balances[0].total, '9007199254740993.125'); assert.equal(buddy.pools[0].balances[1].remaining, '1.1');
  const gemini = fromProvider('gemini-web', [{ data: { viewer: { rpcs: { getUsageInfo: { pools: [{ poolType: 'GXU_FIVE_HOURLY', percentageUsed: 0.25 }] } } } } }], at); assert.equal(gemini.pools[0].windows[0].usedPercent, 25); assert.match(gemini.pools[0].label, /app/);
  const open = fromProvider('opencode-web', { access: { meters: { fiveHour: { usedMicroCents: '10000000', limitMicroCents: '100000000' } } } }, at); assert.equal(open.pools[0].windows[0].remaining, '0.9');
  const deep = fromProvider('deepseek-web', { code: 0, data: { biz_code: 0, biz_data: { normal_wallets: [{ currency: 'CNY', balance: '3.125' }], bonus_wallets: [{ currency: 'USD', balance: '0' }] } } }, at); assert.equal(deep.pools.length, 2); assert.equal(deep.pools[1].balances[0].remaining, '0');
  for (const adapter of ['claude-web', 'workbuddy-web', 'deepseek-web', 'opencode-web']) assert.throws(() => fromProvider(adapter, {}, at), /PROVIDER_/);
});
test('validated remembered API connection survives restart, failed account switch retains both previous credential and quota, IPC rejects secrets in getters', async t => {
  const root = home(t), storage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text).map(byte => byte ^ 127), decryptString: bytes => bytes.map(byte => byte ^ 127).toString() };
  const secretStore = new ProviderSecretStore(path.join(root, 'secrets'), storage, { platform: 'win32' }), quota = () => fromProvider('deepseek-api', { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '4' }] }, now());
  const service = new ProviderQuotaService(root, { secretStore, run: async () => quota() }); t.after(() => service.close());
  await service.connect({ adapter: 'deepseek-api', alias: '合成', credential: 'SYNTHETIC_OLD_SECRET', remember: true }); const row = service.rows[0], previous = row.quota;
  service.run = async () => { throw Error('PROVIDER_AUTH_REQUIRED'); }; await assert.rejects(service.supply(row.id, 'SYNTHETIC_NEW_SECRET', undefined, true), /AUTH_REQUIRED/);
  assert.equal(row.quota, previous); assert.equal(service.secrets.get(row.id), 'SYNTHETIC_OLD_SECRET'); assert.equal(secretStore.get(row.id, row.adapter).credential, 'SYNTHETIC_OLD_SECRET');
  await service.close(); let calls = 0; const restored = new ProviderQuotaService(root, { secretStore, run: async () => { calls++; return quota(); } }); t.after(() => restored.close()); assert.equal(calls, 0); assert.equal(restored.state().accounts[0].remembered, true); assert(!JSON.stringify(restored.state()).includes('SECRET'));
  const handlers = {}; installProviderQuota({ handle: (channel, action) => { handlers[channel] = action; } }, event => event.valid === true, restored, () => {});
  await assert.rejects(handlers['quota:providerClientLogin']({}, {}), /SENDER_REJECTED/); const result = await handlers['quota:providerClientLogin']({ valid: true }, { adapter: 'deepseek-api', id: null, alias: 'x', consent: true, url: 'https://evil.invalid' }); assert.equal(result.ok, false);
});
test('expired owned grant restores without network and renews only on explicit refresh before quota; removal waits for cleanup', async t => {
  const root = home(t), id = '11111111-2222-4333-8444-555555555555', clientHome = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const storage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).map(byte => byte ^ 127), decryptString: value => value.map(byte => byte ^ 127).toString() };
  const secretStore = new ProviderSecretStore(path.join(root, 'secrets'), storage, { platform: 'win32', now: () => 0 });
  const context = { clientHome, oauth: { refreshToken: 'SYNTHETIC_OWN_REFRESH', clientId: 'SYNTHETIC_CLIENT_ID', expiresAt: new Date(Date.now() - 1000).toISOString() } };
  secretStore.put(id, 'claude-oauth', 'SYNTHETIC_EXPIRED', context.oauth.expiresAt, context); secretStore.now = Date.now;
  write(root, 'connections.json', { schemaVersion: 'ProviderQuotaCacheV1', connections: [{ id, adapter: 'claude-oauth', alias: 'owned', quota: null }] });
  let renewals = 0, reads = 0, removed = 0;
  const client = createClientLogin({ root: path.join(root, 'owned'), toolsRoot: path.join(root, 'tools'), environment: () => ({ home: root }), renew: async () => { renewals++; return { credential: 'SYNTHETIC_NEW_ACCESS', refreshToken: 'SYNTHETIC_ROTATED_REFRESH', expiresAt: new Date(Date.now() + 3600000).toISOString() }; } });
  const service = new ProviderQuotaService(root, { secretStore, prepare: client.prepare, forgetClient: (_adapter, value) => { assert.equal(value.clientHome, clientHome); removed++; }, run: async (_adapter, credential) => { reads++; assert.equal(credential, 'SYNTHETIC_NEW_ACCESS'); return fromProvider('claude-oauth', { five_hour: { utilization: 3 } }, now()); } });
  assert.equal(service.state().accounts[0].credentialReady, true); assert.equal(renewals, 0); assert.equal(reads, 0);
  await service.refresh(id); assert.equal(renewals, 1); assert.equal(reads, 1); assert.equal(service.state().accounts[0].status, 'ready'); assert.equal(secretStore.get(id, 'claude-oauth').context.oauth.refreshToken, 'SYNTHETIC_ROTATED_REFRESH');
  service.remove(id); await service.close(); assert.equal(removed, 1); assert.equal(secretStore.get(id, 'claude-oauth'), null);
});
