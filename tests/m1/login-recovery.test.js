'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { fork, spawnSync } = require('node:child_process');
const { verifiedImagesCommand } = require('../../src/quota/workbuddy-client');
const { runWindowsJob } = require('../../src/quota/windows-job');
const { fingerprint } = require('../../src/quota/executable-pin');
const { runDeviceLogin } = require('../../src/quota/provider-device-login');
const { loginConsole, consoleAuthURL, consoleCredentials } = require('../../src/quota/opencode-console-login');
const { fromProvider } = require('../../src/quota/provider-resources');
const { quotaJSON } = require('../../src/quota/quota-json');
const { renewOAuth } = require('../../src/quota/provider-oauth');
const { ProviderSecretStore } = require('../../src/quota/provider-secret-store');
const { EventEmitter } = require('node:events');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'login-recovery-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }

test('CLI Google handoff rejects truncated, repeated or redirected authorization and preserves PKCE parameters', () => {
  const { googleCliAuthURL } = require('../../src/quota/google-cli-auth-url');
  const query = new URLSearchParams({ client_id: 'SYNTHETIC-CLIENT.apps.googleusercontent.com', redirect_uri: 'https://antigravity.google/oauth-callback', response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', scope: 'openid https://www.googleapis.com/auth/cloud-platform', state: 's'.repeat(32) });
  const url = 'https://accounts.google.com/o/oauth2/auth?' + query; assert.equal(googleCliAuthURL(url), url);
  const missing = new URL(url); missing.searchParams.delete('response_type'); assert.throws(() => googleCliAuthURL(missing.href), /RESPONSE_INVALID/);
  assert.throws(() => googleCliAuthURL(url + '&response_type=code'), /RESPONSE_INVALID/); assert.throws(() => googleCliAuthURL(url.replace('accounts.google.com', 'accounts.google.com.evil.invalid')), /RESPONSE_INVALID/);
  const redirected = new URL(url); redirected.searchParams.set('redirect_uri', 'https://evil.invalid/callback'); assert.throws(() => googleCliAuthURL(redirected.href), /RESPONSE_INVALID/); assert.throws(() => googleCliAuthURL(url + '&access_token=SYNTHETIC'), /RESPONSE_INVALID/);
});

test('real Windows PowerShell handles multiple metadata candidates and Chinese paths with UTF8 output, without real registry reads', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t), image = path.join(root, '中文 空格', 'WorkBuddy.exe'); fs.mkdirSync(path.dirname(image)); fs.writeFileSync(image, 'synthetic metadata only');
  const prefix = `function Test-Path { param($LiteralPath,$PathType) if($LiteralPath -like 'HK*'){return $false}; if($PathType){Microsoft.PowerShell.Management\\Test-Path -LiteralPath $LiteralPath -PathType $PathType}else{Microsoft.PowerShell.Management\\Test-Path -LiteralPath $LiteralPath} }
function Get-Item { param($LiteralPath) $f=Microsoft.PowerShell.Management\\Get-Item -LiteralPath $LiteralPath; [pscustomobject]@{Attributes=$f.Attributes;VersionInfo=@{ProductName='WorkBuddy'}} }
function Get-AuthenticodeSignature { param($LiteralPath) @{Status='Valid';SignerCertificate=@{Subject='Tencent SYNTHETIC'}} }
`;
  const env = { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, AGENTUSAGE_IMAGES: JSON.stringify([path.join(root, 'missing', 'WorkBuddy.exe'), image, path.join(root, 'another', 'WorkBuddy.exe')]) };
  const powerShell = fingerprint(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'));
  const args = ['-NoProfile', '-NonInteractive', '-Command', prefix + verifiedImagesCommand];
  const result = await runWindowsJob(powerShell, args, { cwd: root, env, timeoutMs: 30000, maxOutputBytes: 16384, signal: new AbortController().signal });
  assert.equal(result.errorCode, null); assert.equal(result.reaped, true); assert.equal(result.code, 0, result.stderr); const images = JSON.parse(result.stdout); assert.equal(images.length, 1); assert.equal(images[0].executable, image); assert.equal(images[0].sha256, fingerprint(image).sha256);
});

test('device authorization uses an actual owned IPC child while the parent main network remains disabled', async t => {
  const root = fixture(t), preload = path.join(root, 'synthetic-http.cjs'), parent = path.join(root, 'parent.cjs');
  fs.writeFileSync(preload, `const {EventEmitter}=require('node:events');require('node:https').request=(url,options,callback)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>setImmediate(()=>{const res=new EventEmitter();res.statusCode=200;res.destroy=()=>{};callback(res);const value=url.includes('/auth/device/code')?{device_code:'SYNTHETIC_DEVICE',verification_uri_complete:'https://opencode.ai/console/device?code=SYNTHETIC',expires_in:300,interval:1}:url.includes('/auth/device/token')?{access_token:'SYNTHETIC_CONSOLE_ACCESS',refresh_token:'SYNTHETIC_OWN_REFRESH',expires_in:3600,org_id:'org_SYNTHETIC'}:url.includes('/init')?{code:0,data:{flow_id:'SYNTHETIC_FLOW',authorize_url:'https://zcode.z.ai/authorize?flow=SYNTHETIC',poll_interval_sec:1}}:{code:0,data:{status:'ready',token:'SYNTHETIC_DEVICE_TOKEN',user:{user_id:'SYNTHETIC_USER'}}};res.emit('data',Buffer.from(JSON.stringify(value)));res.emit('end')});return req};`);
  fs.writeFileSync(parent, `const {disableNetwork}=require(${JSON.stringify(require.resolve('../../src/m1/policy'))});const {runDeviceLogin}=require(${JSON.stringify(require.resolve('../../src/quota/provider-device-login'))});const {fork}=require('node:child_process');const audit={networkAttempts:0};disableNetwork(audit);let urls=0;(async()=>{for(const adapter of ['zcode-device','opencode-zen']){const v=await runDeviceLogin(adapter,new AbortController().signal,async()=>{urls++},{forkProcess:(file,args,options)=>fork(file,args,{...options,execArgv:['--require',${JSON.stringify(preload)}]})});if(v.credential!==(adapter==='zcode-device'?'SYNTHETIC_DEVICE_TOKEN':'SYNTHETIC_CONSOLE_ACCESS'))throw Error('wrong token');}if(urls!==2||audit.networkAttempts!==0)throw Error('network boundary failed');console.log('PASS: IPC authorization; parent network attempts zero')})().catch(()=>{process.exitCode=1});`);
  const result = spawnSync(process.execPath, [parent], { encoding: 'utf8', timeout: 15000, windowsHide: true }); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /parent network attempts zero/); assert(!result.stdout.includes('SYNTHETIC_DEVICE_TOKEN'));
  const controller = new AbortController(); let opened = 0;
  await assert.rejects(runDeviceLogin('zcode-device', controller.signal, async () => { opened++; controller.abort(); }, { forkProcess: (file, args, options) => fork(file, args, { ...options, execArgv: ['--require', preload] }) }), /CANCELED/); assert.equal(opened, 1);
});

