'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AccountRpc } = require('./rpc');
const { projectQuota, projectCachedQuota, loginUrlAllowed, label } = require('./contract');
const { safeCode, MESSAGES } = require('./errors');
const INTERVAL = 60000;
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
class QuotaService {
  constructor(directory, executable, changed = () => {}, factory = (exe, home) => new AccountRpc(exe, home), clock = {}) {
    Object.assign(this, { directory, executable, changed, factory });
    this.now = clock.now || Date.now; this.setTimer = clock.setTimeout || setTimeout; this.clearTimer = clock.clearTimeout || clearTimeout;
    this.clients = new Map(); this.busy = new Set(); this.busyCounts = new Map(); this.generations = new Map(); this.identities = new Map(); this.reaping = new Set(); this.removing = new Set();
    this.login = null; this.closing = false; this.tail = Promise.resolve(); this.autoRefresh = 'off'; this.autoTimer = null; this.nextAutoAt = null; this.lastBatch = null;
    fs.mkdirSync(directory, { recursive: true }); this.file = path.join(directory, 'quota-cache.json'); this.accounts = []; this.recovered = null;
    if (fs.existsSync(this.file)) {
      let saved = null, damaged = false;
      try {
        saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (!Array.isArray(saved?.accounts) || saved.accounts.length > 20) damaged = true;
      } catch { damaged = true; }
      if (damaged) {
        // A damaged cache must not stop the application. Move the bytes aside and
        // start with no accounts; the user re-adds a connection from the UI.
        const stamp = new Date().toISOString().replaceAll(':', '-');
        const target = path.join(directory, 'quarantine', 'quota-cache-' + stamp + '.json');
        try { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.renameSync(this.file, target); this.recovered = { file: 'quota-cache.json', quarantined: path.posix.join('quarantine', path.basename(target)), code: 'QUOTA_CACHE_INVALID' }; }
        catch { this.recovered = { file: 'quota-cache.json', quarantined: null, code: 'QUARANTINE_FAILED' }; }
      }
      if (!damaged) this.accounts = saved.accounts.filter(a => a && /^[a-f0-9-]{36}$/.test(a.id) && a.provider === 'codex').map(a => ({ id: a.id, provider: 'codex', alias: label(a.alias, 'Codex 账号'), plan: label(a.plan), status: 'cached', quota: projectCachedQuota(a.quota), lastAttempt: validDate(a.lastAttempt), errorCode: Object.hasOwn(MESSAGES, a.errorCode) ? a.errorCode : null, nextRefreshAt: validDate(a.nextRefreshAt) }));
    }
  }
  notify() { if (!this.closing) this.changed(); }
  state() {
    return { schemaVersion: 'QuotaStateV1', executableAvailable: Boolean(this.executable), autoRefresh: this.autoRefresh, nextAutoAt: this.nextAutoAt, lastBatch: this.lastBatch && { ...this.lastBatch }, operationBusy: this.runtimeBusy(), recovered: this.recovered ? { ...this.recovered } : null,
      accounts: this.accounts.map(a => ({ ...structuredClone(a), busy: this.busy.has(a.id), duplicateKnown: this.identities.has(a.id) && [...this.identities].some(([id, identity]) => id !== a.id && identity === this.identities.get(a.id)) })), pendingLogin: this.login ? { accountId: this.login.id } : null };
  }
  persist() {
    if (this.closing) return;
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ accounts: this.accounts.map(({ id, provider, alias, plan, quota, lastAttempt, errorCode, nextRefreshAt }) => ({ id, provider, alias, plan, quota, lastAttempt, errorCode, nextRefreshAt })) }), { mode: 0o600 });
    fs.renameSync(temporary, this.file); this.notify();
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
    const version = this.version(id), home = path.join(this.directory, 'codex-homes', id); fs.mkdirSync(home, { recursive: true });
    const rpc = this.factory(this.executable, home); this.clients.set(id, rpc);
    try { await rpc.initialize(); if (!this.live(id, version) || this.clients.get(id) !== rpc) throw new Error('CANCELED'); }
    catch (error) { this.trackClose(rpc); if (this.clients.get(id) === rpc) this.clients.delete(id); throw error; }
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
  trackClose(rpc) { const reaping = Promise.resolve(rpc.close()); this.reaping.add(reaping); void reaping.catch(() => {}).finally(() => this.reaping.delete(reaping)); }
  release(id) { const rpc = this.clients.get(id); this.clients.delete(id); if (rpc) this.trackClose(rpc); }
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
    const result = this.tail.then(operation); this.tail = result.catch(() => {});
    return result.finally(() => { const count = this.busyCounts.get(id) - 1; if (count) this.busyCounts.set(id, count); else { this.busyCounts.delete(id); this.busy.delete(id); } this.notify(); });
  }
  async refresh(id) { await this.refreshOne(id); return this.state(); }
  refreshOne(id) {
    if (this.closing || this.busy.has(id) || this.login?.id === id) return Promise.resolve('skipped');
    const account = this.account(id), version = this.version(id);
    if (Date.parse(account.nextRefreshAt) > this.now()) return Promise.resolve('skipped');
    return this.enqueue(id, async () => {
      if (!this.live(id, version)) return 'skipped';
      account.status = 'refreshing'; account.lastAttempt = new Date(this.now()).toISOString(); this.notify();
      try {
        const rpc = await this.client(id);
        const response = await rpc.request('account/read', { refreshToken: false });
        if (!this.live(id, version)) return 'skipped';
        if (response?.account?.type !== 'chatgpt') throw new Error('LOGIN_REQUIRED');
        const raw = await rpc.request('account/rateLimits/read');
        if (!this.live(id, version)) return 'skipped';
        if (!raw || typeof raw !== 'object' || (!raw.rateLimits && !raw.rateLimitsByLimitId)) throw new Error('CODEX_PROTOCOL_INVALID');
        const identity = typeof raw.accountId === 'string' && raw.accountId.length <= 512 ? raw.accountId : null;
        if (identity && this.identities.has(id) && this.identities.get(id) !== identity) { account.status = 'login-required'; account.errorCode = 'LOGIN_REQUIRED'; return 'failed'; }
        if (identity) this.identities.set(id, identity); else this.identities.delete(id);
        account.plan = label(response.account.planType); account.quota = projectQuota(raw, new Date(this.now()).toISOString()); account.status = 'ready'; account.errorCode = null; account.nextRefreshAt = null; return 'success';
      } catch (error) {
        if (!this.live(id, version)) return 'skipped';
        account.errorCode = safeCode(error); account.status = account.errorCode === 'LOGIN_REQUIRED' ? 'login-required' : 'error';
        if (account.errorCode === 'LOGIN_REQUIRED') this.identities.delete(id);
        account.nextRefreshAt = new Date(this.now() + (account.errorCode === 'RATE_LIMITED' ? 15 * 60000 : 60000)).toISOString(); return 'failed';
      } finally { this.release(id); this.persist(); }
    });
  }
  async refreshAll() {
    const results = await Promise.all(this.accounts.map(a => this.refreshOne(a.id)));
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
    if (this.closing || this.autoRefresh === 'off') return;
    this.suspend();
    if (Date.parse(this.nextAutoAt) <= this.now()) {
      this.nextAutoAt = new Date(this.now() + INTERVAL).toISOString(); await this.refreshAll();
      // A slow serialized batch may consume the whole minute. Wait for a new
      // interval rather than immediately replaying an already elapsed tick.
      if (!this.closing && this.autoRefresh !== 'off' && Date.parse(this.nextAutoAt) <= this.now()) { this.nextAutoAt = new Date(this.now() + INTERVAL).toISOString(); this.notify(); }
    }
    if (!this.autoTimer) this.armAuto();
  }
  async remove(id) {
    if (this.closing) throw new Error('CANCELED');
    if (this.login?.id === id) return this.cancel();
    this.account(id); this.invalidate(id); const version = this.version(id);
    await this.enqueue(id, async () => {
      if (!this.live(id, version)) return;
      this.removing.add(id);
      try { const rpc = await this.client(id); await rpc.request('account/logout'); if (this.live(id, version)) this.accounts = this.accounts.filter(a => a.id !== id); }
      finally { this.removing.delete(id); this.release(id); this.persist(); }
    });
  }
  async close() {
    if (this.closing) return;
    this.closing = true; this.suspend(); await this.cancel();
    for (const id of this.clients.keys()) this.invalidate(id);
    await Promise.all([...this.reaping]);
  }
}
module.exports = { QuotaService };
