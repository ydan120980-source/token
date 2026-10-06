'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const distShare = require('../../scripts/m1/dist-share');

const GENERATIONS = ['gen-a', 'gen-b', 'gen-c'];
const RUNTIME = Buffer.alloc(64 * 1024, 7);

function generation(root, name, files) {
  const base = path.join(root, name, 'win-unpacked');
  for (const [relative, value] of Object.entries(files)) {
    const file = path.join(base, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
  return base;
}

function file(root, name, relative) { return path.join(root, name, 'win-unpacked', relative); }

function inode(file) { const stat = fs.statSync(file, { bigint: true }); return stat.dev + ':' + stat.ino; }

/** Three generations: one identical runtime file, two files that legitimately differ. */
function tree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-share-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [index, name] of GENERATIONS.entries()) {
    generation(root, name, {
      'runtime/library.dll': RUNTIME,
      // Same length on purpose: only the content hash may separate these.
      'Agent Usage Quota.exe': Buffer.alloc(4096, 16 + index),
      'resources/app.asar': Buffer.from('asar-' + name),
    });
    fs.writeFileSync(path.join(root, name, 'AgentUsage-CodexQuota-Windows-x64.zip'), 'zip-' + name);
  }
  return root;
}

test('dist-share groups identical files per generation and reports genuinely differing ones', t => {
  const root = tree(t);
  const result = distShare.plan(root);
  assert.deepEqual(result.generations, GENERATIONS);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].relative, path.join('runtime', 'library.dll'));
  assert.equal(result.groups[0].members.length, 3);
  assert.deepEqual(result.differing.map(item => item.relative).sort(),
    [path.join('resources', 'app.asar'), 'Agent Usage Quota.exe'].sort());
});

test('dist-share links duplicates into one inode without touching differing files or zips', t => {
  const root = tree(t);
  const before = distShare.footprint(root);
  const result = distShare.share(root);
  assert.deepEqual(result.failures, []);
  assert.equal(result.linked.length, 2);
  assert.equal(result.freedBytes, RUNTIME.length * 2);
  assert.equal(new Set(GENERATIONS.map(name => inode(file(root, name, 'runtime/library.dll')))).size, 1);
  assert.equal(distShare.verify(root).failures.length, 0);
  // Same-length but different content stays its own copy.
  assert.equal(new Set(GENERATIONS.map(name => inode(file(root, name, 'Agent Usage Quota.exe')))).size, 3);
  assert.equal(fs.readFileSync(file(root, 'gen-b', 'Agent Usage Quota.exe')).equals(Buffer.alloc(4096, 17)), true);
  // Zips are never candidates.
  for (const name of GENERATIONS) {
    assert.equal(fs.readFileSync(path.join(root, name, 'AgentUsage-CodexQuota-Windows-x64.zip'), 'utf8'), 'zip-' + name);
  }
  assert.equal(before.collapsedBytes, 0);
  assert.equal(distShare.footprint(root).collapsedBytes, RUNTIME.length * 2);
});

test('dist-share is idempotent, honours dry-run, and its race guard sees idle trees', t => {
  const root = tree(t);
  const dry = distShare.share(root, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.linked.length, 2);
  assert.equal(dry.freedBytes, RUNTIME.length * 2);
  assert.equal(new Set(GENERATIONS.map(name => inode(file(root, name, 'runtime/library.dll')))).size, 3);

  distShare.share(root);
  const again = distShare.share(root);
  assert.equal(again.linked.length, 0);
  assert.equal(again.alreadyShared.length, 2);
  assert.equal(again.freedBytes, 0);
  assert.equal(distShare.recentWrites(root, 0).length, 0);
  assert.equal(distShare.recentWrites(root, 3600).length > 0, true);
});

test('dist-share verify reports a hash group that is not yet a single physical file', t => {
  const root = tree(t);
  const winner = file(root, 'gen-a', 'runtime/library.dll');
  const duplicate = file(root, 'gen-b', 'runtime/library.dll');
  fs.rmSync(duplicate);
  fs.linkSync(winner, duplicate);
  const result = distShare.verify(root);
  assert.equal(result.groups, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].physicalCopies, 2);
  assert.equal(result.failures[0].relative, path.join('runtime', 'library.dll'));
});

test('dist-share preserves an explicitly anchored generation even when it sorts last', t => {
  const root = tree(t), anchor = file(root, 'gen-c', 'runtime/library.dll'), before = inode(anchor);
  assert.throws(() => distShare.share(root, { anchorGeneration: 'missing' }), /ANCHOR_GENERATION_NOT_FOUND/);
  const result = distShare.share(root, { anchorGeneration: 'gen-c' });
  assert.deepEqual(result.failures, []);
  assert.equal(inode(anchor), before);
  assert.deepEqual(result.linked.map(item => item.generation), ['gen-a', 'gen-b']);
  for (const name of GENERATIONS) assert.equal(inode(file(root, name, 'runtime/library.dll')), before);
  assert.deepEqual(distShare.verify(root).failures, []);
});
