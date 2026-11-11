'use strict';
// What is installed for each local Agent (owner 2026-11-03, docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md): MCP servers,
// Skills, Hooks, plugins and instruction files, whether each is on, whether it looks healthy and its details. Runs only
// when the person asks, reads a fixed whitelist under the home directory and the projects they chose, executes nothing
// and opens no network. Values that may be secrets (arguments, environment values, header values, URL paths and
// queries, command lines) never leave this file: names and counts only. Authentication files are not on the list.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { guard } = require('./config-health');
const syntax = require('./config-health-syntax');
const { project } = require('./config-health-project');
const { readFront } = require('./skill-front');

const LIMITS = Object.freeze({ file: 262144, total: 16 * 1024 * 1024, items: 1000, entries: 256, walk: 512 });
const AGENTS = Object.freeze({
  codex: { name: 'Codex', marker: '.codex', user: { config: '.codex/config.toml', hooks: '.codex/hooks.json', skills: ['.agents/skills', '.codex/skills'], instructions: ['.codex/AGENTS.md'] }, project: { config: '.codex/config.toml', hooks: '.codex/hooks.json', skills: ['.agents/skills'], instructions: ['AGENTS.md'] } },
  claude: { name: 'Claude Code', marker: '.claude', user: { settings: ['.claude/settings.json'], skills: ['.claude/skills'], instructions: ['.claude/CLAUDE.md'] }, project: { mcp: '.mcp.json', settings: ['.claude/settings.json', '.claude/settings.local.json'], skills: ['.claude/skills'], instructions: ['CLAUDE.md', '.claude/CLAUDE.md'] } },
  gemini: { name: 'Gemini CLI', marker: '.gemini', user: { settings: ['.gemini/settings.json'], skills: ['.gemini/skills'], instructions: ['.gemini/GEMINI.md'] }, project: { settings: ['.gemini/settings.json'], skills: ['.gemini/skills'], instructions: ['GEMINI.md'] } },
  opencode: { name: 'OpenCode', marker: '.config/opencode', user: { config: '.config/opencode/opencode.json', skills: ['.config/opencode/skills'], instructions: ['.config/opencode/AGENTS.md'], plugins: '.config/opencode/plugins' }, project: { config: 'opencode.json', skills: ['.opencode/skills'], instructions: ['AGENTS.md'], plugins: '.opencode/plugins' } },
});
// How each Agent treats a Skill, from its own documentation or source (docs/m2/UI-AGENT-ADMIN-TABLE-20261105.md). `required`: without
// name and description it is not loaded. `deep`: a SKILL.md below the first level is 'found', 'skipped' or, when not documented, null.
const SKILL_RULES = Object.freeze({ codex: { required: true, deep: 'found', same: '选择时两个都会出现，容易选错' }, claude: { required: false, deep: null, same: '只会用到其中一个' }, gemini: { required: true, deep: 'skipped', same: '只会用到其中一个' }, opencode: { required: true, deep: null, same: 'OpenCode 要求名字在所有位置都不重复' } });
const OPENABLE = /\.(?:md|json|toml|ya?ml|txt)$/i, DEEP = 6;
const STRUCTURE = Object.freeze({
  FIELD_TYPE: ['配置里有字段的类型不对', '对照该 Agent 的文档改正这个字段'], TRANSPORT_CONFLICT: ['同时写了命令和地址，只能有一个', '删掉不用的那个'], TRANSPORT_REQUIRED: ['既没有命令也没有地址，启动不了', '补上 command 或 url'],
  COMMAND_REQUIRED: ['命令是空的', '填上要运行的程序'], URL_TYPE: ['地址不是有效的 http 或 https', '改成完整的地址'], ENTRY_REQUIRED: ['这一项不是有效的配置', '改成对象形式'], HANDLER_VALUE_REQUIRED: ['Hook 缺少要执行的内容', '补上 command 或 prompt'],
  EVENT_HANDLER_UNSUPPORTED: ['这个事件不支持这种 Hook', '换一种类型或换一个事件'], GROUP_REQUIRED: ['Hook 分组的格式不对', '按 hooks 数组的格式改'], GROUP_ARRAY_REQUIRED: ['Hook 分组的格式不对', '按 hooks 数组的格式改'], HANDLER_REQUIRED: ['Hook 的格式不对', '按文档的格式改'],
  SKILL_FIELD_REQUIRED: ['SKILL.md 缺少 name 或 description', '在开头的前言里补上'], DUPLICATE_SKILL_NAME: ['有两个 Skill 同名，只会用到其中一个', '改掉其中一个的名字'], MCP_SETUP_UNAVAILABLE: ['这个事件调用不了 MCP', '换一个事件'], CONDITION_EVENT_UNSUPPORTED: ['这个事件不支持 if 条件', '去掉 if'],
});
const SENSITIVE = /(token|secret|password|passwd|api[_-]?key|apikey|credential|auth|bearer|cookie)/i, DYNAMIC = /\$\{|\$\(|%[A-Za-z_][A-Za-z0-9_]*%|\{env:|\{file:/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = value => String(value).replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160);
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);

function createReader(audit) {
  function stat(file) { try { guard(file); return fs.lstatSync(file); } catch { return null; } }
  /** A whitelisted file as text: null when it is not there, { error } when it cannot be read, and never through a link. */
  function text(file) {
    let before;
    try { before = fs.lstatSync(file); } catch (error) { return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? null : { error: 'READ_FAILED' }; }
    try {
      guard(file);
      if (!before.isFile() || before.nlink > 1) return { error: 'NOT_A_FILE' };
      if (before.size > LIMITS.file) return { error: 'TOO_LARGE' };
      if ((audit.bytes += before.size) > LIMITS.total) return { error: 'TOTAL_LIMIT' };
      return { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(file)).replace(/^\uFEFF/, ''), mtime: before.mtimeMs };
    } catch { return { error: 'READ_FAILED' }; }
  }
  /** Names under a directory, links marked; content is never opened here. */
  function list(directory) {
    try { guard(directory); if (!fs.lstatSync(directory).isDirectory()) return []; return fs.readdirSync(directory, { withFileTypes: true }).slice(0, LIMITS.entries).map(entry => ({ name: entry.name, link: entry.isSymbolicLink(), directory: entry.isDirectory(), file: entry.isFile() })); }
    catch { return []; }
  }
  /** How many files and bytes a directory holds, by name and size only, within a bound. */
  function weigh(directory) {
    let files = 0, bytes = 0, seen = 0, more = false;
    const visit = current => { for (const entry of list(current)) { if (++seen > LIMITS.walk) { more = true; return; } const full = path.join(current, entry.name); if (entry.directory) visit(full); else if (entry.file) { files++; try { bytes += fs.lstatSync(full).size; } catch { /* gone since listed */ } } } };
    visit(directory); return { files, bytes, more };
  }
  return { stat, text, list, weigh };
}
const parseJson = source => syntax.json(source.replace(/^\s*\/\/.*$/gm, ''));
function parsed(reader, file, parse) {
  const read = reader.text(file);
  if (read === null) return { missing: true };
  if (read.error) return { error: read.error };
  try { const value = parse(read.text); return object(value) ? { value, text: read.text, mtime: read.mtime } : { error: 'FORMAT' }; } catch { return { error: 'FORMAT', mtime: read.mtime }; }
}
const size = bytes => bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : bytes >= 1024 ? Math.round(bytes / 1024) + ' KB' : bytes + ' B';
// `remedy`: 'stop' can be stopped with one click and is chosen by default, 'stop-optional' can but is not chosen, 'manual' needs the
// person with the steps in `fix`, 'none' only informs. Level 'note' is a doubt, not a fault: it reads as 没法确认.
const problem = (level, text, fix, remedy = fix ? 'manual' : 'none') => ({ level, text, fix, remedy });
const fileProblem = (agentName, code) => code === 'FORMAT' ? problem('issue', '配置文件解析不了，' + agentName + ' 可能读不到里面的内容', '检查这个文件的语法') : code === 'TOO_LARGE' ? problem('warn', '文件太大，没有检查', '') : problem('warn', '这个文件读取不了，没有检查', '');

function executableOf(command) {
  const value = String(command).trim();
  if (!value || DYNAMIC.test(value)) return null;
  const quoted = /^"([^"]+)"|^'([^']+)'/.exec(value), first = quoted ? quoted[1] || quoted[2] : value.split(/\s+/)[0];
  return first && !/[|&;<>`]/.test(first) ? first : null;
}
/** Whether a program exists where the Agent would look, without running it: 'found', 'missing' or null when it cannot be known. */
function locate(command, env) {
  const name = executableOf(command);
  if (!name) return null;
  const exists = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
  if (path.isAbsolute(name)) return exists(name) ? 'found' : 'missing';
  if (/[\\/]/.test(name)) return null;
  const extensions = process.platform === 'win32' ? ['', ...(env.pathExt || '.COM;.EXE;.BAT;.CMD').split(';').map(item => item.toLowerCase())] : [''];
  for (const folder of String(env.path || '').split(path.delimiter).filter(Boolean)) for (const extension of extensions) if (exists(path.join(folder, name + extension))) return 'found';
  return env.path ? 'missing' : null;
}
const baseName = command => { const name = executableOf(command); return name ? clean(path.basename(name)) : '未知（用了变量或 shell 语法）'; };

/** The checks a server gets whatever its Agent calls the fields. */
function serverHealth(view, env) {
  const problems = [];
  if (view.command) {
    if (locate(view.command, env) === 'missing') problems.push(problem('warn', '在本机的 PATH 里找不到命令 ' + baseName(view.command), '先安装它，或把 command 改成完整路径', 'stop-optional'));
    if (view.args.some(arg => typeof arg === 'string' && /(^|[-_])(token|api[-_]?key|password|secret)=./i.test(arg))) problems.push(problem('warn', '启动参数里好像写了明文密钥', '改成通过环境变量传入'));
  }
  if (view.url) {
    let url = null; try { url = new URL(view.url); } catch { /* structure check reports it */ }
    if (url) {
      if (url.username || url.password || [...url.searchParams.keys()].some(key => SENSITIVE.test(key))) problems.push(problem('warn', '地址里好像带着密钥', '改成通过请求头传入'));
      if (url.protocol === 'http:' && !/^(localhost|127\.|\[?::1\]?)/.test(url.hostname)) problems.push(problem('warn', '远程地址没有加密（http）', '改用 https'));
    }
  }
  for (const [label, map] of [['环境变量', view.env], ['请求头', view.headers]]) for (const [key, value] of Object.entries(map)) {
    if (typeof value !== 'string') continue;
    const reference = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)[^}]*\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%|\{env:([A-Za-z_][A-Za-z0-9_]*)\}/.exec(value);
    if (reference) { const name = reference[1] || reference[2] || reference[3] || reference[4]; if (env.names && !env.names.includes(name) && !/^CLAUDE_/.test(name)) problems.push(problem('warn', '引用的环境变量 ' + clean(name) + ' 在本机没有设置', '设置这个环境变量')); }
    else if (value && SENSITIVE.test(key)) problems.push(problem('warn', label + ' ' + clean(key) + ' 写了明文值', '改成引用系统环境变量，比如 ${' + clean(key) + '}'));
  }
  for (const name of view.envNames) if (env.names && !env.names.includes(name)) problems.push(problem('warn', '需要的环境变量 ' + clean(name) + ' 在本机没有设置', '设置这个环境变量'));
  return problems;
}
function serverDetails(view) {
  return [
    ['连接方式', view.url ? '远程' : view.command ? '本地命令' : '未知'],
    ...view.command ? [['命令', baseName(view.command)], ['参数', view.args.length + ' 个']] : [],
    ...view.url ? [['地址', (() => { try { return new URL(view.url).host; } catch { return DYNAMIC.test(view.url) ? '用了变量' : '无效'; } })()]] : [],
    ...Object.keys(view.env).length ? [['环境变量', Object.keys(view.env).map(clean).join('、')]] : [],
    ...Object.keys(view.headers).length ? [['请求头', Object.keys(view.headers).map(clean).join('、')]] : [],
    ...view.timeout !== null ? [['超时', view.timeout + ' 秒']] : [],
  ];
}
const views = {
  // The field names each Agent's documentation gives.
  common(raw) { return { command: typeof raw.command === 'string' ? raw.command : null, args: Array.isArray(raw.args) ? raw.args : [], env: object(raw.env) ? raw.env : {}, headers: object(raw.headers) ? raw.headers : object(raw.http_headers) ? raw.http_headers : {}, url: typeof raw.url === 'string' ? raw.url : typeof raw.httpUrl === 'string' ? raw.httpUrl : null, envNames: [...Array.isArray(raw.env_vars) ? raw.env_vars.map(entry => typeof entry === 'string' ? entry : entry?.name).filter(Boolean) : [], ...typeof raw.bearer_token_env_var === 'string' ? [raw.bearer_token_env_var] : []], timeout: Number.isFinite(raw.startup_timeout_sec) ? raw.startup_timeout_sec : Number.isFinite(raw.timeout) ? raw.timeout : null }; },
  opencode(raw) { const list = Array.isArray(raw.command) ? raw.command : []; return { command: typeof list[0] === 'string' ? list[0] : null, args: list.slice(1), env: object(raw.environment) ? raw.environment : {}, headers: object(raw.headers) ? raw.headers : {}, url: typeof raw.url === 'string' ? raw.url : null, envNames: [], timeout: Number.isFinite(raw.timeout) ? raw.timeout / 1000 : null }; },
};

function scanInventory({ home, projects = [], env = {} }) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error('INVENTORY_HOME_REQUIRED');
  const audit = { bytes: 0 }, reader = createReader(audit), items = [], notes = [], seen = new Map();
  const add = entry => {
    if (items.length >= LIMITS.items) return;
    const problems = entry.problems || [], health = problems.some(item => item.level === 'issue') ? 'issue' : problems.some(item => item.level === 'warn') ? 'warn' : entry.unchecked || problems.length ? 'unknown' : 'ok';
    items.push({ id: hash([entry.agent, entry.scope, entry.place.root, entry.kind, entry.name, entry.file].join('|')), agent: entry.agent, kind: entry.kind, name: clean(entry.name), scope: entry.scope, project: entry.place.label, file: entry.place.show(entry.file), openable: OPENABLE.test(entry.file), enabled: entry.enabled ?? null, health, problems, details: (entry.details || []).map(([label, value]) => ({ label, value: clean(value) })), updatedAt: Number.isFinite(entry.mtime) ? new Date(entry.mtime).toISOString() : null, actions: entry.actions || [], locator: { root: entry.place.root, scope: entry.scope === 'user' ? 'home' : 'project', file: entry.file, name: entry.key ?? entry.name, directory: entry.directory ?? null } });
  };
  const mtimeOf = file => { try { return fs.lstatSync(file).mtimeMs; } catch { return null; } };
  const overlapping = (agent, kind, name) => { const key = [agent, kind, name].join('|'), count = (seen.get(key) || 0) + 1; seen.set(key, count); return count; };

  function scanMcp(agent, map, source, place, scope, structure, enabledOf, viewOf, writable) {
    if (!object(map)) return;
    for (const [index, [name, raw]] of Object.entries(map).slice(0, 128).entries()) {
      if (!object(raw)) { add({ agent, kind: 'mcp', name, scope, place, file: source, problems: [problem('issue', ...STRUCTURE.ENTRY_REQUIRED)], mtime: mtimeOf(source) }); continue; }
      const view = viewOf(raw), row = structure?.find(check => check.kind === 'mcp' && check.location?.entry === index + 1), problems = [];
      if (row?.state === 'issue') { const [text, fix] = STRUCTURE[row.reason] || ['结构检查没有通过', '']; problems.push(problem('issue', text, fix, 'stop')); }
      problems.push(...serverHealth(view, env));
      const again = overlapping(agent, 'mcp', name);
      add({ agent, kind: 'mcp', name, scope, place, file: source, enabled: enabledOf(name, raw), problems, details: [...serverDetails(view), ...again > 1 ? [['同名', '多个范围都配置了它，以 Agent 的优先级为准']] : []], unchecked: row?.state === 'unchecked', mtime: mtimeOf(source), actions: writable ? ['toggle'] : [] });
    }
  }
  function scanHooks(agent, map, source, place, scope, structure, enabled, writable) {
    if (!object(map)) return;
    let events = 0, total = 0;
    for (const [event, groups] of Object.entries(map)) {
      events++; if (!Array.isArray(groups)) continue;
      for (const [groupIndex, group] of groups.entries()) for (const [handlerIndex, handler] of (Array.isArray(group?.hooks) ? group.hooks : []).entries()) {
        if (++total > 128 || !object(handler)) continue;
        const type = typeof handler.type === 'string' ? handler.type : 'command', row = structure?.find(check => check.kind === 'hooks' && check.location?.event === events && check.location?.group === groupIndex + 1 && check.location?.handler === handlerIndex + 1), problems = [];
        if (row?.state === 'issue') problems.push(problem('issue', ...STRUCTURE[row.reason] || ['结构检查没有通过', '']));
        const command = handler.commandWindows || handler.command_windows || handler.command;
        if (type === 'command' && typeof command === 'string' && locate(command, env) === 'missing') problems.push(problem('warn', '在本机的 PATH 里找不到 ' + baseName(command), '先安装它，或改成完整路径'));
        const name = event + (typeof group.matcher === 'string' && group.matcher ? ' · ' + group.matcher : '') + ' · ' + type;
        add({ agent, kind: 'hook', name: name + (total > 1 && items.some(item => item.agent === agent && item.kind === 'hook' && item.name === clean(name)) ? ' #' + total : ''), scope, place, file: source, enabled, problems, unchecked: row?.state === 'unchecked', mtime: mtimeOf(source), actions: writable ? ['toggle-layer'] : [],
          details: [['事件', clean(event)], ['类型', clean(type)], ...typeof group.matcher === 'string' && group.matcher ? [['匹配', group.matcher]] : [], ...type === 'command' && typeof command === 'string' ? [['命令', baseName(command)]] : [], ...Number.isFinite(handler.timeout) ? [['超时', handler.timeout + ' 秒']] : []] });
      }
    }
  }
  function scanSkills(agent, directories, place, scope, disabledDirectory) {
    const rules = SKILL_RULES[agent], found = [], label = AGENTS[agent].name;
    /** One SKILL.md, wherever the Agent would find it. `direct` when the switch can move it. */
    const readSkill = (full, name, active, direct) => {
      const skillFile = path.join(full, 'SKILL.md'), read = reader.text(skillFile);
      if (read === null) return;
      if (read.error) { add({ agent, kind: 'skill', name, scope, place, file: skillFile, enabled: active, problems: [fileProblem(label, read.error)] }); return; }
      const front = readFront(read.text), fields = front.fields, problems = [], text = key => typeof fields[key] === 'string' ? fields[key].trim() : '';
      if (!front.present) problems.push(rules.required ? problem('issue', 'SKILL.md 开头没有前言（---），' + label + ' 不会加载它', '在开头加上 name 和 description', 'stop') : problem('note', 'SKILL.md 开头没有前言，' + label + ' 用目录名和正文第一行代替', '想控制何时使用，就在开头写上 description'));
      else if (!front.closed) problems.push(problem(rules.required ? 'issue' : 'note', 'SKILL.md 的前言没有用 --- 结束', '在前言末尾补上一行 ---'));
      else {
        if (rules.required && (!text('name') || !text('description'))) problems.push(problem('issue', 'SKILL.md 缺少 ' + ['name', 'description'].filter(key => !text(key)).join(' 和 ') + '，' + label + ' 不会加载它', '在前言里补上', 'stop'));
        else if (!rules.required && !text('description')) problems.push(problem('note', '没有 description，' + label + ' 用正文第一行判断什么时候用它', '在前言里写上 description'));
        if (front.odd) problems.push(problem('note', '前言里有一行看不懂，没法确认 ' + label + ' 怎么读它', '检查前言的写法'));
        if (front.hazard && agent !== 'gemini') problems.push(problem('note', front.hazard === 'colon' ? '前言的值里有没加引号的冒号，严格的 YAML 读取会失败' : '前言的值以特殊符号开头，严格的 YAML 读取会失败', '给这个值加上引号最稳'));
        if (agent === 'opencode' && text('name') && text('name') !== path.basename(full)) problems.push(problem('warn', 'name 和目录名不一样，OpenCode 要求两者相同', '改成一样的名字'));
      }
      const shown = text('name') || name, weight = reader.weigh(full), tools = fields['allowed-tools'], toolCount = Array.isArray(tools) ? tools.length : typeof tools === 'string' ? tools.split(/,\s*|\s+(?![^(]*\))/).filter(Boolean).length : null;
      found.push({ agent, kind: 'skill', name: shown, key: path.basename(full), directory: full, scope, place, file: skillFile, enabled: active, problems, mtime: read.mtime, actions: direct ? ['toggle'] : [],
        details: [...text('description') ? [['描述', text('description')]] : [], ['文件', weight.files + (weight.more ? '+' : '') + ' 个 · ' + size(weight.bytes)], ...toolCount !== null ? [['允许的工具', toolCount + ' 个']] : [], ...text('model') ? [['模型', text('model')]] : [], ...shown !== path.basename(full) ? [['目录名', path.basename(full)]] : []] });
    };
    /** The SKILL.md files below a directory that has none of its own, by name only, within a bound. */
    const below = directory => {
      const hits = []; let seen = 0;
      const visit = (current, depth) => { if (depth > DEEP) return; for (const entry of reader.list(current)) { if (++seen > LIMITS.walk || entry.link || !entry.directory || entry.name.startsWith('.') || entry.name === 'node_modules') continue; const inner = path.join(current, entry.name); if (reader.stat(path.join(inner, 'SKILL.md'))?.isFile()) hits.push(inner); else visit(inner, depth + 1); } };
      visit(directory, 2); return hits;
    };
    const one = (directory, entry, active) => {
      const full = path.join(directory, entry.name);
      if (entry.link) { add({ agent, kind: 'skill', name: entry.name, scope, place, file: full, enabled: active, unchecked: true, details: [['位置', '这是一个链接，没有跟随读取']], mtime: mtimeOf(full) }); return; }
      if (!entry.directory) return;
      if (reader.stat(path.join(full, 'SKILL.md'))) { readSkill(full, entry.name, active, true); return; }
      if (!active || entry.name.startsWith('.')) return;
      const nested = below(full);
      if (!nested.length) { add({ agent, kind: 'skill', name: entry.name, scope, place, file: full, enabled: active, problems: [problem('warn', '目录里没有 SKILL.md，Agent 会跳过它', '不需要就自己删掉这个目录；要用就补上 SKILL.md')], mtime: mtimeOf(full) }); return; }
      if (rules.deep === 'found') { for (const inner of nested) readSkill(inner, path.basename(inner), active, false); return; }
      add({ agent, kind: 'skill', name: entry.name, scope, place, file: full, enabled: active, problems: [rules.deep === 'skipped' ? problem('warn', '里面的 ' + nested.length + ' 个 Skill 放得太深，' + label + ' 只找 skills/名字/SKILL.md，不会读到', '把它们移到 skills 目录的第一层') : problem('note', '里面的 ' + nested.length + ' 个 Skill 放在更深的目录，文档只写了 skills/名字/SKILL.md，没法确认会不会读到', '把它们移到 skills 目录的第一层最稳')], details: [['里面的 Skill', nested.slice(0, 12).map(inner => path.basename(inner)).join('、')]], mtime: mtimeOf(full) });
    };
    for (const relative of directories) { const directory = path.join(place.root, relative); for (const entry of reader.list(directory)) one(directory, entry, true); }
    if (disabledDirectory) for (const entry of reader.list(disabledDirectory)) one(disabledDirectory, entry, false);
    // Same name in one place: stop the one outside the Agent's current directory, or else the older.
    const byName = new Map();
    for (const entry of found) if (entry.enabled) { const list = byName.get(entry.name) ?? []; list.push(entry); byName.set(entry.name, list); }
    for (const list of byName.values()) if (list.length > 1) {
      const rank = entry => (entry.directory.startsWith(path.join(place.root, directories[0]) + path.sep) ? 1e15 : 0) + (entry.mtime ?? 0), keep = [...list].sort((a, b) => rank(b) - rank(a))[0];
      for (const entry of list) entry.problems.push(entry === keep ? problem('warn', '有同名的 Skill（' + place.show(list.find(other => other !== keep).directory) + '），' + rules.same, '') : problem('warn', '和 ' + place.show(keep.directory) + ' 同名，' + rules.same, '停用这一个，或改掉其中一个的名字', 'stop'));
    }
    for (const entry of found) add(entry);
  }
  function scanInstructions(agent, files, place, scope) {
    for (const relative of files) {
      const file = path.join(place.root, relative), stat = reader.stat(file);
      if (!stat?.isFile()) continue;
      const problems = [];
      if (agent === 'codex' && stat.size > 32768) problems.push(problem('warn', '超过 32 KB，Codex 默认只读前面的部分', '拆短，或调大 project_doc_max_bytes'));
      else if (stat.size > 40960) problems.push(problem('warn', '文件很长，每次都会占用不少上下文', '把不常用的内容拆出去'));
      if (!stat.size) problems.push(problem('warn', '文件是空的', ''));
      add({ agent, kind: 'instruction', name: path.basename(relative) + (scope === 'project' ? ' · ' + place.label : ''), scope, place, file, problems, mtime: stat.mtimeMs, enabled: null, details: [['大小', size(stat.size)]], actions: stat.size <= LIMITS.file ? ['read', 'edit'] : [] });
    }
  }
  function manifest(file) { const result = parsed(reader, file, source => JSON.parse(source)); return result; }
  function pluginContents(directory) {
    const count = name => reader.list(path.join(directory, name)).filter(entry => entry.directory || entry.file).length, rows = [];
    const skills = reader.list(path.join(directory, 'skills')).filter(entry => entry.directory).map(entry => entry.name);
    if (skills.length) rows.push(['Skills', skills.length + ' 个：' + skills.slice(0, 12).join('、')]);
    for (const [name, label] of [['commands', '命令'], ['agents', '子 Agent']]) { const value = count(name); if (value) rows.push([label, value + ' 个']); }
    if (reader.stat(path.join(directory, 'hooks', 'hooks.json'))?.isFile()) rows.push(['Hooks', '有']);
    const mcp = manifest(path.join(directory, '.mcp.json')); if (mcp.value) { const map = object(mcp.value.mcpServers) ? mcp.value.mcpServers : mcp.value; rows.push(['MCP', Object.keys(map).slice(0, 12).map(clean).join('、') || '无']); }
    return rows;
  }
  function pluginDetails(meta, directory) {
    return [...typeof meta.description === 'string' ? [['描述', meta.description]] : [], ...typeof meta.version === 'string' ? [['版本', meta.version]] : [], ...typeof meta.author?.name === 'string' ? [['作者', meta.author.name]] : [], ...pluginContents(directory)];
  }

  function scanAgent(agent, spec, place, scope) {
    const name = spec.name, fixed = scope === 'user' ? spec.user : spec.project, at = relative => path.join(place.root, relative);
    const fail = (file, code) => add({ agent, kind: 'file', name: path.basename(file), scope, place, file, problems: [fileProblem(name, code)], mtime: mtimeOf(file) });
    if (agent === 'codex') {
      const file = at(fixed.config), config = parsed(reader, file, syntax.toml), rows = config.value ? project('codex', 'codex-config', config.text) : null;
      if (config.error) fail(file, config.error);
      const hooksSwitch = config.value?.features?.hooks ?? config.value?.features?.codex_hooks, hooksOn = typeof hooksSwitch === 'boolean' ? hooksSwitch : null;
      if (config.value) { scanMcp(agent, config.value.mcp_servers, file, place, scope, rows, (_, raw) => raw.enabled !== false, views.common, true); scanHooks(agent, config.value.hooks, file, place, scope, rows, hooksOn, false); }
      const hooksFile = at(fixed.hooks), hooks = parsed(reader, hooksFile, syntax.json);
      if (hooks.error) fail(hooksFile, hooks.error);
      if (hooks.value) scanHooks(agent, hooks.value.hooks, hooksFile, place, scope, project('codex', 'codex-hooks', hooks.text), hooksOn, true);
      scanSkills(agent, fixed.skills, place, scope, path.join(place.root, '.agent-usage/disabled-skills/codex'));
      if (scope === 'user') scanCodexPlugins(place, config.value?.plugins);
    } else if (agent === 'claude') {
      let local = null;
      for (const relative of fixed.settings) {
        const file = at(relative), settings = parsed(reader, file, syntax.json), kind = relative.endsWith('.local.json') ? 'claude-settings-local' : 'claude-settings';
        if (settings.error) fail(file, settings.error);
        if (!settings.value) continue;
        if (kind === 'claude-settings-local') local = settings.value;
        scanHooks(agent, settings.value.hooks, file, place, scope, project('claude', kind, settings.text), typeof settings.value.disableAllHooks === 'boolean' ? !settings.value.disableAllHooks : null, scope === 'user' || kind === 'claude-settings-local');
        if (scope === 'user') scanClaudePlugins(place, settings.value.enabledPlugins);
      }
      if (scope === 'project') {
        const file = at(fixed.mcp), mcp = parsed(reader, file, syntax.json), disabled = Array.isArray(local?.disabledMcpjsonServers) ? local.disabledMcpjsonServers : [];
        if (mcp.error) fail(file, mcp.error);
        if (mcp.value) scanMcp(agent, mcp.value.mcpServers, file, place, scope, project('claude', 'claude-mcp', mcp.text), serverName => !disabled.includes(serverName), views.common, true);
      }
      scanSkills(agent, fixed.skills, place, scope, path.join(place.root, '.agent-usage/disabled-skills/claude'));
    } else if (agent === 'gemini') {
      const file = at(fixed.settings[0]), settings = parsed(reader, file, parseJson);
      if (settings.error) fail(file, settings.error);
      if (settings.value) { scanMcp(agent, settings.value.mcpServers, file, place, scope, null, () => null, views.common, false); scanHooks(agent, settings.value.hooks, file, place, scope, null, null, false); }
      scanSkills(agent, fixed.skills, place, scope, path.join(place.root, '.agent-usage/disabled-skills', agent));
      if (scope === 'user') scanGeminiExtensions(place);
    } else {
      const file = at(fixed.config), config = parsed(reader, file, parseJson);
      if (config.error) fail(file, config.error);
      if (config.value) {
        scanMcp(agent, config.value.mcp, file, place, scope, null, (_, raw) => raw.enabled !== false, views.opencode, false);
        for (const name of Array.isArray(config.value.plugin) ? config.value.plugin.slice(0, 64) : []) if (typeof name === 'string') add({ agent, kind: 'plugin', name, scope, place, file, enabled: true, mtime: mtimeOf(file), details: [['来源', '配置里写的 npm 包']] });
      }
      for (const entry of reader.list(at(fixed.plugins))) if (entry.file) add({ agent, kind: 'plugin', name: entry.name, scope, place, file: path.join(at(fixed.plugins), entry.name), enabled: true, mtime: mtimeOf(path.join(at(fixed.plugins), entry.name)), details: [['来源', '本地插件文件']] });
      scanSkills(agent, fixed.skills, place, scope, path.join(place.root, '.agent-usage/disabled-skills', agent));
    }
    scanInstructions(agent, fixed.instructions, place, scope);
  }
  function scanClaudePlugins(place, enabledPlugins) {
    const root = path.join(place.root, '.claude/plugins'), file = path.join(root, 'installed_plugins.json'), installed = parsed(reader, file, source => JSON.parse(source)), on = object(enabledPlugins) ? enabledPlugins : {};
    if (installed.error) { add({ agent: 'claude', kind: 'file', name: 'installed_plugins.json', scope: 'user', place, file, problems: [fileProblem('Claude Code', installed.error)] }); return; }
    const records = object(installed.value?.plugins) ? installed.value.plugins : {};
    for (const [id, list] of Object.entries(records).slice(0, 128)) {
      const record = (Array.isArray(list) ? list : [list]).find(object);
      if (!record) continue;
      const directory = typeof record.installPath === 'string' ? path.resolve(record.installPath) : null, inside = directory && directory.startsWith(path.resolve(root) + path.sep), problems = [];
      const present = inside && reader.stat(directory)?.isDirectory();
      if (directory && !inside) problems.push(problem('warn', '插件放在插件目录之外，没有读取它的内容', ''));
      else if (!present) problems.push(problem('issue', '插件文件不见了，这个插件用不了', '在 Claude Code 里运行 /plugin 重新安装；不想要就停用', 'stop'));
      const meta = present ? manifest(path.join(directory, '.claude-plugin/plugin.json')) : {};
      if (meta.error) problems.push(problem('issue', 'plugin.json 解析不了，插件可能加载失败', '更新或重新安装这个插件', 'stop-optional'));
      const defaults = meta.value?.defaultEnabled !== false;
      add({ agent: 'claude', kind: 'plugin', name: id, scope: 'user', place, file, enabled: typeof on[id] === 'boolean' ? on[id] : defaults, problems, mtime: Date.parse(record.lastUpdated || record.installedAt || '') || null, actions: ['toggle-plugin'],
        details: [...meta.value ? pluginDetails(meta.value, directory) : [], ...typeof record.version === 'string' && !meta.value?.version ? [['版本', record.version]] : [], ['范围', clean(record.scope || 'user')]] });
    }
  }
  function scanCodexPlugins(place, settings) {
    const cache = path.join(place.root, '.codex/plugins/cache'), on = object(settings) ? settings : {};
    for (const market of reader.list(cache)) if (market.directory) for (const plugin of reader.list(path.join(cache, market.name))) if (plugin.directory) {
      const versions = reader.list(path.join(cache, market.name, plugin.name)).filter(entry => entry.directory).map(entry => ({ name: entry.name, at: mtimeOf(path.join(cache, market.name, plugin.name, entry.name)) ?? 0 })).sort((a, b) => b.at - a.at);
      if (!versions.length) continue;
      const directory = path.join(cache, market.name, plugin.name, versions[0].name), id = plugin.name + '@' + market.name, meta = [manifest(path.join(directory, 'plugin.json')), manifest(path.join(directory, '.codex-plugin/plugin.json'))].find(result => result.value || result.error) || {}, problems = [];
      if (meta.error) problems.push(problem('issue', 'plugin.json 解析不了，插件可能加载失败', '更新或重新安装这个插件', 'stop-optional'));
      add({ agent: 'codex', kind: 'plugin', name: id, scope: 'user', place, file: directory, enabled: typeof on[id]?.enabled === 'boolean' ? on[id].enabled : null, problems, mtime: versions[0].at, actions: ['toggle-plugin'], details: [...meta.value ? pluginDetails(meta.value, directory) : [], ...!meta.value?.version ? [['版本', versions[0].name]] : [], ...versions.length > 1 ? [['旧版本', versions.length - 1 + ' 个还在缓存里']] : []] });
    }
  }
  function scanGeminiExtensions(place) {
    const root = path.join(place.root, '.gemini/extensions');
    for (const entry of reader.list(root)) {
      const directory = path.join(root, entry.name);
      if (entry.link) { add({ agent: 'gemini', kind: 'plugin', name: entry.name, scope: 'user', place, file: directory, unchecked: true, details: [['位置', '这是一个链接，没有跟随读取']] }); continue; }
      if (!entry.directory) continue;
      const meta = manifest(path.join(directory, 'gemini-extension.json')), problems = [];
      if (meta.missing) problems.push(problem('issue', '没有 gemini-extension.json，不会被当作扩展', '重新安装这个扩展'));
      if (meta.error) problems.push(problem('issue', 'gemini-extension.json 解析不了', '更新或重新安装这个扩展'));
      add({ agent: 'gemini', kind: 'plugin', name: typeof meta.value?.name === 'string' ? meta.value.name : entry.name, scope: 'user', place, file: directory, problems, mtime: mtimeOf(directory), details: [...meta.value ? [...typeof meta.value.version === 'string' ? [['版本', meta.value.version]] : [], ...object(meta.value.mcpServers) ? [['MCP', Object.keys(meta.value.mcpServers).slice(0, 12).map(clean).join('、')]] : [], ...Array.isArray(meta.value.excludeTools) ? [['隐藏的工具', meta.value.excludeTools.length + ' 个']] : []] : [], ...pluginContents(directory)] });
    }
  }

  const homeBase = path.resolve(home), places = [{ root: homeBase, scope: 'user', label: null, show: file => '~/' + path.relative(homeBase, file).replaceAll('\\', '/') }, ...projects.map(root => { const resolved = path.resolve(root), label = clean(path.basename(resolved)); return { root: resolved, scope: 'project', label, show: file => label + '/' + path.relative(resolved, file).replaceAll('\\', '/') }; })];
  const agents = Object.entries(AGENTS).map(([id, spec]) => {
    const found = Boolean(reader.stat(path.join(homeBase, spec.marker))?.isDirectory());
    for (const place of places) { if (place.scope === 'user' && !found) continue; try { scanAgent(id, spec, place, place.scope); } catch { add({ agent: id, kind: 'file', name: spec.name, scope: place.scope, place, file: place.root, problems: [problem('warn', '这一部分没有检查完', '')] }); } }
    return { id, name: spec.name, found: found || items.some(item => item.agent === id), writable: id === 'codex' || id === 'claude' };
  });
  if (agents.find(agent => agent.id === 'claude')?.found) notes.push({ agent: 'claude', text: '用户级 MCP 写在 ~/.claude.json，这个文件混有账号信息，没有读取。' });
  return { schemaVersion: 'AgentInventoryV1', agents, items, notes, truncated: items.length >= LIMITS.items, bytesRead: audit.bytes };
}
module.exports = { scanInventory, AGENTS, LIMITS, SKILL_RULES, OPENABLE, locate };
