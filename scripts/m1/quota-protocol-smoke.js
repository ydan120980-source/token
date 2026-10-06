'use strict';
// Only an empty, unique own CODEX_HOME. Never reads the existing Codex auth/config.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { AccountRpc } = require('../../src/quota/rpc');
const { loginUrlAllowed } = require('../../src/quota/contract');
(async () => {
  const executable = process.argv[2]; if (!executable) throw new Error('EXPLICIT_CODEX_EXECUTABLE_REQUIRED');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-quota-protocol-'));
  const rpc = new AccountRpc(executable, home);
  try {
    await rpc.initialize(); const result = await rpc.request('account/read', { refreshToken: false }); assert.equal(result.account, null);
    let loginHandshake = false;
    if (process.argv.includes('--login-handshake')) { const login = await rpc.request('account/login/start', { type: 'chatgpt' }); assert.equal(loginUrlAllowed(login.authUrl), true); await rpc.request('account/login/cancel', { loginId: login.loginId }); loginHandshake = true; }
    assert.equal(fs.existsSync(path.join(home, 'auth.json')), false); process.stdout.write(JSON.stringify({ initialized: true, isolatedAccount: null, authenticationFileCreated: false, inferenceRequests: 0, loginStartedAndCanceled: loginHandshake, browserOpened: false }) + '\n');
  } finally { await rpc.close(); fs.rmSync(home, { recursive: true, force: true }); }
})().catch(() => { process.stderr.write('Isolated protocol smoke failed; no raw protocol logged.\n'); process.exitCode = 1; });
