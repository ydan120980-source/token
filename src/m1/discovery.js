'use strict';
// What each read path holds right now, and which other Agents leave traces on this
// machine (SOURCES-DISCOVERY-20261014.md). Included paths are listed with the same
// rules a scan uses; excluded and stopped paths and other Agents' directories are
// only checked for existence. No file content is read here.
const fs = require('node:fs');
const path = require('node:path');
const { SOURCES, filesUnder } = require('./policy');
const { TRACES, HOMES } = require('./agent-traces');
const { contains } = require('./source-scope');
const { canonical } = require('./sources');
function expand(marker, places) {
  const [prefix, ...rest] = marker.split('/');
  const base = { '~': places.home, '%APPDATA%': places.appData, '%LOCALAPPDATA%': places.localAppData }[prefix];
  return base ? path.join(base, ...rest) : null;
}
function exists(file) { try { fs.statSync(file); return true; } catch { return false; } }
function display(file, home) { const relative = path.relative(home, file); return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? '~' + path.sep + relative : file; }
function describe(agent, root, entry) {
  let stat; try { stat = fs.statSync(root); } catch { return entry; }
  Object.assign(entry, { exists: true, kind: stat.isDirectory() ? 'directory' : 'file', files: 0 });
  try {
    const listed = filesUnder(agent, root, { reads: 0 });
    let latest = 0;
    for (const file of listed) { try { latest = Math.max(latest, fs.statSync(file).mtimeMs); } catch { /* Removed while listing. */ } }
    // Counted as the scan reads them: copies of the same calls count once.
    Object.assign(entry, { files: canonical(agent, listed).length, latest: latest ? new Date(latest).toISOString() : null });
    for (const [flag, code] of [['limited', 'SOURCE_LIMIT'], ['aliased', 'SOURCE_ALIAS_REJECTED'], ['unreadable', 'SOURCE_UNREADABLE']]) if (listed[flag]) entry.issues.push(code);
  } catch (error) { entry.files = null; entry.issues.push(/^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_UNREADABLE'); }
  return entry;
}
function discover(defaults, scope, places) {
  const sources = SOURCES.map(agent => {
    const stopped = scope.disabled.includes(agent);
    const candidates = [...(defaults[agent] || []).map(root => [root, 'auto']), ...(scope.added[agent] || []).filter(root => !contains(defaults[agent], root)).map(root => [root, 'added'])];
    const paths = candidates.map(([root, origin]) => {
      const state = stopped ? 'stopped' : contains(scope.excluded[agent], root) ? 'excluded' : 'included';
      const entry = { path: root, display: display(root, places.home), origin, state, exists: false, kind: null, files: null, latest: null, issues: [] };
      if (state === 'included') return describe(agent, root, entry);
      entry.exists = exists(root); return entry;
    });
    const included = paths.filter(entry => entry.state === 'included');
    const installed = paths.some(entry => entry.exists) || (HOMES[agent] || []).some(marker => exists(expand(marker, places)));
    const latest = included.map(entry => entry.latest).filter(Boolean).sort().at(-1) || null;
    return { agent, enabled: !stopped, installed, files: included.reduce((n, entry) => n + (entry.files || 0), 0), latest, paths };
  });
  const unsupported = TRACES.flatMap(trace => {
    const markers = trace.markers.filter(marker => { const file = expand(marker, places); return file && exists(file); });
    return markers.length ? [{ id: trace.id, name: trace.name, markers }] : [];
  });
  return { schemaVersion: 'SourceDiscoveryV1', checkedAt: new Date().toISOString(), sources, unsupported };
}
module.exports = { discover, expand };
