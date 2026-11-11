'use strict';
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const crypto = require('node:crypto');
const { Store, atomic } = require('./store');
const {CustomSources}=require('./custom-sources');
const {classify,sanitize,failure,fromMessage}=require('./collection-diagnostic');
// Facts about the collected data, reproduced by every scan of the same files. They
// are shown on the source cards; they are not read failures and must not back off.
const DATA_NOTICES = new Set(['USAGE_UNREPORTED', 'SOURCE_USAGE_CONFLICT', 'SOURCE_USAGE_REGRESSION', 'SOURCE_ROW_INVALID', 'DEEPSEEK_FORMAT_UNSUPPORTED', 'DEEPSEEK_SEED_INVALID', 'DEEPSEEK_ENCODING_CONFLICT', 'DEEPSEEK_LOG_INCOMPLETE', 'CURSOR_SOURCE_MODE_CONFLICT','COPILOT_SOURCE_MODE_CONFLICT','SOURCE_FORMAT_UNSUPPORTED','SOURCE_USAGE_ESTIMATED', 'CURSOR_CSV_SCHEMA', 'CURSOR_CSV_INVALID', 'SOURCE_COMPRESSION_UNSUPPORTED', 'ANTIGRAVITY_MODEL_UNPAIRED']);
class Service {
  // `places` are where discovery looks for Agent homes and other Agents' traces; a
  // fixture passes its own so tests never probe the real profile.
  constructor(dir, sourceRoots, update = () => {}, places = { home: os.homedir(), appData: process.env.APPDATA || null, localAppData: process.env.LOCALAPPDATA || null }, workerFactory = null) { this.workerFactory = workerFactory; this.places = places; this.discovery = null; this.discovering = null; this.store = new Store(dir, sourceRoots); this.update = update; this.timer = null; this.current = null; this.retry = 0; this.lastError = null; this.audit = null; this.closed = false; this.timeoutMs = 60000; this.collector = null; this.requests = 0; this.stamp = null; this.stampSequence = null; this.scanHadError = false; this.checkedAt = null; this.lastCollection = null; this.terminations = new Set(); this.custom=new CustomSources(this); this.customWorkers=new Set(); }
  async refresh(maintenance = false) {
    if (this.closed || this.customBusy) return this.get();
    if (this.current) { if (maintenance) throw new Error('MAINTENANCE_BUSY'); try { await this.current; } catch {} return this.get(); }
    if (maintenance) this.maintenance = null;
    clearTimeout(this.timer);
    let failureStage='collection';
    this.current = new Promise((resolve, reject) => {
      // Routine collections reuse one worker so its per-file parse cache survives;
      // maintenance previews always read every file in a worker of their own.
      const worker = maintenance ? this.spawn() : (this.collector ||= this.spawn()), id = ++this.requests;
      this.worker = worker;
      let timedOut = false;
      const settle = () => { clearTimeout(timer); worker.off('message', onMessage); worker.off('error', onError); worker.off('exit', onExit); };
      const discard = () => { if (this.collector === worker) this.collector = null; this.stop(worker); };
      const timer = setTimeout(() => { timedOut = true; this.killChild(); discard(); }, this.timeoutMs);
      const onMessage = result => {
        if (result.id !== id) return;
        if (result.childPid) { this.childPid = result.childPid; return; }
        settle(); this.childPid = null; this.audit = result.audit; if (maintenance) discard();
        if (result.error) reject(fromMessage(result)); else resolve(result);
      };
      const onError = error => { settle(); discard(); reject(fromMessage({error:'COLLECTION_WORKER_FAILED',diagnostic:classify(error,'worker')})); };
      const onExit = () => { settle(); discard(); this.killChild(); reject(fromMessage({error:timedOut ? 'COLLECTION_TIMEOUT' : 'COLLECTION_WORKER_FAILED'},'COLLECTION_WORKER_FAILED','worker')); };
      worker.on('message', onMessage); worker.on('error', onError); worker.on('exit', onExit);
      worker.postMessage({ id, roots: maintenance ? { codex: this.store.sourceRoots().codex } : this.store.sourceRoots(), salt: this.store.state.salt, dir: this.store.dir, maintenance,
        customSources:maintenance ? {} : this.store.state.customSources || {}, customReservedRoots:[...Object.values(this.store.defaults).flat(),...Object.values(this.store.settings.sources.added).flat()],customProtectedDirs:this.custom.protectedDirs,
        previousStamp: this.stampSequence === this.store.state.sequence ? this.stamp : null });
    });
    try {
      const result = await this.current;
      if (maintenance) {
        failureStage='maintenance';
        if (this.closed || result.scan.codex.partial || result.scan.codex.errors.length || !result.scan.codex.records.length) throw new Error('MAINTENANCE_INCOMPLETE');
        const rebuilt = result.scan.codex.records.map(record => { const old = this.store.state.records[record.id]; return old?.quality === 'measured' && record.quality !== 'measured' ? old : record; }), sessions = new Set(rebuilt.map(r => r.sessionKey));
        const previous = Object.values(this.store.state.records).filter(r => r.agent === 'codex');
        const retained = previous.filter(r => !sessions.has(r.sessionKey));
        const summary = { id: crypto.randomUUID(), sequence: this.store.state.sequence, previousTokens: previous.reduce((n,r) => n+r.totalTokens,0), rebuiltTokens: rebuilt.reduce((n,r) => n+r.totalTokens,0), retainedTokens: retained.reduce((n,r) => n+r.totalTokens,0), records: rebuilt.length, files: result.scan.codex.fileCount, skipped: result.scan.codex.skipped };
        this.maintenance = { summary, rebuilt, retained };
        return summary;
      }
      // Unchanged sources reproduce the stored ledger; skip ingest, verification and writes.
      if (!this.closed) {
        failureStage='ingest';
        this.store.ingestCollection(result.unchanged?null:result.scan,result.native,result.custom);
        if(!result.unchanged)this.scanHadError = Object.values(result.scan).some(s => s.errors.some(code => !DATA_NOTICES.has(code)));
        this.stamp = result.stamp; this.stampSequence = this.store.state.sequence; this.lastCollection = result.unchanged?'unchanged:'+result.reason:'ingested';
      }
      this.checkedAt = new Date().toISOString();
      const hasError = this.scanHadError || Object.values(result.custom || {}).some(source => source.diagnostics.errors.length > 0);
      this.retry = hasError ? Math.min(this.retry + 1, 3) : 0; this.lastError = hasError ? '部分来源读取失败，保留历史数据' : null;
      this.diagnostic=null;
    } catch (error) {
      const safe=failure(error,failureStage);safe.diagnostic=sanitize(error?.diagnostic)||safe.diagnostic;
      if (maintenance) throw fromMessage(safe);
      if (!this.closed && this.store.settings.enabled) { this.retry = Math.min(this.retry + 1, 3); this.lastError = safe.error; this.diagnostic=safe.diagnostic; }
    }
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
  // One discovery at a time, in a one-shot worker; the latest report is kept.
  discover() {
    if (this.closed) return Promise.resolve(this.discovery);
    this.discovering ||= new Promise((resolve, reject) => {
      const worker = this.discoveryWorker = this.spawn(), id = 'discover';
      let settled = false;
      const finish = (error, report) => {
        if (settled) return; settled = true;
        clearTimeout(timer); if (this.discoveryWorker === worker) this.discoveryWorker = null; this.stop(worker);
        if (error) reject(error); else resolve(report);
      };
      const timer = setTimeout(() => finish(new Error('DISCOVERY_TIMEOUT')), this.timeoutMs);
      worker.on('message', result => { if (result.id === id) finish(result.error ? fromMessage(result,'DISCOVERY_FAILED','discovery') : null, result.discovery); });
      worker.once('error', () => finish(new Error('DISCOVERY_FAILED'))); worker.once('exit', () => finish(new Error('DISCOVERY_FAILED')));
      worker.postMessage({ id, discover: { defaults: this.store.defaults, scope: this.store.settings.sources, places: this.places, customSources:this.store.state.customSources || {} } });
    }).then(report => { this.discovery = {...report,sources:[...report.sources,...(report.custom || [])]}; return this.discovery; }).finally(() => { this.discovering = null; });
    return this.discovering;
  }
  customTask(action, source, previous) {
    return new Promise((resolve,reject)=>{
      const worker=this.spawn(); this.customWorkers.add(worker); let settled=false;
      const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);this.customWorkers.delete(worker);this.stop(worker);error?reject(error):resolve(result);};
      const timer=setTimeout(()=>finish(new Error('SOURCE_TIMEOUT')),60000);
      worker.on('message',message=>{if(message.id==='custom')finish(message.error?fromMessage(message,'SOURCE_PARSE_FAILED','custom-source'):null,message.result);});
      worker.on('error',()=>finish(new Error('COLLECTION_WORKER_FAILED'))); worker.on('exit',()=>finish(new Error('COLLECTION_WORKER_FAILED')));
      worker.postMessage({id:'custom',customTask:{action,source,previous,salt:this.store.state.salt}});
    });
  }
  get() { return { snapshot: this.store.snapshot(), enabled: this.store.settings.enabled, refreshIntervalMs: this.interval(), subscriptions: this.subscriptions(), collecting: Boolean(this.current), error: this.lastError, diagnostic:sanitize(this.diagnostic), audit: this.audit, checkedAt: this.checkedAt }; }
  spawn() {
    // An idle collector has no request listeners; it must still never raise an
    // unhandled 'error' in the main process, and a dead one is not reused.
    const worker = this.workerFactory ? this.workerFactory() : new Worker(path.join(__dirname, 'worker.js'));
    const forget = () => { if (this.collector === worker) this.collector = null; };
    worker.on('error', forget); worker.on('exit', forget);
    return worker;
  }
  // Terminating a worker is asynchronous: it can still hold the fixture files it
  // is reading. Track every termination so close() only resolves once the workers
  // are actually gone, which is what callers wait for before deleting a directory.
  stop(worker) {
    const done = worker.terminate().catch(() => {}).finally(() => this.terminations.delete(done));
    this.terminations.add(done);
    return done;
  }
  async drain() { while (this.terminations.size) await Promise.all([...this.terminations]); }
  async dropCollector() { const collector = this.collector; this.collector = null; if (collector) await this.stop(collector); }
  interval() { const value = this.store.settings.refreshIntervalMs; return [0,5000,15000,30000,60000,300000].includes(value) ? value : 15000; }
  setRefreshInterval(value) {
    if (![0,5000,15000,30000,60000,300000].includes(value)) throw new Error('REFRESH_INTERVAL_INVALID');
    this.store.savePreferences({ ...this.store.settings, refreshIntervalMs: value });
    this.schedule(); this.update(); return this.get();
  }
  // Monthly subscription fees (USD) the user entered per Agent, for the cost page's
  // comparison. Only a number per known Agent is kept; nothing is read from any account.
  subscriptions() { const saved = this.store.settings.subscriptions, out = {}; if (saved && typeof saved === 'object') for (const [agent, fee] of Object.entries(saved)) if (this.store.catalog()[agent] && Number.isFinite(fee) && fee > 0 && fee <= 100000) out[agent] = fee; return out; }
  setSubscription(agent, fee) {
    if (!this.store.catalog()[agent] || fee !== null && (!Number.isFinite(fee) || fee <= 0 || fee > 100000)) throw new Error('SUBSCRIPTION_INVALID');
    const next = this.subscriptions(); if (fee === null) delete next[agent]; else next[agent] = Math.round(fee * 100) / 100;
    this.store.savePreferences({ ...this.store.settings, subscriptions: next }); this.update(); return this.get();
  }
  schedule() { clearTimeout(this.timer); this.timer = null; if (!this.closed && this.store.settings.enabled && this.interval() > 0) this.timer = setTimeout(() => this.scheduledRefresh ? this.scheduledRefresh() : this.refresh(), this.retry ? Math.max(this.interval(),[30000, 60000, 120000][this.retry - 1]) : this.interval()); }
  killChild() { if (this.childPid) { try { process.kill(this.childPid); } catch {} this.childPid = null; } }
  async setEnabled(enabled) { this.store.setEnabled(enabled); if (!enabled) { clearTimeout(this.timer); this.killChild(); if (this.worker) await this.stop(this.worker); await this.dropCollector(); } else if (!this.current) void this.refresh(); this.update(); }
  async close() { this.closed = true; this.custom.close(); for(const worker of this.customWorkers) this.stop(worker); clearTimeout(this.timer); this.killChild(); if (this.discoveryWorker) this.stop(this.discoveryWorker); if (this.worker) await this.stop(this.worker); await this.dropCollector(); await this.drain(); }
}
module.exports = { Service };
