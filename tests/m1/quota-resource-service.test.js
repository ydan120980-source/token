'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { QuotaService } = require('../../src/quota/service');
const { installResourceReads } = require('../../src/quota/resource-ipc');
const { projectCachedQuota } = require('../../src/quota/contract');
const { NOW, iso } = require('./fixtures/quota-resources');
const { remove } = require('./temp');
const id = '11111111-1111-4111-8111-111111111111';
const legacy = { schemaVersion: 'AccountQuotaV1', fetchedAt: iso(0), windows: [{ bucket: 'codex', name: 'Codex', kind: 'primary', durationMins: 300, usedPercent: 10, resetsAt: iso(3600000) }], resetCredits: 1 };
function setup(t, quota = legacy) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-v2-'));
  const file = path.join(dir, 'quota-cache.json');
  fs.writeFileSync(file, JSON.stringify({ accounts: [{ id, provider: 'codex', alias: 'Synthetic account', plan: 'plus', quota }] }));
  let time = NOW, plan = 'pro', payload = { rateLimits: { primary: { usedPercent: 25, windowDurationMins: 10080, resetsAt: NOW / 1000 + 86400 }, credits: { hasCredits: true, balance: '9.1' } } }, current;
  const calls = [];
  const factory = () => {
    const rpc = current = new EventEmitter(); rpc.initialize = async () => {}; rpc.close = () => {};
    rpc.request = async method => { calls.push(method); if (method === 'account/read') return { account: { type: 'chatgpt', planType: plan, accessToken: 'SECRET' } }; return payload; };
    return rpc;
  };
  const service = new QuotaService(dir, 'synthetic.exe', () => {}, factory, { now: () => time });
  t.after(async () => { await service.close(); await remove(dir); });
  return { service, file, calls, current: () => current, setPayload: value => { payload = value; }, setPlan: value => { plan = value; }, advance: value => { time += value; } };
}

test('V1 cache migrates in memory without writes or RPC; V2 persists only on an existing save and survives restart', async t => {
  const { service, file, calls } = setup(t), original = fs.readFileSync(file, 'utf8');
  const first = service.stateV2(); assert.equal(calls.length, 0); assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(first.schemaVersion, 'QuotaStateV2'); assert.equal(first.accounts[0].quota.provenance.kind, 'legacy-cache');
  assert.equal(first.accounts[0].quota.coverage.cached, 1); assert.equal(first.accounts[0].identityStatus, 'unknown');
  assert.equal(service.state().accounts[0].quota.schemaVersion, 'AccountQuotaV1'); assert(!JSON.stringify(service.state()).includes('resources'));
  await service.refresh(id);
  assert.deepEqual(calls, ['account/read', 'account/rateLimits/read']);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(saved.schemaVersion, 'QuotaCacheV2'); assert.equal(saved.accounts[0].resourceQuota.schemaVersion, 'AccountQuotaV2');
  assert.equal(saved.accounts[0].resourceQuota.pools[0].balances[0].remaining, '9.1'); assert(!JSON.stringify(saved).includes('SECRET'));
  assert.deepEqual(projectCachedQuota(saved.accounts[0].quota), service.state().accounts[0].quota);
  const restored = new QuotaService(service.directory, 'synthetic.exe', () => { throw new Error('startup notification'); }, () => { throw new Error('startup spawn'); }, { now: () => NOW });
  t.after(() => restored.close());
  assert.deepEqual(restored.accounts[0].resources, service.accounts[0].resources); assert.equal(restored.stateV2().accounts[0].quota.coverage.cached, 2);
  first.accounts[0].quota.pools.length = 0; assert(service.stateV2().accounts[0].quota.pools.length > 0);
});

test('fresh snapshots replace old plan windows, credits and reset inventory completely', async t => {
  const { service, setPayload, setPlan } = setup(t); await service.refresh(id);
  assert.deepEqual(service.state().accounts[0].quota.windows.map(w => w.durationMins), [10080]);
  setPlan('free'); setPayload({ rateLimits: { primary: { usedPercent: 0, windowDurationMins: 60 } } }); await service.refresh(id);
  const account = service.stateV2().accounts[0]; assert.equal(account.plan, 'free'); assert.equal(account.quota.entitlement.plan, 'free');
  assert.equal(account.quota.pools[0].balances.length, 0); assert.equal(account.quota.resetCredits, null); assert.equal(account.quota.pools[0].windows[0].durationMins, 60);
  assert.equal(account.planMatchesObservation, true);
  setPayload({ rateLimitsByLimitId: { credits: { credits: { hasCredits: true, balance: '0' } } } }); await service.refresh(id);
  assert.equal(service.stateV2().accounts[0].quota.hasMeasurements, true); assert.equal(service.state().accounts[0].quota.windows.length, 0);
});

