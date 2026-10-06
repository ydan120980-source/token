'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { projectQuota, projectCachedQuota, childEnvironment, loginUrlAllowed } = require('../../src/quota/contract');
const { AccountRpc } = require('../../src/quota/rpc');
const { QuotaService } = require('../../src/quota/service');
const sample = { rateLimits: { primary: { usedPercent: 90 } }, rateLimitsByLimitId: { codex: { primary: { usedPercent: 36, windowDurationMins: 300, resetsAt: 1791000000 }, secondary: { usedPercent: null, windowDurationMins: 10080, resetsAt: null } }, extra: { primary: { usedPercent: 120, windowDurationMins: 60, resetsAt: null } } }, rateLimitResetCredits: { availableCount: 2 }, accessToken: 'SECRET_SENTINEL' };
class FakeRpc extends EventEmitter {
  async initialize() {}
  async request(method) { if (this.error) throw new Error('SECRET_SENTINEL'); if (method === 'account/login/start') return { authUrl: 'https://auth.openai.com/oauth/authorize?state=secret', loginId: 'fixture' }; if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus', email: 'SENTINEL@example.com', accessToken: 'SECRET_SENTINEL' } }; if (method === 'account/rateLimits/read') return sample; return {}; }
  close() { this.closed = true; }
}
test('quota ledger prefers per-bucket data, preserves unknowns and projects no secrets', () => {
  const q = projectQuota(sample, '2026-10-03T00:00:00Z');
  assert.deepEqual(q.windows.map(w => [w.usedPercent, w.remainingPercent]), [[36, 64], [null, null], [120, 0]]);
  assert.equal(q.windows[0].durationMins, 300); assert.equal(q.windows[1].resetsAt, null); assert.equal(q.resetCredits, 2);
  assert.equal(JSON.stringify(q).includes('SECRET_SENTINEL'), false);
  assert.deepEqual(projectCachedQuota(q), q);
  assert.equal(projectQuota({}).windows.length, 0);
  assert.equal(projectQuota({ rateLimits: { primary: { usedPercent: NaN, resetsAt: Infinity } } }).windows[0].remainingPercent, null);
});
test('dedicated CLI environment drops all provider credentials, proxy and global Codex overrides', () => {
  const env = childEnvironment('isolated-home', { PATH: 'safe', APPDATA: 'app', OPENAI_API_KEY: 'secret', CODEX_HOME: 'global', HTTPS_PROXY: 'proxy', CODEX_API_KEY: 'secret' });
  assert.deepEqual(env, { PATH: 'safe', APPDATA: 'app', CODEX_HOME: 'isolated-home', RUST_LOG: 'off' });
  for (const value of ['http://auth.openai.com/oauth/authorize', 'https://evil.test/', 'https://auth.openai.com.evil.test/oauth/authorize', 'https://u:p@auth.openai.com/oauth/authorize', 'https://auth.openai.com:444/oauth/authorize', 'https://auth.openai.com/other']) assert.equal(loginUrlAllowed(value), false);
  assert.equal(loginUrlAllowed('https://auth.openai.com/oauth/authorize?state=s'), true);
});
test('RPC denies inference/tools and accepts split frames, sanitizes errors, rejects host requests', async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {}; let options;
  const rpc = new AccountRpc('codex.exe', 'home', (_exe, args, supplied) => { options = supplied; assert.ok(args.includes('cli_auth_credentials_store="keyring"')); return child; });
  const lines = []; child.stdin.on('data', chunk => lines.push(chunk.toString()));
  await assert.rejects(rpc.request('turn/start', {}), /RPC_NOT_ALLOWED/);
  await assert.rejects(rpc.request('account/login/start', { type: 'apiKey', apiKey: 'sentinel' }), /LOGIN_TYPE_REJECTED/);
  const read = rpc.request('account/read', { refreshToken: false }); child.stdout.write('{"id":1,"res'); child.stdout.write('ult":{"account":null}}\n'); assert.deepEqual(await read, { account: null });
  const bad = rpc.request('account/rateLimits/read'); child.stdout.write('{"id":2,"error":{"message":"SECRET_SENTINEL"}}\n'); await assert.rejects(bad, /^Error: CODEX_REQUEST_FAILED$/);
  child.stdout.write('{"id":9,"method":"execCommand","params":{"command":"sentinel"}}\n'); assert.ok(lines.at(-1).includes('Method not supported')); assert.equal(options.shell, false); assert.equal(options.windowsHide, true); rpc.close();
});
test('multiple accounts remain separate; refresh failure and restart retain last valid quota', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentusage-quota-')); const rpcs = [];
  const factory = () => { const rpc = new FakeRpc(); rpcs.push(rpc); return rpc; };
  const service = new QuotaService(directory, 'codex.exe', () => {}, factory);
  assert.equal(service.clients.size, 0); // No child or network on initial launch.
  for (const alias of ['个人', '工作']) { await service.begin(alias); const id = service.login.id; rpcs.at(-1).emit('login', { loginId: 'fixture', success: true }); while (service.busy.has(id)) await new Promise(resolve => setImmediate(resolve)); }
  assert.equal(service.accounts.length, 2); assert.notEqual(service.accounts[0].id, service.accounts[1].id);
  const first = service.accounts[0], before = structuredClone(first.quota);
  service.factory = () => { const rpc = new FakeRpc(); rpc.error = true; return rpc; };
  await service.refresh(first.id); assert.equal(first.status, 'error'); assert.deepEqual(first.quota, before);
  const disk = fs.readFileSync(service.file, 'utf8'); assert.equal(/SECRET_SENTINEL|SENTINEL@example|authUrl|accessToken/.test(disk), false);
  const restored = new QuotaService(directory, 'codex.exe', () => {}, factory); assert.equal(restored.clients.size, 0); assert.deepEqual(restored.accounts[0].quota, before); assert.equal(restored.accounts[0].status, 'cached');
  await service.close(); await restored.close();
});
test('RPC rejects an effective plaintext credential store before any account request', async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); let killed = false;
  child.kill = () => { killed = true; }; const methods = [];
  child.stdin.on('data', chunk => { const message = JSON.parse(chunk.toString()); methods.push(message.method); if (message.id) queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, result: message.method === 'config/read' ? { config: { cli_auth_credentials_store: 'file' } } : {} }) + '\n')); });
  const rpc = new AccountRpc('codex.exe', 'isolated-home', () => child);
  await assert.rejects(rpc.initialize(), /SYSTEM_CREDENTIAL_STORE_REQUIRED/);
  assert.equal(killed, true); assert.deepEqual(methods, ['initialize', 'initialized', 'config/read']);
});
test('cancel/login error do not leak a child and logout affects only selected connection', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentusage-quota-')); const rpcs = [];
  const service = new QuotaService(directory, 'codex.exe', () => {}, () => { const rpc = new FakeRpc(); rpcs.push(rpc); return rpc; });
  await service.begin('cancel'); await service.cancel(); assert.equal(service.accounts.length, 0); assert.equal(rpcs[0].closed, true);
  await service.begin('keep'); const id = service.login.id; rpcs.at(-1).emit('login', { loginId: 'fixture', success: true }); while (service.busy.has(id)) await new Promise(resolve => setImmediate(resolve));
  await service.remove(id); assert.equal(service.accounts.length, 0); assert.equal(service.clients.size, 0);
  service.factory = () => { const rpc = new FakeRpc(); rpc.error = true; return rpc; };
  await assert.rejects(service.begin('failure')); assert.equal(service.login, null); assert.equal(service.clients.size, 0); await service.close();
});
