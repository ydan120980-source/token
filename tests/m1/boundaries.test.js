'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixtures } = require('./fixtures');
const { Service } = require('../../src/m1/service');
const { scanSources } = require('../../src/m1/sources');
test('network entry points deny even synthetic attempts in a separate process', () => {
  const script = "const a={networkAttempts:0};require('./src/m1/policy').disableNetwork(a);for(const fn of [()=>fetch('https://example.invalid'),()=>require('https').get('https://example.invalid'),()=>require('net').connect(443,'example.invalid'),()=>require('tls').connect(443,'example.invalid')]){try{fn();throw Error('allowed')}catch(e){if(e.message!=='NETWORK_DISABLED_M1')throw e}}console.log(a.networkAttempts)";
  const child = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true }); assert.equal(child.status, 0); assert.equal(child.stdout.trim(), '4');
});
test('partial JSONL preserves valid lines; source error retained; pause, overlap and restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-service-')), f = fixtures(path.join(dir, 'home'));
  const file = path.join(f.roots.claude[0], 'project/session.jsonl'); fs.appendFileSync(file, '{"unfinished":');
  const scan = await scanSources(f.roots, 's', { reads: 0 }); assert.equal(scan.claude.partial, true); assert.equal(scan.claude.skipped, 1); assert.equal(scan.claude.records[0].totalTokens, 170);
  const service = new Service(path.join(dir, 'app'), f.roots);
  t.after(async () => { await service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await Promise.all([service.refresh(), service.refresh()]); assert.equal(service.store.state.sequence, 1);
  await service.setEnabled(false); assert.equal(service.get().enabled, false); assert.equal(service.timer?._destroyed ?? true, true);
  const second = new Service(path.join(dir, 'app')); assert.equal(second.get().enabled, false); assert.equal(second.get().snapshot.daily.reduce((s, r) => s + r.totalTokens, 0), f.total); await second.close();
  const audit = service.audit, sequence = service.store.state.sequence;
  await service.close(); await service.refresh();
  assert.equal(service.audit, audit); assert.equal(service.store.state.sequence, sequence); assert.equal(service.worker, null);
});
test('worker timeout retains statistics and backoff follows 30/60/120 seconds', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-timeout-')), f = fixtures(path.join(dir, 'home')), service = new Service(path.join(dir, 'app'), f.roots);
  t.after(async () => { await service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await service.refresh(); const sequence = service.store.state.sequence;
  service.timeoutMs = 1;
  for (const delay of [30000, 60000, 120000]) { await service.refresh(); assert.equal(service.lastError, 'COLLECTION_TIMEOUT'); assert.equal(service.timer._idleTimeout, delay); assert.equal(service.store.state.sequence, sequence); }
});
test('exit during native aggregation reaps Tokscale child process', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-reap-')), f = fixtures(path.join(dir, 'home')), service = new Service(path.join(dir, 'app'), f.roots);
  t.after(async () => { await service.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const file = path.join(f.roots.claude[0], 'project/session.jsonl'), base = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, Array.from({ length: 10000 }, (_, i) => JSON.stringify({ ...base, uuid: 'u' + i, message: { ...base.message, id: 'm' + i } })).join('\n'));
  const running = service.refresh(), until = Date.now() + 10000;
  while (!service.childPid && Date.now() < until && service.current) await new Promise(resolve => setTimeout(resolve, 1));
  const pid = service.childPid; assert(pid, 'native child spawn must be observed');
  await service.close(); await running; assert.throws(() => process.kill(pid, 0));
});
