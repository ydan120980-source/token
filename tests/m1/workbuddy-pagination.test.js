'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { readWorkBuddyPackages, PAGE_SIZE, MAX_PAGES } = require('../../src/quota/workbuddy-packages');
const { fromProvider } = require('../../src/quota/provider-resources');
const { readProvider } = require('../../src/quota/provider-http');
const { projectResources } = require('../../src/quota/resource-contract');
const { ProviderQuotaService } = require('../../src/quota/provider-service');
const { remove } = require('./temp');
const at = '2026-10-22T00:00:00.000Z';
const item = index => ({ CapacityType: 1, PackageName: 'synthetic-package-' + index, CapacitySize: '9007199254740993.125', CapacityRemain: '20.125', ExpiredTime: '2026-11-01 00:00:00' });
const page = (items, total) => ({ code: 0, data: { Response: { Data: { Accounts: items, ...(total === undefined ? {} : { TotalCount: total }) } } } });
const project = { desktop: { uid: 'PRIVATE_USER', domain: 'copilot.tencent.com' } };
const source = count => async (_adapter, _token, options) => page(Array.from({ length: Math.min(PAGE_SIZE, Math.max(0, count - (options.pageNumber - 1) * PAGE_SIZE)) }, (_, index) => item((options.pageNumber - 1) * PAGE_SIZE + index)), count);

test('more than one page preserves exact amounts, labels, expiry and complete coverage through normalization and restore', async () => {
  const calls = [], read = source(205);
  const value = await readWorkBuddyPackages('PRIVATE_TOKEN', { project, read: async (...args) => { calls.push(args[2]); return read(...args); } });
  assert.deepEqual(calls.map(row => row.pageNumber), [1, 2, 3, 4]); assert(calls.every(row => row.workbuddyAt === calls[0].workbuddyAt));
  const quota = fromProvider('workbuddy-desktop', value.raw, at, value); assert.equal(quota.pools.length, 205); assert.equal(quota.incomplete, false);
  assert.equal(quota.pools[204].label, 'synthetic-package-204'); assert.equal(quota.pools[204].balances[0].remaining, '20.125'); assert.equal(quota.pools[0].balances[0].total, '9007199254740993.125'); assert.equal(quota.pools[0].balances[0].expiresAt, '2026-10-31T16:00:00.000Z');
  assert.deepEqual(projectResources(JSON.parse(JSON.stringify(quota))), quota);
  assert.equal(fromProvider('workbuddy-desktop', value.raw, at).incomplete, true, 'an unproven response never implies completed pagination');
});

test('short pages need a following empty page, while page cap remains partial and bounded', async () => {
  const calls = [];
  const value = await readWorkBuddyPackages('PRIVATE_TOKEN', { read: async (_a, _t, { pageNumber }) => { calls.push(pageNumber); return page(pageNumber === 1 ? [item(1)] : pageNumber === 2 ? [item(2)] : []); } });
  assert.deepEqual(calls, [1, 2, 3]); assert.equal(value.raw.data.Response.Data.Accounts.length, 2); assert.equal(value.completePackages, true);
  let reads = 0; const read = source(1200);
  const limited = await readWorkBuddyPackages('PRIVATE_TOKEN', { read: async (...args) => { reads++; return read(...args); } });
  assert.equal(reads, MAX_PAGES); assert.equal(limited.completePackages, false); assert.equal(limited.raw.data.Response.Data.Accounts.length, 1000);
  const quota = fromProvider('workbuddy-desktop', limited.raw, at, limited); assert.equal(quota.pools.length, 1000); assert.equal(quota.incomplete, true);
  assert.equal(projectResources({ ...quota, pools: [...quota.pools, { ...quota.pools[0], id: 'too-many' }] }), null);
  assert.equal(projectResources({ ...quota, provider: 'deepseek' }), null, 'other providers retain the existing pool limit');
});

