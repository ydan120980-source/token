'use strict';
// Discovery (SOURCES-DISCOVERY-20261014.md): counts what included paths hold, only
// checks existence for everything else, and never reads a file.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { fixtures, SENTINEL } = require('./fixtures');
const { remove } = require('./temp');
const { discover } = require('../../src/m1/discovery');
const scope = require('../../src/m1/source-scope');
const { Service } = require('../../src/m1/service');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-')), home = path.join(root, 'home'), f = fixtures(home);
  const places = { home, appData: path.join(home, 'AppData', 'Roaming'), localAppData: path.join(home, 'AppData', 'Local') };
  // Other Agents' traces, each holding a file that must never be read.
  for (const dir of [path.join(home, '.kiro'), path.join(places.appData, 'Code', 'User', 'globalStorage', 'saoudrizwan.claude-dev')]) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'secrets.json'), SENTINEL); }
  t.after(() => remove(root));
  return { root, home, f, places };
}

test('included paths are counted, excluded and stopped ones only checked, other Agents only detected', t => {
  const { home, f, places } = setup(t);
  let next = scope.change.remove(scope.empty(), f.roots, 'codex', f.roots.codex[1]);
  next = scope.change.enable(next, 'mimo', false);
  const reads = { file: 0, open: 0 }, readFileSync = fs.readFileSync, openSync = fs.openSync;
  fs.readFileSync = (...args) => { reads.file++; return readFileSync(...args); }; fs.openSync = (...args) => { reads.open++; return openSync(...args); };
  let report;
  try { report = discover(f.roots, next, places); } finally { fs.readFileSync = readFileSync; fs.openSync = openSync; }
  assert.deepEqual(reads, { file: 0, open: 0 }, 'discovery lists and stats, it never opens a file');
  const by = Object.fromEntries(report.sources.map(source => [source.agent, source]));
  assert.deepEqual(by.codex.paths.map(entry => [entry.state, entry.exists, entry.files]), [['included', true, 1], ['excluded', true, null]]);
  assert.equal(by.codex.files, 1); assert.equal(typeof by.codex.latest, 'string');
  assert.equal(by.codex.paths[0].display, path.join('~', '.codex', 'sessions'));
  assert.deepEqual([by.mimo.enabled, by.mimo.paths[0].state, by.mimo.paths[0].files], [false, 'stopped', null]);
  assert.deepEqual([by.gemini.installed, by.gemini.files], [false, 0], 'an Agent without its home is not installed');
  assert.deepEqual(report.unsupported, [{ id: 'kiro', name: 'Kiro', markers: ['~/.kiro'] }]);
  assert.equal(by.cline.installed, true, 'Cline is now supported, but discovery still only checks metadata');
  assert.equal(JSON.stringify(report).includes(SENTINEL), false);
  fs.mkdirSync(path.join(home, '.gemini', 'tmp'), { recursive: true });
  assert.deepEqual(discover(f.roots, scope.empty(), places).sources.find(source => source.agent === 'gemini').installed, true, 'an installed Agent with nothing to count');
});

test('an added path is reported with its origin and the service runs discovery in a worker', async t => {
  const { root, f, places } = setup(t), extra = path.join(root, 'extra-claude');
  fs.mkdirSync(path.join(extra, 'project'), { recursive: true }); fs.copyFileSync(path.join(f.roots.claude[0], 'project', 'session.jsonl'), path.join(extra, 'project', 'other.jsonl'));
  const service = new Service(path.join(root, 'app'), f.roots, () => {}, places);
  t.after(() => service.close());
  service.store.changeSources('add', 'claude', extra);
  const [first, second] = [service.discover(), service.discover()];
  assert.equal(first, second, 'one discovery at a time');
  const report = await first, claude = report.sources.find(source => source.agent === 'claude');
  assert.deepEqual(claude.paths.map(entry => [entry.origin, entry.files]), [['auto', 1], ['auto', null], ['added', 1]], 'a missing location has no count, not zero');
  assert.equal(claude.files, 2); assert.equal(service.discovery, report);
});
