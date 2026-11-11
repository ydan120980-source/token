'use strict';
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { projectResources, instant } = require('./resource-contract');
const { own } = require('./agent-install-engine');
function projectClaude(raw, observedAt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !instant(observedAt)) throw new Error('PROVIDER_RESPONSE_INVALID');
  const limits = raw.rate_limits, windows = [];
  for (const [id, durationMins] of [['five_hour', 300], ['seven_day', 10080], ['spend_limit', null]]) {
    const item = limits?.[id]; if (item == null) continue;
    if (typeof item.used_percentage !== 'number' || !Number.isFinite(item.used_percentage) || item.used_percentage < 0 || item.used_percentage > 100) throw new Error('PROVIDER_RESPONSE_INVALID');
    const seconds = item.resets_at, resetsAt = Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 8640000000000 ? new Date(seconds * 1000).toISOString() : null;
    windows.push({ id, label: id === 'spend_limit' ? '网关消费约束' : durationMins === 300 ? '5 小时订阅约束' : '7 天订阅约束', unit: 'percent', durationMins, usedPercent: item.used_percentage, resetsAt });
  }
  return projectResources({ schemaVersion: 'AccountQuotaV2', provider: 'claude', fetchedAt: observedAt, incomplete: true, provenance: { kind: 'passive', version: typeof raw.version === 'string' ? raw.version : null }, entitlement: {}, pools: windows.length ? [{ id: 'statusline', label: '官方状态栏观测 · 非后台查询', scope: 'unknown', windows, balances: [] }] : [] });
}
function readSnapshot(root, id, provider='claude') {
  const file = own(root, path.join(root, 'incoming', id + '.json'));
  if (!fs.existsSync(file)) throw new Error('PROVIDER_PASSIVE_PENDING');
  if (fs.statSync(file).size > 512 * 1024) throw new Error('PROVIDER_OUTPUT_LIMIT');
  const quota = projectResources(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!quota || quota.provider !== provider || !['claude','antigravity'].includes(provider) || quota.provenance.kind !== 'passive') throw new Error('PROVIDER_RESPONSE_INVALID'); return quota;
}
function writeSnapshot(root, id, raw, now = Date.now()) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('PROVIDER_ACTION_INVALID');
  const marker = own(root, path.join(root, 'connections.json'));
  if (fs.statSync(marker).size > 4 * 1024 * 1024) throw new Error('PROVIDER_CACHE_INVALID');
  const records = JSON.parse(fs.readFileSync(marker, 'utf8'));
  const connection=records.connections?.find(row=>row.id===id),provider=connection?.adapter==='claude-statusline'?'claude':connection?.adapter==='antigravity-statusline'?'antigravity':null;
  if (records.schemaVersion !== 'ProviderQuotaCacheV1' || !provider) throw new Error('PROVIDER_ACTION_INVALID');
  const project=provider==='claude'?projectClaude:require('./antigravity-passive').projectAntigravity;
  const quota = project(raw, new Date(now).toISOString());
  try { const old = readSnapshot(root, id,provider), sameTime = project(raw, old.fetchedAt); if (JSON.stringify(old) === JSON.stringify(sameTime)) return old; } catch { /* First observation or a previous invalid projection. */ }
  const file = own(root, path.join(root, 'incoming', id + '.json')); fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = own(root, file + '.' + randomUUID() + '.tmp'); fs.writeFileSync(temporary, JSON.stringify(quota), { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, file); return quota;
}
module.exports = { projectClaude, readSnapshot, writeSnapshot };
