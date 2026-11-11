'use strict';
// The local Agent admin (owner 2026-11-03, docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md). Nothing here runs on its own: a
// check happens when the person presses it, in a worker with no network. Changes go through ConfigManager's preview,
// encrypted backup and restore. The renderer only ever names an item by id; paths stay in this process.
const fs = require('node:fs'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const { selected } = require('../m1/config-health');
const { OPENABLE } = require('../m1/agent-inventory');
const syntax = require('../m1/config-health-syntax');
const ERRORS = ['INVENTORY_FILE_MISSING', 'INVENTORY_OPEN_REFUSED', 'INVENTORY_OPEN_FAILED', 'INVENTORY_BUSY', 'INVENTORY_FAILED', 'INVENTORY_TIMEOUT', 'INVENTORY_ITEM_UNKNOWN', 'INVENTORY_ACTION_UNSUPPORTED', 'CONFIG_MANAGEMENT_UNSUPPORTED', 'CONFIG_MANAGEMENT_LIMIT', 'CONFIG_FORMAT_UNSUPPORTED', 'CONFIG_IMPORT_REJECTED', 'CONFIG_IMPORT_COLLISION', 'CONFIG_EDIT_INVALID', 'CONFIG_NO_CHANGE', 'CONFIG_PREVIEW_STALE', 'CONFIG_CHANGED', 'CONFIG_BACKUP_UNAVAILABLE', 'CONFIG_UNDO_UNAVAILABLE', 'CONFIG_PATH_REJECTED', 'CONFIG_FILE_REJECTED'];
const KIND = { mcp: 'mcp', skill: 'skills', hook: 'hooks' };
const AUTH_NAME = /^\.?(?:auth|credentials?|tokens?|secrets?|env)(?:[._-]|$)|^\.claude\.json$/i;

function runScan(request) {
  return new Promise((resolve, reject) => {
    let worker, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); void worker?.terminate(); if (error) reject(Error(error)); else resolve(value); };
    const timer = setTimeout(() => finish('INVENTORY_TIMEOUT'), 30000);
    try {
      worker = new Worker(require.resolve('../m1/agent-inventory-worker'), { workerData: request, resourceLimits: { maxOldGenerationSizeMb: 128 } });
      worker.once('message', value => { if (value.result?.schemaVersion === 'AgentInventoryV1') finish(null, value.result); else finish('INVENTORY_FAILED'); });
      worker.once('error', () => finish('INVENTORY_FAILED')); worker.once('exit', () => finish('INVENTORY_FAILED'));
    } catch { finish('INVENTORY_FAILED'); }
  });
}

