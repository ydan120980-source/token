'use strict';
const fs = require('node:fs'), path = require('node:path'), { randomUUID } = require('node:crypto'), { fork } = require('node:child_process');
const { routes, capabilities, experimental } = require('./provider-catalog');
const { validProject } = require('./provider-http');
const { normalizeCredential } = require('./provider-credentials');
const { projectResources } = require('./resource-contract');
const { resourceView } = require('./resource-state');
const { own } = require('./agent-install-engine');
const { readSnapshot } = require('./claude-passive');
const { WEBSITE_ADAPTERS } = require('./provider-secret-store');
const { ConnectionIdentities } = require('./connection-identities');
const { OperationMetrics } = require('../m1/operation-metrics');
const { RefreshScheduler } = require('./refresh-scheduler');
const CACHE_LIMIT = 4 * 1024 * 1024;
// An automatic read that hits a passing failure is tried again once and stays quiet: the card keeps its last reading and its age.
// Only the third tick in a row says so. An explicit refresh always says so. Sign-in, limits and bad answers are never quiet.
const PASSING = new Set(['PROVIDER_REQUEST_FAILED', 'PROVIDER_TIMEOUT']), QUIET_TICKS = 3;
// A route that has to start a program (owner 2026-11-04: the reads must not disturb the desktop) reads less often than the minute.
const PROGRAM_EVERY = 5 * 60000;
const EXTRA_MESSAGES = Object.freeze({ PROVIDER_CLIENT_ENCRYPTED: '已找到 WorkBuddy 登录，但当前安装或系统辅助程序无法读取加密凭据。请检查客户端安装与系统辅助程序后重试。', PROVIDER_CLIENT_REGION_UNSUPPORTED: '当前为 WorkBuddy 国际版登录；国际版未提供已核对的国内积分接口，不会混用账号。', PROVIDER_CLIENT_ACCOUNT_CHANGED: '当前客户端登录账号已变化，请重新连接；历史额度保留，不会附到新账号。', PROVIDER_ORGANIZATION_REQUIRED: '此账号需要明确选择组织／工作区；请填写官网额度请求对应的组织或工作区 ID 后重试。', PROVIDER_CLIENT_MISSING: '未找到兼容的官方 CLI，请先在安装管理中安装，或选择网站登录。', PROVIDER_CLIENT_CREDENTIAL_MISSING: '未发现此服务已配置的有效凭据。API key 来源请在本地输入一次，或打开官方说明获取；客户端登录不能代替其他产品的套餐／余额。', PROVIDER_CLIENT_UNSUPPORTED: '此官方 CLI 版本尚未完成兼容核对；更新不一定能解决，请选择已支持版本或其他额度来源。' });
const BASE_MESSAGES = Object.freeze({ PROVIDER_EXPERIMENTAL_OFF: '这是试验性路线。如需使用，请先在设置的“额度”里打开。', PROVIDER_CREDENTIAL_REQUIRED: '请重新连接、复用官方客户端登录，或在本地提供此服务的有效凭据。', PROVIDER_AUTH_REQUIRED: '凭据已失效，请重新提供；历史额度保留。', PROVIDER_ACCESS_DENIED: '服务端拒绝访问，可能缺少授权范围或订阅资格；不能据此认定会员过期。', PROVIDER_RATE_LIMITED: '服务限流，15 分钟后可重试。', PROVIDER_REDIRECT_REJECTED: '额度接口发生重定向，已阻止凭据转发。', PROVIDER_REQUEST_FAILED: '额度读取失败，保留上次成功观测。', PROVIDER_TIMEOUT: '额度读取超时，保留上次成功观测。', PROVIDER_OUTPUT_LIMIT: '额度响应超出大小限制，未保存。', PROVIDER_RESPONSE_INVALID: '额度响应不符合已核对的合同，未替换历史结果。', PROVIDER_QUOTA_UNAVAILABLE: '服务未返回可识别的额度，不能当作零或无限。', PROVIDER_CANCELED: '已取消本次读取。', PROVIDER_CACHE_INVALID: '额度连接缓存损坏，原文件保留；请先检查应用数据目录。', PROVIDER_STORAGE_FAILED: '额度结果保存失败，未发布为新结果。', PROVIDER_ACTION_INVALID: '额度操作无效或状态已变化。', PROVIDER_FIXTURE_BLOCKED: '合成环境禁止真实账号网络请求。' });
const LOGIN_MESSAGES = Object.freeze({ PROVIDER_ZCODE_INIT_FAILED: 'ZCode 授权初始化未能连接；Chrome 尚未打开，请重试。', PROVIDER_ZCODE_POLL_FAILED: 'ZCode 授权结果查询连接失败，请重试；尚未保存新账号。', PROVIDER_CHROME_MISSING: '未找到已安装的 Chrome。请安装 Chrome 后重试，或手动打开服务商官网并提供凭据。', PROVIDER_BROWSER_FAILED: 'Chrome 未能打开；应用仍可使用，请重试或手动打开官网。', PROVIDER_SECURE_STORAGE_REQUIRED: 'Windows 系统加密不可用，无法保持登录；没有保存明文凭据。', PROVIDER_SECRET_STORAGE_FAILED: '本机登录凭据暂时无法保存或恢复，请先点击刷新重试；历史额度保留。若持续失败，再重新连接。', PROVIDER_LOGIN_FAILED: '登录未完成，可能被客户端、网站或网络限制；可重试或选择其他连接方式。', PROVIDER_LOGIN_TIMEOUT: '网站登录等待超时，请重新开始。', PROVIDER_LOGIN_BUSY: '已有连接正在进行，请先完成或取消。' });
const MESSAGES = Object.freeze({ ...BASE_MESSAGES, ...EXTRA_MESSAGES });
const safeCode = error => Object.hasOwn(MESSAGES, error?.message) || Object.hasOwn(LOGIN_MESSAGES, error?.message) ? error.message : error?.message === 'PROVIDER_PASSIVE_PENDING' ? 'PROVIDER_PASSIVE_PENDING' : 'PROVIDER_REQUEST_FAILED';
const idValid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
// The reads of one batch share one worker, which leaves soon after the last of them: each extra connection
// costs a request, not a process. A read that overruns ends its worker, and any read sharing it is retried or reported like any failure.
const WORKER_IDLE_MS = 1500, WORKER_CANCEL_MS = 3000;
let worker = null, requests = 0;
function sharedWorker() {
  if (worker) { clearTimeout(worker.idle); return worker; }
  const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]])); env.ELECTRON_RUN_AS_NODE = '1';
  const child = fork(path.join(__dirname, 'provider-worker.js'), [], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }), current = { child, pending: new Map(), idle: null };
  const gone = () => { if (worker === current) worker = null; clearTimeout(current.idle); for (const finish of [...current.pending.values()]) finish(null); };
  child.on('message', value => current.pending.get(value?.id)?.(value));
  child.on('error', gone); child.on('close', gone);
  return worker = current;
}
function runWorker(adapter, token, signal, project, operation = 'quota') {
  return new Promise((resolve, reject) => {
    const current = sharedWorker(), { child } = current, id = ++requests;
    let timedOut = false, killer = null;
    const finish = value => {
      current.pending.delete(id); clearTimeout(timer); clearTimeout(killer); signal.removeEventListener('abort', abort);
      if (!current.pending.size && worker === current) { current.idle = setTimeout(() => { if (current.pending.size) return; if (worker === current) worker = null; if (child.connected) child.disconnect(); }, WORKER_IDLE_MS); current.idle.unref?.(); }
      if (signal.aborted) reject(new Error('PROVIDER_CANCELED'));
      else if (timedOut) reject(new Error('PROVIDER_TIMEOUT'));
      else if (operation === 'renew' && value?.credentials) resolve(value.credentials);
      else if (operation === 'quota' && value?.resources) resolve({ resources: value.resources, identityContext: value.identityContext });
      else reject(new Error(Object.hasOwn(MESSAGES, value?.errorCode) ? value.errorCode : 'PROVIDER_REQUEST_FAILED'));
    };
    const cancel = () => { if (child.connected) child.send({ cancel: true, id }, () => {}); killer = setTimeout(() => child.kill(), WORKER_CANCEL_MS); };
    const abort = () => cancel();
    const timer = setTimeout(() => { timedOut = true; cancel(); }, adapter === 'mimo-web' ? 60000 : ['claude-web', 'opencode-web', 'gemini-code-assist'].includes(adapter) ? 40000 : 20000);
    current.pending.set(id, finish);
    signal.addEventListener('abort', abort, { once: true });
    child.send({ id, adapter, credential: token, project: adapter === 'opencode-zen' && operation === 'quota' ? { console: project?.console } : project, operation }, sendError => { if (sendError) child.kill(); });
    if (signal.aborted) abort();
  });
}
class ProviderQuotaService {
  constructor(root, { changed = () => {}, run = runWorker, now = Date.now, fixture = false, secretStore = null, websiteLogin = null, history = null, clientLogin = null, forgetClient = () => {}, prepare = null, scheduler = new RefreshScheduler(), retryDelay = 8000 } = {}) {
    Object.assign(this, { history, root: path.resolve(root), changed, run, now, fixture, secretStore, websiteLogin, clientLogin, forgetClient, prepare, scheduler, retryDelay });
    this.operations = new Set(); this.jobs = new Map();
    fs.mkdirSync(this.root, { recursive: true }); this.file = own(this.root, path.join(this.root, 'connections.json'));
    this.metrics = new OperationMetrics(['refresh'], ['queued', 'success', 'failed', 'skipped', 'canceled', 'authRequired', 'rateLimited', 'storageFailed']);
    this.rows = []; this.secrets = new Map(); this.contexts = new Map(); this.identities = new ConnectionIdentities(); this.busy = new Map(); this.versions = new Map(); this.tail = Promise.resolve(); this.closed = false; this.cacheError = null;
    try {
      if (fs.existsSync(this.file)) {
        if (fs.statSync(this.file).size > CACHE_LIMIT) throw new Error();
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (saved?.schemaVersion !== 'ProviderQuotaCacheV1' || !Array.isArray(saved.connections) || saved.connections.length > 20) throw new Error();
        const ids = new Set();
        this.rows = saved.connections.map(row => {
          const route = Object.hasOwn(routes, row?.adapter) && routes[row.adapter], quota = row?.quota === null ? null : projectResources(row?.quota);
          if (!route || !idValid(row.id) || ids.has(row.id) || typeof row.alias !== 'string' || row.alias.length > 48 || /[\x00-\x1f]/.test(row.alias) || row.quota !== null && (!quota || quota.provider !== route.provider)) throw new Error();
          ids.add(row.id); return { id: row.id, adapter: row.adapter, provider: route.provider, alias: row.alias, quota, status: 'cached', lastAttempt: null, errorCode: null, nextRefreshAt: null };
        });
      }
    } catch { this.rows = []; this.cacheError = 'PROVIDER_CACHE_INVALID'; }
    this.remembered = new Map(); this.pendingWebsite = null; this.cleanupTasks = new Set(); this.cleanupError = null;
    for (const row of this.rows.filter(value => routes[value.adapter].kind !== 'passive')) {
      try { const value = this.secretStore?.get(row.id, row.adapter); if (value) { if (value.context != null) this.contexts.set(row.id, value.context); if (value.credential === 'official-login-required' || value.expiresAt && Date.parse(value.expiresAt) <= this.now() && !value.context?.oauth && !value.context?.desktop && !value.context?.cursor) { row.status = 'login-required'; row.errorCode = 'PROVIDER_AUTH_REQUIRED'; } else { this.secrets.set(row.id, value.credential); this.remembered.set(row.id, value.expiresAt); } } }
      catch (error) { row.errorCode = safeCode(error); row.credentialRestoreFailure = ['read', 'decrypt', 'record'].includes(error.stage) ? error.stage : null; }
    }
    this.passiveTimes = new Map();
    this.passiveTimer=null;this.schedulePassive();
  }
  schedulePassive() {
    if(this.closed||this.cacheError||!this.rows.some(value=>routes[value.adapter].kind==='passive')){clearInterval(this.passiveTimer);this.passiveTimer=null;return;}
    if(this.passiveTimer)return;
    this.passiveTimer = setInterval(() => {
      if (this.closed || this.cacheError) return;
      for (const row of this.rows.filter(value => routes[value.adapter].kind === 'passive')) {
        try { const file = own(this.root, path.join(this.root, 'incoming', row.id + '.json')), stamp = fs.statSync(file).mtimeMs; if (this.passiveTimes.get(row.id) === stamp || this.busy.has(row.id)) continue; this.passiveTimes.set(row.id, stamp); void this.refresh(row.id).catch(() => {}); } catch { /* Waiting for the explicitly configured exporter. */ }
      }
    }, 5000); this.passiveTimer.unref?.();
  }
  state() { return { schemaVersion: 'ProviderQuotaStateV1', refreshConcurrency: this.scheduler.state(), capabilities: capabilities(), experimentalEnabled: this.experimentalEnabled(), cacheError: this.cacheError, cleanupError: this.cleanupError, pendingWebsiteLogin: this.pendingWebsite ? { adapter: this.pendingWebsite.adapter, id: this.pendingWebsite.id } : null, accounts: this.rows.map(row => ({ ...row, remembered: this.remembered.has(row.id), credentialExpiresAt: this.remembered.get(row.id) || null, passive: routes[row.adapter].kind === 'passive', errorMessage: row.errorCode === 'PROVIDER_PASSIVE_PENDING' ? '等待本人配置官方状态栏导出；尚未收到额度观测。' : MESSAGES[row.errorCode] || LOGIN_MESSAGES[row.errorCode] || null, quota: resourceView(row.quota, { ...row, busy: this.busy.has(row.id) }, this.now()), credentialReady: routes[row.adapter].kind === 'passive' || this.secrets.has(row.id), credentialRetryable: ['PROVIDER_SECRET_STORAGE_FAILED', 'PROVIDER_SECURE_STORAGE_REQUIRED'].includes(row.errorCode), busy: this.busy.has(row.id), ...this.identities.view(row.id) })) }; }
  // Experimental routes are off by default (owner 2026-11-04). A synthetic run starts with them on; its own suites turn them off.
  experimentalEnabled() { try { return JSON.parse(fs.readFileSync(path.join(this.root, 'experimental.json'), 'utf8')).enabled === true; } catch { return this.fixture === true; } }
  setExperimental(value) { if (typeof value !== 'boolean') throw new Error('PROVIDER_ACTION_INVALID'); fs.mkdirSync(this.root, { recursive: true }); fs.writeFileSync(path.join(this.root, 'experimental.json'), JSON.stringify({ enabled: value })); this.notify(); return this.state(); }
  // A new connection only; one the person already has keeps working.
  allowed(adapter, id) { if (id === null && Object.hasOwn(routes, adapter) && experimental(routes[adapter]) && !this.experimentalEnabled()) throw new Error('PROVIDER_EXPERIMENTAL_OFF'); }
  notify() { this.schedulePassive(); if (!this.closed) this.changed(); }
  cleanupClient(adapter, context) { try { this.forgetClient(adapter, context); } catch { this.cleanupError = 'PROVIDER_SECRET_STORAGE_FAILED'; } }
  invalidateCredential(row) {
    this.identities.forget(row.id);
    this.secrets.delete(row.id); const context = this.contexts.get(row.id);
    if (context?.clientHome) { const retained = { clientHome: context.clientHome, ...(context.discover ? { discover: true } : {}) }; this.secretStore?.put(row.id, row.adapter, 'official-login-required', null, retained); this.contexts.set(row.id, retained); }
    else { this.secretStore?.remove(row.id); this.contexts.delete(row.id); }
    this.remembered.delete(row.id);
  }
  persist(rows) {
    if (this.cacheError) throw new Error(this.cacheError);
    try {
      const contents = JSON.stringify({ schemaVersion: 'ProviderQuotaCacheV1', connections: rows.map(({ id, adapter, alias, quota }) => ({ id, adapter, alias, quota })) });
      if (Buffer.byteLength(contents) > CACHE_LIMIT) throw Error('PROVIDER_STORAGE_FAILED');
      const temporary = own(this.root, this.file + '.tmp'); fs.writeFileSync(temporary, contents, { mode: 0o600 }); fs.renameSync(temporary, this.file);
    }
    catch (cause) { throw new Error('PROVIDER_STORAGE_FAILED', { cause }); }
  }
  account(id) { const row = idValid(id) && this.rows.find(value => value.id === id); if (!row) throw new Error('PROVIDER_ACTION_INVALID'); return row; }
  async loginWebsite(request, client = false, supplied = null) {
    if (this.closed || this.cacheError || !request || Object.keys(request).filter(key => key !== 'fresh').sort().join(',') !== 'adapter,alias,consent,id' || request.fresh !== undefined && (request.fresh !== true || !client || !['claude-oauth', 'gemini-code-assist', 'antigravity-cli', 'zcode-device', 'opencode-zen'].includes(request.adapter)) || request.consent !== true || !(supplied ? Object.hasOwn(routes, request.adapter) && !['passive', 'local-report'].includes(routes[request.adapter].kind) : client ? Object.hasOwn(routes, request.adapter) && routes[request.adapter].clientLogin : WEBSITE_ADAPTERS.includes(request.adapter)) || typeof request.alias !== 'string' || !request.alias.trim() || request.alias.length > 48 || /[\x00-\x1f]/.test(request.alias) || request.id !== null && !idValid(request.id)) throw new Error('PROVIDER_ACTION_INVALID');
    this.allowed(request.adapter, request.id);
    if (this.pendingWebsite) throw new Error('PROVIDER_LOGIN_BUSY');
    const existing = request.id === null ? null : this.account(request.id);
    if (existing ? existing.adapter !== request.adapter || this.busy.has(existing.id) : this.rows.length >= 20) throw new Error('PROVIDER_ACTION_INVALID');
    if (this.fixture) throw new Error('PROVIDER_FIXTURE_BLOCKED');
    if (!this.secretStore?.available()) throw new Error('PROVIDER_SECURE_STORAGE_REQUIRED');
    const login = supplied ? async () => supplied : client ? this.clientLogin : this.websiteLogin;
    if (!login) throw new Error('PROVIDER_LOGIN_FAILED');
    const connectionId = existing?.id || randomUUID(); let loginResult, committed = false;
    let done; const active = this.pendingWebsite = { adapter: request.adapter, id: request.id, abort: new AbortController(), done: new Promise(resolve => { done = resolve; }) }; this.notify();
    try {
      const result = loginResult = await login(request.adapter, active.abort.signal, connectionId, existing ? this.contexts.get(existing.id) : null, { credential: existing ? this.secrets.get(existing.id) : null, fresh: request.fresh === true });
      const observation = result?.quota || await this.run(request.adapter, result?.credential, active.abort.signal, result?.context);
      const quota = projectResources(observation?.resources ?? observation);
      if (!quota || quota.provider !== routes[request.adapter].provider || !quota.fetchedAt || Date.parse(quota.fetchedAt) > this.now() + 60000 || Date.parse(quota.fetchedAt) < this.now() - 60000) throw new Error('PROVIDER_RESPONSE_INVALID');
      if (this.closed || active.abort.signal.aborted || existing && !this.rows.includes(existing)) throw new Error('PROVIDER_CANCELED');
      if (!existing && this.rows.length >= 20 || existing && this.busy.has(existing.id)) throw new Error('PROVIDER_ACTION_INVALID');
      const credential = normalizeCredential(request.adapter, result?.credential), id = connectionId;
      if (!credential) throw new Error('PROVIDER_LOGIN_FAILED');
      const expiresAt = result.expiresAt ?? null;
      const row = { ...(existing || { id, adapter: request.adapter, provider: routes[request.adapter].provider, alias: request.alias.trim() }), quota, status: 'ready', lastAttempt: quota.fetchedAt, errorCode: null, credentialRestoreFailure: null, nextRefreshAt: null };
      // Validate first. A failed/rejected account switch must retain the previous
      // account's credential and quota, rather than attaching its history to a new login.
      const previous = existing ? this.secretStore.snapshot(id) : null, previousContext = existing ? this.contexts.get(id) : null;
      this.secretStore.put(id, request.adapter, credential, expiresAt, result.context);
      try { this.persist(existing ? this.rows.map(value => value === existing ? row : value) : [...this.rows, row]); }
      catch (error) { this.secretStore.restore(id, previous); throw error; }
      if (existing) Object.assign(existing, row); else this.rows.push(row);
      this.secrets.set(id, credential); if (result.context != null) this.contexts.set(id, result.context); else this.contexts.delete(id); this.remembered.set(id, expiresAt);
      this.identities.observe(id, request.adapter, credential, observation?.identityContext ?? result.context);
      committed = true;
      if (previousContext?.clientHome && previousContext.clientHome !== result.context?.clientHome) this.cleanupClient(request.adapter, previousContext);
      this.pendingWebsite = null; return this.state();
    } finally { if (!committed && loginResult?.context?.clientHome && loginResult.context.clientHome !== this.contexts.get(connectionId)?.clientHome) this.cleanupClient(request.adapter, loginResult.context); if (this.pendingWebsite === active) this.pendingWebsite = null; done(); this.notify(); }
  }
  async openWebsite(request, open) {
    if (this.closed || this.cacheError || !request || Object.keys(request).sort().join(',') !== 'adapter,alias,consent,id' || request.consent !== true || !WEBSITE_ADAPTERS.includes(request.adapter) || typeof request.alias !== 'string' || !request.alias.trim() || request.alias.length > 48 || /[\x00-\x1f]/.test(request.alias) || request.id !== null && !idValid(request.id)) throw new Error('PROVIDER_ACTION_INVALID');
    this.allowed(request.adapter, request.id);
    if (request.id !== null && this.account(request.id).adapter !== request.adapter) throw new Error('PROVIDER_ACTION_INVALID');
    if (this.fixture) throw new Error('PROVIDER_FIXTURE_BLOCKED');
    const { sites } = require('./provider-website-login');
    await open(sites[request.adapter].url);
    return this.state();
  }
  cancelWebsite() { this.pendingWebsite?.abort.abort(); return this.state(); }
  async connect(request) {
    this.allowed(request?.adapter, null);
    const route = request && Object.hasOwn(routes, request.adapter) ? routes[request.adapter] : null, google = route?.kind === 'google-internal';
    const browserContext = manualBrowserContext(request?.adapter, request?.userAgent, request?.organization, request?.workspace);
    const remember = request?.remember === true, keys = request && Object.keys(request).filter(key => !['remember', 'userAgent', 'organization', 'workspace'].includes(key)).sort().join(',');
    const selectedCredential = route?.kind === 'passive' ? null : normalizeCredential(request?.adapter, request?.credential);
    if (browserContext === undefined || this.closed || !route || route.clientOnly || route.kind === 'local-report' || keys !== (google ? 'adapter,alias,credential,project' : 'adapter,alias,credential') || request.remember !== undefined && typeof request.remember !== 'boolean' || google && !validProject(request.project) || (route.kind === 'passive' ? request.credential !== null : !selectedCredential) || typeof request.alias !== 'string' || !request.alias.trim() || request.alias.length > 48 || /[\x00-\x1f]/.test(request.alias) || this.rows.length >= 20) throw new Error('PROVIDER_ACTION_INVALID');
    if (remember && route.kind !== 'passive') return this.loginWebsite({ adapter: request.adapter, alias: request.alias, id: null, consent: true }, false, { credential: selectedCredential, expiresAt: null, context: google ? request.project : browserContext });
    const row = { id: randomUUID(), adapter: request.adapter, provider: routes[request.adapter].provider, alias: request.alias.trim(), quota: null, status: 'cached', lastAttempt: null, errorCode: null, nextRefreshAt: null };
    this.persist([...this.rows, row]);
    this.rows.push(row); if (routes[row.adapter].kind !== 'passive') this.secrets.set(row.id, selectedCredential); this.notify();
    if (google || browserContext) this.contexts.set(row.id, google ? request.project : browserContext);
    void this.refresh(row.id).catch(() => {}); return this.state();
  }
  async supply(id, token, project, remember = false, userAgent, organization, workspace) {
    const row = this.account(id), browserContext = manualBrowserContext(row.adapter, userAgent, organization, workspace), google = routes[row.adapter].kind === 'google-internal', selectedCredential = normalizeCredential(row.adapter, token); if (browserContext === undefined || this.closed || routes[row.adapter].kind === 'passive' || routes[row.adapter].clientOnly || !selectedCredential || this.busy.has(id) || this.pendingWebsite?.id === id || (google ? !validProject(project) : project !== undefined)) throw new Error('PROVIDER_ACTION_INVALID');
    if (typeof remember !== 'boolean') throw new Error('PROVIDER_ACTION_INVALID');
    if (remember) return this.loginWebsite({ adapter: row.adapter, alias: row.alias, id, consent: true }, false, { credential: selectedCredential, expiresAt: null, context: google ? project : browserContext });
    if (this.remembered.has(id)) { this.secretStore.remove(id); this.remembered.delete(id); }
    if (google || browserContext) this.contexts.set(id, google ? project : browserContext); else if (WEBSITE_ADAPTERS.includes(row.adapter)) this.contexts.delete(id);
    this.identities.forget(id); this.secrets.set(id, selectedCredential); row.nextRefreshAt = null; void this.refresh(id).catch(() => {}); return this.state();
  }
  diagnostics() { return this.metrics.state(); }
  restoreCredential(row) {
    const value = this.secretStore?.get(row.id, row.adapter);
    if (!value || value.credential === 'official-login-required') return false;
    if (value.context != null) this.contexts.set(row.id, value.context);
    this.secrets.set(row.id, value.credential); this.remembered.set(row.id, value.expiresAt); return true;
  }
  async refreshAll({ automatic = false } = {}) {
    const batch = { success: 0, failed: 0, skipped: 0 };
    await Promise.all([...this.rows].map(async row => {
      if (this.closed || this.pendingWebsite?.id === row.id || this.busy.has(row.id) || Date.parse(row.nextRefreshAt) > this.now() || !this.secrets.has(row.id) && routes[row.adapter].kind !== 'passive' || automatic && routes[row.adapter].kind === 'local-report' && this.now() - Date.parse(row.lastAttempt) < PROGRAM_EVERY - 5000) { batch.skipped++; return; }
      try {
        await this.refresh(row.id, { automatic });
        if (automatic && row.tryAgain && !this.closed) { row.tryAgain = false; await new Promise(resolve => { const timer = setTimeout(resolve, this.retryDelay); timer.unref?.(); }); if (!this.closed && this.rows.includes(row)) await this.refresh(row.id, { automatic, again: true }); }
        batch[row.errorCode ? 'failed' : 'success']++;
      } catch { batch.failed++; }
    }));
    return batch;
  }
  refresh(id, { automatic = false, again = false } = {}) {
    const row = this.account(id);
    const passive = routes[row.adapter].kind === 'passive';
    if (this.closed || this.cacheError || this.pendingWebsite?.id === id || this.busy.has(id) || !passive && Date.parse(row.nextRefreshAt) > this.now()) { this.metrics.count('skipped'); return Promise.resolve(this.state()); }
    if (this.remembered.get(id) && Date.parse(this.remembered.get(id)) <= this.now() && !this.contexts.get(id)?.oauth && !this.contexts.get(id)?.desktop && !this.contexts.get(id)?.cursor) { this.invalidateCredential(row); row.status = 'login-required'; row.errorCode = 'PROVIDER_AUTH_REQUIRED'; this.notify(); }
    if (!passive && !this.secrets.has(id) && !automatic) {
      try { this.restoreCredential(row); } catch (error) { row.errorCode = safeCode(error); row.credentialRestoreFailure = ['read', 'decrypt', 'record'].includes(error.stage) ? error.stage : null; this.notify(); throw error; }
    }
    if (!passive && !this.secrets.has(id)) throw new Error('PROVIDER_CREDENTIAL_REQUIRED');
    const abort = new AbortController(), version = this.versions.get(id) || 0;
    this.busy.set(id, abort); this.notify();
    const live = () => !this.closed && !abort.signal.aborted && this.rows.includes(row) && (this.versions.get(id) || 0) === version;
    this.metrics.count('queued');
    const context = this.contexts.get(id), key = row.adapter + ':' + (context?.clientHome || id);
    const task = this.scheduler.run({ provider: row.provider, cli: row.adapter === 'antigravity-cli', key, signal: abort.signal }, () => this.metrics.measureAsync('refresh', async () => {
      if (!live()) return;
      const before = row.status, hadError = row.errorCode;
      row.status = 'refreshing'; row.lastAttempt = new Date(this.now()).toISOString(); this.notify();
      try {
        if (this.fixture && !passive) throw new Error('PROVIDER_FIXTURE_BLOCKED');
        if (!passive && this.prepare && (!automatic || !this.contexts.get(id)?.desktop && !this.contexts.get(id)?.cursor)) {
          const prepared = await this.prepare(row.adapter, this.secrets.get(id), abort.signal, this.contexts.get(id));
          if (!live()) return;
          if (prepared) { if (!normalizeCredential(row.adapter, prepared.credential)) throw new Error('PROVIDER_RESPONSE_INVALID'); this.identities.forget(id); this.secretStore.put(id, row.adapter, prepared.credential, prepared.expiresAt, prepared.context); this.secrets.set(id, prepared.credential); this.contexts.set(id, prepared.context); this.remembered.set(id, prepared.expiresAt); }
        }
        let observation;
        try { observation = passive ? readSnapshot(this.root, id,row.provider) : await this.run(row.adapter, this.secrets.get(id), abort.signal, this.contexts.get(id)); }
        catch (error) {
          const context = this.contexts.get(id), ownedGrant = context?.oauth && (context.clientHome || row.adapter === 'opencode-zen' && context.deviceGrant === true);
          // The server can revoke an access token before its recorded expiry.
          // Renew only an app-owned grant, once; do not discard a renewable login on the first 401.
          if (error?.message !== 'PROVIDER_AUTH_REQUIRED' || !ownedGrant || !this.prepare || !live()) throw error;
          const prepared = await this.prepare(row.adapter, this.secrets.get(id), abort.signal, context, { force: true });
          if (!live()) return;
          if (!prepared || !normalizeCredential(row.adapter, prepared.credential)) throw error;
          this.secretStore.put(id, row.adapter, prepared.credential, prepared.expiresAt, prepared.context);
          this.secrets.set(id, prepared.credential); this.contexts.set(id, prepared.context); this.remembered.set(id, prepared.expiresAt);
          observation = await this.run(row.adapter, prepared.credential, abort.signal, prepared.context);
        }
        const result = projectResources(observation?.resources ?? observation);
        if (!live()) return;
        if (!result || result.provider !== row.provider || !result.fetchedAt || Date.parse(result.fetchedAt) > this.now() + 60000 || !passive && Date.parse(result.fetchedAt) < Date.parse(row.lastAttempt) - 60000) throw new Error('PROVIDER_RESPONSE_INVALID');
        const next = { ...row, quota: result, status: 'ready', errorCode: null, credentialRestoreFailure: null, nextRefreshAt: null, quietTicks: 0, tryAgain: false };
        if (JSON.stringify(row.quota) !== JSON.stringify(result)) this.persist(this.rows.map(value => value === row ? next : value)); Object.assign(row, next);
        this.identities.observe(id, row.adapter, this.secrets.get(id), observation?.identityContext ?? this.contexts.get(id));
        this.metrics.count('success');
        this.history?.record(id, { ok: true, automatic });
      } catch (error) {
        if (!live()) return;
        this.metrics.count('failed');
        if (automatic && row.quota && !hadError && PASSING.has(safeCode(error))) {
          const quietTicks = (row.quietTicks || 0) + (again ? 1 : 0);
          if (quietTicks < QUIET_TICKS) { row.quietTicks = quietTicks; row.tryAgain = !again; row.status = before; this.history?.record(id, { ok: false, code: safeCode(error), automatic, quiet: true }); return; }
        }
        const category = { PROVIDER_AUTH_REQUIRED: 'authRequired', PROVIDER_RATE_LIMITED: 'rateLimited', PROVIDER_STORAGE_FAILED: 'storageFailed' }[safeCode(error)];
        if (category) this.metrics.count(category);
        row.errorCode = safeCode(error);
        if (row.errorCode !== 'PROVIDER_PASSIVE_PENDING') this.history?.record(id, { ok: false, code: row.errorCode, automatic });
        row.status = row.errorCode === 'PROVIDER_PASSIVE_PENDING' ? 'waiting' : row.errorCode === 'PROVIDER_AUTH_REQUIRED' ? 'login-required' : 'error';
        if (row.errorCode === 'PROVIDER_CLIENT_ACCOUNT_CHANGED') this.identities.forget(id);
        if (row.status === 'login-required') { try { this.invalidateCredential(row); } catch { row.errorCode = 'PROVIDER_SECRET_STORAGE_FAILED'; } }
        row.nextRefreshAt = passive ? null : new Date(this.now() + (row.errorCode === 'PROVIDER_RATE_LIMITED' ? 15 * 60000 : 60000)).toISOString();
      }
    })).finally(() => { if (abort.signal.aborted) this.metrics.count('canceled'); this.busy.delete(id); if (abort.signal.aborted && this.rows.includes(row) && !this.closed) { row.status = 'cached'; row.errorCode = 'PROVIDER_CANCELED'; } this.notify(); });
    const safe = task.catch(() => {}); this.operations.add(safe); this.jobs.set(id, safe); this.tail = Promise.all([...this.operations]);
    void safe.then(() => { this.operations.delete(safe); if (this.jobs.get(id) === safe) this.jobs.delete(id); }); return task.then(() => this.state());
  }
  cancel(id) { this.account(id); this.busy.get(id)?.abort(); return this.state(); }
  remove(id) {
    const row = this.account(id); if (this.closed) throw new Error('PROVIDER_ACTION_INVALID');
    const next = this.rows.filter(value => value !== row), context = this.contexts.get(id), loginDone = this.pendingWebsite?.id === id ? this.pendingWebsite.done : null;
    this.persist(next); try { this.secretStore?.remove(id); } catch { this.cleanupError = 'PROVIDER_SECRET_STORAGE_FAILED'; } this.remembered.delete(id); this.versions.set(id, (this.versions.get(id) || 0) + 1); this.busy.get(id)?.abort(); if (loginDone) this.pendingWebsite.abort.abort(); this.secrets.delete(id); this.contexts.delete(id); this.identities.forget(id); this.rows = next;
    const cleanup = Promise.all([this.jobs.get(id), loginDone]).then(() => this.forgetClient(row.adapter, context)).catch(() => { this.cleanupError = 'PROVIDER_SECRET_STORAGE_FAILED'; }).finally(() => { this.cleanupTasks.delete(cleanup); this.notify(); }); this.cleanupTasks.add(cleanup);
    this.notify(); return this.state();
  }
  async close() { this.closed = true; const loginDone = this.pendingWebsite?.done; this.cancelWebsite(); clearInterval(this.passiveTimer); this.secrets.clear(); this.identities.clear(); for (const abort of this.busy.values()) abort.abort(); await Promise.all([this.tail, loginDone, ...this.cleanupTasks]); this.contexts.clear(); }
}
function installProviderQuota(ipcMain, valid, service, openExternal, copyPassive = () => { throw new Error('PROVIDER_ACTION_INVALID'); }) {
  const handle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); try { return { ok: true, state: await action(...args) }; } catch (error) { const errorCode = safeCode(error); return { ok: false, errorCode, error: MESSAGES[errorCode] || LOGIN_MESSAGES[errorCode], errorStage: ['read', 'decrypt', 'record', 'encrypt', 'verify', 'snapshot', 'write', 'replace'].includes(error?.stage) ? error.stage : null, storageCode: ['EACCES', 'EPERM', 'EBUSY', 'ENOSPC', 'EIO', 'EROFS'].includes(error?.storageCode) ? error.storageCode : null, state: service.state() }; } });
  handle('quota:providers', (...args) => { if (args.length) throw new Error('PROVIDER_ACTION_INVALID'); return service.state(); });
  handle('quota:providerExperimental', value => service.setExperimental(value));
  handle('quota:providerConnect', request => service.connect(request));
  handle('quota:providerWebsiteLogin', (...args) => { if (args.length !== 1) throw new Error('PROVIDER_ACTION_INVALID'); return service.openWebsite(args[0], openExternal); });
  handle('quota:providerClientLogin', (...args) => { if (args.length !== 1) throw new Error('PROVIDER_ACTION_INVALID'); return service.loginWebsite(args[0], true); });
  handle('quota:providerWebsiteCancel', (...args) => { if (args.length) throw new Error('PROVIDER_ACTION_INVALID'); return service.cancelWebsite(); });
  handle('quota:providerPassiveGuide', async id => { const row = service.account(id); if (routes[row.adapter].kind !== 'passive') throw new Error('PROVIDER_ACTION_INVALID'); await copyPassive(id); return service.state(); });
  handle('quota:providerAction', request => {
    if (!request || Object.keys(request).some(key => !['action', 'id', 'credential', 'project', 'remember', 'userAgent', 'organization', 'workspace'].includes(key)) || !idValid(request.id)) throw new Error('PROVIDER_ACTION_INVALID');
    if (request.action === 'credential') return service.supply(request.id, request.credential, request.project, request.remember, request.userAgent, request.organization, request.workspace);
    if (request.organization !== undefined || request.workspace !== undefined || request.userAgent !== undefined || request.credential !== undefined || request.project !== undefined || request.remember !== undefined || !['refresh', 'cancel', 'remove'].includes(request.action)) throw new Error('PROVIDER_ACTION_INVALID');
    return service[request.action](request.id);
  });
  handle('quota:providerGuide', async adapter => {
    if (!Object.hasOwn(routes, adapter)) throw new Error('PROVIDER_ACTION_INVALID');
    const urls = { claude: 'https://code.claude.com/docs/en/statusline', antigravity:'https://antigravity.google/docs/cli/statusline/', workbuddy: 'https://open.workbuddy.cn/en/docs/third-party-app', deepseek: 'https://platform.deepseek.com/api_keys', opencode: 'https://opencode.ai/go', gemini: 'https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/code_assist/server.ts', mimo: 'https://platform.xiaomimimo.com', cursor: 'https://cursor.com/dashboard' };
    await openExternal((adapter === 'opencode-zen' ? 'https://opencode.ai/console' : adapter === 'opencode-go' ? 'https://opencode.ai/auth' : null) || urls[routes[adapter].provider] || (adapter === 'zai-cn' ? 'https://bigmodel.cn/coding-plan/personal/usage' : 'https://z.ai/manage-apikey/coding-plan/personal/my-plan')); return service.state();
  });
}
const readMessage = code => MESSAGES[code] ?? LOGIN_MESSAGES[code] ?? null;
module.exports = { readMessage, ProviderQuotaService, installProviderQuota, MESSAGES, runWorker };

function manualBrowserContext(adapter, userAgent, organization, workspace) {
  if (organization !== undefined && (adapter !== 'claude-web' || typeof organization !== 'string' || !/^[a-f0-9-]{36}$/i.test(organization))) return undefined;
  if (workspace !== undefined && (adapter !== 'opencode-web' || typeof workspace !== 'string' || !/^(?:wrk_|org_)[A-Za-z0-9_-]{1,100}$/.test(workspace))) return undefined;
  if (adapter === 'workbuddy-web') return typeof userAgent === 'string' && userAgent.length > 0 && userAgent.length <= 512 && !/[^\x20-\x7e]/.test(userAgent) ? { userAgent } : undefined;
  if (userAgent !== undefined) return undefined;
  return organization ? { organization } : workspace ? { workspace } : null;
}