test('overlapping pages preserve only preceding verified packages and mark coverage incomplete', async () => {
  for (const read of [
    async () => page([item(1)]),
    async (_a, _t, { pageNumber }) => page(pageNumber === 1 ? [item(1), item(2)] : [item(2), item(3)]),
    async (_a, _t, { pageNumber }) => page([{ ...item(1), CapacityRemain: String(pageNumber) }]),
  ]) {
    const value = await readWorkBuddyPackages('PRIVATE_TOKEN', { read });
    assert.equal(value.completePackages, false);
    assert(value.raw.data.Response.Data.Accounts.length > 0);
    assert.equal(new Set(value.raw.data.Response.Data.Accounts.map(row => row.PackageName)).size, value.raw.data.Response.Data.Accounts.length);
  }
});

test('changing or contradictory counts still fail without publishing misleading coverage', async () => {
  for (const read of [
    async (_a, _t, { pageNumber }) => page(pageNumber === 1 ? [item(1)] : [], 2),
    async (_a, _t, { pageNumber }) => page([item(pageNumber)], pageNumber === 1 ? 5 : 6),
    async () => page([item(1)], -1),
    async () => page([item(1)], '1'),
    async () => page([item(1)], 0),
    async () => page(new Array(101).fill(item(1))),
    async () => ({ code: 0, data: {} })
  ]) await assert.rejects(readWorkBuddyPackages('PRIVATE_TOKEN', { read }), /PROVIDER_RESPONSE_INVALID/);
});

test('later-page auth, redirect, rate, timeout and cancellation errors propagate atomically; aggregate bytes are bounded', async () => {
  for (const error of ['PROVIDER_AUTH_REQUIRED', 'PROVIDER_REDIRECT_REJECTED', 'PROVIDER_RATE_LIMITED', 'PROVIDER_TIMEOUT']) await assert.rejects(readWorkBuddyPackages('PRIVATE_TOKEN', { read: async (_a, _t, { pageNumber }) => { if (pageNumber === 2) throw Error(error); return page([item(1)]); } }), new RegExp(error));
  await assert.rejects(readWorkBuddyPackages('PRIVATE_TOKEN', { read: async () => ({ code: 401 }) }), /AUTH_REQUIRED/);
  let reads = 0; const abort = new AbortController(); abort.abort(); await assert.rejects(readWorkBuddyPackages('PRIVATE_TOKEN', { signal: abort.signal, read: async () => { reads++; } }), /CANCELED/); assert.equal(reads, 0);
  const mid = new AbortController(); await assert.rejects(readWorkBuddyPackages('PRIVATE_TOKEN', { signal: mid.signal, read: async () => { mid.abort(); return page([item(1)]); } }), /CANCELED/);
  await assert.rejects(readWorkBuddyPackages('PRIVATE_TOKEN', { read: async (_a, _t, { pageNumber }) => ({ ...page([item(pageNumber)]), extra: 'x'.repeat(450000) }) }), /OUTPUT_LIMIT/);
});

test('desktop transport sends bounded page numbers to the same route with frozen filters and no caller URLs', async () => {
  const calls = [], bodies = [];
  const post = (url, options, callback) => {
    calls.push({ url, options }); const req = new EventEmitter(); req.destroy = () => {};
    req.end = body => { bodies.push(JSON.parse(body)); setImmediate(() => { const response = new EventEmitter(); response.statusCode = 200; response.destroy = () => {}; callback(response); response.emit('data', Buffer.from(JSON.stringify(page(bodies.length === 1 ? [item(1)] : [])))); response.emit('end'); }); }; return req;
  };
  await readWorkBuddyPackages('PRIVATE_TOKEN', { project, post });
  assert.equal(calls.length, 2); assert(calls.every(row => row.url === 'https://www.codebuddy.cn/v2/billing/meter/get-user-resource' && row.options.headers.Authorization === 'Bearer PRIVATE_TOKEN' && row.options.headers.Cookie === undefined));
  assert.deepEqual(bodies.map(row => row.PageNumber), [1, 2]); assert.deepEqual({ ...bodies[1], PageNumber: 1 }, bodies[0]); assert.equal(bodies[0].PageSize, PAGE_SIZE); assert.deepEqual(bodies[0].Status, [0, 3]);
  for (const pageNumber of [0, 11, 1.5, '2']) await assert.rejects(readProvider('workbuddy-desktop', 'PRIVATE_TOKEN', { project, post, pageNumber }), /ACTION_INVALID/);
  await assert.rejects(readProvider('workbuddy-web', 'auth=PRIVATE_TOKEN', { project: { userAgent: 'synthetic' }, post, pageNumber: 2 }), /ACTION_INVALID/); assert.equal(calls.length, 2);
});

