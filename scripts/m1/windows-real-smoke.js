'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const { waitState } = require('./wait-state');
(async () => {
  const data = fs.mkdtempSync(path.resolve('.cache/windows-real-')), started = Date.now();
  const app = await electron.launch({ executablePath: path.resolve('dist/win-unpacked/Agent Usage M1.exe'), args: ['--m1-data-dir', data], timeout: 60000 });
  try {
    const page = await app.firstWindow();
    const state = await waitState(page, state => state.snapshot.sequence > 0);
    assert.equal(state.runtimeNetworkAttempts, 0); assert.equal(state.audit.networkAttempts, 0);
    const result = { elapsedMs: Date.now() - started, ownDataDirectory: true, product: 'Agent Usage M1 0.1.0', sources: state.snapshot.sources.map(s => ({ agent: s.agent, records: s.observedRecords, state: s.status })), runtimeNetworkAttempts: state.runtimeNetworkAttempts, audit: state.audit };
    await page.evaluate(() => window.agentUsage.setEnabled(false));
    fs.writeFileSync('artifacts/windows-real-smoke.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await app.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
