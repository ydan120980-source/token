'use strict';
const { Worker } = require('node:worker_threads');
const { selected } = require('../m1/config-health');
const AGENTS = ['codex','claude'], SCOPES = ['home','project'];
function key(agent, scope) { if (!AGENTS.includes(agent) || !SCOPES.includes(scope)) throw Error('CONFIG_SELECTION_INVALID'); return agent + ':' + scope; }
function runCheck(selection, agent) {
  let worker, timer, settled = false, finish;
  const promise = new Promise((resolve, reject) => {
    finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); void worker?.terminate(); error ? reject(Error(error)) : resolve(value); };
    timer = setTimeout(() => finish('CONFIG_CHECK_TIMEOUT'), 30000);
    try {
      worker = new Worker(require.resolve('../m1/config-health-worker'), { workerData: { selection, agent }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
      worker.once('message', value => {
        if (!value.result || value.result.schemaVersion !== 'ConfigHealthV1' || JSON.stringify(value).length > 512 * 1024) finish('CONFIG_CHECK_FAILED');
        else finish(null, value.result);
      });
      worker.once('error', () => finish('CONFIG_CHECK_FAILED')); worker.once('exit', () => finish('CONFIG_CHECK_FAILED'));
    } catch { finish('CONFIG_CHECK_FAILED'); }
  });
  return { promise, cancel: () => finish('CONFIG_CHECK_CANCELLED') };
}
class ConfigHealthService {
  constructor(choose, run = runCheck, manager = null, importPicker = null) { this.choose = choose; this.run = run; this.manager = manager; this.importPicker = importPicker; this.entries = new Map(); this.running = null; this.choosing = null; this.closed = false; }
  state() { return { busy: Boolean(this.running || this.choosing), active: this.running?.key || this.choosing, selections: Object.fromEntries([...this.entries].map(([key, value]) => [key, { selected: true, result: value.result || null, checkedAt: value.checkedAt || null, error: value.error || null }])) }; }
  available() { if (this.closed) throw Error('CONFIG_CHECK_CLOSED'); if (this.running || this.choosing) throw Error('CONFIG_CHECK_BUSY'); }
  async select(agent, scope) {
    const id = key(agent, scope); this.available(); this.choosing = id; let file;
    try { file = await this.choose(agent, scope); } finally { this.choosing = null; }
    this.available(); if (!file) return { canceled: true, state: this.state() };
    const root = selected(file); this.entries.set(id, { root }); if (this.manager) { this.manager.context = null; this.manager.draft = null; } return { state: this.state() };
  }
  forget(agent, scope) { const id = key(agent, scope); this.available(); this.entries.delete(id); if (this.manager) { this.manager.context = null; this.manager.draft = null; } return { state: this.state() }; }
  async check(agent, scope) {
    const id = key(agent, scope); this.available(); const entry = this.entries.get(id); if (!entry) throw Error('CONFIG_ROOT_NOT_SELECTED');
    const task = this.run({ [scope]: entry.root }, agent); this.running = { key: id, ...task }; entry.error = null;
    try { const result = await task.promise; if (!this.closed) { entry.result = result; entry.checkedAt = new Date().toISOString(); } }
    catch (error) { entry.error = ['CONFIG_CHECK_TIMEOUT','CONFIG_CHECK_CANCELLED'].includes(error.message) ? error.message : 'CONFIG_CHECK_FAILED'; }
    finally { this.running = null; }
    return { state: this.state() };
  }
  cancel() { this.running?.cancel(); return { state: this.state() }; }
  invalidate(root) {
    const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
    for (const entry of this.entries.values()) if (normalized(entry.root) === normalized(root)) { entry.result = null; entry.checkedAt = null; entry.error = null; }
  }
  async manage(action, agent, scope, kind, request = {}) {
    const id = key(agent, scope); this.available(); const entry = this.entries.get(id);
    if (!entry || !this.manager) throw Error('CONFIG_ROOT_NOT_SELECTED');
    if (!['mcp','hooks','skills'].includes(kind) || !['list','preview','import','apply','undo','release'].includes(action)) throw Error('CONFIG_SELECTION_INVALID');
    if(action==='release'){const c=this.manager.context;if(c?.id===request.id&&c.root===entry.root&&c.agent===agent&&c.scope===scope&&c.kind===kind){this.manager.context=null;this.manager.draft=null;}return {released:true};}
    if (action === 'list') return { view: this.manager.list(entry.root, agent, scope, kind) };
    if (action === 'undo') { const result = this.manager.undo(entry.root); this.invalidate(entry.root); return { ...result, state: this.state() }; }
    const context = this.manager.context;
    if (!context || context.root !== entry.root || context.agent !== agent || context.scope !== scope || context.kind !== kind) throw Error('CONFIG_PREVIEW_STALE');
    if (action === 'preview') return { preview: this.manager.prepare(request.id, request) };
    if (action === 'apply') { const result = this.manager.apply(request.id); this.invalidate(entry.root); return { ...result, state: this.state() }; }
    this.choosing = id; let imported;
    try { imported = await this.importPicker(kind); } finally { this.choosing = null; }
    this.available(); if (!imported) return { canceled: true };
    // The context must still match after the native picker, never a renderer path.
    if (context !== this.manager.context) throw Error('CONFIG_PREVIEW_STALE');
    return { preview: this.manager.prepare(request.id, { action: 'import' }, imported) };
  }
  async close() { this.closed = true; const task = this.running; task?.cancel(); await task?.promise.catch(() => {}); this.entries.clear(); if (this.manager) { this.manager.context = null; this.manager.draft = null; this.manager.undoRecord = null; } }
}
function installConfigHealth(ipcMain, valid, service) {
  const methods = { state: () => service.state(), choose: (agent, scope) => service.select(agent, scope), check: (agent, scope) => service.check(agent, scope), forget: (agent, scope) => service.forget(agent, scope), cancel: () => service.cancel(), manage: (...args) => service.manage(...args) };
  for (const [name, action] of Object.entries(methods)) ipcMain.handle('usage:config:' + name, async (event, ...args) => {
    if (!valid(event)) return { error: 'IPC_SENDER_REJECTED' };
    try { return await action(...args); } catch (error) { return { error: ['CONFIG_SELECTION_INVALID','CONFIG_CHECK_CLOSED','CONFIG_CHECK_BUSY','CONFIG_ROOT_NOT_SELECTED','CONFIG_MANAGEMENT_UNSUPPORTED','CONFIG_MANAGEMENT_LIMIT','CONFIG_FORMAT_UNSUPPORTED','CONFIG_IMPORT_REJECTED','CONFIG_IMPORT_COLLISION','CONFIG_EDIT_INVALID','CONFIG_NO_CHANGE','CONFIG_PREVIEW_STALE','CONFIG_CHANGED','CONFIG_BACKUP_UNAVAILABLE','CONFIG_UNDO_UNAVAILABLE','CONFIG_PATH_REJECTED','CONFIG_FILE_REJECTED'].includes(error.message) ? error.message : 'CONFIG_SELECTION_REJECTED' }; }
  });
}
module.exports = { ConfigHealthService, installConfigHealth, runCheck };
