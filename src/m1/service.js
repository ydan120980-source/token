'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const crypto = require('node:crypto');
const { Store, atomic } = require('./store');
class Service {
  constructor(dir, sourceRoots, update = () => {}) { this.store = new Store(dir, sourceRoots); this.update = update; this.timer = null; this.current = null; this.retry = 0; this.lastError = null; this.audit = null; this.closed = false; this.timeoutMs = 60000; }
  async refresh(maintenance = false) {
    if (this.closed) return this.get();
    if (this.current) { if (maintenance) throw new Error('MAINTENANCE_BUSY'); try { await this.current; } catch {} return this.get(); }
    if (maintenance) this.maintenance = null;
    clearTimeout(this.timer);
    this.current = new Promise((resolve, reject) => {
      this.worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { roots: maintenance ? { codex: this.store.settings.roots.codex } : this.store.settings.roots, salt: this.store.state.salt, dir: this.store.dir, maintenance } });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; this.killChild(); void this.worker?.terminate(); }, this.timeoutMs);
      this.worker.on('message', result => { if (result.childPid) { this.childPid = result.childPid; return; } clearTimeout(timer); this.childPid = null; this.audit = result.audit; if (result.error) reject(new Error(result.error)); else resolve(result); });
      this.worker.on('error', () => { clearTimeout(timer); reject(new Error('COLLECTION_WORKER_FAILED')); });
      this.worker.on('exit', code => { if (code !== 0 || timedOut) { clearTimeout(timer); this.killChild(); reject(new Error(timedOut ? 'COLLECTION_TIMEOUT' : 'COLLECTION_WORKER_FAILED')); } });
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
      if (!this.closed) this.store.ingest(result.scan, result.native);
      const hasError = Object.values(result.scan).some(s => s.errors.length);
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
    atomic(path.join(this.store.dir, 'statistics.json'), next); this.store.state = next; this.store._snapshot = null; this.maintenance = null; this.update();
    return { ...candidate.summary, backupCreated: true, ...this.get() };
  }
  get() { return { snapshot: this.store.snapshot(), enabled: this.store.settings.enabled, refreshIntervalMs: this.interval(), collecting: Boolean(this.current), error: this.lastError, audit: this.audit }; }
  interval() { const value = this.store.settings.refreshIntervalMs; return [0,5000,15000,30000,60000,300000].includes(value) ? value : 15000; }
  setRefreshInterval(value) {
    if (![0,5000,15000,30000,60000,300000].includes(value)) throw new Error('REFRESH_INTERVAL_INVALID');
    this.store.settings.refreshIntervalMs = value;
    atomic(path.join(this.store.dir, 'preferences.json'), this.store.settings);
    this.schedule(); this.update(); return this.get();
  }
  schedule() { clearTimeout(this.timer); this.timer = null; if (!this.closed && this.store.settings.enabled && this.interval() > 0) this.timer = setTimeout(() => this.refresh(), this.retry ? Math.max(this.interval(),[30000, 60000, 120000][this.retry - 1]) : this.interval()); }
  killChild() { if (this.childPid) { try { process.kill(this.childPid); } catch {} this.childPid = null; } }
  async setEnabled(enabled) { this.store.setEnabled(enabled); if (!enabled) { clearTimeout(this.timer); this.killChild(); if (this.worker) await this.worker.terminate(); } else if (!this.current) void this.refresh(); this.update(); }
  async close() { this.closed = true; clearTimeout(this.timer); this.killChild(); if (this.worker) await this.worker.terminate(); }
}
module.exports = { Service };
