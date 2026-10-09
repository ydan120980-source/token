'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { QuotaService } = require('../../src/quota/service');
const { AccountRpc } = require('../../src/quota/rpc');
const { rpcErrorCode } = require('../../src/quota/errors');
const { remove } = require('./temp');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const quota = identity => ({ accountId: identity, rateLimits: { primary: { usedPercent: 150, windowDurationMins: 300, resetsAt: 1 } } });
class Rpc extends EventEmitter {
  async initialize() { if (this.init) await this.init.promise; }
  async request(method) {
    this.calls.push(method);
    if (this.error) throw new Error(this.error);
    if (method === 'account/login/start') return { loginId: 'login', authUrl: 'https://auth.openai.com/oauth/authorize?state=SECRET' };
    if (method === 'account/read') return { account: { type: 'chatgpt', email: null, planType: 'plus' } };
    if (method === 'account/rateLimits/read') { if (this.read) await this.read.promise; return quota(this.identity); }
    return {};
  }
  close() { this.closed = true; }
  constructor() { super(); this.calls = []; }
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-stability-')), rpcs = [], timers = new Map(); let time = Date.parse('2026-10-03T01:00:00Z'), next = 0;
  const service = new QuotaService(directory, 'codex.exe', () => {}, () => { const rpc = new Rpc(); rpcs.push(rpc); return rpc; }, { now: () => time, setTimeout: (fn, delay) => { timers.set(++next, { fn, delay }); return next; }, clearTimeout: id => timers.delete(id) });
  t.after(async () => { await service.close(); await remove(directory); });
  const add = async alias => { await service.begin(alias); const id = service.login.id; rpcs.at(-1).emit('login', { loginId: 'login', success: true }); await service.tail; await tick(); return id; };
  return { service, rpcs, timers, add, advance: ms => { time += ms; } };
}
test('one queue serializes accounts and suppresses same-account overlapping reads', async t => {
  const { service, add, rpcs } = fixture(t); const a = await add('A'), b = await add('B');
  const read = deferred(); service.factory = () => { const rpc = new Rpc(); rpc.read = read; rpcs.push(rpc); return rpc; };
  const all = service.refreshAll(); await tick(); const started = rpcs.length;
  assert.equal(service.busy.size, 2); await service.refresh(a); assert.equal(rpcs.length, started);
  assert.equal(rpcs.at(-1).calls.includes('account/rateLimits/read'), true);
  read.resolve(); await all; assert.equal(rpcs.length, started + 1);
  assert.deepEqual(service.state().lastBatch, { success: 2, failed: 0, skipped: 0 }); assert.equal(service.busy.size, 0); assert.ok(service.account(b).quota);
});
test('safe failure cooldown preserves last success; manual and all cannot bypass it', async t => {
  const { service, add, advance } = fixture(t), id = await add('A'); const previous = structuredClone(service.account(id).quota);
  service.factory = () => { const rpc = new Rpc(); rpc.error = 'SECRET rate limit http429'; return rpc; };
  advance(1); await service.refresh(id); const failed = service.account(id);
  assert.equal(failed.errorCode, 'CODEX_REQUEST_FAILED'); assert.deepEqual(failed.quota, previous); assert.notEqual(failed.lastAttempt, previous.fetchedAt);
  await service.refreshAll(); assert.deepEqual(service.lastBatch, { success: 0, failed: 0, skipped: 1 });
  advance(60000); service.factory = () => { const rpc = new Rpc(); rpc.error = 'RATE_LIMITED'; return rpc; }; await service.refresh(id);
  assert.equal(Date.parse(failed.nextRefreshAt) - Date.parse(failed.lastAttempt), 15 * 60000);
  assert.equal(rpcErrorCode({ message: '429 rateLimitExceeded SECRET' }), 'CODEX_REQUEST_FAILED');
  assert.equal(rpcErrorCode({ data: { codexErrorInfo: 'rateLimitExceeded' } }), 'RATE_LIMITED');
  assert.equal(fs.readFileSync(service.file, 'utf8').includes('SECRET'), false);
});
test('cancel during initialization cannot resurrect a connection or open an auth URL', async t => {
  const { service } = fixture(t), init = deferred(), rpc = new Rpc(); rpc.init = init; service.factory = () => rpc;
  const begin = service.begin('cancel'); await tick(); await service.cancel(); const disk = fs.readFileSync(service.file, 'utf8');
  init.resolve(); await assert.rejects(begin, /CANCELED/); assert.equal(service.accounts.length, 0); assert.equal(service.clients.size, 0); assert.equal(rpc.closed, true); assert.deepEqual(rpc.calls, []); assert.equal(fs.readFileSync(service.file, 'utf8'), disk);
});
test('login expires after five minutes and releases only the pending connection', async t => {
  const { service, add, timers } = fixture(t); const keep = await add('keep'); await service.begin('expire');
  const active = service.login.id, timer = [...timers.values()][0]; assert.equal(timer.delay, 5 * 60000);
  timer.fn(); await tick(); assert.equal(service.login, null); assert.deepEqual(service.accounts.map(a => a.id), [keep]); assert.equal(service.clients.has(active), false);
});
test('login required preserves historical quota, and cache rejects untrusted operational fields', async t => {
  const { service, add } = fixture(t), id = await add('A'); const previous = structuredClone(service.account(id).quota);
  service.factory = () => { const rpc = new Rpc(); rpc.request = async () => ({ account: null }); return rpc; }; await service.refresh(id);
  assert.equal(service.account(id).status, 'login-required'); assert.deepEqual(service.account(id).quota, previous);
  const saved = JSON.parse(fs.readFileSync(service.file, 'utf8')); saved.accounts[0].lastAttempt = 'SECRET'; saved.accounts[0].errorCode = 'SECRET'; saved.accounts[0].nextRefreshAt = 'SECRET'; saved.accounts[0].accountId = 'SECRET'; fs.writeFileSync(service.file, JSON.stringify(saved));
  const restored = new QuotaService(service.directory, 'codex.exe'); assert.equal(restored.accounts[0].lastAttempt, null); assert.equal(restored.accounts[0].errorCode, null); assert.equal(restored.accounts[0].nextRefreshAt, null); assert.equal(JSON.stringify(restored.state()).includes('SECRET'), false); await restored.close();
});
test('remove invalidates a delayed refresh and serializes logout; close never writes late results', async t => {
  const { service, add } = fixture(t), id = await add('A'), read = deferred(); let rpc;
  service.factory = () => { rpc = new Rpc(); rpc.read = read; return rpc; };
  const refresh = service.refresh(id); await tick(); const remove = service.remove(id); assert.equal(rpc.closed, true);
  read.resolve(); await Promise.all([refresh, remove]); assert.equal(service.accounts.length, 0); assert.equal(service.busy.size, 0);
  const keep = await add('B'), late = deferred(); service.factory = () => { const result = new Rpc(); result.read = late; return result; };
  const pending = service.refresh(keep); await tick(); const before = fs.readFileSync(service.file, 'utf8'); let notifications = 0; service.changed = () => { notifications++; };
  await service.close(); late.resolve(); await pending; assert.equal(notifications, 0); assert.equal(fs.readFileSync(service.file, 'utf8'), before); assert.equal(service.clients.size, 0);
});
test('auto starts off, wake runs one due batch and restart does not enable network', async t => {
  const { service, add, advance, timers } = fixture(t); await add('A');
  assert.equal(service.autoRefresh, 'off'); assert.equal(timers.size, 0);
  service.setAutoRefresh('1min'); assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay,60000);
  const previous = service.accounts[0].lastAttempt;
  service.suspend(); advance(59999); await service.resume(); assert.equal(service.accounts[0].lastAttempt,previous);
  service.suspend(); advance(1); await service.resume(); assert.notEqual(service.accounts[0].lastAttempt,previous);
  assert.throws(()=>service.setAutoRefresh('5min'),/CANCELED/);
  service.suspend(); advance(40 * 60000); await service.resume();
  assert.deepEqual(service.lastBatch, { success: 1, failed: 0, skipped: 0 }); assert.equal(timers.size, 1);
  const last = service.account(service.accounts[0].id).lastAttempt; await service.resume(); assert.equal(service.accounts[0].lastAttempt, last);
  service.setAutoRefresh('off'); advance(40 * 60000); await service.resume(); assert.equal(timers.size, 0);
  const restored = new QuotaService(service.directory, 'codex.exe'); assert.equal(restored.autoRefresh, 'off'); assert.equal(restored.clients.size, 0); assert.equal(restored.accounts[0].status, 'cached'); await restored.close();
});
test('optional identities never leave main memory; known duplicates and changes are explicit', async t => {
  const { service, add } = fixture(t), a = await add('A'), b = await add('B');
  service.factory = () => { const rpc = new Rpc(); rpc.identity = 'PRIVATE_ACCOUNT_ID'; return rpc; }; await service.refreshAll();
  assert.ok(service.state().accounts.every(account => account.duplicateKnown)); assert.equal(JSON.stringify(service.state()).includes('PRIVATE_ACCOUNT_ID'), false); assert.equal(fs.readFileSync(service.file, 'utf8').includes('PRIVATE_ACCOUNT_ID'), false);
  const previous = structuredClone(service.account(a).quota); service.factory = () => { const rpc = new Rpc(); rpc.identity = 'DIFFERENT_PRIVATE'; return rpc; }; await service.refresh(a);
  assert.equal(service.account(a).status, 'login-required'); assert.deepEqual(service.account(a).quota, previous);
  service.factory = () => new Rpc(); await service.refresh(b); assert.equal(service.state().accounts.find(account => account.id === b).duplicateKnown, false);
});

