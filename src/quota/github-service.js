'use strict';
// GitHub identity and sync to the person's own private repository
// (docs/m2/GITHUB-AND-UPDATE-20261104.md). Everything starts from a person's click: nothing polls in the background.
// The token goes only through the encrypted store it is given, never into state, a file here or the window.
// Application updates are not here: they need no GitHub account and live in update-service.js.
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto');
const { payload } = require('../m1/github-sync-payload');

const CODES = new Set(['GITHUB_NOT_CONFIGURED', 'GITHUB_OFFLINE', 'GITHUB_RATE_LIMITED', 'GITHUB_AUTH_REQUIRED', 'GITHUB_FORBIDDEN', 'GITHUB_REQUEST_FAILED', 'GITHUB_DENIED', 'GITHUB_CODE_EXPIRED', 'GITHUB_SECURE_STORAGE_REQUIRED', 'GITHUB_REPOSITORY_INVALID', 'GITHUB_NOT_CONNECTED', 'GITHUB_BUSY']);
const failure = error => CODES.has(error?.message) ? error.message : 'GITHUB_REQUEST_FAILED';
const REPOSITORY = /^(?!\.)[A-Za-z0-9_.-]{1,100}\/(?!\.)[A-Za-z0-9_.-]{1,100}$/;
const AVATAR = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