test('service persists all pages and restores offline; later-page failure preserves the entire previous snapshot', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packages-synthetic-')); t.after(() => remove(root));
  let read = source(205);
  const run = async () => { const value = await readWorkBuddyPackages('PRIVATE_TOKEN', { read }); return fromProvider('workbuddy-desktop', value.raw, at, value); };
  const service = new ProviderQuotaService(root, { now: () => Date.parse(at), run }); t.after(() => service.close());
  service.rows.push({ id: '11111111-2222-4333-8444-555555555555', adapter: 'workbuddy-desktop', provider: 'workbuddy', alias: 'synthetic', quota: null, status: 'cached' }); const id = service.rows[0].id; service.secrets.set(id, 'PRIVATE_TOKEN'); service.contexts.set(id, project);
  await service.refresh(id); assert.equal(service.state().accounts[0].quota.pools.length, 205); assert.equal(service.state().accounts[0].quota.incomplete, false); assert.equal(service.state().accounts[0].quota.partial, true, 'unknown package availability remains partial even when pagination completes');
  const before = service.rows[0].quota, bytes = fs.readFileSync(service.file);
  read = async (_a, _t, { pageNumber }) => { if (pageNumber === 2) throw Error('PROVIDER_TIMEOUT'); return page([item(999)]); };
  await service.refresh(id); assert.equal(service.rows[0].quota, before); assert.equal(service.rows[0].errorCode, 'PROVIDER_TIMEOUT'); assert.deepEqual(fs.readFileSync(service.file), bytes);
  const restored = new ProviderQuotaService(root, { run: () => assert.fail('restart network') }); t.after(() => restored.close()); assert.equal(restored.state().accounts[0].quota.pools.length, 205); assert.equal(restored.state().accounts[0].identityStatus, 'unknown');
});

test('IPC worker uses the paginator only for desktop and carries its completeness into sanitized resources', async () => {
  const child = new EventEmitter(), sent = []; child.connected = true; child.disconnect = () => { child.connected = false; }; child.send = value => sent.push(value);
  let calls = 0;
  const requireMock = name => name === './provider-http' ? { readProvider: () => assert.fail('first-page path') } : name === './workbuddy-packages' ? { readWorkBuddyPackages: async () => { calls++; return { raw: page([item(1)]), completePackages: true }; } } : require(path.resolve(__dirname, '../../src/quota', name));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/quota/provider-worker.js'), 'utf8'), { require: requireMock, process: child, AbortController, Date });
  await child.listeners('message')[0]({ id: 1, adapter: 'workbuddy-desktop', credential: 'PRIVATE_TOKEN', project });
  assert.equal(calls, 1); assert.equal(sent[0].resources.incomplete, false); assert.equal(sent[0].resources.pools.length, 1); assert(!JSON.stringify(sent).includes('PRIVATE_TOKEN'));
});

test('larger package collections cannot write a cache that the bounded startup reader would reject', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packages-cache-bound-')); t.after(() => remove(root));
  const service = new ProviderQuotaService(root); t.after(() => service.close()); service.persist([]); const before = fs.readFileSync(service.file);
  const quota = fromProvider('workbuddy-desktop', page(Array.from({ length: 1000 }, (_, i) => item(i))), at);
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: String(i).padStart(8, '0') + '-2222-4333-8444-555555555555', adapter: 'workbuddy-desktop', alias: 'synthetic', quota }));
  assert.throws(() => service.persist(rows), /PROVIDER_STORAGE_FAILED/); assert.deepEqual(fs.readFileSync(service.file), before); assert.equal(fs.existsSync(service.file + '.tmp'), false);
});
