'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { fixtures } = require('../../tests/m1/fixtures');
const { waitState } = require('./wait-state');
(async () => {
  const dir = fs.mkdtempSync(path.resolve('.cache/zip-smoke-')), home = path.join(dir, 'home'); fixtures(home);
  const app = await electron.launch({ executablePath: path.resolve(process.argv[2]), args: ['--m1-data-dir', path.join(dir, 'app'), '--m1-fixture-root', home], timeout: 60000 });
  try {
    const page = await app.firstWindow(), state = await waitState(page, s => s.snapshot.sequence > 0);
    assert.equal(state.snapshot.daily.reduce((sum, r) => sum + r.totalTokens, 0), 694); assert.equal(state.runtimeNetworkAttempts, 0);
    console.log('PASS: freshly extracted Windows ZIP starts and collects synthetic usage independently.');
  } finally { await app.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