class AgentInventoryService {
  constructor({ dataDir, home, environment, choose, manager, health = null, run = runScan, reveal = null, open = null, copy = null }) {
    this.reveal = reveal; this.open = open; this.copy = copy; this.repaired = [];
    this.file = path.join(dataDir, 'agent-projects.json'); this.home = home; this.environment = environment; this.choose = choose; this.manager = manager; this.health = health; this.run = run;
    this.locators = new Map(); this.result = null; this.checkedAt = null; this.busy = false; this.error = null;
  }
  projects() { try { const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); return Array.isArray(saved?.projects) ? saved.projects.filter(item => typeof item === 'string' && path.isAbsolute(item)) : []; } catch { return []; } }
  saveProjects(list) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); const temp = this.file + '.tmp'; fs.writeFileSync(temp, JSON.stringify({ projects: list }, null, 2), { mode: 0o600 }); fs.renameSync(temp, this.file); }
  state() { return { busy: this.busy, error: this.error, checkedAt: this.checkedAt, inventory: this.result, repaired: this.repaired.length, projects: this.projects().map((root, index) => ({ id: index, name: path.basename(root) })) }; }
  async check() {
    if (this.busy) throw Error('INVENTORY_BUSY');
    this.busy = true; this.error = null;
    try {
      const existing = this.projects().filter(root => { try { selected(root); return true; } catch { return false; } });
      const result = await this.run({ home: this.home, projects: existing, env: this.environment() });
      this.locators = new Map(result.items.map(item => [item.id, { ...item.locator, agent: item.agent, kind: item.kind, name: item.name, actions: item.actions }]));
      this.result = { ...result, items: result.items.map(({ locator: _locator, ...item }) => item) }; this.checkedAt = new Date().toISOString();
    } catch (error) { this.error = ERRORS.includes(error.message) ? error.message : 'INVENTORY_FAILED'; }
    finally { this.busy = false; }
    return this.state();
  }
  async addProject() {
    const root = await this.choose(); if (!root) return { canceled: true, state: this.state() };
    selected(root);
    const list = this.projects(); if (!list.some(item => item.toLowerCase() === root.toLowerCase())) { list.push(root); this.saveProjects(list); }
    return { state: this.state() };
  }
  removeProject(id) { const list = this.projects(); if (!Number.isInteger(id) || !list[id]) throw Error('INVENTORY_ITEM_UNKNOWN'); list.splice(id, 1); this.saveProjects(list); return { state: this.state() }; }
  item(id) { const value = this.locators.get(id); if (!value) throw Error('INVENTORY_ITEM_UNKNOWN'); return value; }
  /** One instruction file's text, read when the person opens it, kept nowhere. */
  instruction(id) { const item = this.item(id); if (item.kind !== 'instruction') throw Error('INVENTORY_ACTION_UNSUPPORTED'); return this.manager.readText(item.root, item.file); }
  preview(request) {
    if (!request || typeof request !== 'object') throw Error('INVENTORY_ACTION_UNSUPPORTED');
    const item = this.item(request.id), manager = this.manager;
    if (request.action === 'toggle') {
      if (typeof request.enabled !== 'boolean') throw Error('CONFIG_EDIT_INVALID');
      if (item.actions.includes('toggle-plugin')) return { preview: manager.preparePlugin({ root: item.root, agent: item.agent, id: item.name, enabled: request.enabled }) };
      if (item.actions.includes('toggle-layer')) { const view = manager.list(item.root, item.agent, item.scope, 'hooks'); return { preview: manager.prepare(view.id, { action: 'toggle', enabled: request.enabled }) }; }
      if (!item.actions.includes('toggle')) throw Error('INVENTORY_ACTION_UNSUPPORTED');
      const view = manager.list(item.root, item.agent, item.scope, KIND[item.kind]), row = item.kind === 'skill' ? manager.context.rows.findIndex(entry => entry.directory === item.directory) : view.rows.findIndex(entry => entry.name === item.name);
      if (row < 0) throw Error('CONFIG_MANAGEMENT_UNSUPPORTED');
      return { preview: manager.prepare(view.id, { action: 'toggle', row, enabled: request.enabled }) };
    }
    if (request.action === 'copy') {
      if (item.kind !== 'mcp' || !['codex', 'claude'].includes(request.to)) throw Error('INVENTORY_ACTION_UNSUPPORTED');
      const raw = this.server(item), root = request.to === 'claude' && item.scope === 'home' ? null : item.root;
      if (!root) throw Error('CONFIG_MANAGEMENT_UNSUPPORTED');
      return { preview: manager.prepareCopy({ root, agent: request.to, scope: item.scope, name: item.name, value: raw }) };
    }
    if (request.action === 'text') {
      if (item.kind !== 'instruction' || typeof request.text !== 'string' || typeof request.revision !== 'string') throw Error('CONFIG_EDIT_INVALID');
      return { preview: manager.prepareText({ root: item.root, file: item.file, revision: request.revision, text: request.text }) };
    }
    throw Error('INVENTORY_ACTION_UNSUPPORTED');
  }
  server(item) {
    const source = fs.readFileSync(item.file, 'utf8'), value = item.file.endsWith('.toml') ? syntax.toml(source) : syntax.json(source);
    const map = value.mcp_servers ?? value.mcpServers ?? value.mcp, raw = map?.[item.name];
    if (!raw) throw Error('CONFIG_CHANGED');
    if (raw.headers || raw.http_headers || raw.headersHelper || raw.http_headers_helper || raw.bearer_token_env_var) throw Error('CONFIG_FORMAT_UNSUPPORTED');
    if (Array.isArray(raw.command)) return { command: raw.command[0], args: raw.command.slice(1), ...raw.environment ? { env: raw.environment } : {} };
    return { ...typeof raw.command === 'string' ? { command: raw.command } : {}, ...Array.isArray(raw.args) ? { args: raw.args } : {}, ...raw.env ? { env: raw.env } : {}, ...typeof raw.url === 'string' ? { url: raw.url } : {} };
  }
  /**
   * Where an item lives, for the person's own click. Only an id comes from the page, the path is this process's own. Opening is
   * limited to text files by extension and never follows a link, so nothing here can start a program.
   */
  async locate(request) {
    const item = this.item(request?.id), action = request?.action;
    if (action === 'copy') { if (!this.copy) throw Error('INVENTORY_ACTION_UNSUPPORTED'); await this.copy(item.file); return { done: true }; }
    if (action !== 'reveal' && action !== 'open') throw Error('INVENTORY_ACTION_UNSUPPORTED');
    let stat; try { stat = fs.lstatSync(item.file); } catch { throw Error('INVENTORY_FILE_MISSING'); }
    if (action === 'reveal') { if (!this.reveal) throw Error('INVENTORY_ACTION_UNSUPPORTED'); this.reveal(item.file); return { done: true }; }
    if (!this.open || !stat.isFile() || !OPENABLE.test(item.file) || AUTH_NAME.test(path.basename(item.file))) throw Error('INVENTORY_OPEN_REFUSED');
    if (await this.open(item.file)) throw Error('INVENTORY_OPEN_FAILED');
    return { done: true };
  }
  /** What one click would do: what can be stopped and why, what cannot and what to do instead. Each stop is tried as a preview; nothing is written. */
  plan() {
    const rows = [], manual = [], items = this.result?.items ?? [], remedyOf = item => item.problems.find(entry => entry.remedy === 'stop') ?? item.problems.find(entry => entry.remedy === 'stop-optional');
    for (const item of items) {
      const fix = item.enabled === false ? null : remedyOf(item), steps = entry => ({ id: item.id, name: item.name, agent: item.agent, kind: item.kind, file: item.file, text: entry.text, fix: entry.fix, why: null });
      if (fix) {
        try { this.preview({ id: item.id, action: 'toggle', enabled: false }); rows.push({ id: item.id, name: item.name, agent: item.agent, kind: item.kind, file: item.file, text: fix.text, chosen: fix.remedy === 'stop' }); }
        catch (error) { manual.push({ ...steps(fix), why: ERRORS.includes(error.message) ? error.message : 'INVENTORY_ACTION_UNSUPPORTED' }); }
      }
      for (const entry of item.problems) if (entry !== fix && entry.remedy === 'manual' && entry.level !== 'note') manual.push(steps(entry));
    }
    this.manager.draft = null; this.manager.context = null;
    return { rows, manual };
  }
  /** The chosen stops, each with its own backup and record. One that fails leaves the others done, and says so. */
  repair(ids) {
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw Error('CONFIG_EDIT_INVALID');
    const known = new Map(this.plan().rows.map(row => [row.id, row])), done = [], failed = [];
    for (const id of new Set(ids)) {
      const row = known.get(id); if (!row) { failed.push({ id, name: id, error: 'INVENTORY_ITEM_UNKNOWN' }); continue; }
      try { done.push({ id, name: row.name, record: this.apply(this.preview({ id, action: 'toggle', enabled: false }).preview.id).record }); }
      catch (error) { failed.push({ id, name: row.name, error: ERRORS.includes(error.message) ? error.message : 'INVENTORY_ACTION_REJECTED' }); }
    }
    this.repaired = done.map(entry => entry.record);
    return { done: done.map(({ id, name }) => ({ id, name })), failed, state: this.state() };
  }
  /** Back to before that one click, last change first. What was changed again since stays as it is, and is counted. */
  undoRepair() {
    let restored = 0, left = 0;
    for (const record of [...this.repaired].reverse()) { try { this.restore(record); restored++; } catch { left++; } }
    this.repaired = [];
    return { restored, left, state: this.state() };
  }
  apply(id) { const result = this.manager.apply(id); this.health?.invalidate?.(this.manager.lastRoot); return result; }
  history() { return { records: this.manager.history() }; }
  restore(id) { const result = this.manager.restore(id); return { ...result, records: this.manager.history() }; }
}
function installAgentInventory(ipcMain, valid, service) {
  const methods = { state: () => service.state(), check: () => service.check(), addProject: () => service.addProject(), removeProject: id => service.removeProject(id), instruction: id => service.instruction(id), preview: request => service.preview(request), apply: id => service.apply(id), locate: request => service.locate(request), plan: () => service.plan(), repair: ids => service.repair(ids), undoRepair: () => service.undoRepair(), history: () => service.history(), restore: id => service.restore(id) };
  for (const [name, action] of Object.entries(methods)) ipcMain.handle('usage:agents:' + name, async (event, ...args) => {
    if (!valid(event)) return { error: 'IPC_SENDER_REJECTED' };
    try { return await action(...args); } catch (error) { return { error: ERRORS.includes(error.message) ? error.message : 'INVENTORY_ACTION_REJECTED' }; }
  });
}
module.exports = { AgentInventoryService, installAgentInventory };
