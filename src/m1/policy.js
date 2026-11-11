'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {sources: SOURCES, labels: LABELS} = require('./agent-catalog');
// The process environment applies only to the real home: an explicit home (a test
// fixture) never picks up CODEX_HOME or CLAUDE_CONFIG_DIR from the machine.
function roots(home, env) {
  if (home === undefined) { home = os.homedir(); env ??= process.env; }
  env ??= {};
  // An Agent that honours a home override writes there; the default location is kept
  // too, because history written before the override stays where it was.
  const homes = (variable, fallback) => {
    const result = [path.join(home, fallback)];
    try { if (env[variable]) result.push(localPath(env[variable])); } catch { /* Not a local absolute path. */ }
    return [...new Set(result)];
  };
  return {
    codex: homes('CODEX_HOME', '.codex').flatMap(dir => [path.join(dir, 'sessions'), path.join(dir, 'archived_sessions')]),
    claude: homes('CLAUDE_CONFIG_DIR', '.claude').flatMap(dir => [path.join(dir, 'projects'), path.join(dir, 'transcripts')]),
    opencode: [path.join(home, '.local/share/opencode')],
    workbuddy: [path.join(home, '.workbuddy/projects'), path.join(home, '.workbuddy/workbuddy.db'), path.join(home, '.workbuddy-ai/projects'), path.join(home, '.workbuddy-ai/workbuddy.db')],
    mimo: [path.join(home, '.local/share/mimocode')],
    gemini: [path.join(home, '.gemini/tmp')],
    cursor: [path.join(home,'.cursor/projects')], // Only SDK index.db/runs.ndjson/usage CSV are read.
    zcode: [path.join(home, '.zcode/cli/db/db.sqlite')],
    deepseek: [path.join(home, '.dsh/sessions'), path.join(home, '.dsh/profiles/desktop/sessions')],
    // The 2.0 app, the CLI and the legacy IDE keep the same layout under their own directory.
    antigravity: ['antigravity', 'antigravity-cli', 'antigravity-ide'].map(product => path.join(home, '.gemini', product, 'brain')),
    copilot: homes('COPILOT_HOME', '.copilot').map(dir => path.join(dir, 'session-state')),
    cline: [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev', 'tasks'), path.join(home, '.cline', 'data', 'sessions')],
    pi: [path.join(home, '.pi', 'agent', 'sessions')],
    continue: [path.join(home, '.continue', 'dev_data', 'devdata.sqlite')],
    kilo: [path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'globalStorage', 'kilocode.kilo-code', 'tasks'), path.join(home, '.local', 'share', 'kilo', 'kilo.db')],
    qwen: [path.join(home, '.qwen', 'projects')],
    kimi: [path.join(home, '.kimi', 'sessions'),path.join(home, '.kimi-code', 'sessions')]
  };
}
function localPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^[/\\]{2}/.test(value) || value.includes('\0') || /(^|[/\\])(?:auth|credentials|config|settings|storage)\.(?:json|toml)$/i.test(value)) throw new Error('SOURCE_PATH_REJECTED');
  return path.resolve(value);
}
function allowedFile(agent, file) {
  const base = path.basename(file);
  if (/^(?:auth|credentials|config|settings|storage|tokens?)(?:[._-]|$)/i.test(base)) return false;
  if (/^custom-[a-f0-9-]{36}$/.test(agent)) return /\.(?:jsonl|ndjson)$/i.test(base);
  // Conversation files the usage scan never opens; only the reading view lists these (transcript-more.js).
  if (agent === 'transcript:cline' || agent === 'transcript:kilo') return base === 'api_conversation_history.json' && path.basename(path.dirname(path.dirname(file))) === 'tasks' || agent === 'transcript:cline' && base.endsWith('.messages.json') && base === path.basename(path.dirname(file)) + '.messages.json';
  if (agent === 'transcript:cursor') return /^[A-Za-z0-9_-]{1,128}\.jsonl$/.test(base) && file.split(path.sep).includes('agent-transcripts') && path.basename(path.dirname(file)) !== 'subagents';
  if (agent === 'transcript:cursor-sub') return /^[A-Za-z0-9_-]{1,128}\.jsonl$/.test(base) && path.basename(path.dirname(file)) === 'subagents' && file.split(path.sep).includes('agent-transcripts');
  if (agent === 'transcript:legacy') return /^[\w.-]{1,128}\.json$/.test(base);
  if (agent === 'transcript:continue-index') return base === 'sessions.json';
  if (agent === 'transcript:continue') return base !== 'sessions.json' && /^[A-Za-z0-9_-]{1,128}\.json$/.test(base);
  if (agent === 'pi') return base.endsWith('.jsonl');
  if (agent === 'continue') return base === 'devdata.sqlite';
  if (agent === 'kilo') return base === 'kilo.db' || base === 'ui_messages.json' && path.basename(path.dirname(path.dirname(file))) === 'tasks';
  if (agent === 'qwen') return base.endsWith('.jsonl') && path.basename(path.dirname(file)) === 'chats';
  if (agent === 'kimi') return base === 'wire.jsonl';
  if (agent === 'cline') return base === 'ui_messages.json' && path.basename(path.dirname(path.dirname(file))) === 'tasks' || base.endsWith('.messages.json') && base === path.basename(path.dirname(file)) + '.messages.json';
  if (agent === 'copilot') return base === 'events.jsonl' && path.basename(path.dirname(path.dirname(file))) === 'session-state' || base.endsWith('.jsonl') && file.split(path.sep).includes('otel');
  if (agent === 'codex' || agent === 'claude') return base.endsWith('.jsonl');
  if (agent === 'workbuddy') return base.endsWith('.jsonl') || base === 'workbuddy.db';
  if (agent === 'mimo') return /^mimocode(?:[-\w]*)\.db$/.test(base);
  if (agent === 'gemini') return /^(?:session-[\w.-]+|[a-f0-9-]{8,})\.(?:json|jsonl)$/.test(base) && file.split(path.sep).includes('chats');
  if (agent === 'cursor') return base === 'index.db' || base.toLowerCase() === 'runs.ndjson' || /\.csv$/i.test(base);
  if (agent === 'zcode') return base === 'db.sqlite';
  if (agent === 'deepseek') return /^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(base);
  // Only a conversation's own transcript (see antigravity.js); never chunks, steps or messages.
  if (agent === 'antigravity') { const parts = file.split(path.sep); return ['transcript_full.jsonl', 'transcript.jsonl'].includes(base) && parts.at(-2) === 'logs' && parts.at(-3) === '.system_generated' && parts.at(-5) === 'brain'; }
  if (agent === 'opencode') return (base.endsWith('.json') && file.split(path.sep).includes('message')) || /^opencode(?:[-\w]*)\.db$/.test(base);
  return false;
}
const LIMITS = { depth: 16, files: 100000 };
const SKIPPED_DIRECTORIES = ['node_modules', '.git', 'auth', 'credentials', 'cache'];
// Lists the allowed files under one root. The returned array carries `limited` when
// the walk stopped at a limit, `aliased` when a file resolved outside its place and
// `unreadable` when a subdirectory could not be listed; each keeps the files already
// listed, so one oversized or locked subtree does not hide the rest of the root.
function filesUnder(agent, root, _audit, { descend } = {}) {
  root = localPath(root);
  const output = [];
  let stat;
  try { stat = fs.lstatSync(root); } catch (error) { if (error.code === 'ENOENT') return output; throw new Error('SOURCE_UNREADABLE', { cause: error }); }
  if (stat.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_REJECTED');
  // A parent of the root may be a link (an Agent home moved to another drive); nothing
  // at or below the root may be. Each directory must resolve to its own place under the
  // root's real path, and every file in it is then accepted from that one check: a
  // directory is resolved once instead of once per file, which is the same guarantee
  // because a file's own name cannot move it elsewhere, and a file that is itself a
  // link was already skipped by the walk.
  const real = fs.realpathSync(root), fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
  const accept = file => { output.push(file); };
  const walk = (directory, depth) => {
    if (depth > LIMITS.depth) { output.limited = true; return; }
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) { if (!depth) throw new Error('SOURCE_UNREADABLE', { cause: error }); output.unreadable = true; return; }
    // One resolution per directory, compared with where that directory should be under the
    // root's real path: every file directly inside it then resolves there too, because the
    // walk skips links and a regular file cannot resolve anywhere else. A directory that
    // resolves elsewhere marks the root aliased and its files are not read.
    let here = null;
    try { here = fold(fs.realpathSync(directory)); } catch { /* an unresolved directory is not accepted */ }
    const placed = here !== null && here === fold(path.join(real, path.relative(root, directory)));
    for (const entry of entries) {
      if (output.length >= LIMITS.files) { output.limited = true; return; }
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { if (!SKIPPED_DIRECTORIES.includes(entry.name) && (!descend || descend(directory, entry.name))) walk(full, depth + 1); }
      else if (entry.isFile() && allowedFile(agent, full)) { if (placed) accept(full); else output.aliased = true; }
    }
  };
  if (stat.isDirectory()) walk(root, 0);
  else if (stat.isFile() && allowedFile(agent, root)) accept(root);
  return output;
}
function readBytes(file, audit) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024 * 1024) throw new Error('SOURCE_SIZE_OR_LINK');
  const fd = fs.openSync(file, fs.constants.O_RDONLY);
  try {
    audit.reads++;
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    if (stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error('SOURCE_BUSY');
    return bytes;
  } finally { fs.closeSync(fd); }
}
// Gemini CLI writes the project's working directory to .project_root beside the
// chats directory. Only this one small file is read, and any failure means unknown.
function projectRoot(file, audit) {
  const parts = file.split(path.sep), at = parts.lastIndexOf('chats');
  if (at < 1) return null;
  const target = parts.slice(0, at).concat('.project_root').join(path.sep);
  try {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) return null;
    return readBytes(target, audit).toString('utf8').trim();
  } catch { return null; }
}
// Codex writes thread names to session_index.jsonl in its home, beside the sessions
// and archived_sessions folders. Only that file is read, only each line's id and
// thread_name are kept, and any failure means no titles.
function threadIndexes(roots) {
  const files = new Set();
  for (const root of roots) if (typeof root === 'string' && ['sessions', 'archived_sessions'].includes(path.basename(root))) files.add(path.join(path.dirname(root), 'session_index.jsonl'));
  return [...files];
}
function threadNames(roots, audit) {
  const names = new Map();
  for (const target of threadIndexes(roots)) {
    try {
      const stat = fs.lstatSync(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) continue;
      for (const line of readBytes(target, audit).toString('utf8').split('\n')) {
        let row; try { row = JSON.parse(line); } catch { continue; }
        if (row && typeof row.id === 'string' && typeof row.thread_name === 'string' && row.thread_name.trim()) names.set(row.id, row.thread_name);
      }
    } catch { continue; }
  }
  return names;
}
function disableNetwork(audit) {
  const denied = () => { audit.networkAttempts++; throw new Error('NETWORK_DISABLED_M1'); };
  globalThis.fetch = denied;
  for (const name of ['node:http', 'node:https']) {
    const mod = require(name); mod.request = denied; mod.get = denied;
  }
  const net = require('node:net'); net.connect = denied; net.createConnection = denied;
  const tls = require('node:tls'); tls.connect = denied;
}
module.exports = { SOURCES, LABELS, LIMITS, roots, localPath, allowedFile, filesUnder, readBytes, projectRoot, threadIndexes, threadNames, disableNetwork };
