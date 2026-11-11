'use strict';
// One pool shared by Codex and provider reads. Scope keys remain private and
// are never included in diagnostics; unrelated providers can use free slots.
class RefreshScheduler {
  constructor({ limit = 16, perProvider = 4, cliLimit = 4 } = {}) {
    if (![limit, perProvider, cliLimit].every(n => Number.isInteger(n) && n > 0 && n <= 16)) throw Error('REFRESH_LIMIT_INVALID');
    Object.assign(this, { limit, perProvider, cliLimit });
    this.active = 0; this.cliActive = 0; this.providers = new Map(); this.keys = new Set(); this.queue = [];
  }
  state() { return { limit: this.limit, perProvider: this.perProvider, cliLimit: this.cliLimit, active: this.active, queued: this.queue.length }; }
  run({ provider, cli = false, key, signal }, operation) {
    if (signal?.aborted) return Promise.reject(Error('PROVIDER_CANCELED'));
    return new Promise((resolve, reject) => {
      const job = { provider, cli, key, signal, operation, resolve, reject };
      job.abort = () => { const index = this.queue.indexOf(job); if (index < 0) return; this.queue.splice(index, 1); reject(Error('PROVIDER_CANCELED')); this.drain(); };
      signal?.addEventListener('abort', job.abort, { once: true }); this.queue.push(job); this.drain();
    });
  }
  drain() {
    while (this.active < this.limit) {
      const index = this.queue.findIndex(job => (this.providers.get(job.provider) || 0) < this.perProvider && (!job.cli || this.cliActive < this.cliLimit) && (!job.key || !this.keys.has(job.key)));
      if (index < 0) return;
      const [job] = this.queue.splice(index, 1);
      job.signal?.removeEventListener('abort', job.abort);
      this.active++; if (job.cli) this.cliActive++;
      this.providers.set(job.provider, (this.providers.get(job.provider) || 0) + 1); if (job.key) this.keys.add(job.key);
      const release = () => { this.active--; if (job.cli) this.cliActive--; const count = this.providers.get(job.provider) - 1; if (count) this.providers.set(job.provider, count); else this.providers.delete(job.provider); if (job.key) this.keys.delete(job.key); this.drain(); };
      Promise.resolve().then(job.operation).then(value => { release(); job.resolve(value); }, error => { release(); job.reject(error); });
    }
  }
}
module.exports = { RefreshScheduler };
