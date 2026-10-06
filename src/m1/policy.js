'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {sources: SOURCES, labels: LABELS} = require('../../design/desktop-reference/agent-catalog');
function roots(home = os.homedir()) {
  return {
    codex: [path.join(home, '.codex/sessions'), path.join(home, '.codex/archived_sessions')],
    claude: [path.join(home, '.claude/projects'), path.join(home, '.claude/transcripts')],
    opencode: [path.join(home, '.local/share/opencode')],
    workbuddy: [path.join(home, '.workbuddy/projects'), path.join(home, '.workbuddy/workbuddy.db'), path.join(home, '.workbuddy-ai/projects'), path.join(home, '.workbuddy-ai/workbuddy.db')],
    mimo: [path.join(home, '.local/share/mimocode')],
    gemini: [path.join(home, '.gemini/tmp')],
    cursor: [path.join(home,'.cursor/projects')], // Only SDK index.db/runs.ndjson/usage CSV are read.
    zcode: [path.join(home, '.zcode/cli/db/db.sqlite')],
    deepseek: [path.join(home, '.dsh/sessions'), path.join(home, '.dsh/profiles/desktop/sessions')]
  };
}
function localPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /^[/\\]{2}/.test(value) || value.includes('\0') || /(^|[/\\])(?:auth|credentials|config|settings|storage)\.(?:json|toml)$/i.test(value)) throw new Error('SOURCE_PATH_REJECTED');
  return path.resolve(value);
}
function allowedFile(agent, file) {
  const base = path.basename(file);
  if (/^(?:auth|credentials|config|settings|storage|tokens?)(?:[._-]|$)/i.test(base)) return false;
  if (agent === 'codex' || agent === 'claude') return base.endsWith('.jsonl');
  if (agent === 'workbuddy') return base.endsWith('.jsonl') || base === 'workbuddy.db';
  if (agent === 'mimo') return /^mimocode(?:[-\w]*)\.db$/.test(base);
  if (agent === 'gemini') return /^(?:session-[\w.-]+|[a-f0-9-]{8,})\.(?:json|jsonl)$/.test(base) && file.split(path.sep).includes('chats');
  if (agent === 'cursor') return base === 'index.db' || base.toLowerCase() === 'runs.ndjson' || /\.csv$/i.test(base);
  if (agent === 'zcode') return base === 'db.sqlite';
  if (agent === 'deepseek') return /^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/.test(base);
  if (agent === 'opencode') return (base.endsWith('.json') && file.split(path.sep).includes('message')) || /^opencode(?:[-\w]*)\.db$/.test(base);
  return false;
}
function filesUnder(agent, root, audit, output = [], depth = 0) {
  if (depth > 16 || output.length > 100000) throw new Error('SOURCE_LIMIT');
  root = localPath(root);
  let stat;
  try { stat = fs.lstatSync(root); } catch (error) { if (error.code === 'ENOENT') return output; throw new Error('SOURCE_UNREADABLE', { cause: error }); }
  if (stat.isSymbolicLink()) throw new Error('SOURCE_SYMLINK_REJECTED');
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !['node_modules', '.git', 'auth', 'credentials', 'cache'].includes(entry.name)) filesUnder(agent, path.join(root, entry.name), audit, output, depth + 1);
      else if (entry.isFile() && allowedFile(agent, path.join(root, entry.name))) filesUnder(agent, path.join(root, entry.name), audit, output, depth + 1);
    }
  } else if (stat.isFile() && allowedFile(agent, root)) {
    if (fs.realpathSync(root) !== root) throw new Error('SOURCE_ALIAS_REJECTED');
    output.push(root);
  }
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
function disableNetwork(audit) {
  const denied = () => { audit.networkAttempts++; throw new Error('NETWORK_DISABLED_M1'); };
  globalThis.fetch = denied;
  for (const name of ['node:http', 'node:https']) {
    const mod = require(name); mod.request = denied; mod.get = denied;
  }
  const net = require('node:net'); net.connect = denied; net.createConnection = denied;
  const tls = require('node:tls'); tls.connect = denied;
}
module.exports = { SOURCES, LABELS, roots, localPath, allowedFile, filesUnder, readBytes, disableNetwork };
