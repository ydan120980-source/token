'use strict';
const path = require('node:path');
const { fork } = require('node:child_process');
const { verify } = require('./runtime-catalog');
const DAY = 24 * 60 * 60 * 1000;
function fetchEnvironment() {
  const env = { ELECTRON_RUN_AS_NODE:'1' };
  for (const key of ['SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
class PriceSyncService {
  constructor(store, update = () => {}, offline = false, spawn = fork) { this.store = store; this.update = update; this.offline = offline; this.spawn = spawn; this.timer = null; this.child = null; this.current = null; this.closed = false; this.status = { syncing:false, lastAttempt:null, error:null }; }
  state() { return { ...this.status, enabled:this.store.billing.autoSync, lastSuccess:this.store.downloadedCatalog ? this.store.remoteCatalog?.obtainedAt || null : null, builtInAt:this.store.remoteCatalog?.obtainedAt || null, modelCount:Object.keys(this.store.remoteCatalog?.models || {}).length }; }
  start() { if (!this.offline && this.store.billing.autoSync) this.schedule(); }
  schedule(delay) {
    clearTimeout(this.timer);
    if (this.closed || this.offline || !this.store.billing.autoSync) return;
    const age = Date.now() - Date.parse(this.store.downloadedCatalog ? this.store.remoteCatalog?.obtainedAt || '' : '');
    this.timer = setTimeout(() => void this.sync().catch(() => {}), delay ?? (Number.isFinite(age) ? Math.max(0, DAY-age) : 1000));
    this.timer.unref?.();
  }
  setEnabled(enabled) { if (typeof enabled !== 'boolean') throw new Error('PRICE_SETTING_INVALID'); this.store.setBilling({ ...this.store.billing, autoSync:enabled }); this.schedule(); this.update(); return this.state(); }
  sync() {
    if (this.current) return this.current;
    if (this.closed || this.offline) return Promise.reject(new Error('PRICE_SYNC_OFFLINE_FIXTURE'));
    clearTimeout(this.timer); this.status = { syncing:true,lastAttempt:new Date().toISOString(),error:null }; this.update();
    this.current = new Promise((resolve, reject) => {
      // Deliberately omit HOME, CODEX_HOME, proxy auth and arbitrary environment.
      const env = fetchEnvironment();
      let settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timeout); this.child?.kill(); this.child = null; if (error) reject(new Error(error)); else resolve(value); };
      const timeout = setTimeout(() => finish('PRICE_DOWNLOAD_TIMEOUT'), 20000);
      try {
        this.child = this.spawn(path.join(__dirname,'price-fetch-worker.js'), [], {env,stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,serialization:'json'});
        this.child.on('message', result => { try { if (this.closed) return finish('PRICE_SYNC_CLOSED'); if (!result.catalog) return finish('PRICE_DOWNLOAD_FAILED'); const value = verify(result.catalog); if(Object.keys(value.models).length < Object.keys(this.store.remoteCatalog?.models || {}).length / 2) return finish('PRICE_DOWNLOAD_INCOMPLETE'); this.store.installCatalog(value); finish(null,value); } catch { finish('PRICE_DOWNLOAD_SCHEMA'); } });
        this.child.on('error', () => finish('PRICE_DOWNLOAD_FAILED'));
        this.child.on('exit', () => finish('PRICE_DOWNLOAD_FAILED'));
      } catch { finish('PRICE_DOWNLOAD_FAILED'); }
    }).then(() => { this.status.error = null; this.status.syncing = false; return this.state(); }, error => { this.status.error = error.message; throw error; }).finally(() => { this.current = null; this.status.syncing = false; this.update(); this.schedule(this.status.error ? 60*60*1000 : DAY); });
    return this.current;
  }
  close() { this.closed = true; clearTimeout(this.timer); this.child?.kill(); return this.current?.catch(() => {}); }
}
module.exports = { PriceSyncService, fetchEnvironment };
