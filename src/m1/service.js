'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const crypto = require('node:crypto');
const { Store, atomic } = require('./store');
// Facts about the collected data, reproduced by every scan of the same files. They
// are shown on the source cards; they are not read failures and must not back off.
const DATA_NOTICES = new Set(['USAGE_UNREPORTED', 'SOURCE_USAGE_CONFLICT', 'SOURCE_USAGE_REGRESSION', 'SOURCE_ROW_INVALID', 'DEEPSEEK_FORMAT_UNSUPPORTED', 'DEEPSEEK_SEED_INVALID', 'DEEPSEEK_ENCODING_CONFLICT', 'DEEPSEEK_LOG_INCOMPLETE', 'CURSOR_SOURCE_MODE_CONFLICT', 'CURSOR_CSV_SCHEMA', 'CURSOR_CSV_INVALID', 'SOURCE_COMPRESSION_UNSUPPORTED']);
class Service {
  constructor(dir, sourceRoots, update = () => {}) { this.store = new Store(dir, sourceRoots); this.update = update; this.timer = null; this.current = null; this.retry = 0; this.lastError = null; this.audit = null; this.closed = false; this.timeoutMs = 60000; this.collector = null; this.requests = 0; this.stamp = null; this.stampSequence = null; this.scanHadError = false; this.checkedAt = null; this.lastCollection = null; }
  async refresh(maintenance = false) {
    if (this.closed) return this.get();
    if (this.current) { if (maintenance) throw new Error('MAINTENANCE_BUSY'); try { await this.current; } catch {} return this.get(); }
    if (maintenance) this.maintenance = null;
    clearTimeout(this.timer);
    this.current = new Promise((resolve, reject) => {
      // Routine collections reuse one worker so its per-file parse cache survives;
      // maintenance previews always read every file in a worker of their own.
      const worker = maintenance ? this.spawn() : (this.collector ||= this.spawn()), id = ++this.requests;
      this.worker = worker;
      let timedOut = false;
      const settle = () => { clearTimeout(timer); worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit); };
      const discard = () => { if (this.collector === worker) this.collector = null; void worker.terminate(); };
      const timer = setTimeout(() => { timedOut = true; this.killChild(); discard(); }, this.timeoutMs);
      const onMessage = result => {
        if (result.id !== id) return;
        if (result.childPid) { this.childPid = result.childPid; return; }
        settle(); this.childPid = null; this.audit = result.audit; if (maintenance) discard();
        if (result.error) reject(new Error(result.error)); else resolve(result);
      };
      const onError = () => { settle(); discard(); reject(new Error('COLLECTION_WORKER_FAILED')); };
      const onExit = () => { settle(); discard(); this.killChild(); reject(new Error(timedOut ? 'COLLECTION_TIMEOUT' : 'COLLECTION_WORKER_FAILED')); };
      worker.on('message', onMessage); worker.on('error', onError); worker.on('exit', onExit);
      worker.postMessage({ id, roots: maintenance ? { codex: this.store.settings.roots.codex } : this.store.settings.roots, salt: this.store.state.salt, dir: this.store.dir, maintenance,
        previousStamp: this.stampSequence === this.store.state.sequence ? this.stamp : null });
    });
    try {
      const result = await this.current;
      if (maintenance) {
        if (this.closed || result.scan.codex.partial || result.scan.codex.errors.length || !result.scan.codex.records.length) throw new Error('MAINTENANCE_INCOMPLETE');
        const rebuilt = result.scan.codex.records.map(record => { const old = this.store.state.records[record.id]; return old?.quality === 'measured' && record.quality !== 'measured' ? old : record; }), sessions = new Set(rebuilt.map(r => r.sessionKey));
        const previous = Object.values(this.store.state.records).filter(r => r.agent === 'codex');
        const retained = previous.filter(r => !sessions.has(r.sessionKey));
        const summary = { id: crypto.randomUUID(), sequence: this.store.state.sequence, previousTokens: previous.reduce((n,r) => n+r.totalTokens,0), rebuiltTokens: rebuilt.reduce((n,r) => n+r.totalTokens,0), retainedTokens: retained.reduce((n,r) => n+r.totalTokens,0), records: rebuilt.length, files: result.scan.codex.fileCount, skipped: result.scan.codex.skipped };
        this.maintenance = { summary, rebuilt, retained };
        return summary;
      }
      // Unchanged sources reproduce the stored ledger; skip ingest, verification and writes.
      if (result.unchanged) { this.stamp = result.stamp; this.lastCollection = 'unchanged:' + result.reason; }
      else if (!this.closed) {
        this.store.ingest(result.scan, result.native);
        this.scanHadError = Object.values(result.scan).some(s => s.errors.some(code => !DATA_NOTICES.has(code)));
        this.stamp = result.stamp; this.stampSequence = this.store.state.sequence; this.lastCollection = 'ingested';
      }
      this.checkedAt = new Date().toISOString();
      const hasError = this.scanHadError;
      this.retry = hasError ? Math.min(this.retry + 1, 3) : 0; this.lastError = hasError ? '部分来源读取失败，保留历史数据' : null;
    } catch (error) { if (maintenance) throw error; if (!this.closed && this.store.settings.enabled) { this.retry = Math.min(this.retry + 1, 3); this.lastError = error.message; } }
    finally { this.worker = null; this.current = null; if (!this.closed) { this.update(); this.schedule(); } }
    return this.get();
  }
  applyMaintenance(id) {
    const candidate = this.maintenance;
    if (this.closed || this.current || !candidate || id !== candidate.summary.id || candidate.summary.sequence !== this.store.state.sequence) throw new Error('MAINTENANCE_STALE');
    const before = this.store.state, records = Object.fromEntries(Object.values(before.records).filter(r => r.agent !== 'codex').concat(candidate.retained, candidate.rebuilt).map(r => [r.id, r]));
    const status = { ...before.statuses.codex, observedRecords: candidate.rebuilt.length, parserVersion: 'm1-projection/2 + tokscale/4.17.0', nativeVerification: 'not-run-maintenance-preview', realSampleVerified: false, status: 'unverified' };
    const backupName = 'statistics-before-codex-' + new Date().toISOString().replaceAll(':','-') + '.json';
    atomic(path.join(this.store.dir, 'backups', backupName), before);
    const next = { ...before, records, statuses: { ...before.statuses, codex: status }, sequence: before.sequence + 1, updatedAt: new Date().toISOString() };
    atomic(path.join(this.store.dir, 'statistics.json'), next); this.store.state = next; this.store._snapshot = null; this.store.persistedDigest = null; this.maintenance = null; this.update();
    return { ...candidate.summary, backupCreated: true, ...this.get() };
  }
  get() { return { snapshot: this.store.snapshot(), enabled: this.store.settings.enabled, refreshIntervalMs: this.interval(), collecting: Boolean(this.current), error: this.lastError, audit: this.audit, checkedAt: this.checkedAt }; }
  spawn() {
    // An idle collector has no request listeners; it must still never raise an
    // unhandled 'error' in the main process, and a dead one is not reused.
    const worker = new Worker(path.join(__dirname, 'worker.js'));
    const forget = () => { if (this.collector === worker) this.collector = null; };
    worker.on('error', forget); worker.on('exit', forget);
    return worker;
  }
  async dropCollector() { const collector = this.collector; this.collector = null; if (collector) await collector.terminate(); }
  interval() { const value = this.store.settings.refreshIntervalMs; return [0,5000,15000,30000,60000,300000].includes(value) ? value : 15000; }
  setRefreshInterval(value) {
    if (![0,5000,15000,30000,60000,300000].includes(value)) throw new Error('REFRESH_INTERVAL_INVALID');
    this.store.settings.refreshIntervalMs = value;
    atomic(path.join(this.store.dir, 'preferences.json'), this.store.settings);
    this.schedule(); this.update(); return this.get();
  }
  schedule() { clearTimeout(this.timer); this.timer = null; if (!this.closed && this.store.settings.enabled && this.interval() > 0) this.timer = setTimeout(() => this.refresh(), this.retry ? Math.max(this.interval(),[30000, 60000, 120000][this.retry - 1]) : this.interval()); }
  killChild() { if (this.childPid) { try { process.kill(this.childPid); } catch {} this.childPid = null; } }
  async setEnabled(enabled) { this.store.setEnabled(enabled); if (!enabled) { clearTimeout(this.timer); this.killChild(); if (this.worker) await this.worker.terminate(); await this.dropCollector(); } else if (!this.current) void this.refresh(); this.update(); }
  async close() { this.closed = true; clearTimeout(this.timer); this.killChild(); if (this.worker) await this.worker.terminate(); await this.dropCollector(); }
}
module.exports = { Service };
