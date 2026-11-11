'use strict';
const fs = require('node:fs'), path = require('node:path'), { fork } = require('node:child_process');
const { plans, version, newer } = require('./agent-install-plans');
const { agents } = require('../m1/agent-catalog');
const { own } = require('./agent-install-engine');
const setupCatalog = require('./agent-setup-catalog');
const ERROR_MESSAGES = Object.freeze({
  INSTALL_DOWNLOAD_FAILED: '下载失败，请检查网络后重试，或使用官方下载入口。', INSTALL_TIMEOUT: '操作超时；请重新检查状态后重试。',
  INSTALL_CHECKSUM_FAILED: '下载文件校验不符，未执行。请重试或使用官方下载。', INSTALL_SIGNATURE_FAILED: '安装包签名或发行者核验未通过，未启动安装包。',
  INSTALL_PROCESS_FAILED: '安装程序未正常完成，旧的应用内版本保留；可重新安装或打开官方排查。', INSTALL_VERSION_UNVERIFIED: '安装后的版本或运行状态未能核验，旧版本保持使用。',
  INSTALL_METADATA_INVALID: '官方安装信息格式不符合当前合同，未继续安装。', INSTALL_PLATFORM_UNSUPPORTED: '当前系统或架构不支持此安装路线。',
  INSTALL_LAYOUT_UNSUPPORTED: '安装后的目录结构未被当前适配器识别，旧版本保留。', INSTALL_DEPENDENCY_FAILED: '应用内 Node.js 准备失败，请重试或使用官方下载。',
  INSTALL_CANCELED: '操作已取消，已启用的旧版本保留。', INSTALL_CLEANUP_UNCONFIRMED: '无法确认安装子进程已清理；请检查进程并重启本应用后继续。',
  INSTALL_OUTPUT_LIMIT: '安装输出超过限制，已停止本次安装。', INSTALL_URL_REJECTED: '下载地址不符合已核对的官方来源，未继续。',
  INSTALL_WRITE_FAILED: '安装文件写入失败，请检查本应用数据目录的权限与磁盘空间。', INSTALL_FIXTURE_BLOCKED: '合成测试环境禁止真实安装或网络检查。',
  INSTALL_INTERRUPTED: '上次操作被中断，请重新检查版本；未确认安装完成。', INSTALL_FAILED: '安装未完成，请重新检查后重试或使用官方下载。'
  , INSTALL_ARCHIVE_REJECTED: '安装包目录或格式未通过安全检查，未启动程序。', INSTALL_DOWNLOAD_LIMIT: '安装包超出本次大小限制，已停止下载。',
  INSTALL_LOCAL_MAINTENANCE_REQUIRED: '检测到旧的本机维护记录，请使用本机维护工具检查；产品安装器不会替换该外部程序。'
});
const STAGES = new Set(['queued', 'resolving', 'dependency', 'downloading', 'verifying', 'extracting', 'rolling-back', 'installing', 'postcheck', 'checking', 'awaiting-installer', 'complete', 'failed', 'canceled']);
class AgentInstallService {
  constructor(root, environment, { changed = () => {}, openPath, openExternal, writeText, fixture = false, forkWorker = fork } = {}) {
    Object.assign(this, { root, environment, changed, openPath, openExternal, writeText, fixture, forkWorker });
    this.rows = Object.fromEntries(Object.keys(plans).map(agent => [agent, { agent, name: agents[agent].name, state: 'unchecked', version: null, latest: null, managed: false, runnable: null, checkedAt: null, stage: null, busy: false, errorCode: null, message: null }]));
    this.queue = []; this.active = null; this.closed = false; this.blocked = false; this.revision = 0; this.persistWarning = false;
    this.file = path.join(root, 'install-status.json');
    try { own(path.dirname(root), this.file); if (fs.statSync(this.file).size < 1024 * 1024 && !fs.lstatSync(this.file).isSymbolicLink()) { const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); for (const [agent, row] of Object.entries(this.rows)) { const old = saved.rows?.[agent]; if (old && !old.busy) Object.assign(row, { state: ['installed', 'missing', 'broken', 'unverified', 'incomplete', 'multiple'].includes(old.state) ? old.state : 'unchecked', version: version(old.version), latest: version(old.latest), managed: old.managed === true, localMaintenanceRequired: old.localMaintenanceRequired === true || old.governed === true, governed: false, canRollback: false, expectedVersion: version(old.expectedVersion), stage: old.stage === 'awaiting-installer' ? 'awaiting-installer' : null, message: old.stage === 'awaiting-installer' ? '上次已打开安装程序，请完成后复检；尚未确认安装完成。' : '上次检查结果，请检查当前版本。', checkedAt: typeof old.checkedAt === 'string' && Number.isFinite(Date.parse(old.checkedAt)) ? old.checkedAt : null }); else if (old?.busy) Object.assign(row, { errorCode: 'INSTALL_INTERRUPTED', message: ERROR_MESSAGES.INSTALL_INTERRUPTED }); } } } catch { /* First launch or invalid advisory status; active generation is rechecked on demand. */ }
  }
  state() { return structuredClone({ schemaVersion: 'AgentInstallStateV1', revision: this.revision, active: this.active?.agent || null, blocked: this.blocked, persistWarning: this.persistWarning, rows: Object.values(this.rows).map(row => ({ ...row, updateAvailable: !row.localMaintenanceRequired && !row.checkError && newer(row.latest, row.version) === true, route: row.localMaintenanceRequired ? '旧本机维护记录 · 请使用本机工具' : plans[row.agent].kind === 'desktop' ? '官方安装包 · 需完成安装界面' : '应用内管理 · 不覆盖其他安装', canCancel: row.busy, quotaReady: false })) }); }
  publish() {
    this.revision++;
    try { own(path.dirname(this.root), this.file); const temporary = own(this.root, this.file + '.tmp'); fs.mkdirSync(this.root, { recursive: true }); fs.writeFileSync(temporary, JSON.stringify({ rows: this.rows }), { mode: 0o600 }); fs.renameSync(temporary, this.file); this.persistWarning = false; } catch { this.persistWarning = true; }
    try { this.changed(); } catch { /* A closing renderer does not cancel installation. */ }
  }
  searchDirectories() { return Object.values(this.rows).filter(row => row.managed && row.state === 'installed' && typeof row.searchDirectory === 'string').map(row => row.searchDirectory); }
  run(request, report, signal) {
    if (this.fixture) return Promise.reject(new Error('INSTALL_FIXTURE_BLOCKED'));
    return new Promise((resolve, reject) => {
      const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]])); env.ELECTRON_RUN_AS_NODE = '1';
      const child = this.forkWorker(path.join(__dirname, 'agent-install-worker.js'), [], { env, windowsHide: true, serialization: 'json', stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      let settled = false, cancelTimer;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(cancelTimer); signal.removeEventListener('abort', cancel); child.kill(); error ? reject(error) : resolve(value); };
      const cancel = () => { if (!child.connected) { finish(new Error('INSTALL_CLEANUP_UNCONFIRMED')); return; } child.send({ cancel: true }, () => {}); cancelTimer = setTimeout(() => finish(new Error('INSTALL_CLEANUP_UNCONFIRMED')), request.agent === 'claude' ? 90000 : 12000); };
      const timer = setTimeout(cancel, 15 * 60000);
      signal.addEventListener('abort', cancel, { once: true });
      child.on('message', message => { if (message?.progress) report(message.progress); else if (message?.result) finish(null, message.result); else if (message?.errorCode) finish(new Error(Object.hasOwn(ERROR_MESSAGES, message.errorCode) ? message.errorCode : 'INSTALL_FAILED')); });
      child.on('error', () => finish(new Error(child.pid ? 'INSTALL_CLEANUP_UNCONFIRMED' : 'INSTALL_FAILED')));
      // A result/error response acknowledges completed cleanup. An unexpected
      // worker exit does not; the OS owner watchdog may still be reaping a job.
      child.on('exit', () => finish(new Error('INSTALL_CLEANUP_UNCONFIRMED')));
      child.send({ ...request, root: this.root, environment: this.environment() });
      if (signal.aborted) cancel();
    });
  }
  async pump() {
    if (this.active || this.closed || this.blocked || !this.queue.length) return;
    const task = this.queue.shift(), row = this.rows[task.agent], abort = new AbortController(); this.active = { ...task, abort };
    this.publish();
    this.current = (async () => {
      try {
        const result = await this.run(task, progress => { if (STAGES.has(progress?.stage)) { row.stage = progress.stage; row.attempt = Number.isInteger(progress.attempt) && progress.attempt >= 1 && progress.attempt <= 3 ? progress.attempt : null; row.downloadedBytes = Number.isSafeInteger(progress.downloadedBytes) && progress.downloadedBytes >= 0 ? progress.downloadedBytes : null; row.totalBytes = Number.isSafeInteger(progress.totalBytes) && progress.totalBytes > 0 ? progress.totalBytes : null; this.publish(); } }, abort.signal);
        if (abort.signal.aborted && !result.installed) throw new Error('INSTALL_CANCELED');
        if (result.awaitingInstaller) {
          // The worker returns only a verified app-owned installer. Recheck its
          // hash immediately before OS handoff; no caller-supplied path reaches it.
          const crypto = require('node:crypto'), file = own(this.root, result.path);
          const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
          if (abort.signal.aborted) throw new Error('INSTALL_CANCELED');
          if (hash.digest('hex') !== result.sha256) throw new Error('INSTALL_CHECKSUM_FAILED');
          const error = await this.openPath(file); if (error) throw new Error('INSTALL_PROCESS_FAILED');
          row.stage = 'awaiting-installer'; row.expectedVersion = version(result.version); row.message = '已打开官方安装程序，请完成安装后点击“复检安装”；尚未确认安装完成。';
        } else if (result.installed) {
          if (!version(result.version)||result.governed||result.rolledBack) throw new Error('INSTALL_VERSION_UNVERIFIED');
          Object.assign(row, { state:'installed',managed:true,governed:false,canRollback:false,localMaintenanceRequired:false,version:version(result.version),latest:version(result.version),stage:'complete',message:'应用内版本安装并通过版本复检，未登录或读取额度。' });
          this.queue.unshift({ agent: task.agent, action: 'check' });
        } else {
          const expected = row.expectedVersion;
          if (!['installed', 'missing', 'broken', 'multiple', 'incomplete', 'unverified'].includes(result.state)) throw new Error('INSTALL_FAILED');
          const launchCommand = typeof result.launchCommand === 'string' && result.launchCommand.length < 32768 ? result.launchCommand : null;
          Object.assign(row, { state: result.state, version: version(result.version), latest: version(result.latest), checkError: Object.hasOwn(ERROR_MESSAGES, result.checkError) ? result.checkError : result.checkError ? 'INSTALL_FAILED' : null, managed: result.managed === true, governed: false, canRollback: false, localMaintenanceRequired: result.localMaintenanceRequired === true, runnable: result.runnable === true ? true : result.runnable === false ? false : null, checkedAt: new Date().toISOString(), stage: 'complete', launchCommand, searchDirectory: result.searchDirectory || null });
          if (expected && !(row.version && (row.version === expected || newer(row.version, expected) === true))) { row.stage = 'awaiting-installer'; row.message = '尚未发现目标版本，请完成官方安装界面后再复检。'; }
          else { row.expectedVersion = null; row.message = row.checkError ? ERROR_MESSAGES[row.checkError] : result.state === 'broken' ? '应用内版本无法通过运行核验，可重新安装修复；已有数据保留。' : '版本检查已完成；发现程序不表示账号或额度已连接。'; }
        }
      } catch (error) {
        row.errorCode = Object.hasOwn(ERROR_MESSAGES, error?.message) ? error.message : 'INSTALL_FAILED'; row.message = ERROR_MESSAGES[row.errorCode]; row.stage = row.errorCode === 'INSTALL_CANCELED' ? 'canceled' : 'failed';
        if(row.errorCode==='INSTALL_LOCAL_MAINTENANCE_REQUIRED')Object.assign(row,{localMaintenanceRequired:true,governed:false,canRollback:false,launchCommand:null,searchDirectory:null});
        if (row.errorCode === 'INSTALL_CLEANUP_UNCONFIRMED') { this.blocked = true; for (const queued of this.queue) Object.assign(this.rows[queued.agent], { busy: false, stage: 'canceled', message: '安装运行环境需人工检查，队列已停止。' }); this.queue = []; }
      } finally {
        row.busy = false; row.downloadedBytes = row.totalBytes = null; this.active = null;
        const next = this.queue.find(item => item.agent === task.agent); if (next) { row.busy = true; row.stage = 'queued'; }
        this.publish(); void this.pump();
      }
    })();
    return this.current;
  }
  action(request) {
    const failure = message => ({ ok: false, message, state: this.state() });
    if (this.closed || this.blocked || !request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 3 || !['agent', 'action', 'revision'].every(key => Object.hasOwn(request, key)) || !Number.isSafeInteger(request.revision)) return failure(this.blocked ? ERROR_MESSAGES.INSTALL_CLEANUP_UNCONFIRMED : '安装请求无效。');
    if (request.revision !== this.revision) return failure('安装状态已变化，请使用最新状态重试。');
    if (request.action === 'check-all' && request.agent === 'all') { for (const agent of Object.keys(plans)) this.enqueue(agent, 'check'); return { ok: true, state: this.state() }; }
    if (request.action === 'upgrade-all' && request.agent === 'all') { for (const row of this.state().rows) if (row.updateAvailable && (row.managed || plans[row.agent].kind === 'desktop')) this.enqueue(row.agent, 'install'); return { ok: true, state: this.state() }; }
    if (!Object.hasOwn(plans, request.agent)) return failure('这个来源没有程序安装功能。');
    const row = this.rows[request.agent];
    if (request.action === 'official') return Promise.resolve(this.openExternal(setupCatalog[request.agent].install)).then(() => ({ ok: true, message: '已请求浏览器打开官方下载入口。', state: this.state() }), () => failure('官方下载网页未能打开，请检查默认浏览器后重试。'));
    if (request.action === 'cancel') {
      if (this.active?.agent === request.agent) this.active.abort.abort(); else { this.queue = this.queue.filter(task => task.agent !== request.agent); row.busy = false; row.stage = 'canceled'; row.message = ERROR_MESSAGES.INSTALL_CANCELED; this.publish(); }
      return { ok: true, state: this.state() };
    }
    if (request.action === 'dismiss-installer' && !row.busy && row.stage === 'awaiting-installer') {
      row.expectedVersion = null; row.stage = 'canceled'; row.message = '已清除待复检标记，未确认安装完成；可重新检查或再次安装。'; this.publish();
      return { ok: true, state: this.state() };
    }
    if (request.action === 'copy-launch' && row.launchCommand && !row.busy) { this.writeText(row.launchCommand); return { ok: true, message: '已复制应用内 CLI 的 PowerShell 启动命令。', state: this.state() }; }
    if(request.action==='install'&&row.localMaintenanceRequired)return failure(ERROR_MESSAGES.INSTALL_LOCAL_MAINTENANCE_REQUIRED);
    if (!['check', 'install'].includes(request.action) || row.busy || row.stage === 'awaiting-installer' && request.action === 'install') return failure('请先完成当前操作，或复检安装状态。');
    this.enqueue(request.agent, request.action); return { ok: true, state: this.state() };
  }
  enqueue(agent, action) {
    if (this.rows[agent].busy) return;
    Object.assign(this.rows[agent], { busy: true, stage: 'queued', errorCode: null, message: null }); this.queue.push({ agent, action }); this.publish(); void this.pump();
  }
  async close() { this.closed = true; for (const queued of this.queue) Object.assign(this.rows[queued.agent], { busy: false, stage: 'canceled', message: ERROR_MESSAGES.INSTALL_CANCELED }); this.queue = []; this.active?.abort.abort(); await this.current; }
}
function installAgentInstaller(ipcMain, valid, service) {
  ipcMain.handle('usage:installers', (event, ...args) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); return args.length ? { ok: false, message: '请求参数无效。' } : { ok: true, state: service.state() }; });
  ipcMain.handle('usage:installerAction', (event, ...args) => { if (!valid(event)) throw new Error('IPC_SENDER_REJECTED'); try { return args.length === 1 ? service.action(args[0]) : { ok: false, message: '请求参数无效。' }; } catch { return { ok: false, message: '操作未完成，请重新检查安装状态。', state: service.state() }; } });
}
module.exports = { AgentInstallService, installAgentInstaller };
