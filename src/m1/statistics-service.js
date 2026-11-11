'use strict';
const { Worker } = require('node:worker_threads');
const { agents } = require('./agent-catalog');
const { empty } = require('./source-scope');
const { commandMode, CUSTOM_COMMANDS } = require('./statistics-contract');

/**
 * Main-process application API. The worker exclusively owns Store and the ledger.
 * facts() returns a detached read model, never a mutable storage facade.
 * Electron IPC remains in quota/main.js and never exposes the command transport.
 */
class StatisticsService {
  constructor(dir, roots, update = () => {}, places, options = {}) {
    Object.assign(this, { dir, roots, update, places, options });
    this.pending = new Map();
    this.children = new Set();
    this.serial = 0;
    this.revision = 0;
    this.closed = false;
    this.started = false;
    this.metrics = { workerStarts: 0, requests: 0, completed: 0, failed: 0, maxInFlight: 0, packedSnapshotBytes: 0 };
    this.lifecycle = { workerFailures: 0, timeouts: 0, rejected: 0 };
    this._facts = { settings: { enabled: false, sources: empty() }, defaults: roots, catalog: agents, statuses: {}, customSources: {} };
    this.custom = {};
    for (const name of CUSTOM_COMMANDS) this.custom[name] = (...args) => this.call('custom:' + name, ...args);
    this.custom.get = token => this.call('customCheck', token);
    Object.freeze(this.custom);
    this.priceSync = Object.freeze({
      state: () => structuredClone(this._facts.priceSync || { enabled: false, syncing: false }),
      start: () => this.call('priceStart'), sync: () => this.call('priceSync'),
      setEnabled: value => this.call('priceAuto', value),
      close: () => Promise.resolve() // The owner closes this service.
    });
    this.ready = this.open();
  }
  /** @returns {import('./statistics-contract').StatisticsFacts} */
  facts() { return structuredClone(this._facts); }
  catalog() { return structuredClone(this._facts.catalog); }
  busy() { return Boolean(this.current || this._facts.collecting || this._facts.customBusy); }
  maintenancePreview() { return structuredClone(this._facts.maintenance || null); }
  apply(meta) { if (meta) this._facts = meta; }
  open() {
    this.metrics.workerStarts++;
    const worker = this.worker = new Worker(require.resolve('./statistics-worker'), { resourceLimits: { maxYoungGenerationSizeMb: 8 }, workerData: {
      dir: this.dir, roots: this.roots, places: this.places, protectedDirs: this.options.protectedDirs || [],
      offline: Boolean(this.options.offline), initialRevision: this.revision + 1, resumeStarted: this.started
    } });
    let initialized = false;
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(Error('STATISTICS_START_TIMEOUT')); void worker.terminate(); }, 60000);
      const fail = () => {
        clearTimeout(timer);
        if (this.worker !== worker) return;
        this.worker = null;
        if (!this.closed) this.lifecycle.workerFailures++;
        for (const task of this.pending.values()) {
          clearTimeout(task.timer);
          this.metrics.completed++;
          this.metrics.failed++;
          task.reject(Error('STATISTICS_WORKER_FAILED'));
        }
        this.pending.clear();
        for (const pid of this.children) { try { process.kill(pid); } catch {} }
        this.children.clear();
        if (!initialized) reject(Error('STATISTICS_WORKER_FAILED'));
        else if (!this.closed) this.update();
      };
      worker.on('error', fail);
      worker.on('exit', fail);
      worker.on('message', message => {
        if (this.worker !== worker) return;
        if (message.event === 'child') { this.children.add(message.pid); return; }
        if (message.event === 'childDone') { this.children.delete(message.pid); return; }
        this.apply(message.meta);
        if (message.event === 'ready') { initialized = true; clearTimeout(timer); resolve(); return; }
        if (message.event === 'update') { if (!this.closed) this.update(); return; }
        const task = this.pending.get(message.id);
        if (!task) return;
        this.pending.delete(message.id);
        clearTimeout(task.timer);
        this.metrics.completed++;
        this.metrics.packedSnapshotBytes += message.value?.snapshotBytes?.byteLength || 0;
        if (message.error) this.metrics.failed++;
        if (message.value?.snapshotRevision) this.revision = Math.max(this.revision, message.value.snapshotRevision);
        if (message.error) task.reject(Error(message.error));
        else task.resolve(message.value);
      });
    });
    ready.catch(() => {});
    return ready;
  }
  async call(command, ...args) {
    if (this.closed && command !== 'close') throw Error('STATISTICS_CLOSED');
    try { commandMode(command); } catch (error) { this.lifecycle.rejected++; throw error; }
    if (command === 'start') this.started = true;
    if (!this.worker) {
      if (this.closed) return;
      this.ready = this.open();
    }
    await this.ready;
    if (this.closed && command !== 'close') throw Error('STATISTICS_CLOSED');
    if (this.pending.size >= 64) throw Error('STATISTICS_BUSY');
    this.metrics.requests++;
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.metrics.completed++;
        this.metrics.failed++;
        this.lifecycle.timeouts++;
        reject(Error('STATISTICS_TIMEOUT'));
        void this.worker?.terminate();
      }, command === 'close' ? 5000 : 90000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, command, args }); }
      catch {
        clearTimeout(timer);
        this.pending.delete(id);
        this.metrics.completed++;
        this.metrics.failed++;
        reject(Error('STATISTICS_WORKER_FAILED'));
      }
      this.metrics.maxInFlight = Math.max(this.metrics.maxInFlight, this.pending.size);
    });
  }
  ensureReady() { if (!this.worker && !this.closed) this.ready = this.open(); return this.ready; }
  performanceState() { return { ...this.metrics, inFlight: this.pending.size, workerPresent: Boolean(this.worker) }; }
  async diagnostics() {
    // Observing a failed/closed owner must not restart it or resume collection.
    const owner = this.worker ? await this.call('diagnostics') : null;
    return { requests: this.performanceState(), lifecycle: { ...this.lifecycle }, owner };
  }
  get(known) { return this.call('get', known); }
  getPacked(known) { return this.call('getPacked', known); }
  start() { return this.call('start'); }
  workbench(selection) { return this.call('workbench', selection); }
  attention() { return this.call('attention'); }
  saveWorkbench(value) { return this.call('saveWorkbench', value); }
  reprice() { return this.call('reprice'); }
  resume(key) { return this.call('resume', key); }
  directory(key) { return this.call('directory', key); }
  transcript(key, request) { return request === undefined ? this.call('transcript', key) : this.call('transcript', key, request); }
  searchTranscripts(request) { return this.call('searchTranscripts', request); }
  transcriptPart(key, request) { return this.call('transcriptPart', key, request); }
  transcriptFind(key, request) { return this.call('transcriptFind', key, request); }
  transcriptStamp(key) { return this.call('transcriptStamp', key); }
  transcriptFacts(key) { return this.call('transcriptFacts', key); }
  transcriptFileHistory(request) { return this.call('transcriptFileHistory', request); }
  agentUse(request) { return this.call('agentUse', request); }
  transcriptMarkdown(key, request) { return this.call('transcriptMarkdown', key, request); }
  pricing() { return this.call('pricing'); }
  setBilling(value) { return this.call('setBilling', value); }
  setPrice(value, reset = false) { return this.call('setPrice', value, reset); }
  probe(value) { return this.call('probe', value); }
  priceTry(value) { return this.call('priceTry', value); }
  pricePlan(value) { return this.call('pricePlan', value); }
  changeSources(...args) { return this.call('changeSources', ...args); }
  clear(...args) { return this.call('clear', ...args); }
  sessions(selection) { return this.call('sessions', selection); }
  sessionsPacked(selection) { return this.call('sessionsPacked', selection); }
  sessionSummary(selection) { return this.call('sessionSummary', selection); }
  exportProjects(selection) { return this.call('exportProjects', selection); }
  exportCost(request) { return this.call('exportCost', request); }
  serializeStatistics(value) { return this.call('serializeStatistics', value); }
  refresh(maintenance = false) {
    if (this.current) { if (maintenance) return Promise.reject(Error('MAINTENANCE_BUSY')); return this.current; }
    this.current = this.call('refresh', maintenance).finally(() => { this.current = null; });
    return this.current;
  }
  setEnabled(value) { return this.call('enabled', value); }
  setRefreshInterval(value) { return this.call('interval', value); }
  setSubscription(agent, fee) { return this.call('subscription', agent, fee); }
  discover() {
    if (this.discovering) return this.discovering;
    this.discovering = this.call('discover').then(value => this.discovery = value).finally(() => { this.discovering = null; });
    return this.discovering;
  }
  applyMaintenance(id) { return this.call('applyMaintenance', id); }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      try { await this.call('close'); }
      finally { if (this.worker) await this.worker.terminate(); }
    })();
    return this.closing;
  }
}
module.exports = { StatisticsService };
