'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileHistory } = require('../../src/m1/transcript');

const row = (type, payload, timestamp = '2026-11-02T01:00:00Z') => ({ type, payload, timestamp });
const patch = file => '*** Begin Patch\n*** Update File: ' + file + '\n@@\n-a\n+b\n+c\n*** End Patch';
function session(root, id, file, { failed = false } = {}) {
  const rows = [row('session_meta', { id }), row('response_item', { type: 'custom_tool_call', name: 'apply_patch', call_id: 'p', input: patch(file) })];
  if (failed) rows.push(row('response_item', { type: 'custom_tool_call_output', call_id: 'p', output: JSON.stringify({ output: 'no', metadata: { exit_code: 1 } }) }));
  fs.writeFileSync(path.join(root, 'rollout-2026-11-02T00-00-00-' + id + '.jsonl'), rows.map(item => JSON.stringify(item)).join('\n'));
  return { key: id, agent: 'codex', id };
}
const id = n => '11111111-2222-4333-8444-' + String(n).padStart(12, '0');
function fixture() { return fs.mkdtempSync(path.join(os.tmpdir(), 'file-history-')); }

test('the same file is found across sessions; other files, failed edits and other projects\' short names are not', async () => {
  const root = fixture();
  try {
    const entries = [
      { ...session(root, id(1), 'src/chart.js'), cwd: 'E:/work/app' },
      { ...session(root, id(2), 'E:\\work\\app\\SRC\\chart.js'), cwd: 'E:/elsewhere' },
      { ...session(root, id(3), 'src/chart.js'), cwd: 'E:/work/app-worktree' },
      { ...session(root, id(4), 'src/other.js'), cwd: 'E:/work/app' },
      { ...session(root, id(5), 'src/chart.js', { failed: true }), cwd: 'E:/work/app' },
      { ...session(root, id(6), 'README.md'), cwd: 'E:/work/app' },
    ];
    const { results, scanned } = await fileHistory(entries, () => [root], { path: 'E:/work/app/src/chart.js', cwd: 'E:/work/app' });
    assert.equal(scanned, 6);
    assert.deepEqual(results.map(hit => [hit.key, hit.exact]), [[id(1), true], [id(2), true], [id(3), false]]);
    assert.deepEqual([results[0].added, results[0].removed, results[0].calls], [2, 1, 1]);
    assert.equal(results[1].path, 'E:\\work\\app\\SRC\\chart.js', 'the path as that session wrote it, so its reader can filter on it');
    assert.equal(JSON.stringify(results).includes('*** Begin Patch'), false, 'no text of the change');
    const { results: bare } = await fileHistory(entries, () => [root], { path: 'E:/work/app/README.md', cwd: 'E:/work/app' });
    assert.deepEqual(bare.map(hit => hit.key), [id(6)], 'a bare name matches only by its full path');
    const { results: lone } = await fileHistory([{ ...session(root, id(7), 'README.md'), cwd: 'E:/other/project' }], () => [root], { path: 'E:/work/app/README.md', cwd: 'E:/work/app' });
    assert.deepEqual(lone, [], 'another project\'s README is another file');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('a scan stops at its budget and says how far it got; a later batch continues', async () => {
  const root = fixture();
  try {
    const entries = [1, 2, 3].map(n => ({ ...session(root, id(n), 'src/a.js'), cwd: 'E:/w' }));
    const first = await fileHistory(entries, () => [root], { path: 'src/a.js', cwd: 'E:/w' }, { budgetMs: -1 });
    assert.equal(first.scanned, 1, 'at least one each batch, so it always moves');
    const rest = await fileHistory(entries.slice(first.scanned), () => [root], { path: 'src/a.js', cwd: 'E:/w' });
    assert.equal(first.results.length + rest.results.length, 3);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
