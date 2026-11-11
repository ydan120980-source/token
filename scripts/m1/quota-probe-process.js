'use strict';
// Development-only transport for synthetic protocol acceptance. The product
// must never import this module. A production Windows Job Object is not provided.
const { spawn } = require('node:child_process');
const path = require('node:path');
function runProbeProcess(executable, args, { cwd, env, signal, timeoutMs, maxOutputBytes }) {
  return new Promise(resolve => {
    if (signal?.aborted) return resolve({ code: null, signal: null, stdout: '', stderr: '', canceled: true, reaped: true });
    const output = { stdout: [], stderr: [] };
    let size = 0, timedOut = false, canceled = false, overflow = false, stopping = false, finished = false;
    let child, timer, reapTimer, killer, killerClosed = false;
    const done = (code, exitSignal, reaped) => {
      if (finished) return;
      if (reaped && killer && !killerClosed) { killer.once('close', () => done(code, exitSignal, reaped)); return; }
      finished = true; clearTimeout(timer); clearTimeout(reapTimer); signal?.removeEventListener('abort', abort);
      resolve({ code, signal: exitSignal, stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8'), timedOut, canceled, overflow, reaped });
    };
    const stop = () => {
      if (stopping || finished) return;
      stopping = true;
      if (process.platform === 'win32' && child.pid) {
        // No shell or caller-controlled PID/options; only the direct child tree.
        killer = spawn(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { child.kill(); });
        killer.once('close', () => { killerClosed = true; });
      } else child.kill('SIGKILL');
      reapTimer = setTimeout(() => { killer?.kill(); child.kill(); done(null, null, false); }, 3000);
    };
    const abort = () => { canceled = true; stop(); };
    try { child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch { done(null, null, true); return; }
    child.once('error', () => done(null, null, !child.pid));
    child.once('close', (code, exitSignal) => done(code, exitSignal, true));
    for (const channel of ['stdout', 'stderr']) child[channel].on('data', chunk => {
      if (finished || stopping) return;
      size += chunk.length;
      if (size > maxOutputBytes) { overflow = true; stop(); return; }
      output[channel].push(chunk);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  });
}
module.exports = { runProbeProcess };
