'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { RefreshScheduler } = require('../../src/quota/refresh-scheduler');
const { ProviderQuotaService } = require('../../src/quota/provider-service');
const { QuotaService } = require('../../src/quota/service');
const { fromProvider } = require('../../src/quota/provider-resources');
const { remove } = require('./temp');
const tick = () => new Promise(resolve => setImmediate(resolve));
function gate() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }

test('shared pool caps global/provider/CLI work, avoids head-of-line blocking and cancels queued work', async () => {
  const pool = new RefreshScheduler({ limit: 8, perProvider: 4, cliLimit: 2 }), pending = gate(), started = [];
  const enqueue = (provider, cli, key, signal) => pool.run({ provider, cli, key, signal }, async () => { started.push(key); await pending.promise; });
  const tasks = Array.from({ length: 6 }, (_, i) => enqueue('codex', true, 'cli-' + i));
  tasks.push(...Array.from({ length: 6 }, (_, i) => enqueue('workbuddy', false, 'wb-' + i)));
  tasks.push(...Array.from({ length: 3 }, (_, i) => enqueue('other', false, 'other-' + i)));
  const abort = new AbortController(), canceled = enqueue('codex', true, 'must-not-start', abort.signal);
  const rejection = assert.rejects(canceled, /PROVIDER_CANCELED/); abort.abort(); await rejection; await tick();
  assert.equal(pool.active, 8); assert.equal(pool.cliActive, 2); assert.equal(pool.providers.get('workbuddy'), 4); assert(started.some(key => key.startsWith('other'))); assert(!started.includes('must-not-start'));
  pending.release(); await Promise.all(tasks); assert.deepEqual(pool.state(), { limit: 8, perProvider: 4, cliLimit: 2, active: 0, queued: 0 }); assert.equal(pool.keys.size, 0);
});

test('a shared login home is serialized while unrelated reads and failures continue', async () => {
  const pool = new RefreshScheduler(), pending = gate(); let same = 0, maximum = 0, unrelated = false;
  const run = () => pool.run({ provider: 'claude', key: 'same-owned-home' }, async () => { same++; maximum = Math.max(maximum, same); await pending.promise; same--; });
  const a = run(), b = run(), failure = pool.run({ provider: 'other' }, async () => { unrelated = true; throw Error('synthetic'); });
  await assert.rejects(failure, /synthetic/); await tick(); assert.equal(same, 1); assert.equal(unrelated, true);
  pending.release(); await Promise.all([a, b]); assert.equal(maximum, 1); assert.equal(pool.active, 0);
});

test('Codex and providers share the pool, complete independently, preserve every committed result and skip deleted queued rows', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-parallel-')); t.after(() => remove(root));
  const pool = new RefreshScheduler({ limit: 8, perProvider: 4, cliLimit: 4 }), hold = gate(); let active = 0, peak = 0, providerReads = 0;
  const enter = async () => { active++; peak = Math.max(peak, active); await hold.promise; active--; };
  class Rpc extends EventEmitter { async initialize() {} async request(method) { if (method === 'account/read') return { account: { type: 'chatgpt', planType: 'plus' } }; await enter(); return { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300 } } }; } close() {} }
  const codex = new QuotaService(path.join(root, 'codex'), 'synthetic', () => {}, () => new Rpc(), { scheduler: pool });
  const providers = new ProviderQuotaService(path.join(root, 'providers'), { scheduler: pool, run: async () => { providerReads++; await enter(); return fromProvider('deepseek-api', { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '7' }] }, new Date().toISOString()); } });
  t.after(async () => { await codex.close(); await providers.close(); });
  codex.accounts = Array.from({ length: 10 }, () => ({ id: randomUUID(), provider: 'codex', alias: 'synthetic', status: 'cached' }));
  providers.rows = Array.from({ length: 10 }, () => ({ id: randomUUID(), adapter: 'deepseek-api', provider: 'deepseek', alias: 'synthetic', quota: null, status: 'cached' }));
  for (const row of providers.rows) providers.secrets.set(row.id, 'SYNTHETIC_SECRET');
  const c = codex.refreshAll(), p = providers.refreshAll(); await tick(); assert.equal(active, 8); assert.equal(peak, 8);
  const deleted = providers.rows.at(-1).id; providers.remove(deleted);
  hold.release(); await Promise.all([c, p]); await providers.tail;
  assert.equal(providerReads, 9); assert.equal(codex.accounts.filter(row => row.quota).length, 10);
  const saved = JSON.parse(fs.readFileSync(providers.file)); assert.equal(saved.connections.length, 9); assert(saved.connections.every(row => row.quota.pools.length === 1)); assert(!saved.connections.some(row => row.id === deleted));
  assert.equal(pool.active, 0); assert.equal(pool.queue.length, 0); assert.equal(codex.busy.size, 0); assert.equal(providers.busy.size, 0);
});

test('automatic provider work starts before a slow Codex batch finishes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-auto-parallel-')); t.after(() => remove(root));
  const service = new QuotaService(root, null, () => {}, undefined, { setTimeout: () => 1, clearTimeout: () => {} }); t.after(() => service.close());
  const hold = gate(); let providers = 0; service.refreshAll = () => hold.promise; service.refreshProviders = async () => { providers++; return { success: 1, failed: 0, skipped: 0 }; };
  service.setAutoRefresh('1min'); service.nextAutoAt = new Date(0).toISOString(); const run = service.resume(); await tick(); assert.equal(providers, 1);
  hold.release(); await run; service.setAutoRefresh('off');
});


test('a CLI slot remains reserved until the owned child has finished closing', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-reaping-')); t.after(() => remove(root));
  const pool = new RefreshScheduler({ limit: 4, cliLimit: 1 }), closing = gate(); let spawned = 0;
  class Rpc extends EventEmitter {
    async initialize() {}
    async request(method) { return method === 'account/read' ? { account: { type: 'chatgpt', planType: 'plus' } } : { rateLimits: { primary: { usedPercent: 12, windowDurationMins: 300 } } }; }
    close() { return closing.promise; }
  }
  const service = new QuotaService(root, 'synthetic', () => {}, () => { spawned++; return new Rpc(); }, { scheduler: pool }); t.after(() => service.close());
  service.accounts = Array.from({ length: 2 }, () => ({ id: randomUUID(), provider: 'codex', alias: 'synthetic', status: 'cached' }));
  const batch = service.refreshAll(); await tick(); assert.equal(spawned, 1); assert.equal(pool.cliActive, 1); assert.equal(pool.queue.length, 1);
  closing.release(); await batch; assert.equal(spawned, 2); assert.equal(pool.cliActive, 0); assert.equal(service.reaping.size, 0);
});
