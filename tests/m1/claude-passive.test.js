'use strict';
require('./experimental-on');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawnSync } = require('node:child_process');
const { ProviderQuotaService } = require('../../src/quota/provider-service');
const { projectClaude, writeSnapshot, readSnapshot } = require('../../src/quota/claude-passive');
const { passiveInstructions } = require('../../src/quota/passive-instructions');
const { readActiveRuntime } = require('../../src/quota/agent-install-engine');
const { createHash } = require('node:crypto');
const { projectConnections } = require('../../src/quota/connection-state');
const { capabilities } = require('../../src/quota/provider-catalog');
const { remove } = require('./temp');
const NOW = Date.parse('2026-10-19T13:00:00Z');
const payload = () => ({ version: '2.1.303', session_id: 'private-id', cwd: 'E:/private/project', transcript_path: 'do-not-read.jsonl', rate_limits: { five_hour: { used_percentage: 35, resets_at: NOW / 1000 + 3600 }, seven_day: { used_percentage: 60, resets_at: NOW / 1000 + 86400 } } });
test('Claude callback exports only quota fields, stable repeats keep original age, absent limits replace old observations', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-额度 ')); let now = NOW;
  const service = new ProviderQuotaService(root, { now: () => now, run: () => assert.fail('passive must not request network'), fixture: true });
  try {
    await service.connect({ adapter: 'claude-statusline', alias: '当前官方 CLI 观测', credential: null }); await service.tail; const state = service.state(), id = state.accounts[0].id;
    assert.equal(state.accounts[0].errorCode, 'PROVIDER_PASSIVE_PENDING');
    const first = writeSnapshot(root, id, payload(), now); now += 15 * 60000;
    const repeat = writeSnapshot(root, id, payload(), now); assert.equal(first.fetchedAt, repeat.fetchedAt);
    await service.refresh(id); const row = service.state().accounts[0]; assert.equal(row.quota.pools[0].windows[0].freshness.state, 'stale'); assert.equal(row.credentialReady, true);
    const saved = fs.readFileSync(service.file, 'utf8') + fs.readFileSync(path.join(root, 'incoming', id + '.json'), 'utf8'); for (const forbidden of ['private-id', 'private/project', 'do-not-read', 'session_id', 'transcript_path']) assert(!saved.includes(forbidden));
    const changed = payload(); changed.rate_limits.five_hour.used_percentage = 40; assert.equal(writeSnapshot(root, id, changed, now).fetchedAt, new Date(now).toISOString());
    writeSnapshot(root, id, { version: '2.1.303' }, now + 1); await service.refresh(id); assert.equal(service.state().accounts[0].quota.pools.length, 0); assert.equal(service.state().accounts[0].quota.hasMeasurements, false);
    service.remove(id); assert.throws(() => writeSnapshot(root, id, payload()), /ACTION_INVALID/);
    assert.throws(() => projectClaude({ rate_limits: { five_hour: { used_percentage: -1 } } }, new Date(now).toISOString()), /RESPONSE_INVALID/);
  } finally { await service.close(); await remove(root); }
});
test('Windows statusline helper passes bounded stdin to the real Node exporter under a Chinese and space path', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '额度 导出 ')), service = new ProviderQuotaService(root);
  try {
    const state = await service.connect({ adapter: 'claude-statusline', alias: 'synthetic', credential: null }), id = state.accounts[0].id;
    const helper = path.resolve('src/quota/claude-statusline-export.ps1'), script = path.resolve('src/quota/provider-passive-export.js');
    // Match an explicitly configured statusline callback's inherited Windows
    // environment. Only our exporter executes; its input/output roots are owned
    // synthetic files and it never reads source/auth/config or uses network.
    const result = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper, '-Executable', process.execPath, '-Script', script, '-Connection', id, '-Directory', root], { input: JSON.stringify(payload()), encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 8192 });
    assert.equal(result.status, 0, result.stderr); assert.equal(readSnapshot(root, id).pools[0].windows[0].usedPercent, 35);
    const guide = JSON.parse(passiveInstructions(root, process.execPath, path.resolve('src/quota'), id)); assert(guide.statusLine.command.includes(helper)); assert(!guide.statusLine.command.includes('Bypass'));
  } finally { await service.close(); await remove(root); }
});
test('managed Codex runtime selection validates current bytes, rejects changed and missing native executables', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-runtime-')), executable = path.join(root, 'codex/generation/codex.exe');
  try {
    fs.mkdirSync(path.dirname(executable), { recursive: true }); fs.writeFileSync(executable, 'synthetic native binary');
    fs.writeFileSync(path.join(root, 'codex/active.json'), JSON.stringify({ agent: 'codex', version: '0.163.0', executable, executableHash: createHash('sha256').update(fs.readFileSync(executable)).digest('hex'), js: false }));
    assert.equal(readActiveRuntime(root, 'codex').executable, executable); fs.appendFileSync(executable, 'changed'); assert.equal(readActiveRuntime(root, 'codex'), null); fs.unlinkSync(executable); assert.equal(readActiveRuntime(root, 'codex'), null);
  } finally { await remove(root); }
});
test('source capability status admits explicit provider connections and balance-only quota without equating local token history', () => {
  const { fromProvider } = require('../../src/quota/provider-resources');
  const { resourceView } = require('../../src/quota/resource-state');
  const raw = fromProvider('workbuddy-credit', { total_capacity_size: 100, total_capacity_used: 30 }, new Date(NOW).toISOString()), account = { provider: 'workbuddy', status: 'ready', credentialReady: true, quota: null };
  account.quota = resourceView(raw, account, NOW);
  const view = projectConnections({ catalog: { workbuddy: { name: 'WorkBuddy' }, mimo: { name: 'MiMo' } }, quota: { accounts: [], providerAccounts: [account], providerCapabilities: capabilities() }, now: NOW });
  assert.equal(view.rows[0].quota.connections, 1); assert.equal(view.rows[0].quota.freshness.fresh, 1); assert.equal(view.rows[1].quota.capability, 'supported'); assert.equal(view.rows[1].quota.connections, 0);
});
