'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { fingerprint } = require('../../src/quota/executable-pin');
const { runWindowsJob, runWindowsInstallerJob } = require('../../src/quota/windows-job');
const { remove } = require('./temp');
// Minimal stored ZIP fixture, independent of installed archive tools.
function zip(name, text) {
  const file = Buffer.from(name), bytes = Buffer.from(text); let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(file.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(file.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + file.length, 12); end.writeUInt32LE(local.length + file.length + bytes.length, 16);
  return Buffer.concat([local, file, bytes, central, file, end]);
}
test('Windows installer profile allows bounded long tasks while quota profile retains 30 seconds; real helper extracts and rejects traversal', { skip: process.platform !== 'win32' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '安装 helper with spaces-')); t.after(() => remove(root));
  const options = { cwd: root, timeoutMs: 30001, maxOutputBytes: 65536, env: { SystemRoot: process.env.SystemRoot, TEMP: root, TMP: root } };
  const pin = fingerprint(process.execPath);
  assert.equal((await runWindowsJob(pin, ['--version'], options)).errorCode, 'JOB_REQUEST_INVALID');
  const accepted = await runWindowsInstallerJob(pin, ['--version'], options); assert.equal(accepted.code, 0); assert.equal(accepted.reaped, true);
  const helper = path.resolve('src/quota/agent-install-host.ps1'), powerShell = fingerprint(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'));
  async function expand(name, entry) {
    const source = path.join(root, name + '.zip'), destination = path.join(root, name), input = path.join(root, name + '.json'); fs.writeFileSync(source, zip(entry, 'SYNTHETIC'));
    fs.writeFileSync(input, JSON.stringify({ source, destination }));
    return runWindowsInstallerJob(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helper, '-Mode', 'expand', '-InputFile', input], options);
  }
  const valid = await expand('valid', 'node/bin.txt'); assert.equal(valid.code, 0, valid.stderr); assert.equal(valid.reaped, true); assert.equal(fs.readFileSync(path.join(root, 'valid/node/bin.txt'), 'utf8'), 'SYNTHETIC');
  const nested = Array.from({ length: 12 }, () => 'long-directory-1234567890').join('/') + '/file.txt';
  const long = await expand('long', nested); assert.equal(long.code, 0, long.stderr); assert.equal(fs.readFileSync(path.join(root, 'long', nested), 'utf8'), 'SYNTHETIC');
  const invalid = await expand('invalid', '../escape.txt'); assert.notEqual(invalid.code, 0); assert.equal(invalid.reaped, true); assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
  // Exercise the exact local-tool P/Invoke definition against owned fixture
  // files. PowerShell converts a string $null to "", which is not a native NULL.
  const definition = fs.readFileSync(path.resolve('scripts/local/claude-governed/host.ps1'), 'utf8').match(/Add-Type -TypeDefinition '([^']+ClaudeNativeReplace[^']+)'/)[1];
  const target = path.join(root, 'current.bin'), staged = path.join(root, 'replacement.bin'), input = path.join(root, 'replace.json'), script = path.join(root, 'replace.ps1');
  fs.writeFileSync(target, 'OLD'); fs.writeFileSync(staged, 'NEW'); fs.writeFileSync(input, JSON.stringify({ target, staged }));
  fs.writeFileSync(script, "param([string]$InputFile)\n$ErrorActionPreference='Stop'\n$r=[IO.File]::ReadAllText($InputFile)|ConvertFrom-Json\nAdd-Type -TypeDefinition '" + definition + "'\nif(![ClaudeNativeReplace]::ReplaceFile($r.target,$r.staged,[IntPtr]::Zero,0,[IntPtr]::Zero,[IntPtr]::Zero)){throw [Runtime.InteropServices.Marshal]::GetLastWin32Error()}\n[Console]::Out.WriteLine('REPLACED')");
  const replaced = await runWindowsInstallerJob(powerShell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', script, '-InputFile', input], options); assert.equal(replaced.code, 0, replaced.stderr); assert.equal(replaced.reaped, true); assert.equal(fs.readFileSync(target, 'utf8'), 'NEW'); assert.equal(fs.existsSync(staged), false);
});
