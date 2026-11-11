'use strict';
// What a tool call changed, for the reading view's change view (docs/m2/UI-READER-PARSING-20261102.md). Only the
// Agent's own edit tools count; a file changed through a shell command is not seen. Fields per the public sources:
// Claude Code Edit/Write and DeepSeek Harness edit/write (file_path, old_string, new_string, content), Gemini CLI
// replace/write_file (same fields), OpenCode edit/write (path or filePath, oldString, newString, content), DeepSeek
// str_replace_editor (path, old_str, new_str), and the Codex patch format, also used by OpenCode and DeepSeek.
// A diff is lines prefixed "+", "-" or " ", "@@" for a hunk, and "*** " + path before each file.

const PATCH = '*** Begin Patch', LCS_CELLS = 40000, CONTEXT = 3;
const lines = text => { const list = text.split(/\r?\n/); if (list.at(-1) === '') list.pop(); return list; };
const parse = text => { try { return JSON.parse(text); } catch { return null; } };

// Lines that differ between two texts. Common ends are trimmed and kept as a little context; the middle is compared
// line by line while that stays cheap, and reads as removed then added past that.
function diffLines(before, after) {
  const a = lines(before), b = lines(after);
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const out = a.slice(Math.max(0, start - CONTEXT), start).map(line => ' ' + line), n = endA - start, m = endB - start;
  if (n && m && n * m <= LCS_CELLS) {
    const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = a[start + i] === b[start + j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) { out.push(' ' + a[start + i]); i++; j++; }
      else if (i < n && (j === m || table[i + 1][j] >= table[i][j + 1])) out.push('-' + a[start + i++]);
      else out.push('+' + b[start + j++]);
    }
  } else {
    for (let i = start; i < endA; i++) out.push('-' + a[i]);
    for (let j = start; j < endB; j++) out.push('+' + b[j]);
  }
  out.push(...a.slice(endA, endA + CONTEXT).map(line => ' ' + line));
  return out;
}
const count = (list, mark) => list.reduce((sum, line) => sum + (line[0] === mark ? 1 : 0), 0);
const file = (path, kind, list, extra) => ({ entry: { path, kind, added: count(list, '+'), removed: count(list, '-'), ...extra }, list });
function assemble(sections) {
  const out = [];
  for (const { entry, list } of sections) out.push('*** ' + entry.path, ...list);
  return { files: sections.map(section => section.entry), diff: out.join('\n') };
}
// The Codex patch format: *** Add File, *** Delete File, *** Update File with an optional *** Move to.
function fromPatch(text) {
  const begin = text.indexOf(PATCH); if (begin < 0) return null;
  const sections = []; let current = null;
  for (const line of text.slice(begin + PATCH.length).split(/\r?\n/)) {
    if (line.startsWith('*** End Patch')) break;
    const head = /^\*\*\* (Add|Delete|Update) File: (.+)$/.exec(line);
    if (head) { current = { path: head[2].trim(), kind: head[1] === 'Add' ? 'add' : head[1] === 'Delete' ? 'delete' : 'edit', list: [] }; sections.push(current); continue; }
    if (!current) continue;
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move) { current.to = move[1].trim(); continue; }
    if (line.startsWith('*** ')) continue;
    if (line.startsWith('@@') || /^[+\- ]/.test(line)) current.list.push(line);
  }
  return sections.length ? assemble(sections.map(section => file(section.path, section.kind, section.list, section.to ? { to: section.to } : {}))) : null;
}
const text = value => typeof value === 'string' ? value : null;
const pathOf = value => [value.file_path, value.filePath, value.path].find(item => typeof item === 'string' && item.trim()) ?? null;

function change(name, input) {
  const tool = String(name ?? '').toLowerCase(), value = typeof input === 'string' ? parse(input) ?? input : input;
  if (typeof value === 'string') return value.includes(PATCH) ? fromPatch(value) : null;
  if (!value || typeof value !== 'object') return null;
  const command = Array.isArray(value.command) ? value.command.join('\n') : value.command ?? value.cmd;
  for (const candidate of [value.input, value.patch, value.patchText, value.patch_text, command]) {
    if (typeof candidate === 'string' && candidate.includes(PATCH)) return fromPatch(candidate);
  }
  const path = pathOf(value); if (!path) return null;
  if (tool === 'edit' || tool === 'replace') {
    if (Array.isArray(value.edits)) {
      const list = value.edits.flatMap(edit => text(edit?.old_string ?? edit?.oldString) !== null && text(edit?.new_string ?? edit?.newString) !== null ? diffLines(edit.old_string ?? edit.oldString, edit.new_string ?? edit.newString) : []);
      return list.length ? assemble([file(path, 'edit', list)]) : null;
    }
    const before = text(value.old_string ?? value.oldString), after = text(value.new_string ?? value.newString);
    return before !== null && after !== null ? assemble([file(path, 'edit', diffLines(before, after))]) : null;
  }
  if (tool === 'multiedit' && Array.isArray(value.edits)) return change('edit', value);
  if (tool === 'write' || tool === 'write_file') {
    // Written whole: what it replaced is not in the record, so nothing reads as removed.
    return text(value.content) !== null ? assemble([file(path, 'write', lines(value.content).map(line => '+' + line))]) : null;
  }
  if (tool === 'str_replace_editor' && value.command === 'str_replace' && text(value.old_str) !== null && text(value.new_str) !== null) return assemble([file(path, 'edit', diffLines(value.old_str, value.new_str))]);
  return null;
}
// Antigravity's CODE_ACTION steps (format as read by cc-sessions-viewer, specstory-cli, wakatime-cli and deja-vu; no
// first-party format is published): an edit says "... tool to: <path>." with its diff between [diff_block_start] and
// [diff_block_end]; a new file says "Created file file://<path> with requested content." and its text is in the call.
function fromAntigravity(content, written) {
  if (typeof content !== 'string') return null;
  const begin = content.indexOf('[diff_block_start]');
  if (begin >= 0) {
    const named = /\btool to: (.+?)(?:\.\s|\.?\n|$)/.exec(content.slice(0, begin)); if (!named) return null;
    const after = content.slice(begin + 18), end = after.indexOf('[diff_block_end]');
    const list = (end < 0 ? after : after.slice(0, end)).split(/\r?\n/).filter(line => line.startsWith('@@') || /^[+\- ]/.test(line));
    return list.length ? assemble([file(named[1].trim(), 'edit', list)]) : null;
  }
  const created = /Created file file:\/\/\/?(\S+) with requested content/.exec(content); if (!created) return null;
  let path = created[1]; try { path = decodeURI(path); } catch { /* Shown as written. */ }
  if (!/^[A-Za-z]:/.test(path)) path = '/' + path;
  const text = written?.get(path.toLowerCase());
  return typeof text === 'string' ? assemble([file(path, 'write', lines(text).map(line => '+' + line))]) : null;
}
module.exports = { change, diffLines, fromPatch, fromAntigravity };
