'use strict';
// What a SKILL.md's header says, read for the Agent admin only (owner 2026-11-05, docs/m2/UI-AGENT-ADMIN-TABLE-20261105.md).
// config-health-syntax's frontmatter stays the strict gate for writes; it refuses most of what Agents accept, so it cannot
// say whether a Skill is healthy. This reads top-level fields line by line: no tags, anchors, references or evaluation.
// Nested values are only noted as present. `hazard` names a form a strict YAML reader refuses; `odd` a line it could not place.
const LIMIT = 65536, CLOSE = /^---[ \t]*$/, KEY = /^([A-Za-z_][\w.-]*)[ \t]*:(?:[ \t]+(.*))?[ \t]*$/, BLOCK = /^[|>][-+0-9]*(?:[ \t]+#.*)?$/, INDENTED = /^[ \t]+\S/;
const stripComment = value => value.replace(/[ \t]+#.*$/, '').trimEnd();
function quoted(raw) {
  const quote = raw[0], end = quote === '"' ? /^"(?:[^"\\]|\\.)*"/s.exec(raw) : /^'(?:[^']|'')*'/s.exec(raw);
  if (!end) return null;
  if (quote === "'") return end[0].slice(1, -1).replaceAll("''", "'");
  try { return JSON.parse(end[0].replace(/\n[ \t]*/g, ' ')); } catch { return end[0].slice(1, -1); }
}
function flowList(raw) {
  const items = []; let current = '', quote = null;
  for (const char of raw.slice(1, raw.lastIndexOf(']'))) {
    if (quote) { if (char === quote) quote = null; else current += char; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === ',') { items.push(current.trim()); current = ''; }
    else current += char;
  }
  if (current.trim()) items.push(current.trim());
  return items.filter(Boolean).slice(0, 256);
}
function readFront(text) {
  const source = String(text).replace(/^\uFEFF/, '').slice(0, LIMIT * 4), lines = source.split(/\r?\n/);
  if (!/^---[ \t]*$/.test(lines[0])) return { present: false, closed: false, fields: Object.create(null), hazard: null, odd: false };
  const end = lines.findIndex((line, index) => index > 0 && CLOSE.test(line));
  if (end < 0 || lines.slice(1, end).join('\n').length > LIMIT) return { present: true, closed: false, fields: Object.create(null), hazard: null, odd: true };
  const body = lines.slice(1, end), fields = Object.create(null); let hazard = null, odd = false;
  for (let at = 0; at < body.length; at++) {
    const line = body[at];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = KEY.exec(line);
    if (!match) { odd = true; continue; }
    const key = match[1], raw = (match[2] ?? '').trim();
    const more = test => { const taken = []; while (at + 1 < body.length && test(body[at + 1])) taken.push(body[++at]); return taken; };
    if (BLOCK.test(raw)) {
      const taken = more(next => INDENTED.test(next) || !next.trim()).map(next => next.trim());
      fields[key] = (raw[0] === '>' ? taken.join(' ') : taken.join('\n')).trim();
    } else if (!raw || raw.startsWith('#')) {
      const nested = more(next => INDENTED.test(next) || !next.trim() || next.startsWith('- '));
      const list = nested.filter(next => /^[ \t]*- /.test(next));
      if (list.length && list.length === nested.filter(next => next.trim() && !/^[ \t]{4,}/.test(next)).length) fields[key] = list.map(next => { const value = next.trim().slice(2).trim(); return value[0] === '"' || value[0] === "'" ? quoted(value) ?? value : stripComment(value); });
      else fields[key] = nested.some(next => next.trim()) ? Object.create(null) : null;
    } else if (raw[0] === '"' || raw[0] === "'") {
      let value = raw;
      while (quoted(value) === null && at + 1 < body.length && (INDENTED.test(body[at + 1]) || !body[at + 1].trim())) value += '\n' + body[++at].trim();
      const read = quoted(value);
      if (read === null) odd = true;
      fields[key] = read ?? value.slice(1);
    } else if (raw[0] === '[') {
      let value = raw;
      while (!value.includes(']') && at + 1 < body.length && (INDENTED.test(body[at + 1]) || !body[at + 1].trim())) value += ' ' + body[++at].trim();
      fields[key] = value.includes(']') ? flowList(value) : (odd = true, []);
    } else if (raw[0] === '{') {
      more(next => INDENTED.test(next));
      fields[key] = Object.create(null);
    } else {
      const plain = stripComment(raw), rest = more(next => INDENTED.test(next)).map(next => next.trim());
      if (/:[ \t]/.test(plain) || /:$/.test(plain)) hazard ??= 'colon';
      else if (/^[*&!%@`|>?-]/.test(plain) && !/^-?\d/.test(plain)) hazard ??= 'mark';
      fields[key] = [plain, ...rest].join(' ').trim();
    }
  }
  return { present: true, closed: true, fields, hazard, odd };
}
module.exports = { readFront };
