'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { checkPin } = require('./executable-pin');
const HOST_ERRORS = new Set(['JOB_BINARY_CHANGED', 'JOB_REQUEST_INVALID', 'JOB_HOST_UNAVAILABLE']);
const clean = (errorCode, extra = {}) => ({ code: null, signal: null, stdout: '', stderr: '', timedOut: false, canceled: false, overflow: false, reaped: false, errorCode, ...extra });
// The host's C# is compiled once per source and kept per user: a read starts no compiler. A missing or
// unusable copy only costs a compile (windows-job-host.ps1), never the read.
const hostDirectory = __dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
let compiled = null;
function hostAssembly() {
  if (compiled !== null) return compiled;
  try {
    const name = createHash('sha256').update(fs.readFileSync(path.join(hostDirectory, 'windows-job-host.cs'))).digest('hex').slice(0, 32);
    const directory = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'AgentUsage', 'job-host'); fs.mkdirSync(directory, { recursive: true });
    compiled = path.join(directory, name + '.dll');
    for (const file of fs.readdirSync(directory)) if (!file.startsWith(name)) { try { fs.rmSync(path.join(directory, file), { force: true }); } catch { /* In use by a read still running. */ } }
  } catch { compiled = ''; }
  return compiled;
}
function request(pin, args, options, maximumTimeout = 30000) {
  checkPin(pin);
  if (!Array.isArray(args) || args.length > 64 || args.some(v => typeof v !== 'string' || /\0/.test(v)) || args.join('').length > 16000 || !path.isAbsolute(options.cwd) || !fs.statSync(options.cwd).isDirectory() || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > maximumTimeout || !Number.isInteger(options.maxOutputBytes) || options.maxOutputBytes < 1 || options.maxOutputBytes > 524288) throw new Error('JOB_REQUEST_INVALID');
  // Explicit environment only. No process.env merge for the target program.
  const environment = Object.entries(options.env || {});
  if (environment.length > 64 || environment.some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string' || /\0/.test(value)) || new Set(environment.map(([key]) => key.toLowerCase())).size !== environment.length) throw new Error('JOB_REQUEST_INVALID');
  const value = { executable: pin.executable, sha256: pin.sha256, arguments: args, cwd: options.cwd, environment: environment.map(([key, value]) => key + '=' + value), parentPid: process.pid, timeoutMs: options.timeoutMs, maxOutputBytes: options.maxOutputBytes };
  if (options.interactive === true) { if (maximumTimeout !== 600000) throw new Error('JOB_REQUEST_INVALID'); value.interactive = true; }
  if (options.onAuthUrl !== undefined) { if (options.interactive !== true || typeof options.onAuthUrl !== 'function') throw new Error('JOB_REQUEST_INVALID'); value.authBrowser = true; }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 131072) throw new Error('JOB_REQUEST_INVALID');
  return value;
}
function runJob(pin, args, options = {}, maximumTimeout = 30000) {
  if (process.platform !== 'win32') return Promise.resolve(clean('JOB_PLATFORM_UNSUPPORTED'));
  if (options.signal?.aborted) return Promise.resolve(clean(null, { canceled: true, reaped: true }));
  let input;
  try { input = request(pin, args, options, maximumTimeout); } catch (error) { return Promise.resolve(clean(HOST_ERRORS.has(error.message) ? error.message : 'JOB_REQUEST_INVALID', { reaped: true })); }
  return new Promise(resolve => {
    let child, finished = false, canceled = false, forced = false, timedOut = false, overflow = false, timer, reapTimer;
    let bytes = 0, frameBuffer = Buffer.alloc(0), resultFrame = null, invalidFrame = false, browserStarted = false, browserFailure = null, browserTask = Promise.resolve(), childClosed = false;
    const hostLimit = 6 * options.maxOutputBytes + 65536;
    const done = result => {
      if (finished) return; finished = true; clearTimeout(timer); clearTimeout(reapTimer); options.signal?.removeEventListener('abort', abort); if (browserFailure) result.browserError = browserFailure; resolve(result);
    };
    const stop = () => { if (forced || finished) return; forced = true; child.kill(); clearTimeout(reapTimer); reapTimer = setTimeout(() => done(clean('JOB_CLEANUP_UNCONFIRMED', { canceled, timedOut, overflow })), 3000); };
    const abort = () => { if (!canceled && !finished) { canceled = true; child.stdin.write('cancel\n'); reapTimer = setTimeout(stop, 5000); } };
    // Windows PowerShell is an explicit platform prerequisite. No profile,
    // ExecutionPolicy override, command interpolation, or fallback to a shell.
    const helper = path.join(hostDirectory, 'windows-job-host.ps1');
    const executable = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const hostEnv = Object.fromEntries(['SystemRoot', 'SystemDrive', 'TEMP', 'TMP'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    if (hostAssembly()) hostEnv.AGENTUSAGE_JOB_ASSEMBLY = hostAssembly();
    try { child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper], { env: hostEnv, cwd: options.cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { done(clean('JOB_HOST_UNAVAILABLE', { reaped: true })); return; }
    child.on('error', () => done(clean('JOB_HOST_UNAVAILABLE', { reaped: !child.pid })));
    child.stdin.on('error', () => {});
    const frame = line => {
      if (!line.toString('utf8').trim()) return;
      try {
        const value = JSON.parse(line.toString('utf8'));
        if (value.schemaVersion === 'WindowsJobAuthUrlV1' && Object.keys(value).sort().join(',') === 'schemaVersion,url' && input.authBrowser && !browserStarted && !resultFrame && typeof value.url === 'string' && value.url.length <= 16384) {
          browserStarted = true;
          browserTask = Promise.resolve().then(() => { if (finished || childClosed || canceled || options.signal?.aborted) return; return options.onAuthUrl(value.url); }).catch(error => { browserFailure = ['PROVIDER_CHROME_MISSING', 'PROVIDER_BROWSER_FAILED', 'PROVIDER_RESPONSE_INVALID'].includes(error?.message) ? error.message : 'PROVIDER_BROWSER_FAILED'; abort(); });
        } else if (value.schemaVersion === 'WindowsJobResultV1' && !resultFrame) resultFrame = value;
        else invalidFrame = true;
      } catch { invalidFrame = true; }
    };
    child.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > hostLimit) { if (!overflow) { overflow = true; stop(); } return; }
      frameBuffer = Buffer.concat([frameBuffer, chunk]); let end;
      while ((end = frameBuffer.indexOf(10)) >= 0) { frame(frameBuffer.subarray(0, end)); frameBuffer = frameBuffer.subarray(end + 1); }
    });
    // Host diagnostics are never returned. Compiler/policy errors are not
    // provider stderr and can contain local paths.
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > hostLimit && !overflow) { overflow = true; stop(); } });
    child.once('close', async () => {
      childClosed = true; frame(frameBuffer);
      await browserTask;
      if (forced || timedOut || overflow) { done(clean('JOB_CLEANUP_UNCONFIRMED', { canceled, timedOut, overflow })); return; }
      try {
        if (invalidFrame || !resultFrame) throw new Error(); const value = resultFrame;
        if (value.schemaVersion !== 'WindowsJobResultV1' || typeof value.stdout !== 'string' || typeof value.stderr !== 'string' || typeof value.reaped !== 'boolean' || Buffer.byteLength(value.stdout, 'utf8') + Buffer.byteLength(value.stderr, 'utf8') > options.maxOutputBytes) throw new Error();
        if (value.errorCode) { done(clean(HOST_ERRORS.has(value.errorCode) ? value.errorCode : 'JOB_HOST_UNAVAILABLE', { reaped: value.reaped })); return; }
        done({ code: Number.isInteger(value.code) ? value.code : null, signal: null, stdout: value.stdout, stderr: value.stderr, timedOut: value.timedOut === true, canceled: canceled || value.canceled === true, overflow: value.overflow === true, reaped: value.reaped, errorCode: HOST_ERRORS.has(value.errorCode) ? value.errorCode : value.parentExited ? 'JOB_OWNER_EXITED' : null });
      } catch { done(clean('JOB_HOST_UNAVAILABLE')); }
    });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    // Includes compiler/startup overhead; C# has its own target-only deadline.
    timer = setTimeout(() => { timedOut = true; stop(); }, options.timeoutMs + 15000);
    child.stdin.write(JSON.stringify(input) + '\n');
  });
}
const runWindowsJob = (pin, args, options) => runJob(pin, args, options, 30000);
// Installation is an explicit different capability. Quota probes keep 30 seconds.
const runWindowsInstallerJob = (pin, args, options) => runJob(pin, args, options, 600000);
const runWindowsLoginJob = (pin, args, options) => runJob(pin, args, { ...options, interactive: true }, 600000);
module.exports = { runWindowsJob, runWindowsInstallerJob, runWindowsLoginJob };
