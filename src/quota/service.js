'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AccountRpc } = require('./rpc');
const { loginUrlAllowed, label } = require('./contract');
const { fromCodex, fromLegacy, toLegacy, restoreQuota } = require('./codex-resources');
const { resourceView } = require('./resource-state');
const { safeCode, MESSAGES } = require('./errors');
const { RefreshScheduler } = require('./refresh-scheduler');
const INTERVAL = 60000;
// As in provider-service.js: an automatic read that hits a passing failure tries once more and stays quiet until the third tick in a row.
const PASSING = new Set(['CODEX_REQUEST_TIMEOUT', 'CODEX_REQUEST_FAILED']), QUIET_TICKS = 3;
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
class QuotaService {
  constructor(directory, executable, changed = () => {}, factory = (exe, home) => new AccountRpc(exe, home), clock = {}) {
    Object.assign(this, { directory, executable, changed, factory });
    this.scheduler = clock.scheduler || new RefreshScheduler(); this.operations = new Set(); this.accountReaping = new Map(); this.accountTails = new Map();
    this.now = clock.now || Date.now; this.setTimer = clock.setTimeout || setTimeout; this.clearTimer = clock.clearTimeout || clearTimeout; this.retryDelay = clock.retryDelay ?? 8000; this.quietTicks = new Map();
    this.clients = new Map(); this.busy = new Set(); this.busyCounts = new Map(); this.generations = new Map(); this.identities = new Map(); this.reaping = new Set(); this.removing = new Set();
    this.login = null; this.closing = false; this.tail = Promise.resolve(); this.autoRefresh = 'off'; this.autoTimer = null; this.nextAutoAt = null; this.lastBatch = null; this.lastProviderBatch = null; this.refreshProviders = null;
    fs.mkdirSync(directory, { recursive: true }); this.file = path.join(directory, 'quota-cache.json'); this.accounts = []; this.recovered = null;
    if (fs.existsSync(this.file)) {
      let damaged = false, restored = [];
      try {
        if (fs.statSync(this.file).size > 16 * 1024 * 1024) throw new Error('QUOTA_CACHE_LIMIT');
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (!Array.isArray(saved?.accounts) || saved.accounts.length > 20 || saved.schemaVersion !== undefined && saved.schemaVersion !== 'QuotaCacheV2') damaged = true;
        if (!damaged) for (const a of saved.accounts.filter(a => a && /^[a-f0-9-]{36}$/.test(a.id) && a.provider === 'codex')) {
          const stored = a.resourceQuota ?? a.quota;
          const resources = stored == null ? null : restoreQuota(stored, a.plan);
          if (stored != null && !resources) { damaged = true; break; }
          restored.push({ id: a.id, provider: 'codex', alias: label(a.alias, 'Codex 账号'), plan: label(a.plan), status: 'cached', quota: toLegacy(resources), resources,
            lastAttempt: validDate(a.lastAttempt), errorCode: Object.hasOwn(MESSAGES, a.errorCode) ? a.errorCode : null, nextRefreshAt: validDate(a.nextRefreshAt) });
        }
      } catch { damaged = true; }
      if (damaged) {
        // A damaged cache must not stop the application. Move the bytes aside and
        // start with no accounts; the user re-adds a connection from the UI.
        const stamp = new Date().toISOString().replaceAll(':', '-');
        const target = path.join(directory, 'quarantine', 'quota-cache-' + stamp + '.json');
        try { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(this.file, target); this.recovered = { file: 'quota-cache.json', quarantined: path.posix.join('quarantine', path.basename(target)), code: 'QUOTA_CACHE_INVALID' }; }
        catch { this.recovered = { file: 'quota-cache.json', quarantined: null, code: 'QUARANTINE_FAILED' }; }
      }
      if (!damaged) this.accounts = restored;
    }
  }
  notify() { if (!this.closing) this.changed(); }
  state() {
    return { schemaVersion: 'QuotaStateV1', refreshConcurrency: this.scheduler.state(), executableAvailable: Boolean(this.executable), autoRefresh: this.autoRefresh, nextAutoAt: this.nextAutoAt, lastBatch: this.lastBatch && { ...this.lastBatch }, lastProviderBatch: this.lastProviderBatch && { ...this.lastProviderBatch }, operationBusy: this.runtimeBusy(), recovered: this.recovered ? { ...this.recovered } : null,
      accounts: this.accounts.map(({ resources: _resources, ...a }) => {
        const duplicateAccountIds = this.identities.has(a.id) && !['login-required', 'login-failed'].includes(a.status) ? [...this.identities].filter(([id, identity]) => id !== a.id && identity === this.identities.get(a.id) && !['login-required', 'login-failed'].includes(this.account(id).status)).map(([id]) => id).sort() : [];
        return { ...structuredClone(a), busy: this.busy.has(a.id), duplicateKnown: duplicateAccountIds.length > 0, duplicateAccountIds };
      }), pendingLogin: this.login ? { accountId: this.login.id } : null };
  }
  stateV2() {
    const state = this.state(), now = this.now();
    return { ...state, schemaVersion: 'QuotaStateV2', accounts: state.accounts.map(a => {
      const resources = this.account(a.id).resources || fromLegacy(a.quota, a.plan);
      return { ...a, identityStatus: this.identities.has(a.id) ? 'server-reported' : 'unknown',
        planMatchesObservation: a.plan && resources?.entitlement.plan ? a.plan === resources.entitlement.plan : null, quota: resourceView(resources, a, now) };
    }) };
  }
  persist(accounts = this.accounts, notify = true) {
    if (this.closing) return;
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ schemaVersion: 'QuotaCacheV2', accounts: accounts.map(({ id, provider, alias, plan, quota, resources, lastAttempt, errorCode, nextRefreshAt }) => {
      const resourceQuota = resources || fromLegacy(quota, plan);
      // A V1 shadow, derived in this same atomic file, keeps older readers from
      // silently losing every window when they encounter the new cache.
      return { id, provider, alias, plan, quota: toLegacy(resourceQuota), resourceQuota, lastAttempt, errorCode, nextRefreshAt };
    }) }), { mode: 0o600 });
    fs.renameSync(temporary, this.file); if (notify) this.notify();
  }
  runtimeBusy() { return Boolean(this.login || this.busy.size); }
  account(id) { const result = this.accounts.find(a => a.id === id); if (!result) throw new Error('ACCOUNT_NOT_FOUND'); return result; }
  version(id) { return this.generations.get(id) || 0; }
  live(id, version) { return !this.closing && this.version(id) === version && this.accounts.some(a => a.id === id); }
  invalidate(id) { this.generations.set(id, this.version(id) + 1); this.identities.delete(id); this.release(id); }
  async client(id) {
    if (!this.executable) throw new Error('CODEX_EXECUTABLE_REQUIRED');
    if (this.closing) throw new Error('CANCELED');
    if (this.clients.has(id)) return this.clients.get(id);
    if (this.accountReaping.has(id)) await this.accountReaping.get(id);
    if (this.closing || !this.accounts.some(account => account.id === id)) throw Error('CANCELED');
    const version = this.version(id), home = path.join(this.directory, 'codex-homes', id); fs.mkdirSync(home, { recursive: true });
    const rpc = this.factory(this.executable, home); this.clients.set(id, rpc);
    try { await rpc.initialize(); if (!this.live(id, version) || this.clients.get(id) !== rpc) throw new Error('CANCELED'); }
    catch (error) { this.trackClose(rpc, id); if (this.clients.get(id) === rpc) this.clients.delete(id); throw error; }
    rpc.on('accountUpdated', event => {
      if (!this.live(id, version) || this.login?.id === id || this.removing.has(id) || !this.account(id).quota) return;
      const account = this.account(id);
      // Official account/read can confirm unchanged managed auth through this
      // notification. It must not cancel the read that is verifying the quota.
      if (event?.authMode === 'chatgpt' && (!event.plan || event.plan === account.plan)) return;
      const identity = this.identities.get(id);
      account.status = event && event.authMode !== 'chatgpt' ? 'login-required' : 'cached';
      if (account.status === 'login-required') account.errorCode = 'LOGIN_REQUIRED';
      if (event?.authMode === 'chatgpt' && event.plan) account.plan = event.plan;
      this.invalidate(id);
      if (event?.authMode === 'chatgpt' && identity) this.identities.set(id, identity);
      this.persist();
    });
    return rpc;
  }
  trackClose(rpc, id) { const reaping = Promise.resolve(rpc.close()); this.reaping.add(reaping); if (id) this.accountReaping.set(id, reaping); void reaping.catch(() => {}).finally(() => { this.reaping.delete(reaping); if (this.accountReaping.get(id) === reaping) this.accountReaping.delete(id); }); return reaping; }
  release(id) { const rpc = this.clients.get(id); this.clients.delete(id); return rpc ? this.trackClose(rpc, id) : this.accountReaping.get(id); }
  async begin(alias) {
    if (this.closing) throw new Error('CANCELED');
    if (this.login || this.accounts.length >= 20) throw new Error('LOGIN_BUSY_OR_ACCOUNT_LIMIT');
    const id = randomUUID(), account = { id, provider: 'codex', alias: label(alias?.trim(), 'Codex 账号') || 'Codex 账号', plan: null, status: 'connecting', quota: null, lastAttempt: null, errorCode: null, nextRefreshAt: null };
    this.accounts.push(account); const active = this.login = { id, loginId: null, timer: null }; this.notify();
    try {
      const rpc = await this.client(id); if (this.login !== active || this.closing) throw new Error('LOGIN_CANCELED');
      let earlyEvent;
      const completed = event => {
        if (this.login !== active || this.closing) return;
        if (active.loginId === null) { earlyEvent = event; return; }
        if (event.loginId !== active.loginId) return;
        this.clearTimer(active.timer); this.login = null;
        if (event.success) void this.refresh(id);
        else { account.status = 'login-failed'; account.errorCode = 'LOGIN_REQUIRED'; this.release(id); this.persist(); }
      };
      rpc.on('login', completed);
      const result = await rpc.request('account/login/start', { type: 'chatgpt' });
      if (this.login !== active || this.closing) throw new Error('LOGIN_CANCELED');
      if (!loginUrlAllowed(result?.authUrl) || typeof result.loginId !== 'string') throw new Error('CODEX_PROTOCOL_INVALID');
      active.loginId = result.loginId; active.timer = this.setTimer(() => { void this.cancel(); }, 5 * 60000);
      if (earlyEvent) completed(earlyEvent); this.notify(); return { authUrl: result.authUrl };
    } catch (error) {
      if (this.login === active && !this.closing) { this.clearTimer(active.timer); this.login = null; account.status = 'login-failed'; account.errorCode = safeCode(error); this.release(id); this.persist(); }
      throw error;
    }
  }
  async cancel() {
    const active = this.login; if (!active) return;
    this.login = null; this.clearTimer(active.timer);
    const rpc = this.clients.get(active.id);
    if (active.loginId && rpc) void rpc.request('account/login/cancel', { loginId: active.loginId }).catch(() => {});
    this.invalidate(active.id); this.accounts = this.accounts.filter(a => a.id !== active.id); this.persist();
  }
  enqueue(id, operation) {
    this.busyCounts.set(id, (this.busyCounts.get(id) || 0) + 1); this.busy.add(id); this.notify();
    const result = (this.accountTails.get(id) || Promise.resolve()).then(() => this.scheduler.run({ provider: 'codex', cli: true, key: 'codex:' + this.directory + ':' + id }, operation));
    const finished = result.finally(() => { const count = this.busyCounts.get(id) - 1; if (count) this.busyCounts.set(id, count); else { this.busyCounts.delete(id); this.busy.delete(id); } this.notify(); });
    const safe = finished.catch(() => {}); this.accountTails.set(id, safe); this.operations.add(safe); this.tail = Promise.all([...this.operations]);
    void safe.then(() => { this.operations.delete(safe); if (this.accountTails.get(id) === safe) this.accountTails.delete(id); }); return finished;
  }
  async refresh(id) { await this.refreshOne(id); return this.state(); }
  refreshOne(id, { automatic = false, again = false } = {}) {
    if (this.closing || this.busy.has(id) || this.login?.id === id) return Promise.resolve('skipped');
    const account = this.account(id), version = this.version(id);
    if (Date.parse(account.nextRefreshAt) > this.now()) return Promise.resolve('skipped');
    return this.enqueue(id, async () => {
      if (!this.live(id, version)) return 'skipped';
      const before = account.status, hadError = account.errorCode;
      account.status = 'refreshing'; account.lastAttempt = new Date(this.now()).toISOString(); this.notify();
      let published = false;
      try {
        const rpc = await this.client(id);
        const response = await rpc.request('account/read', { refreshToken: false });
        if (!this.live(id, version)) return 'skipped';
        if (response?.account?.type !== 'chatgpt') throw new Error('LOGIN_REQUIRED');
        const raw = await rpc.request('account/rateLimits/read');
        if (!this.live(id, version)) return 'skipped';
        const identity = typeof raw?.accountId === 'string' && raw.accountId.length <= 512 ? raw.accountId : null;
        if (identity && this.identities.has(id) && this.identities.get(id) !== identity) { account.status = 'login-required'; account.errorCode = 'LOGIN_REQUIRED'; return 'failed'; }
        const plan = label(response.account.planType), resources = fromCodex(raw, new Date(this.now()).toISOString(), plan);
        const next = { ...account, plan, resources, quota: toLegacy(resources), status: 'ready', errorCode: null, nextRefreshAt: null };
        // Persist the complete new observation before publishing either getter.
        // A failed save must not expose an unsaved balance as a fresh success.
        this.persist(this.accounts.map(a => a === account ? next : a), false);
        Object.assign(account, next); published = true; this.quietTicks.delete(id);
        this.history?.record(id, { ok: true, automatic });
        if (identity) this.identities.set(id, identity); else this.identities.delete(id);
        this.notify(); return 'success';
      } catch (error) {
        if (!this.live(id, version)) return 'skipped';
        if (automatic && account.quota && !hadError && PASSING.has(safeCode(error))) {
          const ticks = (this.quietTicks.get(id) || 0) + (again ? 1 : 0);
          if (ticks < QUIET_TICKS) { this.quietTicks.set(id, ticks); account.status = before; this.history?.record(id, { ok: false, code: safeCode(error), automatic, quiet: true }); return again ? 'failed' : 'again'; }
        }
        account.errorCode = safeCode(error); account.status = account.errorCode === 'LOGIN_REQUIRED' ? 'login-required' : 'error';
        this.history?.record(id, { ok: false, code: account.errorCode, automatic });
        if (account.errorCode === 'LOGIN_REQUIRED') this.identities.delete(id);
        account.nextRefreshAt = new Date(this.now() + (account.errorCode === 'RATE_LIMITED' ? 15 * 60000 : 60000)).toISOString(); return 'failed';
      } finally { await this.release(id); if (!published) this.persist(); }
    });
  }
  async automaticRead(id) {
    const first = await this.refreshOne(id, { automatic: true }); if (first !== 'again') return first;
    await new Promise(resolve => { const timer = this.setTimer(resolve, this.retryDelay); timer?.unref?.(); });
    return this.closing ? 'skipped' : this.refreshOne(id, { automatic: true, again: true });
  }
  async refreshAll({ automatic = false } = {}) {
    this.lastProviderBatch = null;
    const results = await Promise.all(this.accounts.map(a => automatic ? this.automaticRead(a.id) : this.refreshOne(a.id)));
    if (!this.closing) { this.lastBatch = { success: results.filter(r => r === 'success').length, failed: results.filter(r => r === 'failed').length, skipped: results.filter(r => r === 'skipped').length }; this.notify(); }
    return this.state();
  }
  setAutoRefresh(value) {
    if (!['off', '1min'].includes(value) || this.closing) throw new Error('CANCELED');
    this.autoRefresh = value; this.clearTimer(this.autoTimer); this.autoTimer = null;
    this.nextAutoAt = value === 'off' ? null : new Date(this.now() + INTERVAL).toISOString(); this.armAuto(); this.notify(); return this.state();
  }
  armAuto() {
    if (this.closing || this.autoRefresh === 'off') return;
    this.autoTimer = this.setTimer(() => { void this.resume(); }, Math.max(0, Date.parse(this.nextAutoAt) - this.now())); this.autoTimer?.unref?.();
  }
  suspend() { this.clearTimer(this.autoTimer); this.autoTimer = null; }
  async resume() {
    if (this.closing || this.autoRefresh === 'off' || this.autoRunning) return;
    this.autoRunning = true; this.suspend();
    try {
      if (Date.parse(this.nextAutoAt) <= this.now()) {
        this.nextAutoAt = new Date(this.now() + INTERVAL).toISOString();
        const [, providerBatch] = await Promise.all([this.refreshAll({ automatic: true }), this.refreshProviders ? this.refreshProviders() : null]);
        if (!this.closing && providerBatch) { this.lastProviderBatch = providerBatch; this.notify(); }
        // A slow batch may consume the whole minute. Wait for a new
        // interval rather than immediately replaying an already elapsed tick.
        if (!this.closing && this.autoRefresh !== 'off' && Date.parse(this.nextAutoAt) <= this.now()) { this.nextAutoAt = new Date(this.now() + INTERVAL).toISOString(); this.notify(); }
      }
    } finally { this.autoRunning = false; if (!this.autoTimer) this.armAuto(); }
  }
  async remove(id) {
    if (this.closing) throw new Error('CANCELED');
    if (this.login?.id === id) return this.cancel();
    this.account(id); this.invalidate(id); const version = this.version(id);
    await this.enqueue(id, async () => {
      if (!this.live(id, version)) return;
      this.removing.add(id);
      try { const rpc = await this.client(id); await rpc.request('account/logout'); if (this.live(id, version)) this.accounts = this.accounts.filter(a => a.id !== id); }
      finally { this.removing.delete(id); await this.release(id); this.persist(); }
    });
  }
  async close() {
    if (this.closing) return;
    this.closing = true; this.suspend(); await this.cancel();
    for (const id of this.clients.keys()) this.invalidate(id);
    this.identities.clear();
    await Promise.all([...this.reaping]);
  }
}
module.exports = { QuotaService };