test('minute refresh never replays elapsed ticks after a slow batch and off cancels rearming', async t => {
  const { service, add, advance, timers } = fixture(t); await add('slow');
  const read = deferred(); service.factory = () => { const rpc = new Rpc(); rpc.read = read; return rpc; };
  service.setAutoRefresh('1min'); service.suspend(); advance(60000);
  const pending = service.resume(); await tick(); advance(120000); read.resolve(); await pending;
  assert.equal([...timers.values()][0].delay,60000);
  const second = deferred(); service.factory = () => { const rpc = new Rpc(); rpc.read = second; return rpc; };
  service.suspend(); advance(60000); const stopped = service.resume(); await tick(); service.setAutoRefresh('off'); second.resolve(); await stopped;
  assert.equal(service.nextAutoAt,null); assert.equal(timers.size,0);
});
test('server request ID collision cannot resolve a pending quota read; invalid frames fail safely', async () => {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const rpc = new AccountRpc('codex.exe', 'home', () => child), writes = []; child.stdin.on('data', data => writes.push(data.toString()));
  let settled = false; const read = rpc.request('account/read').then(result => { settled = true; return result; });
  child.stdout.write('{"id":1,"method":"execCommand","params":{"SECRET":"ignored"}}\n'); await tick(); assert.equal(settled, false); assert.match(writes.at(-1), /-32601/);
  child.stdout.write('{"id":1,"result":{"account":null}}\n'); assert.deepEqual(await read, { account: null });
  let notification; rpc.on('accountUpdated', event => { notification = event; });
  child.stdout.write('{"method":"account/updated","params":{"authMode":"chatgpt","planType":"plus","accessToken":"SECRET"}}\n');
  assert.deepEqual(notification, { authMode: 'chatgpt', plan: 'plus' });
  const broken = rpc.request('account/read'); child.stdout.write('null\n'); await assert.rejects(broken, /CODEX_PROTOCOL_INVALID/); rpc.close();
});
