'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { fingerprint, checkPin } = require('../../src/quota/executable-pin');
const { runWindowsJob, runWindowsLoginJob } = require('../../src/quota/windows-job');
const { pinnedAntigravityRun } = require('../../src/quota/antigravity-windows-run');
const { inspectAntigravity } = require('../../src/quota/antigravity-probe');
const { response, NOW } = require('./fixtures/antigravity-quota');
const { remove } = require('./temp');
const fixture = path.join(__dirname, 'fixtures/job-process-child.js');
const ownerFixture = path.join(__dirname, 'fixtures/job-process-owner.js');
const env = Object.fromEntries(['SystemRoot', 'SystemDrive', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
function setup(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), '作业进程 with spaces-'));
  t.after(() => remove(cwd));
  return { cwd, env, timeoutMs: 5000, maxOutputBytes: 4096 };
}
async function until(read, description, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('timeout: ' + description);
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
function read(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function windows(t) { if (process.platform !== 'win32') { t.skip('Windows Job Objects'); return false; } return true; }

test('executable pin rejects replacement and symlinks while preserving sensitive bytes', t => {
  const { cwd } = setup(t), file = path.join(cwd, 'selected.exe');
  fs.writeFileSync(file, 'SYNTHETIC_PROGRAM_A'); const pin = fingerprint(file); assert.deepEqual(checkPin(pin), pin);
  fs.writeFileSync(file, 'SYNTHETIC_PROGRAM_B'); assert.throws(() => checkPin(pin), /JOB_BINARY_CHANGED/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'SYNTHETIC_PROGRAM_B');
  assert.throws(() => fingerprint(path.join(cwd, 'missing.exe')), /^Error: JOB_BINARY_UNAVAILABLE$/);
  if (process.platform === 'win32') {
    const junction = path.join(cwd, 'alias'); fs.symlinkSync(cwd, junction, 'junction');
    assert.throws(() => fingerprint(path.join(junction, 'selected.exe')), /JOB_BINARY_UNAVAILABLE/);
    fs.unlinkSync(junction);
  }
});
test('executable pin keeps a finite 512 MiB image limit for current native CLI releases', t => {
  const { cwd } = setup(t), file = path.join(cwd, 'bounded.exe'); fs.writeFileSync(file, 'FIXTURE'); const original = fs.fstatSync;
  t.mock.method(fs, 'fstatSync', (...args) => { const result = original(...args); return args[1]?.bigint ? { ...result, size: 513n * 1024n * 1024n } : result; });
  assert.throws(() => fingerprint(file), /JOB_BINARY_UNAVAILABLE/); assert.equal(fs.readFileSync(file, 'utf8'), 'FIXTURE');
});
test('Job host preserves Unicode and shell metacharacter arguments, with bounded success and no profile inheritance', async t => {
  if (!windows(t)) return; const options = setup(t);
  const args = ['a b', '中文', '"quoted"', 'tail\\', '', '$(echo SECRET)', '&'];
  const result = await runWindowsJob(fingerprint(process.execPath), [fixture, 'args', ...args], options);
  assert.equal(result.errorCode, null); assert.equal(result.code, 0); assert.equal(result.reaped, true); assert.deepEqual(JSON.parse(result.stdout), args);
  const previous = process.env.QUOTA_SYNTHETIC_SECRET; process.env.QUOTA_SYNTHETIC_SECRET = 'SYNTHETIC_ONLY';
  try {
    const childEnv = await runWindowsJob(fingerprint(process.execPath), [fixture, 'env'], options);
    assert.equal(childEnv.reaped, true); assert(!JSON.parse(childEnv.stdout).includes('QUOTA_SYNTHETIC_SECRET'));
  } finally { if (previous === undefined) delete process.env.QUOTA_SYNTHETIC_SECRET; else process.env.QUOTA_SYNTHETIC_SECRET = previous; }
  assert.deepEqual(fs.readdirSync(options.cwd), []);
});

test('official login capability owns a real Windows console, captures no terminal secrets, and reaps on cancellation', async t => {
  if (!windows(t)) return; const options = setup(t), report = path.join(options.cwd, 'interactive.json');
  const script = 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({tty:!!process.stdin.isTTY,pid:process.pid}));console.log("SYNTHETIC_TERMINAL_SECRET");setInterval(()=>{},1000)';
  const controller = new AbortController(), pending = runWindowsLoginJob(fingerprint(process.execPath), ['-e', script, report], { ...options, signal: controller.signal });
  const value = await until(() => read(report), 'owned interactive console'); assert.equal(value.tty, true); controller.abort();
  const result = await pending; assert.equal(result.canceled, true); assert.equal(result.reaped, true); assert.equal(result.stdout, ''); assert.equal(result.stderr, ''); await until(() => !alive(value.pid), 'interactive cancellation reaped');
});
test('owned login console hands off a complete soft-wrapped Google authorization URL once without returning terminal data', async t => {
  if (!windows(t)) return; const options = setup(t), controller = new AbortController();
  const query = new URLSearchParams({ client_id: 'SYNTHETIC-CLIENT.apps.googleusercontent.com', redirect_uri: 'https://antigravity.google/oauth-callback', response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email', state: 's'.repeat(32) });
  const url = 'https://accounts.google.com/o/oauth2/auth?' + query, handed = [];
  const script = 'console.log("SYNTHETIC_TERMINAL_SECRET");console.log(process.argv[1]);setInterval(()=>{},1000)';
  const result = await runWindowsLoginJob(fingerprint(process.execPath), ['-e', script, url], { ...options, signal: controller.signal, onAuthUrl: async value => { handed.push(require('../../src/quota/google-cli-auth-url').googleCliAuthURL(value)); controller.abort(); } });
  assert.deepEqual(handed, [url]); assert.equal(result.canceled, true); assert.equal(result.reaped, true); assert.equal(result.stdout, ''); assert.equal(result.stderr, ''); assert(!JSON.stringify(result).includes('SYNTHETIC_TERMINAL_SECRET')); assert(!JSON.stringify(result).includes('code_challenge'));
});
test('login handoff follows a same-pinned-image descendant console inside its own Job', async t => {
  if (!windows(t)) return; const options = setup(t), controller = new AbortController();
  const url = 'https://accounts.google.com/o/oauth2/auth?' + new URLSearchParams({ client_id: 'SYNTHETIC-CLIENT.apps.googleusercontent.com', redirect_uri: 'https://antigravity.google/oauth-callback', response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', scope: 'openid', state: 's'.repeat(32) });
  const child = 'console.log(process.argv[1]);setInterval(()=>{},1000)', handed = [];
  const script = `const {runWindowsLoginJob}=require(${JSON.stringify(require.resolve('../../src/quota/windows-job'))});const {fingerprint}=require(${JSON.stringify(require.resolve('../../src/quota/executable-pin'))});runWindowsLoginJob(fingerprint(process.execPath),['-e',${JSON.stringify(child)},${JSON.stringify(url)}],${JSON.stringify({ cwd: options.cwd, env: options.env, timeoutMs: 10000, maxOutputBytes: 4096 })}).then(()=>{});`;
  const result = await runWindowsLoginJob(fingerprint(process.execPath), ['-e', script], { ...options, timeoutMs: 10000, signal: controller.signal, onAuthUrl: async value => { handed.push(value); controller.abort(); } });
  assert.deepEqual(handed, [url]); assert.equal(result.canceled, true); assert.equal(result.reaped, true); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});
test('interactive padded URL rows preserve every encoded parameter before the Chrome handoff', async t => {
  if (!windows(t)) return; const options = setup(t), controller = new AbortController();
  const url = 'https://accounts.google.com/o/oauth2/auth?' + new URLSearchParams({ client_id: 'SYNTHETIC-CLIENT.apps.googleusercontent.com', redirect_uri: 'https://antigravity.google/oauth-callback', response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', scope: 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email', state: 's'.repeat(32) });
  const script = 'const width=process.stdout.columns-2,u=process.argv[1];for(let i=0;i<u.length;i+=width)console.log(" "+u.slice(i,i+width)+" ");console.log(" NON_URL_PROMPT ");console.log(" "+"─".repeat(width)+" ");console.log(" Paste authorization code: ");setInterval(()=>{},1000)', handed = [];
  const result = await runWindowsLoginJob(fingerprint(process.execPath), ['-e', script, url], { ...options, signal: controller.signal, onAuthUrl: async value => { handed.push(require('../../src/quota/google-cli-auth-url').googleCliAuthURL(value)); controller.abort(); } });
  assert.deepEqual(handed, [url]); assert.equal(result.canceled, true); assert.equal(result.reaped, true); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});
test('normal root exit cleans detached descendants rather than accepting an orphan', async t => {
  if (!windows(t)) return; const options = setup(t), report = path.join(options.cwd, 'tree.json');
  const result = await runWindowsJob(fingerprint(process.execPath), [fixture, 'orphan', report], options);
  const tree = read(report); assert(tree?.descendant); assert.equal(result.code, 0); assert.equal(result.reaped, true);
  await until(() => !alive(tree.root) && !alive(tree.descendant), 'normal-exit tree reaped');
});
test('native timeout, output flood and cooperative cancel report cleanup, not just a killed helper', async t => {
  if (!windows(t)) return; const options = setup(t), pin = fingerprint(process.execPath);
  const timeout = await runWindowsJob(pin, [fixture, 'hang'], { ...options, timeoutMs: 150 });
  assert.equal(timeout.timedOut, true); assert.equal(timeout.reaped, true);
  const flood = await runWindowsJob(pin, [fixture, 'flood'], { ...options, maxOutputBytes: 1024 });
  assert.equal(flood.overflow, true); assert.equal(flood.reaped, true); assert(Buffer.byteLength(flood.stderr, 'utf8') <= 1024);
  const controller = new AbortController(), report = path.join(options.cwd, 'tree.json');
  const pending = runWindowsJob(pin, [fixture, 'tree', report], { ...options, signal: controller.signal });
  const tree = await until(() => read(report), 'cancellation tree starts'); controller.abort();
  const canceled = await pending; assert.equal(canceled.canceled, true); assert.equal(canceled.reaped, true);
  await until(() => !alive(tree.root) && !alive(tree.descendant), 'cancellation tree reaped');
});
test('force-killing the helper or its Node owner still reaps the entire created job', async t => {
  if (!windows(t)) return;
  for (const crash of ['helper', 'owner']) {
    const options = setup(t);
    const owner = spawn(process.execPath, [ownerFixture, options.cwd, 'tree'], { env, cwd: options.cwd, shell: false, windowsHide: true, stdio: 'ignore' });
    t.after(() => { if (owner.exitCode === null) owner.kill(); });
    const metadata = await until(() => read(path.join(options.cwd, 'owner.json')), 'owner metadata');
    const tree = await until(() => read(path.join(options.cwd, 'tree.json')), 'crash tree starts');
    process.kill(metadata[crash]);
    await until(() => !alive(tree.root) && !alive(tree.descendant), 'job survives owner/host crash cleanup');
    await until(() => !alive(metadata.helper), 'helper exits after owner lifetime');
  }
});
test('pinned image stays locked against writes for the invocation and is released afterward', async t => {
  if (!windows(t)) return; const options = setup(t), executable = path.join(options.cwd, 'selected.exe'), report = path.join(options.cwd, 'tree.json');
  fs.copyFileSync(process.execPath, executable); const pin = fingerprint(executable), controller = new AbortController();
  const pending = runWindowsJob(pin, [fixture, 'tree', report], { ...options, signal: controller.signal });
  const tree = await until(() => read(report), 'pinned image starts');
  assert.throws(() => fs.writeFileSync(executable, 'REPLACED'));
  controller.abort(); assert.equal((await pending).reaped, true);
  await until(() => !alive(tree.root) && !alive(tree.descendant), 'pinned process tree exits', 3000);
  // Windows can retain the terminated image section briefly after all process handles close.
  // Keep the in-flight denial above immediate; bound the post-exit write observation separately.
  await until(() => {
    try { fs.writeFileSync(executable, 'REPLACED'); return true; }
    catch (error) { if (!['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error; return false; }
  }, 'exited image becomes writable', 3000);
  assert.throws(() => checkPin(pin), /JOB_BINARY_CHANGED/);
  const rejected = await runWindowsJob(pin, [fixture, 'hang'], options); assert.equal(rejected.errorCode, 'JOB_BINARY_CHANGED'); assert.equal(rejected.reaped, true);
});
test('a compiled synthetic CLI exercises pinned version/usage through Job Objects, then rejects between-stage replacement', async t => {
  if (!windows(t)) return; const options = setup(t), executable = path.join(options.cwd, 'synthetic-agy.exe');
  const builder = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'fixtures/build-quota-cli.ps1'), '-OutputPath', executable, '-Payload', Buffer.from(JSON.stringify(response())).toString('base64')], { env, shell: false, windowsHide: true, stdio: 'ignore' });
  const code = await new Promise((resolve, reject) => { builder.on('error', reject); builder.on('close', resolve); }); assert.equal(code, 0);
  const pin = { ...fingerprint(executable) }, run = pinnedAntigravityRun(pin, options);
  const result = await inspectAntigravity({ executable, run, now: () => NOW }); assert.equal(result.ok, true); assert.equal(result.quota.pools.length, 2);
  let stages = 0;
  const changed = await inspectAntigravity({ executable, now: () => NOW, run: async (...args) => {
    const value = await run(...args); if (++stages === 1) { fs.appendFileSync(executable, 'REPLACEMENT'); Object.assign(pin, fingerprint(executable)); } return value;
  } });
  assert.equal(stages, 2); assert.equal(changed.errorCode, 'AGY_BINARY_CHANGED'); assert.equal(changed.quota, null);
  const refused = await run(executable, { args: ['-p', 'model prompt'], timeoutMs: 30000, maxOutputBytes: 524288 }); assert.equal(refused.errorCode, 'JOB_REQUEST_INVALID');
});
