'use strict';
// Explicit local management only. The scanner never imports or invokes this writer.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { TextDecoder } = require('node:util');
const { guard, selected, sameFile } = require('../m1/config-health');
const syntax = require('../m1/config-health-syntax');
const { project } = require('../m1/config-health-project');
const FILE_LIMIT = 262144, TREE_LIMIT = 4 * 1024 * 1024, SKILL_ROWS = 512;
const SKILL_DIRS = Object.freeze({ codex: { home: ['.agents/skills', '.codex/skills'], project: ['.agents/skills'] }, claude: { home: ['.claude/skills'], project: ['.claude/skills'] }, gemini: { home: ['.gemini/skills'], project: ['.gemini/skills'] }, opencode: { home: ['.config/opencode/skills'], project: ['.opencode/skills'] } });
const fail = code => { throw Error(code); }, hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function existingGuard(file) { let current = file; while (!fs.existsSync(current)) { const parent = path.dirname(current); if (parent === current) fail('CONFIG_PATH_REJECTED'); current = parent; } guard(current); }
function read(file, limit = FILE_LIMIT) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || /^[\\/]{2}/.test(file)) fail('CONFIG_PATH_REJECTED');
  existingGuard(file); let before;
  try { before = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  guard(file); if (!before.isFile() || before.nlink !== 1 || before.size > limit) fail('CONFIG_FILE_REJECTED');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!sameFile(before, fs.fstatSync(fd))) fail('CONFIG_CHANGED'); const bytes = Buffer.alloc(before.size); let at = 0;
    while (at < bytes.length) { const count = fs.readSync(fd, bytes, at, bytes.length - at, null); if (!count) fail('CONFIG_CHANGED'); at += count; }
    guard(file); if (!sameFile(before, fs.fstatSync(fd)) || !sameFile(before, fs.lstatSync(file))) fail('CONFIG_CHANGED'); return bytes;
  } finally { fs.closeSync(fd); }
}
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
function parse(file, bytes) { try { const result = bytes ? (file.endsWith('.toml') ? syntax.toml(decode(bytes)) : syntax.json(decode(bytes))) : Object.create(null); if (!object(result)) fail(); return result; } catch { fail('CONFIG_FORMAT_UNSUPPORTED'); } }
function tomlValue(value) {
  if (Array.isArray(value)) return '[' + value.map(tomlValue).join(', ') + ']';
  if (object(value)) return '{ ' + Object.entries(value).map(([key, item]) => JSON.stringify(key) + ' = ' + tomlValue(item)).join(', ') + ' }';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  fail('CONFIG_FORMAT_UNSUPPORTED');
}
function serialize(file, value) {
  const text = file.endsWith('.toml') ? Object.entries(value).map(([key, item]) => JSON.stringify(key) + ' = ' + tomlValue(item)).join('\n') + '\n' : JSON.stringify(value, null, 2) + '\n';
  const bytes = Buffer.from(text); if (bytes.length > FILE_LIMIT) fail('CONFIG_FILE_REJECTED');
  // Parse our output before a preview can authorize a write.
  if (JSON.stringify(parse(file, bytes)) !== JSON.stringify(value)) fail('CONFIG_FORMAT_UNSUPPORTED'); return bytes;
}
function snapshot(file) { const bytes = read(file); return { file, bytes, revision: bytes === null ? null : hash(bytes), value: parse(file, bytes) }; }
function unchanged(snap) { const bytes = read(snap.file); if ((bytes === null ? null : hash(bytes)) !== snap.revision) fail('CONFIG_CHANGED'); }
function target(root, agent, scope, kind) {
  selected(root); if (!['home','project'].includes(scope) || !['mcp','hooks','skills'].includes(kind) || !(kind === 'skills' ? Object.hasOwn(SKILL_DIRS, agent) : ['codex','claude'].includes(agent))) fail('CONFIG_SELECTION_INVALID');
  if (agent === 'claude' && scope === 'home' && kind === 'mcp') fail('CONFIG_MANAGEMENT_UNSUPPORTED');
  // A Skill is moved, never edited, so this reaches every Agent the admin lists. The first directory is where a switch puts one back.
  if (kind === 'skills') { const [first, ...others] = SKILL_DIRS[agent][scope]; return { directory: path.join(root, first), also: others.map(item => path.join(root, item)), disabled: path.join(root, '.agent-usage/disabled-skills', agent) }; }
  const relative = kind === 'mcp' ? agent === 'codex' ? '.codex/config.toml' : '.mcp.json' : agent === 'codex' ? '.codex/hooks.json' : scope === 'project' ? '.claude/settings.local.json' : '.claude/settings.json';
  const control = agent === 'codex' ? '.codex/config.toml' : scope === 'project' ? '.claude/settings.local.json' : '.claude/settings.json';
  return { file: path.join(root, relative), control: path.join(root, control) };
}
function tree(directory) {
  const files = [], directories = [], digest = crypto.createHash('sha256'); let total = 0, nodes = 0;
  function visit(dir, depth) {
    guard(dir); if (depth > 8 || !fs.lstatSync(dir).isDirectory()) fail('CONFIG_IMPORT_REJECTED');
    for (const name of fs.readdirSync(dir).sort()) {
      if (++nodes > 128 || name === '.git' || /^\.?(?:auth|credentials|tokens?|secrets?|env)(?:[._-]|$)/i.test(name)) fail('CONFIG_IMPORT_REJECTED');
      const file = path.join(dir, name), relative = path.relative(directory, file), stat = fs.lstatSync(file); guard(file);
      if (stat.isDirectory()) { directories.push(relative); digest.update('d:' + relative + '\0'); visit(file, depth + 1); }
      else { const bytes = read(file, 1024 * 1024); if (!bytes || (total += bytes.length) > TREE_LIMIT) fail('CONFIG_IMPORT_REJECTED'); files.push({ relative, bytes }); digest.update('f:' + relative + '\0').update(bytes); }
    }
  }
  visit(directory, 0); return { files, directories, revision: digest.digest('hex') };
}
function skillParts(bytes) {
  const text = decode(bytes), match = /^(---\r?\n(?:[\s\S]*?\r?\n)?---)(?:\r?\n|$)/.exec(text);
  if (!match || Buffer.byteLength(match[1]) > 16384) fail('CONFIG_FORMAT_UNSUPPORTED');
  let value; try { value = syntax.frontmatter(match[1]); } catch { fail('CONFIG_FORMAT_UNSUPPORTED'); }
  return { value, body: text.slice(match[0].length) };
}
function skillBytes(value, body, agent) {
  const prefix = '---\n' + Object.entries(value).map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n') + '\n---';
  if (project(agent, 'skill', prefix).some(row => row.state !== 'static-ok')) fail('CONFIG_EDIT_INVALID');
  const bytes = Buffer.from(prefix + '\n' + body); if (bytes.length > FILE_LIMIT) fail('CONFIG_FILE_REJECTED'); return bytes;
}
class ConfigManager {
  constructor(backupRoot, vault) { this.backupRoot = backupRoot; this.vault = vault; this.context = null; this.draft = null; this.undoRecord = null; }
  list(root, agent, scope, kind) {
    const paths = target(root, agent, scope, kind), context = { root, agent, scope, kind, paths, id: crypto.randomUUID(), rows: [], snapshots: [] }; let enabled = null;
    if (kind === 'skills') {
      let total = 0;
      for (const [directory, active] of [[paths.directory,true],...paths.also.map(item => [item,true]),[paths.disabled,false]]) {
        existingGuard(directory); if (!fs.existsSync(directory)) continue; guard(directory);
        const names = fs.readdirSync(directory).sort(); if (names.length > SKILL_ROWS) fail('CONFIG_MANAGEMENT_LIMIT');
        for (const name of names) {
          const dir = path.join(directory, name); guard(dir); if (!fs.lstatSync(dir).isDirectory()) continue;
          const file = path.join(dir, 'SKILL.md'), bytes = read(file); if (!bytes) continue;
          if ((total += bytes.length) > TREE_LIMIT) fail('CONFIG_MANAGEMENT_LIMIT');
          // A Skill with a broken header can still be moved; only editing its header needs it to parse.
          let value = {}; try { value = skillParts(bytes).value; } catch { /* edit reports it */ }
          context.rows.push({ name, directory: dir, file, revision: hash(bytes), enabled: active, value });
        }
      }
    } else {
      const primary = snapshot(paths.file), control = paths.control === paths.file ? primary : snapshot(paths.control); context.snapshots = primary === control ? [primary] : [primary, control]; context.primary = primary; context.control = control;
      if (kind === 'mcp') {
        const map = primary.value[agent === 'codex' ? 'mcp_servers' : 'mcpServers'] || {}; if (!object(map) || Object.keys(map).length > 64) fail('CONFIG_FORMAT_UNSUPPORTED');
        if (control.value.disabledMcpjsonServers !== undefined && (!Array.isArray(control.value.disabledMcpjsonServers) || control.value.disabledMcpjsonServers.some(value => typeof value !== 'string'))) fail('CONFIG_FORMAT_UNSUPPORTED');
        for (const [name, value] of Object.entries(map)) { if (!object(value)) fail('CONFIG_FORMAT_UNSUPPORTED'); context.rows.push({ name, value, enabled: agent === 'codex' ? value.enabled !== false : !(control.value.disabledMcpjsonServers || []).includes(name) }); }
      } else {
        const hooks = primary.value.hooks || {}; if (!object(hooks)) fail('CONFIG_FORMAT_UNSUPPORTED');
        for (const [event, groups] of Object.entries(hooks)) { if (!Array.isArray(groups)) fail('CONFIG_FORMAT_UNSUPPORTED'); for (const [groupIndex, group] of groups.entries()) { if (!object(group) || !Array.isArray(group.hooks)) fail('CONFIG_FORMAT_UNSUPPORTED'); for (const [handlerIndex, value] of group.hooks.entries()) { if (!object(value) || context.rows.length >= 128) fail('CONFIG_MANAGEMENT_LIMIT'); context.rows.push({ name: event + ' · ' + (['command','http','mcp_tool','prompt','agent'].includes(value.type) ? value.type : '其他') + ' · ' + (context.rows.length + 1), event, groupIndex, handlerIndex, value }); } } }
        if (agent === 'codex') { if (control.value.features !== undefined && !object(control.value.features)) fail('CONFIG_FORMAT_UNSUPPORTED'); enabled = typeof control.value.features?.hooks === 'boolean' ? control.value.features.hooks : null; }
        else enabled = typeof control.value.disableAllHooks === 'boolean' ? !control.value.disableAllHooks : null;
      }
    }
    this.context = context; this.draft = null;
    return { id: context.id, kind, target: path.relative(root, paths.file || paths.directory).replaceAll('\\','/'), enabled, rows: context.rows.map((row, index) => ({ id: index, name: row.name.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0,120), enabled: row.enabled ?? null })), undo: Boolean(this.undoRecord && this.undoRecord.root === root), normalization: kind !== 'skills' };
  }
  prepare(id, request, imported = null) {
    const c = this.context; if (!c || c.id !== id || !object(request)) fail('CONFIG_PREVIEW_STALE');
    selected(c.root); for (const snap of c.snapshots) unchanged(snap);
    const draft = { id: crypto.randomUUID(), root: c.root, summary: '', writes: [], source: null, move: null, importTree: null };
    const row = Number.isSafeInteger(request.row) ? c.rows[request.row] : null;
    if (request.action === 'import') {
      if (!imported) fail('CONFIG_IMPORT_REJECTED');
      if (c.kind === 'skills') {
        const name = path.basename(imported); if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) fail('CONFIG_IMPORT_REJECTED');
        selected(imported); const header = read(path.join(imported, 'SKILL.md')); if (!header) fail('CONFIG_IMPORT_REJECTED');
        const metadata = skillParts(header); skillBytes(metadata.value, metadata.body, c.agent);
        const bundle = tree(imported), skill = bundle.files.find(file => file.relative === 'SKILL.md'); if (!skill) fail('CONFIG_IMPORT_REJECTED');
        if (hash(skill.bytes) !== hash(header)) fail('CONFIG_CHANGED');
        const parts = skillParts(skill.bytes); skillBytes(parts.value, parts.body, c.agent);
        const destination = path.join(c.paths.directory, name); existingGuard(destination); if (fs.existsSync(destination) || c.rows.some(row => row.name === name)) fail('CONFIG_IMPORT_COLLISION');
        draft.importTree = { source: imported, destination, bundle }; draft.summary = '导入 1 个 Skill 目录，共 ' + bundle.files.length + ' 个文件；不会执行其中脚本。';
      } else {
        if (!['.mcp.json','mcp.json','hooks.json','settings.json','settings.local.json','config.toml','agent-config.json'].includes(path.basename(imported))) fail('CONFIG_IMPORT_REJECTED');
        const bytes = read(imported); if (!bytes) fail('CONFIG_IMPORT_REJECTED'); const value = parse(imported, bytes), key = c.kind === 'mcp' ? c.agent === 'codex' ? 'mcp_servers' : 'mcpServers' : 'hooks', incoming = value[key];
        if (!object(incoming) || !Object.keys(incoming).length || Object.keys(incoming).length > 64) fail('CONFIG_IMPORT_REJECTED');
        const next = structuredClone(c.primary.value); if (next[key] !== undefined && !object(next[key])) fail('CONFIG_FORMAT_UNSUPPORTED'); const existing = Object.assign(Object.create(null), next[key] || {});
        for (const [name, value] of Object.entries(incoming)) { if (Object.hasOwn(existing, name)) fail('CONFIG_IMPORT_COLLISION'); existing[name] = value; } next[key] = existing;
        const output = serialize(c.paths.file, next), kind = c.kind === 'mcp' ? c.agent === 'codex' ? 'codex-config' : 'claude-mcp' : c.agent === 'codex' ? 'codex-hooks' : 'claude-settings';
        if (project(c.agent, kind, decode(output)).some(row => row.kind === c.kind && row.state === 'issue' || row.kind === 'file')) fail('CONFIG_IMPORT_REJECTED');
        draft.writes.push({ snapshot: c.primary, bytes: output }); draft.source = { file: imported, revision: hash(bytes) }; draft.summary = '合并导入 ' + Object.keys(incoming).length + ' 个配置键；同名键不覆盖。';
      }
    } else if (c.kind === 'skills') {
      if (!row) fail('CONFIG_EDIT_INVALID'); const bundle = tree(row.directory), source = bundle.files.find(file => file.relative === 'SKILL.md'); if (!source || hash(source.bytes) !== row.revision) fail('CONFIG_CHANGED');
      if (request.action === 'toggle' && typeof request.enabled === 'boolean' && request.enabled !== row.enabled) {
        const destination = path.join(request.enabled ? c.paths.directory : c.paths.disabled, row.name); existingGuard(destination); if (fs.existsSync(destination)) fail('CONFIG_IMPORT_COLLISION');
        draft.move = { source: row.directory, destination, revision: bundle.revision }; draft.summary = request.enabled ? '将 Skill 移回该 Agent 的技能目录。' : '将 Skill 移到本范围内的停用目录，原文件保留。';
      } else if (request.action === 'edit' && object(request.patch)) {
        const parts = skillParts(source.bytes), next = { ...parts.value };
        for (const key of Object.keys(request.patch)) { if (!['name','description'].includes(key) || typeof request.patch[key] !== 'string' || request.patch[key].length > 4096) fail('CONFIG_EDIT_INVALID'); next[key] = request.patch[key]; }
        draft.writes.push({ snapshot: { file: row.file, bytes: source.bytes, revision: row.revision }, bytes: skillBytes(next, parts.body, c.agent) }); draft.summary = '修改 Skill 名称／描述，保留正文和其他前言字段。';
      } else fail('CONFIG_EDIT_INVALID');
    } else if (request.action === 'toggle' && typeof request.enabled === 'boolean') {
      const control = c.kind === 'mcp' && c.agent === 'codex' ? c.primary : c.control, next = structuredClone(control.value);
      if (c.kind === 'mcp') {
        if (!row) fail('CONFIG_EDIT_INVALID'); if (c.agent === 'codex') next.mcp_servers[row.name].enabled = request.enabled;
        else { const disabled = new Set(next.disabledMcpjsonServers || []); request.enabled ? disabled.delete(row.name) : disabled.add(row.name); next.disabledMcpjsonServers = [...disabled]; }
      } else if (c.agent === 'codex') { next.features ||= {}; next.features.hooks = request.enabled; }
      else next.disableAllHooks = !request.enabled;
      draft.writes.push({ snapshot: control, bytes: serialize(control.file, next) }); draft.summary = (request.enabled ? '启用' : '停用') + (c.kind === 'hooks' ? '本文件层的 hooks；其他配置层仍可能覆盖。' : c.agent === 'claude' ? '此项目 MCP 的拒绝列表设置；恢复不自动授信，仍需客户端确认。' : '此 MCP 的本文件配置；不会启动服务。');
    } else if (request.action === 'edit' && row && object(request.patch)) {
      const next = structuredClone(c.primary.value), value = c.kind === 'mcp' ? next[c.agent === 'codex' ? 'mcp_servers' : 'mcpServers'][row.name] : next.hooks[row.event][row.groupIndex].hooks[row.handlerIndex];
      const keys = c.kind === 'mcp' ? ['command','args','url','type'] : ['command','prompt','url','server','tool','timeout'];
      for (const [key, field] of Object.entries(request.patch)) {
        const valid = key === 'args' ? Array.isArray(field) && field.every(item => typeof item === 'string') : typeof field === 'string' || key === 'timeout' && typeof field === 'number';
        if (!keys.includes(key) || !valid) fail('CONFIG_EDIT_INVALID'); value[key] = field;
      }
      if (c.kind === 'mcp' && request.patch.type) { if (!['stdio','http'].includes(request.patch.type)) fail('CONFIG_EDIT_INVALID'); if (request.patch.type === 'stdio') delete value.url; else { delete value.command; delete value.args; } if (c.agent === 'codex') delete value.type; }
      const bytes = serialize(c.primary.file, next), kind = c.kind === 'mcp' ? c.agent === 'codex' ? 'codex-config' : 'claude-mcp' : c.agent === 'codex' ? 'codex-hooks' : 'claude-settings';
      // Validate the selected entry even when other entries are invalid or the
      // whole-file scan would stop before it. Preserve its event/group context.
      const edited = c.kind === 'mcp' ? { [c.agent === 'codex' ? 'mcp_servers' : 'mcpServers']: { [row.name]: value } } : { hooks: { [row.event]: [{ ...next.hooks[row.event][row.groupIndex], hooks: [value] }] } };
      if (project(c.agent, kind, decode(serialize(c.primary.file, edited))).some(check => check.kind === 'file' || check.kind === c.kind && check.state === 'issue')) fail('CONFIG_EDIT_INVALID');
      draft.writes.push({ snapshot: c.primary, bytes }); draft.summary = '修改所选配置项；未填写的字段、环境变量和请求头保留原值。';
    } else fail('CONFIG_EDIT_INVALID');
    if (draft.writes.some(write => write.bytes.equals(write.snapshot.bytes || Buffer.alloc(0)))) fail('CONFIG_NO_CHANGE');
    draft.guards = c.snapshots; this.draft = draft;
    return { id: draft.id, summary: draft.summary, backupRequired: true, normalization: Boolean(draft.writes.some(write => write.snapshot.file.endsWith('.toml') || write.snapshot.file.endsWith('.json'))) };
  }
  /** A whole instruction file as text, with the revision a later edit must still match. */
  readText(root, file) {
    selected(root); if (!path.resolve(file).startsWith(root + path.sep)) fail('CONFIG_PATH_REJECTED');
    const bytes = read(file); if (!bytes) fail('CONFIG_CHANGED');
    try { return { text: decode(bytes), revision: hash(bytes) }; } catch { fail('CONFIG_FORMAT_UNSUPPORTED'); }
  }
  // A change outside the kinds above: one file, the bytes it had when previewed, one write. apply() backs it up like any other.
  draftWrite(root, snap, bytes, summary) {
    if (bytes.length > FILE_LIMIT) fail('CONFIG_FILE_REJECTED');
    if (snap.bytes && bytes.equals(snap.bytes)) fail('CONFIG_NO_CHANGE');
    const draft = { id: crypto.randomUUID(), root, summary, writes: [{ snapshot: snap, bytes }], source: null, move: null, importTree: null, guards: [snap] };
    this.draft = draft;
    return { id: draft.id, summary, backupRequired: true, normalization: !snap.file.endsWith('.md') };
  }
  prepareText({ root, file, revision, text }) {
    selected(root); if (!path.resolve(file).startsWith(root + path.sep) || !file.endsWith('.md')) fail('CONFIG_PATH_REJECTED');
    const bytes = read(file); if (!bytes) fail('CONFIG_CHANGED'); if (hash(bytes) !== revision) fail('CONFIG_CHANGED');
    return this.draftWrite(root, { file, bytes, revision }, Buffer.from(text), '修改指令文件 ' + path.basename(file) + '；写入前加密备份，可以恢复。');
  }
  /** A plugin's own on/off in the Agent's settings file; the plugin's files are not touched. */
  preparePlugin({ root, agent, id, enabled }) {
    selected(root); if (!['codex', 'claude'].includes(agent) || typeof id !== 'string' || !id.includes('@')) fail('CONFIG_MANAGEMENT_UNSUPPORTED');
    const file = path.join(root, agent === 'codex' ? '.codex/config.toml' : '.claude/settings.json'), snap = snapshot(file), next = structuredClone(snap.value);
    if (agent === 'codex') { if (next.plugins !== undefined && !object(next.plugins)) fail('CONFIG_FORMAT_UNSUPPORTED'); next.plugins ||= {}; next.plugins[id] = { ...next.plugins[id], enabled }; }
    else { if (next.enabledPlugins !== undefined && !object(next.enabledPlugins)) fail('CONFIG_FORMAT_UNSUPPORTED'); next.enabledPlugins ||= {}; next.enabledPlugins[id] = enabled; }
    return this.draftWrite(root, snap, serialize(file, next), (enabled ? '启用' : '停用') + '插件 ' + id + '；插件文件不变，重启 Agent 后生效。');
  }
  /** The same MCP server for another Agent: the fields both understand, never over one it already has. */
  prepareCopy({ root, agent, scope, name, value }) {
    const view = this.list(root, agent, scope, 'mcp'), c = this.context;
    if (view.rows.some(row => row.name === name)) fail('CONFIG_IMPORT_COLLISION');
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name)) fail('CONFIG_EDIT_INVALID');
    const key = agent === 'codex' ? 'mcp_servers' : 'mcpServers', next = structuredClone(c.primary.value), entry = { ...value, ...agent === 'claude' ? { type: value.url ? 'http' : 'stdio' } : {} };
    next[key] = { ...next[key], [name]: entry };
    const bytes = serialize(c.paths.file, next);
    if (project(agent, agent === 'codex' ? 'codex-config' : 'claude-mcp', decode(serialize(c.paths.file, { [key]: { [name]: entry } }))).some(row => row.kind === 'file' || row.state === 'issue')) fail('CONFIG_EDIT_INVALID');
    const environment = Object.keys(value.env || {}).length;
    const preview = this.draftWrite(root, c.primary, bytes, '把 MCP ' + name + ' 加到 ' + (agent === 'codex' ? 'Codex' : 'Claude Code') + (environment ? '，连同 ' + environment + ' 个环境变量' : '') + '；已有的配置不变，也不会启动它。');
    this.draft.guards = c.snapshots;
    return preview;
  }
  backup(payload) {
    if (!this.vault.isEncryptionAvailable()) fail('CONFIG_BACKUP_UNAVAILABLE');
    let encrypted; try { encrypted = this.vault.encryptString(JSON.stringify(payload)); } catch { fail('CONFIG_BACKUP_UNAVAILABLE'); }
    existingGuard(this.backupRoot); fs.mkdirSync(this.backupRoot, { recursive: true }); guard(this.backupRoot);
    const id = crypto.randomUUID(), file = path.join(this.backupRoot, id + '.bin'); fs.writeFileSync(file, encrypted, { flag: 'wx', mode: 0o600 }); return id;
  }
  write(snap, bytes) {
    unchanged(snap); fs.mkdirSync(path.dirname(snap.file), { recursive: true }); guard(path.dirname(snap.file));
    const temp = path.join(path.dirname(snap.file), '.agent-usage-' + crypto.randomUUID() + '.tmp');
    try { fs.writeFileSync(temp, bytes, { flag: 'wx', mode: 0o600 }); unchanged(snap); if (snap.bytes === null) { fs.linkSync(temp, snap.file); fs.unlinkSync(temp); } else fs.renameSync(temp, snap.file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  apply(id) {
    const d = this.draft; if (!d || d.id !== id) fail('CONFIG_PREVIEW_STALE'); selected(d.root); for (const snap of d.guards) unchanged(snap);
    if (d.source && hash(read(d.source.file) || Buffer.alloc(0)) !== d.source.revision) fail('CONFIG_CHANGED');
    if (d.move && tree(d.move.source).revision !== d.move.revision || d.importTree && tree(d.importTree.source).revision !== d.importTree.bundle.revision) fail('CONFIG_CHANGED');
    const backup = this.backup({ at: new Date().toISOString(), summary: d.summary, root: d.root, writes: d.writes.map(write => ({ file: write.snapshot.file, before: write.snapshot.bytes?.toString('base64') ?? null, after: hash(write.bytes) })), move: d.move, imported: d.importTree ? { destination: d.importTree.destination, revision: d.importTree.bundle.revision } : null });
    for (const write of d.writes) this.write(write.snapshot, write.bytes);
    if (d.move) { fs.mkdirSync(path.dirname(d.move.destination), { recursive: true }); guard(path.dirname(d.move.destination)); if (fs.existsSync(d.move.destination)) fail('CONFIG_CHANGED'); fs.renameSync(d.move.source, d.move.destination); }
    if (d.importTree) {
      const { destination, bundle } = d.importTree; fs.mkdirSync(path.dirname(destination), { recursive: true }); guard(path.dirname(destination)); if (fs.existsSync(destination)) fail('CONFIG_CHANGED');
      const temp = path.join(path.dirname(destination), '.agent-usage-' + crypto.randomUUID()); fs.mkdirSync(temp);
      try { for (const directory of bundle.directories) fs.mkdirSync(path.join(temp, directory), { recursive: true }); for (const file of bundle.files) { fs.mkdirSync(path.dirname(path.join(temp, file.relative)), { recursive: true }); fs.writeFileSync(path.join(temp, file.relative), file.bytes, { flag: 'wx', mode: 0o600 }); } if (fs.existsSync(destination)) fail('CONFIG_CHANGED'); fs.renameSync(temp, destination); }
      finally { if (fs.existsSync(temp)) { guard(temp); if (!path.resolve(temp).startsWith(d.root + path.sep)) fail('CONFIG_PATH_REJECTED'); fs.rmSync(temp, { recursive: true }); } }
    }
    this.undoRecord = { id: backup, root: d.root }; this.lastRoot = d.root; this.draft = null; this.context = null; return { applied: true, undo: true, record: backup };
  }
  /** Past changes, newest first, from the encrypted records; only what the list shows leaves this process. */
  history(limit = 40) {
    if (!this.vault.isEncryptionAvailable() || !fs.existsSync(this.backupRoot)) return [];
    const files = fs.readdirSync(this.backupRoot).filter(name => /^[0-9a-f-]{36}\.bin$/.test(name)).map(name => ({ name, at: fs.statSync(path.join(this.backupRoot, name)).mtimeMs })).sort((a, b) => b.at - a.at).slice(0, limit);
    return files.flatMap(({ name, at }) => {
      try {
        const saved = JSON.parse(this.vault.decryptString(read(path.join(this.backupRoot, name), 16 * 1024 * 1024)));
        const changed = saved.writes.some(write => hash(read(write.file) || Buffer.alloc(0)) !== write.after) || (saved.move ? fs.existsSync(saved.move.source) || !fs.existsSync(saved.move.destination) : false) || (saved.imported ? !fs.existsSync(saved.imported.destination) : false);
        return [{ id: name.slice(0, -4), at: saved.at || new Date(at).toISOString(), summary: saved.summary || '配置修改', files: saved.writes.map(write => path.basename(write.file)), restorable: !changed }];
      } catch { return []; }
    });
  }
  restore(id) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) fail('CONFIG_UNDO_UNAVAILABLE');
    const bytes = read(path.join(this.backupRoot, id + '.bin'), 16 * 1024 * 1024); if (!bytes || !this.vault.isEncryptionAvailable()) fail('CONFIG_UNDO_UNAVAILABLE');
    const saved = JSON.parse(this.vault.decryptString(bytes));
    this.undoRecord = { id, root: saved.root };
    return this.undo(saved.root);
  }
  undo(root) {
    const record = this.undoRecord; if (!record || record.root !== root) fail('CONFIG_UNDO_UNAVAILABLE'); selected(root);
    const file = path.join(this.backupRoot, record.id + '.bin'), bytes = read(file, 16 * 1024 * 1024); if (!bytes || !this.vault.isEncryptionAvailable()) fail('CONFIG_BACKUP_UNAVAILABLE');
    const saved = JSON.parse(this.vault.decryptString(bytes)); if (saved.root !== root) fail('CONFIG_UNDO_UNAVAILABLE');
    for (const candidate of [...saved.writes.map(write => write.file), ...(saved.move ? [saved.move.source,saved.move.destination] : []), ...(saved.imported ? [saved.imported.destination] : [])]) if (!path.isAbsolute(candidate) || !path.resolve(candidate).startsWith(root + path.sep)) fail('CONFIG_PATH_REJECTED');
    for (const write of saved.writes) { if (hash(read(write.file) || Buffer.alloc(0)) !== write.after) fail('CONFIG_CHANGED'); }
    if (saved.move && (fs.existsSync(saved.move.source) || tree(saved.move.destination).revision !== saved.move.revision)) fail('CONFIG_CHANGED');
    if (saved.imported && tree(saved.imported.destination).revision !== saved.imported.revision) fail('CONFIG_CHANGED');
    for (const write of saved.writes) { const current = read(write.file), snap = { file: write.file, bytes: current, revision: hash(current) }; if (write.before === null) fs.unlinkSync(write.file); else this.write(snap, Buffer.from(write.before, 'base64')); }
    if (saved.move) { existingGuard(saved.move.source); fs.renameSync(saved.move.destination, saved.move.source); }
    if (saved.imported) {
      const destination = saved.imported.destination; guard(destination); if (!destination.startsWith(root + path.sep)) fail('CONFIG_PATH_REJECTED');
      // Undo removes the active installation without recursively deleting a tree
      // that another program could be editing after the revision check.
      const held = path.join(root, '.agent-usage/undone-imports', crypto.randomUUID()); existingGuard(held); fs.mkdirSync(path.dirname(held), { recursive: true }); guard(path.dirname(held)); fs.renameSync(destination, held);
    }
    this.undoRecord = null; this.context = null; this.draft = null; return { restored: true };
  }
}
module.exports = { ConfigManager, read, serialize, tree };
