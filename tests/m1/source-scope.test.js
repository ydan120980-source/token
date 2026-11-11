'use strict';
// Which paths are read (SOURCES-DISCOVERY-20261014.md): automatic locations, the
// saved scope, old preference migration and how a root is listed.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { fixtures } = require('./fixtures');
const { roots, filesUnder, LIMITS, SOURCES } = require('../../src/m1/policy');
const scope = require('../../src/m1/source-scope');
const { scanSources } = require('../../src/m1/sources');
const { Store, atomic } = require('../../src/m1/store');
function temporary(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-scope-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }

test('home overrides add their locations; an explicit home never reads the machine environment', t => {
  const root = temporary(t), home = path.join(root, 'home'), moved = path.join(root, 'moved-codex'), claude = path.join(root, 'claude-config');
  const read = roots(home, { CODEX_HOME: moved, CLAUDE_CONFIG_DIR: claude });
  assert.deepEqual(read.codex, [path.join(home, '.codex', 'sessions'), path.join(home, '.codex', 'archived_sessions'), path.join(moved, 'sessions'), path.join(moved, 'archived_sessions')]);
  assert.deepEqual(read.claude.slice(2), [path.join(claude, 'projects'), path.join(claude, 'transcripts')]);
  assert.deepEqual(roots(home, { CODEX_HOME: 'relative', CLAUDE_CONFIG_DIR: '\\\\server\\share' }), roots(home));
  const saved = process.env.CODEX_HOME; process.env.CODEX_HOME = moved;
  try { assert.equal(roots(home).codex.length, 2, 'a fixture home ignores CODEX_HOME'); } finally { if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved; }
});

test('old full lists migrate to changes against today\'s locations', () => {
  const defaults = roots(path.resolve('/home-fixture'));
  const migrated = scope.migrate({ codex: [defaults.codex[0]], claude: [...defaults.claude, path.resolve('/extra')], cursor: [path.resolve('/export/usage.csv')], gemini: [] }, defaults);
  assert.deepEqual(migrated, { added: { claude: [path.resolve('/extra')], cursor: [path.resolve('/export/usage.csv')] }, excluded: { cursor: defaults.cursor }, disabled: ['gemini'] });
  const read = scope.effective(migrated, defaults);
  assert.deepEqual(read.codex, defaults.codex, 'a default an older version lacked is restored');
  assert.deepEqual(read.cursor, [path.resolve('/export/usage.csv')], 'a Cursor selection still replaces its defaults');
  assert.deepEqual(read.gemini, []);
  assert.deepEqual(scope.migrate(undefined, defaults), scope.empty());
});

test('scope changes add, exclude, restore, stop and reset one Agent, or all at once', () => {
  const defaults = roots(path.resolve('/home-fixture')), extra = path.resolve('/extra');
  let next = scope.change.add(scope.empty(), defaults, 'claude', extra);
  next = scope.change.remove(next, defaults, 'claude', defaults.claude[1]);
  assert.deepEqual(scope.effective(next, defaults).claude, [defaults.claude[0], extra]);
  next = scope.change.remove(next, defaults, 'claude', extra);
  assert.deepEqual(next.added, {});
  next = scope.change.include(next, 'claude', defaults.claude[1]);
  assert.deepEqual(scope.effective(next, defaults).claude, defaults.claude);
  next = scope.change.enable(next, 'codex', false);
  assert.deepEqual(scope.effective(next, defaults).codex, []);
  next = scope.change.add(next, defaults, 'codex', extra);
  assert.deepEqual(scope.effective(next, defaults).codex, [...defaults.codex, extra], 'adding a path starts a stopped Agent');
  assert.deepEqual(scope.change.reset(next, 'codex'), scope.empty());
  assert.deepEqual(Object.values(scope.effective(scope.change.all(next, false), defaults)).flat(), []);
  assert.deepEqual(scope.change.all(next, true).disabled, []);
  next = scope.change.add(scope.empty(), defaults, 'cursor', path.resolve('/export/usage.csv'));
  assert.deepEqual(scope.change.remove(next, defaults, 'cursor', path.resolve('/export/usage.csv')), scope.empty(), 'removing the Cursor selection returns to automatic');
});

test('the store saves only changes, keeps full lists for older versions and rejects its own directory', t => {
  const root = temporary(t), defaults = roots(path.join(root, 'home')), app = path.join(root, 'app');
  atomic(path.join(app, 'preferences.json'), { enabled: true, refreshIntervalMs: 60000, roots: { codex: [defaults.codex[0]] } });
  const store = new Store(app, defaults);
  assert.deepEqual(store.sourceRoots().codex, defaults.codex);
  store.changeSources('enable', 'gemini', false);
  const saved = JSON.parse(fs.readFileSync(path.join(app, 'preferences.json'), 'utf8'));
  assert.equal(saved.refreshIntervalMs, 60000);
  assert.deepEqual(saved.sources.disabled, ['gemini']);
  assert.deepEqual(saved.roots.gemini, []); assert.deepEqual(saved.roots.codex, defaults.codex);
  assert.deepEqual(new Store(app, defaults).sourceRoots(), store.sourceRoots(), 'a saved scope wins over the full lists');
  assert.throws(() => store.changeSources('add', 'claude', path.join(app, 'nested')), /SOURCE_PRODUCT_OVERLAP/);
  assert.deepEqual(store.settings.sources.added, {}, 'a rejected change is not applied');
  assert.throws(() => store.changeSources('constructor'), /INVALID_SETTING/);
  assert.deepEqual(Object.keys(store.sourceRoots()), SOURCES);
});

test('a moved Agent home is read through a linked parent; links at or below the root are not', async t => {
  const root = temporary(t), real = path.join(root, 'D-drive', '.claude'), home = path.join(root, 'home'), f = fixtures(path.join(root, 'fixture'));
  fs.mkdirSync(home, { recursive: true }); fs.cpSync(path.join(root, 'fixture', '.claude'), real, { recursive: true });
  fs.symlinkSync(real, path.join(home, '.claude'), 'junction');
  const moved = roots(home).claude[0];
  assert.equal(filesUnder('claude', moved, { reads: 0 }).length, 1);
  const scan = await scanSources({ claude: [moved] }, 'salt', { reads: 0 });
  assert.deepEqual(scan.claude.errors, []); assert.equal(scan.claude.records.length > 0, true);
  assert.throws(() => filesUnder('claude', path.join(home, '.claude'), { reads: 0 }), /SOURCE_SYMLINK_REJECTED/);
  fs.symlinkSync(path.join(root, 'D-drive'), path.join(f.roots.claude[0], 'linked'), 'junction');
  assert.equal(filesUnder('claude', f.roots.claude[0], { reads: 0 }).length, 1, 'a link inside a root is skipped');
});

test('a root over the walk limit keeps the files it listed and reports SOURCE_LIMIT', async t => {
  const root = temporary(t), f = fixtures(path.join(root, 'home')), project = path.join(f.roots.claude[0], 'project');
  fs.copyFileSync(path.join(project, 'session.jsonl'), path.join(project, 'second.jsonl'));
  const files = LIMITS.files; LIMITS.files = 1;
  try {
    const listed = filesUnder('claude', f.roots.claude[0], { reads: 0 });
    assert.equal(listed.length, 1); assert.equal(listed.limited, true);
    const scan = await scanSources({ claude: f.roots.claude }, 'salt', { reads: 0 });
    assert.deepEqual(scan.claude.errors, ['SOURCE_LIMIT']); assert.equal(scan.claude.partial, true); assert.equal(scan.claude.records.length > 0, true);
  } finally { LIMITS.files = files; }
});
