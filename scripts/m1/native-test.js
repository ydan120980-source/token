'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fixtures } = require('../../tests/m1/fixtures');
const { scanSources } = require('../../src/m1/sources');
const { verifyProjection } = require('../../src/m1/native');
const { disableNetwork } = require('../../src/m1/policy');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-native-'));
(async () => {
  const f = fixtures(path.join(dir, 'home')), audit = { reads: 0, networkAttempts: 0 };
  disableNetwork(audit);
  const scan = await scanSources(f.roots, 'salt', audit), records = Object.values(scan).flatMap(s => s.records);
  // The projection exists only while tokscale runs; inspect it at spawn time.
  let projection = '';
  const app = path.join(dir, 'app'), capture = () => { const run = fs.readdirSync(app).find(name => name.startsWith('native-')); projection = fs.readFileSync(path.join(app, run, 'projection/.claude/projects/statistics-only/usage.jsonl'), 'utf8'); };
  const result = await verifyProjection(records, app, capture);
  assert.equal(result.tokens, f.total); assert.equal(audit.networkAttempts, 0);
  assert(projection.length > 0 && !projection.includes(f.sentinel));
  // A record leaving a later projection (dedupe, deleted session) must not stay
  // in tokscale's message cache; this used to block every later collection.
  const fewer = records.slice(1), again = await verifyProjection(fewer, app);
  assert.equal(again.tokens, f.total - records[0].totalTokens); assert.deepEqual(fs.readdirSync(app), []);
  console.log(JSON.stringify({ ...result, nodeNetworkAttempts: audit.networkAttempts, sourceReadOnly: true }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
