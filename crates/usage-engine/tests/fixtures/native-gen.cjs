'use strict';
// Regenerates native-expected.json: runs the SHA-256-pinned tokscale.exe 4.17.0
// (resolved through src/m1/native, so node_modules/@tokscale/cli-win32-x64-msvc
// must be installed) over synthetic canonical transcripts and records the wire
// bytes plus the engine totals the Rust inline core must reproduce.
// Usage: node crates/usage-engine/tests/fixtures/native-gen.cjs <repo-root> <out-dir>
// then copy <out-dir>/native-expected.json over this directory's fixture.
// All homes, names and records are invented; the 'nan' row uses the string
// "NaN" because JSON cannot carry NaN and both runtimes skip it identically.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { binary, trustedBinary, TOKSCALE } = require(path.join(process.argv[2], 'src/m1/native'));
trustedBinary();
const out = process.argv[3];

function wire(rows) {
  let text = '', eligible = 0, expected = 0;
  for (const r of rows) {
    if (!(r.totalTokens >= 0)) continue;
    eligible++; expected += r.totalTokens;
    text += JSON.stringify({ type: 'assistant', uuid: r.id, sessionId: 'm1-projection', timestamp: r.timestamp, message: { id: r.id, role: 'assistant', model: 'm1-statistical-projection', usage: { input_tokens: r.totalTokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n';
  }
  if (!eligible) text = '\n';
  return { text, eligible, expected };
}
function run(rows) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(out, 'run-'));
    const home = path.join(dir, 'projection');
    const project = path.join(home, '.claude', 'projects', 'statistics-only');
    fs.mkdirSync(project, { recursive: true });
    const { text, eligible, expected } = wire(rows);
    fs.writeFileSync(path.join(project, 'usage.jsonl'), text);
    const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: path.join(dir, 'tmp'), TMP: path.join(dir, 'tmp'), TOKSCALE_CONFIG_DIR: path.join(dir, 'tokscale'), TOKSCALE_PRICING_CACHE_ONLY: '1', NO_COLOR: '1' };
    fs.mkdirSync(env.TEMP, { recursive: true }); fs.mkdirSync(env.TOKSCALE_CONFIG_DIR, { recursive: true });
    const child = spawn(binary(), ['--json', '--client', 'claude', '--home', home, '--no-spinner'], { env, windowsHide: true, cwd: home, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', c => stdout += c);
    child.stderr.on('data', () => {});
    child.on('close', code => {
      fs.rmSync(dir, { recursive: true, force: true });
      if (code !== 0) return reject(new Error('exe exit ' + code));
      const parsed = JSON.parse(stdout);
      resolve({ wireSha256: crypto.createHash('sha256').update(text).digest('hex'), wireBytes: Buffer.byteLength(text), eligible, expected, totals: { totalInput: parsed.totalInput, totalOutput: parsed.totalOutput, totalCacheRead: parsed.totalCacheRead, totalCacheWrite: parsed.totalCacheWrite }, totalMessages: parsed.totalMessages, entries: parsed.entries });
    });
  });
}
const T = '2026-11-10T00:00:00Z';
const row = (id, totalTokens, timestamp = T) => ({ id, timestamp, totalTokens });
const cases = {
  basic: [row('r1', 120), row('r2', 300, '2026-11-11T00:00:00Z'), row('zero', 0, '2026-11-11T00:00:00Z')],
  empty: [],
  'only-zero': [row('z1', 0), row('z2', 0)],
  excluded: [row('neg', -1), row('null', null), { id: 'missing', timestamp: T }, row('nan', 'NaN'), row('ok', 50)],
  'js-test-401': Array.from({ length: 400 }, (_, i) => row('synthetic-' + i, i + 1, '2026-11-04T00:00:00Z')).concat([row('zero', 0, '2026-11-04T00:00:00Z'), row('excluded', -1, '2026-11-04T00:00:00Z')]),
  'max-safe': [row('big', 9007199254740991)],
  'duplicate-uuid': [row('same', 100), row('same', 200)],
  'fractional-time': [row('f1', 10, '2026-11-10T00:00:00.123Z'), row('f2', 20, '2026-11-10T01:02:03.456+08:00')],
  'unicode-id': [row('会话-α', 7), row('id with space', 9)],
  'non-string-id': [{ id: 42, timestamp: T, totalTokens: 5 }, { id: null, timestamp: T, totalTokens: 6 }]
};
(async () => {
  const results = { engine: 'tokscale/' + TOKSCALE.version, sha256: TOKSCALE.sha256, cases: {} };
  for (const [name, rows] of Object.entries(cases)) {
    results.cases[name] = { rows, ...(await run(rows)) };
    console.log(name, 'records', results.cases[name].eligible, 'tokens', results.cases[name].expected, 'messages', results.cases[name].totalMessages);
  }
  fs.writeFileSync(path.join(out, 'native-expected.json'), JSON.stringify(results, null, 1));
})().catch(e => { console.error(e); process.exit(1); });