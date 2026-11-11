'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { seed, hashes, COMMON } = require('./sessions-reader-fixture');
const { search } = require('../../src/m1/transcript');
const { Store } = require('../../src/m1/store');
const { roots } = require('../../src/m1/policy');
const { remove } = require('./temp');
test('native reader search deadline makes forward progress; continuation and saved-list offsets preserve real matches', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-continuation-')); t.after(() => remove(root));
  const data = await seed(root), selected = roots(data.home), store = new Store(data.usage, selected);
  const entries = store.sessionList({ range: 'all' }).sessions.toSorted((a, b) => String(b.end).localeCompare(String(a.end)))
    .map(row => ({ key: row.key, agent: row.agent, id: store.state.sessions[row.key].id }));
  const full = await search(entries, agent => selected[agent], COMMON.toLowerCase());
  assert.equal(full.results.length, 7);
  let offset = 0; const combined = [];
  while (offset < entries.length) {
    // An already expired budget is deterministic and still permits one real
    // session. It avoids a slow wall-clock sleep or a fabricated reader reply.
    const batch = await search(entries.slice(offset), agent => selected[agent], COMMON.toLowerCase(), { budgetMs: -1 });
    assert.equal(batch.scanned, 1); combined.push(...batch.results); offset += batch.scanned;
  }
  assert.deepEqual(combined, full.results); assert.equal(new Set(combined.map(row => row.key)).size, 7);
  const rest = await store.searchTranscripts({ query: COMMON, range: 'all', agent: 'all', offset: 1 });
  assert.equal(rest.total, 7); assert.equal(rest.searched, 7); assert.equal(rest.next, null);
  assert.deepEqual(rest.results, full.results.slice(1));
  assert.deepEqual(hashes(data.home), data.sourceHashes);
  assert.deepEqual(fs.readFileSync(path.join(data.usage, 'statistics.json')), data.ledgerBytes);
});
