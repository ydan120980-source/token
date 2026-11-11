'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createCipheriv, createHash, randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createWorkBuddyReader, decodeField } = require('../../src/quota/workbuddy-client');
const { createClientLogin } = require('../../src/quota/provider-client-login');
const { fingerprint } = require('../../src/quota/executable-pin');
const { fromProvider } = require('../../src/quota/provider-resources');
const { readProvider } = require('../../src/quota/provider-http');
const { quotaJSON } = require('../../src/quota/quota-json');
const { ProviderQuotaService } = require('../../src/quota/provider-service');
const { ProviderSecretStore } = require('../../src/quota/provider-secret-store');
function setup(t) { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-client-')); t.after(() => fs.rmSync(home, { recursive: true, force: true })); const environment = () => ({ platform: 'win32', home, localAppData: path.join(home, 'Local'), appData: path.join(home, 'Roaming') }); const file = path.join(environment().localAppData, 'CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info'); fs.mkdirSync(path.dirname(file), { recursive: true }); return { home, file, environment }; }
function write(file, auth = {}) { fs.writeFileSync(file, JSON.stringify({ auth: { accessToken: 'SYNTHETIC_ACCESS', expiresAt: Date.now() + 3600000, domain: 'copilot.tencent.com', ...auth }, account: { uid: 'SYNTHETIC_USER', nickname: 'DO_NOT_RETURN_NAME' } })); }
function sealed(value, secret = 'SYNTHETIC_BUILD_KEY') {
  const key = createHash('sha256').update(secret).digest(), keyId = createHash('sha256').update(key).digest('hex').slice(0, 16), nonce = randomBytes(12);
  const parts = ['WBEV1', 'sym-v1'].map(value => { const size = Buffer.alloc(4); size.writeUInt32BE(value.length); return Buffer.concat([size, Buffer.from(value)]); });
  const aad = Buffer.concat([Buffer.from('57422d4141440001', 'hex'), ...parts, Buffer.from('00000001', 'hex'), Buffer.from('00000010', 'hex'), Buffer.from(keyId), Buffer.from([2, 0, 0])]);
  const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad); const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return { $wbEncrypted: 1, envelope: Buffer.from(JSON.stringify({ suite: 1, keyId, nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') })).toString('base64') };
}
test('WorkBuddy reads only the current fixed client file without browser, historical snapshots, or source changes', async t => {
  const options = setup(t); write(options.file); const before = fs.readFileSync(options.file); let jobs = 0;
  const reader = createWorkBuddyReader({ ...options, job: async () => { jobs++; throw Error(); } });
  const value = await reader.read(new AbortController().signal); assert.equal(value.credential, 'SYNTHETIC_ACCESS'); assert.equal(value.context.desktop.uid, 'SYNTHETIC_USER'); assert.equal(jobs, 0); assert(!JSON.stringify(value).includes('DO_NOT_RETURN_NAME')); assert.deepEqual(fs.readFileSync(options.file), before);
  fs.renameSync(options.file, options.file + '.old.info'); await assert.rejects(reader.read(new AbortController().signal), /CREDENTIAL_MISSING/);
  write(options.file, { domain: 'www.workbuddy.ai' }); await assert.rejects(reader.read(new AbortController().signal), /REGION_UNSUPPORTED/);
  write(options.file, { domain: 'evil.invalid' }); await assert.rejects(reader.read(new AbortController().signal), /CREDENTIAL_MISSING/);
  write(options.file, { expiresAt: Date.now() - 1 }); await assert.rejects(reader.read(new AbortController().signal), /AUTH_REQUIRED/);
  write(options.file); const parent = path.dirname(options.file); fs.renameSync(parent, parent + '-real'); fs.symlinkSync(parent + '-real', parent, process.platform === 'win32' ? 'junction' : 'dir'); await assert.rejects(reader.read(new AbortController().signal), /CREDENTIAL_MISSING/);
});
test('encrypted field compatibility checks GCM authentication/key id and uses a verified pinned build only', async t => {
  const options = setup(t), field = sealed('SYNTHETIC_ACCESS'), payload = JSON.stringify({ atRestSecretKey: 'SYNTHETIC_BUILD_KEY' });
  assert.equal(decodeField(field, payload), 'SYNTHETIC_ACCESS'); assert.throws(() => decodeField(field, '{"atRestSecretKey":"WRONG_KEY"}'), /CLIENT_ENCRYPTED/);
  const envelope = JSON.parse(Buffer.from(field.envelope, 'base64')); envelope.authTag = Buffer.alloc(16).toString('base64'); assert.throws(() => decodeField({ ...field, envelope: Buffer.from(JSON.stringify(envelope)).toString('base64') }, payload), /CLIENT_ENCRYPTED/);
  write(options.file, { accessToken: field }); let jobs = 0; const image = path.join(options.home, 'WorkBuddy.exe'); fs.copyFileSync(process.execPath, image);
  const reader = createWorkBuddyReader({ ...options, discover: async () => [{ executable: image, sha256: fingerprint(image).sha256 }], job: async (pin, args, request) => { jobs++; assert.equal(pin.executable, image); assert.deepEqual(args.slice(0, 1), ['-e']); assert(args[1].includes('loggerGet')); assert.equal(request.env.ELECTRON_RUN_AS_NODE, '1'); assert.equal(request.env.NODE_OPTIONS, undefined); return { reaped: true, code: 0, stdout: payload }; } });
  assert.equal((await reader.read(new AbortController().signal)).credential, 'SYNTHETIC_ACCESS'); await reader.read(new AbortController().signal); assert.equal(jobs, 1);
  const bad = createWorkBuddyReader({ ...options, discover: async () => [{ executable: image, sha256: '0'.repeat(64) }], job: async () => { throw Error('unverified process spawned'); } }); await assert.rejects(bad.read(new AbortController().signal), /CLIENT_ENCRYPTED/);
  const canceled = new AbortController(); canceled.abort(); await assert.rejects(reader.read(canceled.signal), /CANCELED/);
});
test('desktop credits transport binds identity to fixed billing route and never forwards a refresh token', async () => {
  const calls = []; let requestBody;
  const post = (url, options, callback) => { calls.push({ url, options }); const req = new EventEmitter(); req.destroy = () => {}; req.end = body => { requestBody = JSON.parse(body); setImmediate(() => { const response = new EventEmitter(); response.statusCode = 200; response.destroy = () => {}; callback(response); response.emit('data', Buffer.from('{"code":0,"data":{"Response":{"Data":{"Accounts":[]}}}}')); response.emit('end'); }); }; return req; };
  await readProvider('workbuddy-desktop', 'SYNTHETIC_ACCESS', { project: { desktop: { uid: 'SYNTHETIC_USER', domain: 'copilot.tencent.com' } }, post });
  assert.equal(calls[0].url, 'https://www.codebuddy.cn/v2/billing/meter/get-user-resource'); assert.equal(calls[0].options.headers.Authorization, 'Bearer SYNTHETIC_ACCESS'); assert.equal(calls[0].options.headers['X-User-Id'], 'SYNTHETIC_USER'); assert.equal(calls[0].options.headers.Cookie, undefined); assert.equal(calls[0].options.headers['X-Refresh-Token'], undefined); assert.equal(requestBody.PageSize, 100); assert.deepEqual(requestBody.Status, [0, 3]);
  await assert.rejects(readProvider('workbuddy-desktop', 'SYNTHETIC_ACCESS', { project: { desktop: { uid: 'x\r\ninject', domain: '' } }, post }), /ACTION_INVALID/); assert.equal(calls.length, 1);
});
test('desktop credits preserve exact decimal amounts, missing fields, per-package expiry and partial coverage', () => {
  const resources = fromProvider('workbuddy-desktop', quotaJSON('{"code":0,"data":{"Response":{"Data":{"Accounts":[{"CapacityType":4,"CycleCapacitySize":9007199254740993.125,"CycleCapacityRemain":"20.125","CycleEndTime":"2026-11-01 00:00:00"},{"CapacityType":1,"CapacityRemain":"0","ExpiredTime":"2026-11-02 00:00:00"}]}}}}'), new Date().toISOString());
  assert.equal(resources.pools[0].windows[0].total, '9007199254740993.125'); assert.equal(resources.pools[0].windows[0].remaining, '20.125'); assert.equal(Date.parse(resources.pools[0].windows[0].resetsAt), Date.parse('2026-11-01T00:00:00+08:00')); assert.equal(resources.pools[1].balances[0].total, null); assert.equal(resources.pools[1].balances[0].remaining, '0'); assert.equal(resources.incomplete, true);
  assert.throws(() => fromProvider('workbuddy-desktop', { code: 0, data: {} }, new Date().toISOString()), /RESPONSE_INVALID/);
});
test('client fixture gate precedes credential reads and changed desktop identity never receives old account history', async t => {
  const options = setup(t); write(options.file); const desktop = createWorkBuddyReader(options), client = createClientLogin({ ...options, root: path.join(options.home, 'owned'), toolsRoot: path.join(options.home, 'tools'), desktop });
  let reads = 0; const blocked = createClientLogin({ ...options, fixture: true, desktop: { read: () => { reads++; } } }); await assert.rejects(blocked.login('workbuddy-desktop', new AbortController().signal), /FIXTURE_BLOCKED/); assert.equal(reads, 0);
  const storage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value).map(b => b ^ 127), decryptString: bytes => bytes.map(b => b ^ 127).toString() }, secretStore = new ProviderSecretStore(path.join(options.home, 'secrets'), storage);
  const quota = () => fromProvider('workbuddy-desktop', { code: 0, data: { Response: { Data: { Accounts: [{ CapacityType: 1, CapacityRemain: '0' }] } } } }, new Date().toISOString());
  const service = new ProviderQuotaService(path.join(options.home, 'service'), { clientLogin: client.login, prepare: client.prepare, secretStore, run: async () => { reads++; return quota(); } }); t.after(() => service.close());
  await service.loginWebsite({ adapter: 'workbuddy-desktop', alias: 'synthetic', id: null, consent: true }, true); assert.equal(reads, 1); const row = service.rows[0], before = row.quota;
  const document = JSON.parse(fs.readFileSync(options.file)); document.account.uid = 'OTHER_ACCOUNT'; fs.writeFileSync(options.file, JSON.stringify(document)); await service.refresh(row.id); assert.equal(row.errorCode, 'PROVIDER_CLIENT_ACCOUNT_CHANGED'); assert.equal(row.quota, before); assert.equal(reads, 1);
  assert(!JSON.stringify(service.state()).includes('SYNTHETIC_USER')); assert(!JSON.stringify(service.state()).includes('SYNTHETIC_ACCESS')); await assert.rejects(service.connect({ adapter: 'workbuddy-desktop', alias: 'x', credential: 'SYNTHETIC' }), /ACTION_INVALID/);
});
