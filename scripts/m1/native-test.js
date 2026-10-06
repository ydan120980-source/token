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
  const result = await verifyProjection(records, path.join(dir, 'app'));
  assert.equal(result.tokens, f.total); assert.equal(audit.networkAttempts, 0);
  assert(!fs.readFileSync(path.join(dir, 'app/projection/.claude/projects/statistics-only/usage.jsonl'), 'utf8').includes(f.sentinel));
  console.log(JSON.stringify({ ...result, nodeNetworkAttempts: audit.networkAttempts, sourceReadOnly: true }));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
