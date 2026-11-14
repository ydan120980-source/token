'use strict';
// GitHub identity and sync against a fake transport; no test here reaches GitHub. Application updates are separate
// (tests/m1/update-service.test.js): they need no GitHub account and live in update-service.js.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { GithubService, openable } = require('../../src/quota/github-service');
const { payload } = require('../../src/m1/github-sync-payload');
const { create } = require('../../src/quota/github-transport');
const flush = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };
function setup(t, transport, snapshot = async () => ({ daily: [] })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let held = null; const secrets = { available: () => true, get: () => held, set: value => { held = value; }, clear: () => { held = null; } };
  const service = new GithubService(dir, { transport, secrets, snapshot, wait: async () => {} });
  return { dir, service, secrets, held: () => held };
}
const fake = (answers = [{ status: 'pending' }, { status: 'slow_down' }, { status: 'authorized', token: 'demo-token-value' }]) => ({
  polled: 0, puts: [],
  startDevice: async () => ({ deviceCode: 'dc', userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device', expiresIn: 900, interval: 5 }),
  async pollDevice() { return answers[this.polled++] ?? { status: 'pending' }; },
  user: async () => ({ login: 'demo-user', name: '示例用户', avatar: 'data:image/png;base64,AAAA' }),
  privateRepositories: async () => [{ fullName: 'demo-user/usage-data' }, { fullName: 'bad name' }],
  async put(token, repository, file, text) { this.puts.push({ token, repository, file, text }); return { committedAt: 'x' }; },
});

test('without a transport the app says it is not configured and makes no request', async t => {
  assert.equal(create(''), null, 'an unconfigured app makes no GitHub requests');
  const { service } = setup(t, null);
  assert.equal(service.state().configured, false);
  await assert.rejects(service.connect(), /GITHUB_NOT_CONFIGURED/);
});

test('the configured transport runs validation in its child and returns only the public error code', async t => {
  const transport = create('Iv1.demoClient');
  t.after(() => transport.close());
  await assert.rejects(transport.user('x'), { message: 'GITHUB_AUTH_REQUIRED' });
});

test('device flow: the code shows while waiting, the token never reaches state or a file', async t => {
  const transport = fake(), { service, dir, held } = setup(t, transport);
  const pending = await service.connect();
  assert.equal(pending.connection.status, 'pending'); assert.equal(pending.connection.device.userCode, 'WDJB-MJHT');
  await flush();
  const state = service.state();
  assert.equal(state.connection.status, 'connected'); assert.equal(state.connection.login, 'demo-user');
  assert.equal(transport.polled, 3); assert.equal(held().token, 'demo-token-value');
  assert(!JSON.stringify(state).includes('demo-token-value'));
  assert(!fs.readFileSync(path.join(dir, 'github.json'), 'utf8').includes('demo-token-value'));
});

test('denied, expired and cancelled leave nothing connected and say which', async t => {
  for (const [answer, code] of [[{ status: 'denied' }, 'GITHUB_DENIED'], [{ status: 'expired' }, 'GITHUB_CODE_EXPIRED']]) {
    const { service, held } = setup(t, fake([answer])); await service.connect(); await flush();
    assert.equal(service.state().connection.status, 'none'); assert.equal(service.state().connection.error, code); assert.equal(held(), null);
  }
  const { service } = setup(t, fake([])); await service.connect(); assert.equal(service.cancel().connection.status, 'none');
});

test('sync sends only day rows to the chosen repository, in this machine\'s own file', async t => {
  const snapshot = async () => ({ timezone: 'Asia/Shanghai', sourceCatalog: { 'custom-a': { custom: true } }, daily: [
    { date: '2026-11-01', agent: 'codex', model: 'demo-model', provider: 'demo', entry: 'cli', totalTokens: 10, inputUncached: null, output: 2, cacheRead: 0, cacheWrite: null, reasoning: null, records: 1, estimatedCostUsd: 0.5, estimatedCostUpperUsd: 0.5, cwd: 'C:\\secret\\project', project: '秘密项目', sessionKey: 'k', sessionId: 'id', text: 'hello' },
    { date: '2026-11-01', agent: 'custom-a', model: 'x', totalTokens: 1 },
  ] });
  const transport = fake(), { service } = setup(t, transport, snapshot);
  await service.connect(); await flush();
  service.setSync({ enabled: true, repository: 'demo-user/usage-data' });
  const state = await service.syncNow();
  assert.equal(state.sync.status, 'ok'); assert.equal(state.sync.days, 1);
  const sent = transport.puts[0], body = JSON.parse(sent.text);
  assert.equal(sent.repository, 'demo-user/usage-data'); assert.match(sent.file, /^agent-usage\/[a-f0-9-]{36}\.json$/);
  assert.deepEqual(Object.keys(body.days[0]).sort(), ['agent', 'cacheRead', 'cacheWrite', 'date', 'estimatedCostUpperUsd', 'estimatedCostUsd', 'inputUncached', 'model', 'output', 'reasoning', 'records', 'totalTokens'].sort());
  assert.equal(body.days[0].inputUncached, null, 'unknown stays unknown');
  for (const secret of ['secret', '秘密', 'sessionKey', 'custom-a', 'hello']) assert(!sent.text.includes(secret), secret);
  assert.throws(() => payload({}, 'd', 'a'), /GITHUB_SYNC_SNAPSHOT_INVALID/);
});

test('sync refuses a repository name it cannot trust, and a failed write says why and keeps the last success', async t => {
  const transport = fake(), { service } = setup(t, transport);
  await service.connect(); await flush();
  assert.throws(() => service.setSync({ enabled: true, repository: '../etc' }), /GITHUB_REPOSITORY_INVALID/);
  assert.deepEqual((await service.listRepositories()).repositories, ['demo-user/usage-data']);
  service.setSync({ enabled: true, repository: 'demo-user/usage-data' });
  const first = await service.syncNow();
  transport.put = async () => { throw new Error('GITHUB_RATE_LIMITED'); };
  const second = await service.syncNow();
  assert.equal(second.sync.error, 'GITHUB_RATE_LIMITED'); assert.equal(second.sync.lastSuccess, first.sync.lastSuccess);
});

test('a rejected token marks the account expired, and disconnecting forgets it and stops sync', async t => {
  const transport = fake(), { service, held } = setup(t, transport);
  await service.connect(); await flush();
  service.setSync({ enabled: true, repository: 'demo-user/usage-data' });
  transport.put = async () => { throw new Error('GITHUB_AUTH_REQUIRED'); };
  assert.equal((await service.syncNow()).connection.status, 'expired');
  const out = service.disconnect();
  assert.equal(out.connection.status, 'none'); assert.equal(out.sync.enabled, false); assert.equal(held(), null);
});

test('only the fixed GitHub pages may be opened', async () => {
  assert(openable('https://github.com/login/device')); assert(openable('https://github.com/ydan120980-source/token/releases/tag/v1'));
  assert(openable('https://github.com/settings/installations'));
  for (const bad of ['http://github.com/login/device', 'https://evil.example/login/device', 'https://github.com/login/device/x', 'https://github.com/other/repo/releases/1', 'https://a@github.com/login/device']) assert(!openable(bad), bad);
});
