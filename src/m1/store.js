'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SOURCES, LABELS, roots, localPath } = require('./policy');
const catalog = require('./prices.json');
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp-' + crypto.randomBytes(6).toString('hex');
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temporary, file);
}
function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw new Error('LOCAL_STORAGE_INVALID', { cause: error }); return fallback; }
}
const dayFormatters = new Map();
function day(time, timezone) { if (!dayFormatters.has(timezone)) dayFormatters.set(timezone, new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })); return dayFormatters.get(timezone).format(new Date(time)); }
function price(record) {
  if (record.quality !== 'measured') return null;
  const rates = catalog.models[record.provider + '/' + record.model];
  if (!rates) return null;
  let cost = 0;
  for (const key of ['inputUncached', 'output', 'cacheRead', 'cacheWrite']) {
    const count = record[key];
    if (count === null || (count > 0 && rates[key] === undefined)) return null;
    cost += count * (rates[key] ?? 0);
  }
  return cost;
}
class Store {
  constructor(dir, defaults = roots()) {
    this.dir = dir;
    const own = localPath(dir).toLowerCase();
    function checkRoots(selected) { for (const list of Object.values(selected)) for (const source of list) { const normalized = localPath(source).toLowerCase(); if (normalized === own || normalized.startsWith(own + path.sep) || own.startsWith(normalized + path.sep)) throw new Error('SOURCE_PRODUCT_OVERLAP'); } }
    checkRoots(defaults);
    this.state = load(path.join(dir, 'statistics.json'), { version: 1, deviceId: crypto.randomUUID(), salt: crypto.randomBytes(32).toString('hex'), sequence: 0, records: {}, statuses: {} });
    this.settings = load(path.join(dir, 'preferences.json'), { enabled: true, roots: defaults });
    checkRoots(this.settings.roots);
    this.validation = load(path.join(dir, 'validation.json'), {});
    if (this.state.version !== 1 || !this.state.deviceId || typeof this.state.salt !== 'string' || !this.state.records || !this.state.statuses || !Number.isSafeInteger(this.state.sequence)) throw new Error('LOCAL_STORAGE_INVALID');
    atomic(path.join(dir, 'statistics.json'), this.state);
  }
  ingest(scan, native) {
    const at = new Date().toISOString();
    for (const agent of SOURCES) {
      const result = scan[agent];
      const detailed = new Set(result.records.filter(r => r.agent === 'workbuddy' && r.accountingKind !== 'session-aggregate').map(r => r.sessionKey));
      for (const [id, old] of Object.entries(this.state.records)) if (old.agent === 'workbuddy' && old.accountingKind === 'session-aggregate' && detailed.has(old.sessionKey)) delete this.state.records[id];
      for (const record of result.records) {
        const old = this.state.records[record.id];
        if (old?.quality === 'measured' && record.quality !== 'measured') continue;
        this.state.records[record.id] = record;
      }
      const previous = this.state.statuses[agent];
      const times = result.records.map(r => r.timestamp).sort();
      const fieldSupport = Object.fromEntries(['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning'].map(field => {
        const known = result.records.filter(r => r[field] !== null).length;
        return [field, !known ? 'unobserved' : known === result.records.length ? 'observed-all-records' : 'observed-some-records'];
      }));
      this.state.statuses[agent] = {
        schemaVersion: 'SourceCapability',
        agent, label: LABELS[agent], detected: result.detected, observedRecords: result.records.length, fileCount: result.fileCount,
        status: !result.detected ? 'not-detected' : result.errors.length && !result.records.length ? 'error' : result.partial || result.records.some(r => r.quality !== 'measured') ? 'partial' : this.validation[agent]?.verified ? 'verified' : 'unverified',
        lastAttempt: at, lastSuccess: result.errors.length || result.partial ? previous?.lastSuccess || null : at,
        errors: result.errors, malformedLines: result.skipped, durationMs: result.durationMs,
        qualityIssues: Object.fromEntries([...new Set(result.records.filter(r => r.quality !== 'measured').map(r => r.quality))].map(quality => [quality, result.records.filter(r => r.quality === quality).length])),
        parserVersion: 'm1-projection/1 + tokscale/4.17.0', realSampleVerified: this.validation[agent]?.verified === true,
        coverageStart: times[0] || previous?.coverageStart || null, coverageEnd: times.at(-1) || previous?.coverageEnd || null,
        fields: { totalTokens: result.records.length ? 'observed' : 'unobserved', ...fieldSupport, accountQuota: false, actualBill: false },
        nativeVerification: native.status
      };
    }
    this.state.sequence++; this.state.updatedAt = at;
    atomic(path.join(this.dir, 'statistics.json'), this.state);
    return this.snapshot();
  }
  snapshot() {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (this._snapshot?.sequence === this.state.sequence && this._snapshot.timezone === timezone) return this._snapshot;
    const groups = new Map();
    for (const record of Object.values(this.state.records)) {
      const date = day(record.timestamp, timezone);
      const key = JSON.stringify([date, record.agent, record.entry, record.provider, record.model]);
      let row = groups.get(key);
      if (!row) {
        row = { date, agent: record.agent, entry: record.entry, provider: record.provider, model: record.model, totalTokens: 0, inputUncached: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, records: 0, pricedRecords: 0, pricedTokens: 0, estimatedCostUsd: 0, partialRecords: 0 };
        groups.set(key, row);
      }
      row.totalTokens += record.totalTokens; row.records++;
      if (record.quality !== 'measured') row.partialRecords++;
      for (const field of ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning']) row[field] = row[field] === null || record[field] === null ? null : row[field] + record[field];
      const estimate = price(record);
      if (estimate !== null) { row.estimatedCostUsd += estimate; row.pricedRecords++; row.pricedTokens += record.totalTokens; }
    }
    const daily = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
    for (const row of daily) { if (!row.pricedRecords) row.estimatedCostUsd = null; row.semantics = { inputUncached: 'excludes-cache', reasoning: 'subset-of-output', totalTokens: 'non-overlapping-source-total' }; }
    return this._snapshot = {
      schemaVersion: 'UsageSnapshotV1', deviceId: this.state.deviceId, sequence: this.state.sequence,
      collectedAt: this.state.updatedAt || null, generatedAt: new Date().toISOString(), timezone,
      coverageStart: daily[0]?.date || null, daily,
      priceCatalog: { version: catalog.version, obtainedAt: catalog.obtainedAt, sha256: catalog.sha256, currency: 'USD', kind: 'API-equivalent-estimate', source: catalog.source },
      sources: SOURCES.map(agent => this.state.statuses[agent] || { agent, label: LABELS[agent], status: 'unverified', lastSuccess: null, realSampleVerified: false }),
      deferred: [{ agent: 'cursor', status: 'requires-authorized-connection' }, { agent: 'trae', status: 'variant-and-connection-unverified' }]
    };
  }
  setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('INVALID_SETTING');
    this.settings.enabled = enabled; atomic(path.join(this.dir, 'preferences.json'), this.settings);
  }
  clear() { this.state.records = {}; this.state.statuses = {}; this.state.sequence++; this.state.updatedAt = null; atomic(path.join(this.dir, 'statistics.json'), this.state); }
}
module.exports = { Store, atomic, load, day, price };