test('Console device login handles pending/slowdown, binds selected org and never fetches configuration or models', async () => {
  const calls = [], waits = []; let at = Date.now(), polls = 0;
  const result = await loginConsole(new AbortController().signal, async url => { assert.match(url, /^https:\/\/opencode.ai\/console\//); }, { now: () => at, sleep: async ms => { waits.push(ms); at += ms; }, send: async (operation, body) => { calls.push({ operation, body }); if (operation === 'init') return { device_code: 'SYNTHETIC_DEVICE', verification_uri_complete: '/console/auth/device?code=SYNTHETIC', expires_in: 300, interval: 1 }; if (++polls === 1) return { error: 'authorization_pending' }; if (polls === 2) return { error: 'slow_down' }; return { access_token: 'SYNTHETIC_ACCESS', refresh_token: 'SYNTHETIC_OWN_REFRESH', expires_in: 3600, org_id: 'org_SYNTHETIC' }; } });
  assert.equal(result.context.console.orgId, 'org_SYNTHETIC'); assert.equal(result.context.deviceGrant, true); assert.equal(result.context.oauth.clientId, 'opencode-cli'); assert.deepEqual(waits, [1000, 1000, 6000]); assert(calls.every(row => ['init', 'poll'].includes(row.operation))); assert.equal(calls[0].body.supports_org_scope, true);
  assert.throws(() => consoleAuthURL('https://opencode.ai.evil.invalid/console/'), /LOGIN_FAILED/); assert.throws(() => consoleAuthURL('https://opencode.ai/other'), /LOGIN_FAILED/);
  await assert.rejects(loginConsole(new AbortController().signal, async () => {}, { sleep: async () => {}, send: async operation => operation === 'init' ? { device_code: 'SYNTHETIC_DEVICE', verification_uri_complete: '/console/auth/device', expires_in: 300, interval: 1 } : operation === 'poll' ? { access_token: 'SYNTHETIC_ACCESS', refresh_token: 'SYNTHETIC_REFRESH', expires_in: 3600 } : [{ id: 'org_ONE' }, { id: 'org_TWO' }] }), /ORGANIZATION_REQUIRED/);
});

test('Zen keeps exact signed prepaid balance separate from available credit and Go windows', () => {
  const at = new Date().toISOString(), result = fromProvider('opencode-zen', quotaJSON('{"balanceMicroCents":9007199254740993,"availableMicroCents":"999999999999999999"}'), at); assert.equal(result.pools[0].balances[0].remaining, '90071992.54740993'); assert.equal(result.pools[0].windows.length, 0); assert.equal(result.incomplete, true);
  const debt = fromProvider('opencode-zen', quotaJSON('{"balanceMicroCents":-125000000}'), at).pools[0].balances[0]; assert.equal(debt.used, '1.25'); assert.equal(debt.remaining, null); assert.equal(debt.availability, 'unavailable'); assert.throws(() => fromProvider('opencode-zen', { availableMicroCents: '1' }, at), /RESPONSE_INVALID/);
});

test('only owned Console grants persist encrypted and renew through fixed JSON endpoint without changing org', async t => {
  const root = fixture(t), value = consoleCredentials({ access_token: 'SYNTHETIC_ACCESS', refresh_token: 'SYNTHETIC_OWN_REFRESH', expires_in: 60 }, 'org_SYNTHETIC');
  const storage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s).map(b => b ^ 127), decryptString: b => b.map(x => x ^ 127).toString() }, store = new ProviderSecretStore(root, storage, { platform: 'win32' });
  const id = '11111111-2222-4333-8444-555555555555'; store.put(id, 'opencode-zen', value.credential, value.expiresAt, value.context); assert(!fs.readFileSync(store.file(id)).includes(Buffer.from('SYNTHETIC_OWN_REFRESH'))); store.now = () => Date.now() + 120000; assert(store.get(id, 'opencode-zen'));
  let requestBody, changed = false; const post = (url, options, callback) => { assert.equal(url, 'https://opencode.ai/console/auth/device/token'); assert.equal(options.headers['Content-Type'], 'application/json'); const req = new EventEmitter(); req.destroy = () => {}; req.end = body => { requestBody = JSON.parse(body); setImmediate(() => { const res = new EventEmitter(); res.statusCode = 200; res.destroy = () => {}; callback(res); res.emit('data', Buffer.from(JSON.stringify({ access_token: 'SYNTHETIC_NEW', expires_in: 3600, org_id: changed ? 'org_CHANGED' : 'org_SYNTHETIC' }))); res.emit('end'); }); }; return req; };
  const grant = { clientId: 'opencode-cli', orgId: 'org_SYNTHETIC' }; const renewed = await renewOAuth('opencode-zen', value.context.oauth.refreshToken, grant, { signal: new AbortController().signal, post }); assert.equal(renewed.refreshToken, value.context.oauth.refreshToken); assert.equal(requestBody.grant_type, 'refresh_token'); changed = true; await assert.rejects(renewOAuth('opencode-zen', value.context.oauth.refreshToken, grant, { signal: new AbortController().signal, post }), /ACCOUNT_CHANGED/);
});
