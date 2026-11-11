'use strict';
// Which paths each Agent is read from. Saved as the user's changes against the
// automatic locations (added paths, excluded paths, stopped Agents), so locations a
// later version adds still reach existing users. See SOURCES-DISCOVERY-20261014.md.
const path = require('node:path');
const { SOURCES, localPath } = require('./policy');
const fold = value => process.platform === 'win32' ? value.toLowerCase() : value;
const same = (a, b) => fold(path.resolve(a)) === fold(path.resolve(b));
const contains = (list, file) => (list || []).some(entry => same(entry, file));
function empty() { return { added: {}, excluded: {}, disabled: [] }; }
// Keeps only well-formed entries of a saved scope; anything else is dropped.
function sanitize(value) {
  const scope = empty();
  if (!value || typeof value !== 'object') return null;
  const paths = list => Array.isArray(list) ? list.filter(entry => { try { localPath(entry); return true; } catch { return false; } }) : [];
  for (const key of ['added', 'excluded']) for (const agent of SOURCES) { const list = paths(value[key]?.[agent]); if (list.length) scope[key][agent] = list; }
  scope.disabled = SOURCES.filter(agent => Array.isArray(value.disabled) && value.disabled.includes(agent));
  return scope;
}
// Older versions saved one full list per Agent. No version could remove a path, so a
// difference from today's locations is a path the user added, Cursor's "replace"
// choice, an older version's defaults, or an intentionally empty list.
function migrate(saved, defaults) {
  const scope = empty();
  for (const agent of SOURCES) {
    const list = saved?.[agent];
    if (!Array.isArray(list)) continue;
    if (!list.length) { if (defaults[agent]?.length) scope.disabled.push(agent); continue; }
    const extra = list.filter(entry => typeof entry === 'string' && !contains(defaults[agent], entry));
    if (extra.length) scope.added[agent] = extra;
    if (agent === 'cursor' && extra.length && !list.some(entry => contains(defaults.cursor, entry))) scope.excluded.cursor = [...defaults.cursor];
  }
  return sanitize(scope);
}
// The roots a scan reads: automatic locations plus added paths, minus exclusions.
function effective(scope, defaults) {
  return Object.fromEntries(SOURCES.map(agent => {
    if (scope.disabled.includes(agent)) return [agent, []];
    const list = [];
    for (const entry of [...(defaults[agent] || []), ...(scope.added[agent] || [])]) if (!contains(list, entry) && !contains(scope.excluded[agent], entry)) list.push(entry);
    return [agent, list];
  }));
}
function without(list, file) { return (list || []).filter(entry => !same(entry, file)); }
function set(scope, key, agent, list) { if (list.length) scope[key][agent] = list; else delete scope[key][agent]; }
// Changes return a new scope; the caller validates and saves it.
const change = {
  add(scope, defaults, agent, file) {
    const next = structuredClone(scope);
    next.disabled = next.disabled.filter(entry => entry !== agent);
    // A Cursor selection replaces its sources: SDK files and CSV exports conflict.
    if (agent === 'cursor') { next.added.cursor = [file]; set(next, 'excluded', agent, [...(defaults.cursor || [])]); return next; }
    if (contains(defaults[agent], file)) set(next, 'excluded', agent, without(next.excluded[agent], file));
    else if (!contains(next.added[agent], file)) next.added[agent] = [...(next.added[agent] || []), file];
    return next;
  },
  remove(scope, defaults, agent, file) {
    const next = structuredClone(scope);
    if (contains(next.added[agent], file)) {
      set(next, 'added', agent, without(next.added[agent], file));
      if (agent === 'cursor' && !next.added.cursor) delete next.excluded.cursor;
    } else if (contains(defaults[agent], file) && !contains(next.excluded[agent], file)) next.excluded[agent] = [...(next.excluded[agent] || []), file];
    return next;
  },
  include(scope, agent, file) { const next = structuredClone(scope); set(next, 'excluded', agent, without(next.excluded[agent], file)); return next; },
  enable(scope, agent, enabled) {
    const next = structuredClone(scope), rest = next.disabled.filter(entry => entry !== agent);
    next.disabled = enabled ? rest : [...rest, agent];
    return next;
  },
  reset(scope, agent) { const next = structuredClone(scope); delete next.added[agent]; delete next.excluded[agent]; next.disabled = next.disabled.filter(entry => entry !== agent); return next; },
  all(scope, enabled) { return { ...structuredClone(scope), disabled: enabled ? [] : [...SOURCES] }; }
};
module.exports = { empty, sanitize, migrate, effective, change, same, contains };