class GithubService {
  constructor(dir, { transport, secrets, snapshot, onChange = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => Date.now() }) {
    Object.assign(this, { dir, transport, secrets, snapshot, onChange, wait, now });
    this.file = path.join(dir, 'github.json');
    this.saved = this.load();
    this.pending = null; this.syncing = false; this.connectError = null; this.syncError = null; this.repositories = null;
  }
  load() {
    try { const value = JSON.parse(fs.readFileSync(this.file, 'utf8')); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
  }
  save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const temporary = this.file + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.saved), { mode: 0o600 }); fs.renameSync(temporary, this.file);
  }
  transportNow() { return typeof this.transport === 'function' ? this.transport() : this.transport; }
  state() {
    const { account, sync = {}, device } = this.saved;
    return {
      schemaVersion: 'GithubStateV1', configured: Boolean(this.transportNow()),
      connection: { status: this.pending ? 'pending' : account ? account.expired ? 'expired' : 'connected' : 'none', login: account?.login ?? null, name: account?.name ?? null, avatar: account?.avatar ?? null, connectedAt: account?.connectedAt ?? null,
        device: this.pending ? { userCode: this.pending.userCode, verificationUri: this.pending.verificationUri, expiresAt: this.pending.expiresAt } : null, error: this.connectError },
      sync: { enabled: sync.enabled === true, repository: sync.repository ?? null, status: this.syncing ? 'syncing' : this.syncError ? 'error' : sync.lastSuccess ? 'ok' : 'idle', lastSuccess: sync.lastSuccess ?? null, days: sync.days ?? null, error: this.syncError, device: device ?? null },
      repositories: this.repositories,
    };
  }
  changed() { const state = this.state(); this.onChange(state); return state; }
  async withToken(run) {
    const transport = this.transportNow();
    if (!transport) throw new Error('GITHUB_NOT_CONFIGURED');
    const held = this.secrets.get();
    if (!held?.token || !this.saved.account) throw new Error('GITHUB_NOT_CONNECTED');
    try {
      if (held.expiresAt && Date.parse(held.expiresAt) <= this.now() + 60000 && held.refreshToken) {
        const renewed = await transport.refresh(held.refreshToken);
        const next = { token: renewed.token, refreshToken: renewed.refreshToken ?? held.refreshToken, expiresAt: renewed.expiresAt ?? null };
        this.secrets.set(next); return await run(next.token, transport);
      }
      return await run(held.token, transport);
    } catch (error) {
      if (error?.message === 'GITHUB_AUTH_REQUIRED') { this.saved.account = { ...this.saved.account, expired: true }; this.save(); }
      throw error;
    }
  }
  // Device flow: a code the person types on GitHub, the app waiting at the pace GitHub set. Nothing is saved until it is authorized.
  async connect() {
    const transport = this.transportNow();
    if (!transport) throw new Error('GITHUB_NOT_CONFIGURED');
    if (this.pending) throw new Error('GITHUB_BUSY');
    if (!this.secrets.available()) throw new Error('GITHUB_SECURE_STORAGE_REQUIRED');
    this.connectError = null;
    const control = new AbortController(), started = await transport.startDevice(control.signal);
    this.pending = { control, userCode: started.userCode, verificationUri: started.verificationUri, expiresAt: new Date(this.now() + started.expiresIn * 1000).toISOString() };
    this.changed();
    void this.poll(started, control, transport);
    return this.state();
  }
  async poll(started, control, transport) {
    let interval = Math.max(1, started.interval ?? 5);
    const deadline = this.now() + started.expiresIn * 1000;
    try {
      while (!control.signal.aborted) {
        if (this.now() >= deadline) throw new Error('GITHUB_CODE_EXPIRED');
        await this.wait(interval * 1000);
        if (control.signal.aborted) return;
        const answer = await transport.pollDevice(started.deviceCode, control.signal);
        if (answer.status === 'pending') continue;
        if (answer.status === 'slow_down') { interval += 5; continue; }
        if (answer.status === 'denied') throw new Error('GITHUB_DENIED');
        if (answer.status === 'expired') throw new Error('GITHUB_CODE_EXPIRED');
        if (answer.status !== 'authorized' || !answer.token) throw new Error('GITHUB_REQUEST_FAILED');
        const user = await transport.user(answer.token, control.signal);
        if (control.signal.aborted) return;
        this.secrets.set({ token: answer.token, refreshToken: answer.refreshToken ?? null, expiresAt: answer.expiresAt ?? null });
        this.saved.account = { login: String(user.login).slice(0, 100), name: typeof user.name === 'string' ? user.name.slice(0, 120) : null, avatar: AVATAR.test(user.avatar ?? '') && user.avatar.length <= 512 * 1024 ? user.avatar : null, connectedAt: new Date(this.now()).toISOString() };
        this.save();
        break;
      }
    } catch (error) { if (!control.signal.aborted) this.connectError = failure(error); }
    if (this.pending?.control === control) { this.pending = null; this.changed(); }
  }
  cancel() { this.pending?.control.abort(); this.pending = null; this.connectError = null; return this.changed(); }
  // Leaving keeps what was already synced in the person's repository and their choice of repository, and forgets the token.
  disconnect() {
    this.pending?.control.abort(); this.pending = null;
    this.secrets.clear(); delete this.saved.account; this.connectError = null; this.syncError = null; this.repositories = null;
    this.saved.sync = { ...this.saved.sync, enabled: false };
    this.save();
    return this.changed();
  }
  async listRepositories() {
    try { this.repositories = (await this.withToken((token, transport) => transport.privateRepositories(token))).map(row => row.fullName).filter(name => REPOSITORY.test(name)).slice(0, 500); this.syncError = null; }
    catch (error) { this.syncError = failure(error); }
    return this.changed();
  }
  setSync({ enabled, repository }) {
    if (typeof enabled !== 'boolean' || repository !== null && !REPOSITORY.test(repository ?? '')) throw new Error('GITHUB_REPOSITORY_INVALID');
    if (enabled && !this.saved.account) throw new Error('GITHUB_NOT_CONNECTED');
    if (enabled && !repository) throw new Error('GITHUB_REPOSITORY_INVALID');
    this.saved.sync = { ...this.saved.sync, enabled, repository };
    this.syncError = null;
    this.save();
    return this.changed();
  }
  async syncNow() {
    const { sync } = this.saved;
    if (this.syncing) throw new Error('GITHUB_BUSY');
    if (!sync?.enabled || !sync.repository) throw new Error('GITHUB_REPOSITORY_INVALID');
    this.syncing = true; this.syncError = null; this.changed();
    try {
      // Each machine writes its own file, so two machines never overwrite each other.
      this.saved.device ??= randomUUID();
      const at = new Date(this.now()).toISOString(), body = payload(await this.snapshot(), this.saved.device, at);
      await this.withToken((token, transport) => transport.put(token, sync.repository, 'agent-usage/' + this.saved.device + '.json', JSON.stringify(body, null, 1) + '\n'));
      this.saved.sync = { ...this.saved.sync, lastSuccess: at, days: new Set(body.days.map(row => row.date)).size };
      this.save();
    } catch (error) { this.syncError = failure(error); }
    this.syncing = false;
    return this.changed();
  }
  close() { this.pending?.control.abort(); this.pending = null; }
}
// The token at rest, under Windows' own encryption. There is no plain text fallback.
function secretFile(file, safeStorage) {
  return {
    available: () => safeStorage.isEncryptionAvailable(),
    get() { try { return JSON.parse(safeStorage.decryptString(fs.readFileSync(file))); } catch { return null; } },
    set(value) { if (!safeStorage.isEncryptionAvailable()) throw new Error('GITHUB_SECURE_STORAGE_REQUIRED'); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 }); },
    clear() { fs.rmSync(file, { force: true }); },
  };
}
const RELEASES = 'https://github.com/ydan120980-source/token/releases/';
// The page the app may open for a code to be typed on GitHub, and a release of this project.
function openable(url) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password && (parsed.href === 'https://github.com/login/device' || parsed.href.startsWith(RELEASES)); } catch { return false; }
}
module.exports = { GithubService, secretFile, openable };
