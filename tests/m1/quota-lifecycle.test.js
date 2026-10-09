'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { QuotaService } = require('../../src/quota/service');
const { AccountRpc } = require('../../src/quota/rpc');
const { remove } = require('./temp');
const { PassThrough } = require('node:stream');
test('RPC read timeout is bounded at 60 seconds and safely removes pending state', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const rpc = new AccountRpc('codex.exe', 'home', () => child);
  const read = rpc.request('account/read'), rejected = assert.rejects(read, /^Error: CODEX_REQUEST_TIMEOUT$/);
  t.mock.timers.tick(59999); assert.equal(rpc.pending.size, 1); t.mock.timers.tick(1); await rejected; assert.equal(rpc.pending.size, 0); await rpc.close();
});
test('account update invalidates an in-flight result and keeps it historical', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-notification-'));
  let current, resolveRead;
  const factory = () => { const rpc = new EventEmitter(); current = rpc; rpc.close = () => {}; rpc.initialize = async () => {}; rpc.request = async method => {
    if (method === 'account/login/start') return { loginId: 'login', authUrl: 'https://auth.openai.com/oauth/authorize' };
    if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } };
    if (method === 'account/rateLimits/read') return resolveRead === undefined ? { rateLimits: { primary: { usedPercent: 10 } } } : new Promise(resolve => { resolveRead = resolve; });
    return {};
  }; return rpc; };
  const service = new QuotaService(directory, 'codex.exe', () => {}, factory);
  t.after(async () => { await service.close(); await remove(directory); });
  await service.begin('A'); const id = service.login.id; current.emit('login', { loginId: 'login', success: true });
  current.emit('accountUpdated'); await service.tail; await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.account(id).status, 'ready'); const previous = structuredClone(service.account(id).quota);
  resolveRead = null; const pending = service.refresh(id); await new Promise(resolve => setImmediate(resolve));
  current.emit('accountUpdated', { authMode: 'chatgpt', plan: 'plus' }); assert.equal(service.account(id).status, 'refreshing'); assert.equal(service.clients.size, 1);
  current.emit('accountUpdated');
  resolveRead({ rateLimits: { primary: { usedPercent: 99 } } }); await pending;
  assert.equal(service.account(id).status, 'cached'); assert.deepEqual(service.account(id).quota, previous);
});
test('RPC close waits for an actual owned child to exit and rejects pending reads', async () => {
  let child;
  const rpc = new AccountRpc('codex.exe', 'home', () => { child = spawn(process.execPath, ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); return child; });
  const pending = rpc.request('account/read'); const rejected = assert.rejects(pending, /CODEX_PROCESS_EXITED/);
  await rpc.close(); await rejected; assert.ok(child.exitCode !== null || child.signalCode !== null); assert.equal(rpc.pending.size, 0);
});
test('oversized protocol is discarded and closed RPC ignores late notifications', async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const rpc = new AccountRpc('synthetic.exe', 'home', () => child); let notifications = 0;
  rpc.on('login', () => { notifications++; });
  const pending = rpc.request('account/read'), rejected = assert.rejects(pending, /CODEX_PROTOCOL_LIMIT/);
  child.stdout.write('x'.repeat(2 * 1024 * 1024 + 1)); await rejected;
  child.stdout.write(JSON.stringify({ method: 'account/login/completed', params: { loginId: 'late', success: true } }) + '\n');
  assert.equal(rpc.pending.size, 0); assert.equal(rpc.buffer, ''); assert.equal(notifications, 0); await rpc.close();
});
test('selected logout consumes its own auth notification without canceling removal', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-logout-event-'));
  const id = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(path.join(directory, 'quota-cache.json'), JSON.stringify({ accounts: [{ id, provider: 'codex', alias: 'A', plan: 'plus', quota: { schemaVersion: 'AccountQuotaV1', fetchedAt: '2026-10-03T00:00:00Z', windows: [], resetCredits: null } }] }));
  const rpc = new EventEmitter(); rpc.initialize = async () => {}; rpc.close = () => {};
  rpc.request = async method => { if (method === 'account/logout') rpc.emit('accountUpdated', { authMode: null, plan: null }); return {}; };
  const service = new QuotaService(directory, 'codex.exe', () => {}, () => rpc);
  t.after(async () => { await service.close(); await remove(directory); });
  await service.remove(id); assert.equal(service.accounts.length, 0); assert.equal(service.clients.size, 0);
});
test('a damaged quota cache is quarantined and the app starts with no accounts', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-cache-recovery-')), file = path.join(directory, 'quota-cache.json');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  // Truncated JSON previously escaped as a raw SyntaxError; an oversized account
  // list threw QUOTA_CACHE_INVALID; both aborted start-up.
  for (const [bytes, code] of [['{"accounts":[', 'QUOTA_CACHE_INVALID'], [JSON.stringify({ accounts: new Array(21).fill({ id: 'x', provider: 'codex' }) }), 'QUOTA_CACHE_INVALID']]) {
    fs.writeFileSync(file, bytes);
    const service = new QuotaService(directory, 'codex.exe', () => {}, () => { throw new Error('unused'); });
    await service.close();
    assert.equal(service.accounts.length, 0, 'no accounts are invented from the damaged file');
    assert.equal(service.state().recovered.code, code);
    assert.equal(service.state().recovered.file, 'quota-cache.json');
    assert.match(service.state().recovered.quarantined, /^quarantine\/quota-cache-.*\.json$/);
    assert.equal(fs.readFileSync(path.join(directory, service.state().recovered.quarantined), 'utf8'), bytes, 'the bytes stay on disk for inspection');
    assert.ok(!fs.existsSync(file));
    fs.rmSync(path.join(directory, 'quarantine'), { recursive: true, force: true });
  }
  const healthy = new QuotaService(directory, 'codex.exe', () => {}, () => { throw new Error('unused'); });
  await healthy.close();
  assert.equal(healthy.state().recovered, null, 'a clean start reports no recovery');
});
