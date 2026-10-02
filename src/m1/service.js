'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { Store } = require('./store');
class Service {
  constructor(dir, sourceRoots, update = () => {}) { this.store = new Store(dir, sourceRoots); this.update = update; this.timer = null; this.current = null; this.retry = 0; this.lastError = null; this.audit = null; this.closed = false; this.timeoutMs = 60000; }
  async refresh() {
    if (this.current) { try { await this.current; } catch {} return this.get(); }
    clearTimeout(this.timer);
    this.current = new Promise((resolve, reject) => {
      this.worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { roots: this.store.settings.roots, salt: this.store.state.salt, dir: this.store.dir } });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; this.killChild(); void this.worker?.terminate(); }, this.timeoutMs);
      this.worker.on('message', result => { if (result.childPid) { this.childPid = result.childPid; return; } clearTimeout(timer); this.childPid = null; this.audit = result.audit; if (result.error) reject(new Error(result.error)); else resolve(result); });
      this.worker.on('error', () => { clearTimeout(timer); reject(new Error('COLLECTION_WORKER_FAILED')); });
      this.worker.on('exit', code => { if (code !== 0 || timedOut) { clearTimeout(timer); this.killChild(); reject(new Error(timedOut ? 'COLLECTION_TIMEOUT' : 'COLLECTION_WORKER_FAILED')); } });
    });
    try {
      const result = await this.current;
      if (!this.closed) this.store.ingest(result.scan, result.native);
      const hasError = Object.values(result.scan).some(s => s.errors.length);
      this.retry = hasError ? Math.min(this.retry + 1, 3) : 0; this.lastError = hasError ? '部分来源读取失败，保留历史数据' : null;
    } catch (error) { if (!this.closed && this.store.settings.enabled) { this.retry = Math.min(this.retry + 1, 3); this.lastError = error.message; } }
    finally { this.worker = null; this.current = null; if (!this.closed) { this.update(); this.schedule(); } }
    return this.get();
  }
  get() { return { snapshot: this.store.snapshot(), enabled: this.store.settings.enabled, collecting: Boolean(this.current), error: this.lastError, audit: this.audit }; }
  schedule() { clearTimeout(this.timer); if (!this.closed && this.store.settings.enabled) this.timer = setTimeout(() => this.refresh(), this.retry ? [30000, 60000, 120000][this.retry - 1] : 15000); }
  killChild() { if (this.childPid) { try { process.kill(this.childPid); } catch {} this.childPid = null; } }
  async setEnabled(enabled) { this.store.setEnabled(enabled); if (!enabled) { clearTimeout(this.timer); this.killChild(); if (this.worker) await this.worker.terminate(); } else if (!this.current) void this.refresh(); this.update(); }
  async close() { this.closed = true; clearTimeout(this.timer); this.killChild(); if (this.worker) await this.worker.terminate(); }
}
module.exports = { Service };
