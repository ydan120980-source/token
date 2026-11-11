'use strict';
// Session metadata: the raw session ID and working directory, kept locally for the
// session list and its resume command. Never part of UsageSnapshotV1, its export or
// the query interface (docs/m2/SESSIONS-LAYER1-20261012.md).
const path = require('node:path');
const { sessionKey } = require('./normalize');
// Sources whose resume command has a recorded basis (SESSIONS-LAYER1-20261012.md,
// SESSIONS-NEXT-20261101.md); the others offer no command.
const RESUME = {
  codex: id => 'codex resume ' + id,
  claude: id => 'claude --resume ' + id,
  opencode: id => 'opencode -s ' + id,
  gemini: id => 'gemini --resume ' + id,
  // Official MiMo Code CLI options: --session/-s "Session ID to continue".
  mimo: id => 'mimo -s ' + id,
  // Antigravity CLI, per cc-switch's agy_config.rs (MIT): default profile only.
  antigravity: id => 'agy --conversation=' + id
};
const ID = /^[A-Za-z0-9_-]{1,128}$/;
function rawId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\0-\x1f\x7f]/.test(value) ? value : null; }
function directory(value) {
  if (typeof value !== 'string' || value.length > 1024 || /[\0-\x1f\x7f]/.test(value)) return null;
  const trimmed = value.trim();
  return path.win32.isAbsolute(trimmed) && !/^[/\\]{2}/.test(trimmed) || path.posix.isAbsolute(trimmed) && !trimmed.startsWith('//') ? trimmed : null;
}
// A session title the Agent itself stores as a title (a rename, a thread name, a
// title column); never text derived from a message. One line, at most 120 characters.
function title(value) {
  if (typeof value !== 'string') return null;
  const line = value.replace(/[\0-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return line ? [...line].slice(0, 120).join('') : null;
}
// One observation of a session in one file. Returns null without a usable raw ID.
function observe(agent, session, cwd, salt, name = null) {
  const id = rawId(session), key = id && sessionKey(agent, id, salt);
  return key ? { key, id, cwd: directory(cwd), title: title(name) } : null;
}
// Files that mention the same session (copies, archives) merge; a later file can
// fill a directory the first one lacked but never replaces one it reported. A later
// title replaces an earlier one: a rename is appended after the title it replaces.
function merge(map, entries) {
  for (const entry of entries || []) {
    const old = map.get(entry.key);
    map.set(entry.key, old ? { key: entry.key, id: old.id, cwd: old.cwd ?? entry.cwd, title: entry.title ?? old.title ?? null } : { key: entry.key, id: entry.id, cwd: entry.cwd, title: entry.title ?? null });
  }
  return map;
}
function projectName(cwd) {
  if (!cwd) return null;
  const parts = cwd.split(/[/\\]+/).filter(Boolean);
  return parts.at(-1) || cwd;
}
// A PowerShell command the user pastes. The directory is a single-quoted literal,
// so $(), backticks and semicolons inside it stay text. PowerShell also closes a
// single-quoted string on the typographic quotes U+2018..U+201B; every one of
// them is doubled like the ASCII quote. The ID must match a strict pattern or
// there is no command at all.
function resumeCommand(agent, session) {
  const build = RESUME[agent];
  if (!build || !session || !ID.test(session.id || '')) return null;
  const command = build(session.id);
  return session.cwd ? "Set-Location -LiteralPath '" + session.cwd.replace(/['‘-‛]/g, '$&$&') + "'; " + command : command;
}
module.exports = { observe, merge, projectName, resumeCommand, directory, title };
