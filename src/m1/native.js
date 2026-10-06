'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
function binary() { return path.join(path.dirname(require.resolve('@tokscale/cli-win32-x64-msvc/package.json')), 'bin', 'tokscale.exe').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1'); }
async function verifyProjection(records, directory, onSpawn = () => {}) {
  // tokscale keeps a per-path source-message cache that assumes append-only
  // transcripts; a record leaving the rewritten projection stays cached and every
  // later check mismatches. Each check therefore runs in its own fresh directory.
  fs.mkdirSync(directory, { recursive: true });
  const run = fs.mkdtempSync(path.join(directory, 'native-'));
  try { return await verifyIn(records, run, onSpawn); } finally { fs.rmSync(run, { recursive: true, force: true }); }
}
async function verifyIn(records, directory, onSpawn) {
  const home = path.join(directory, 'projection');
  const project = path.join(home, '.claude', 'projects', 'statistics-only'); fs.mkdirSync(project, { recursive: true });
  const file = path.join(project, 'usage.jsonl');
  const eligible = records.filter(r => r.totalTokens >= 0);
  // Canonical statistics-only transcript. No original paths, titles, bodies,
  // accounts or tokens. Native process cannot inherit provider environments.
  fs.writeFileSync(file, eligible.map(r => JSON.stringify({
    type: 'assistant', uuid: r.id, sessionId: 'm1-projection', timestamp: r.timestamp,
    message: { id: r.id, role: 'assistant', model: 'm1-statistical-projection', usage: { input_tokens: r.totalTokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  })).join('\n') + '\n', { mode: 0o600 });
  const env = {
    SystemRoot: process.env.SystemRoot || 'C:\\Windows', WINDIR: process.env.WINDIR || 'C:\\Windows',
    TEMP: path.join(directory, 'tmp'), TMP: path.join(directory, 'tmp'),
    TOKSCALE_CONFIG_DIR: path.join(directory, 'tokscale'), TOKSCALE_PRICING_CACHE_ONLY: '1', NO_COLOR: '1'
  };
  fs.mkdirSync(env.TEMP, { recursive: true }); fs.mkdirSync(env.TOKSCALE_CONFIG_DIR, { recursive: true });
  const text = await new Promise((resolve, reject) => {
    const child = spawn(binary(), ['--json', '--client', 'claude', '--home', home, '--no-spinner'], { env, windowsHide: true, cwd: home, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) onSpawn(child.pid);
    let stdout = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('NATIVE_TIMEOUT')); }, 60000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 10 * 1024 * 1024) { child.kill(); reject(new Error('NATIVE_OUTPUT_LIMIT')); } });
    child.stderr.on('data', () => {});
    child.on('error', () => { clearTimeout(timer); reject(new Error('NATIVE_UNAVAILABLE')); });
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(stdout); else reject(new Error('NATIVE_FAILED')); });
  });
  const parsed = JSON.parse(text);
  if (!['totalInput', 'totalOutput', 'totalCacheRead', 'totalCacheWrite'].every(key => Number.isSafeInteger(parsed[key]) && parsed[key] >= 0)) throw new Error('NATIVE_SCHEMA_MISMATCH');
  const expected = eligible.reduce((sum, r) => sum + r.totalTokens, 0);
  const actual = ['totalInput', 'totalOutput', 'totalCacheRead', 'totalCacheWrite'].reduce((sum, key) => sum + (parsed[key] ?? 0), 0);
  if (actual !== expected) throw new Error('NATIVE_TOTAL_MISMATCH');
  return { status: 'passed', records: eligible.length, tokens: actual, engine: 'tokscale/4.17.0' };
}
module.exports = { binary, verifyProjection };