test('V2 cache and getter strip unknown fields; private provider identity stays in memory only', async t => {
  const { service, file, setPayload } = setup(t);
  setPayload({ accountId: 'PRIVATE_PROVIDER_ID', accessToken: 'SECRET_TOKEN', rateLimits: { credits: { hasCredits: true, balance: '1', accessToken: 'SECRET_TOKEN' } } });
  await service.refresh(id); assert.equal(service.stateV2().accounts[0].identityStatus, 'server-reported');
  for (const text of [JSON.stringify(service.stateV2()), fs.readFileSync(file, 'utf8')]) assert(!/PRIVATE_PROVIDER_ID|SECRET_TOKEN/.test(text));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')); saved.accounts[0].resourceQuota.accessToken = 'SECRET_CACHE'; saved.accounts[0].resourceQuota.pools[0].balances[0].rawResponse = 'SECRET_CACHE';
  fs.writeFileSync(file, JSON.stringify(saved));
  const restored = new QuotaService(service.directory, 'synthetic.exe'); t.after(() => restored.close());
  assert(!JSON.stringify(restored.stateV2()).includes('SECRET_CACHE')); restored.persist(); assert(!fs.readFileSync(file, 'utf8').includes('SECRET_CACHE'));
});

test('failed publication and failed reads retain both last successful views and their timestamps', async t => {
  const { service, file, setPayload } = setup(t); await service.refresh(id);
  const previous = structuredClone(service.account(id).resources), stored = JSON.parse(fs.readFileSync(file, 'utf8')).accounts[0].resourceQuota;
  const persist = service.persist.bind(service); let fail = true;
  service.persist = (...args) => { if (fail) { fail = false; throw new Error('PRIVATE_PATH'); } return persist(...args); };
  setPayload({ rateLimits: { credits: { hasCredits: true, balance: '999' } } }); await service.refresh(id);
  assert.deepEqual(service.account(id).resources, previous); assert.equal(service.stateV2().accounts[0].status, 'error');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).accounts[0].resourceQuota, stored); assert(!JSON.stringify(service.stateV2()).includes('PRIVATE_PATH'));
});

test('late old-account response cannot replace a V2 observation after an identity notification', async t => {
  const { service, current } = setup(t); await service.refresh(id); const before = structuredClone(service.account(id).resources);
  let resolve;
  service.factory = () => {
    const rpc = new EventEmitter(); rpc.initialize = async () => {}; rpc.close = () => {};
    rpc.request = async method => method === 'account/read' ? { account: { type: 'chatgpt', planType: 'pro' } } : new Promise(done => { resolve = done; });
    return rpc;
  };
  const pending = service.refresh(id); while (!resolve) await new Promise(done => setImmediate(done));
  const active = service.clients.get(id); assert.notEqual(active, current());
  active.emit('accountUpdated', { authMode: 'chatgpt', plan: 'free' });
  resolve({ rateLimits: { primary: { usedPercent: 99 } } }); await pending;
  assert.deepEqual(service.account(id).resources, before); assert.equal(service.stateV2().accounts[0].planMatchesObservation, false);
  assert.equal(service.stateV2().accounts[0].status, 'cached');
});

test('malformed/future V2 cache is quarantined byte-for-byte; snapshot getters never write', async t => {
  const { service } = setup(t); const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-v2-corrupt-')); t.after(() => remove(directory));
  const file = path.join(directory, 'quota-cache.json'), bytes = JSON.stringify({ schemaVersion: 'QuotaCacheV2', accounts: [{ id, provider: 'codex', quota: { schemaVersion: 'AccountQuotaV2', provider: 'codex', pools: 'bad' } }] });
  fs.writeFileSync(file, bytes); const restored = new QuotaService(directory, 'synthetic.exe'); t.after(() => restored.close());
  assert.equal(restored.accounts.length, 0); assert.equal(restored.recovered.code, 'QUOTA_CACHE_INVALID');
  assert.equal(fs.readFileSync(path.join(directory, restored.recovered.quarantined), 'utf8'), bytes);
  assert.equal(fs.existsSync(file), false); const before = fs.readFileSync(service.file, 'utf8'); service.state(); service.stateV2(); assert.equal(fs.readFileSync(service.file, 'utf8'), before);
});

test('headless IPC and preload exercise actual V2 getters, sender guard and controlled failures without a window', t => {
  const { service, calls } = setup(t), handlers = new Map(), sender = {};
  installResourceReads({ handle: (name, fn) => handlers.set(name, fn) }, event => event.sender === sender, service, () => ({ catalog: { codex: { name: 'Codex' } }, now: NOW }));
  const exposed = {}, event = { sender };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/quota/preload.js'), 'utf8'), { require: name => { assert.equal(name, 'electron'); return {
    contextBridge: { exposeInMainWorld: (name, value) => { exposed[name] = value; } }, ipcRenderer: { sendSync: () => ({}), invoke: name => handlers.get(name)(event) }
  }; } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../design/desktop-reference/usage-data.js'), 'utf8'), { window:exposed });
  assert.equal(exposed.quotaBridge.getV2().state.schemaVersion, 'QuotaStateV2'); assert.equal(exposed.usageBridge.connectionsV2().schemaVersion, 'SourceConnectionsV2'); assert.equal(calls.length, 0);
  assert.throws(() => handlers.get('quota:getV2')({ sender: {} }), /IPC_SENDER_REJECTED/);
  assert.throws(() => handlers.get('usage:connectionsV2')({ sender: {} }), /IPC_SENDER_REJECTED/);
  service.stateV2 = () => { throw new Error('SECRET'); };
  assert.equal(exposed.quotaBridge.getV2().state, null); assert(!JSON.stringify(exposed.quotaBridge.getV2()).includes('SECRET'));
  assert.throws(() => exposed.usageBridge.connectionsV2(), /^Error: CONNECTIONS_UNAVAILABLE$/);
});
