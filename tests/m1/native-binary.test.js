'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TOKSCALE, binary, trustedBinary, verifyProjection } = require('../../src/m1/native');
const { remove } = require('./temp');

test('the installed tokscale binary is the pinned release', () => {
  // A tokscale upgrade must update TOKSCALE in src/m1/native.js together with the lockfile.
  assert.equal(require('@tokscale/cli-win32-x64-msvc/package.json').version, TOKSCALE.version);
  assert.match(TOKSCALE.sha256, /^[0-9a-f]{64}$/);
  assert.equal(trustedBinary(), binary());
});

test('a binary with other bytes or no binary at all is refused before spawn', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-native-binary-'));
  try {
    const tampered = path.join(dir, 'tokscale.exe');
    const original = fs.readFileSync(binary());
    const copy = Buffer.from(original); copy[copy.length - 1] ^= 1;
    fs.writeFileSync(tampered, copy);
    assert.throws(() => trustedBinary(tampered), { message: 'NATIVE_BINARY_MISMATCH' });
    fs.writeFileSync(tampered, original);
    assert.equal(trustedBinary(tampered), tampered);
    assert.throws(() => trustedBinary(path.join(dir, 'missing.exe')), { message: 'NATIVE_UNAVAILABLE' });
    assert.throws(() => trustedBinary(tampered, '0'.repeat(64)), { message: 'NATIVE_BINARY_MISMATCH' });
  } finally { await remove(dir); }
});

test('verification rejects a tampered binary without spawning it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-native-spawn-'));
  const target = binary(), read = fs.readFileSync, spawned = [];
  fs.readFileSync = (file, ...rest) => {
    const bytes = read(file, ...rest);
    if (path.resolve(String(file)) !== path.resolve(target)) return bytes;
    const copy = Buffer.from(bytes); copy[0] ^= 1; return copy;
  };
  try {
    await assert.rejects(verifyProjection([{ id: 'r', timestamp: '2026-10-10T00:00:00Z', totalTokens: 1 }], dir, pid => spawned.push(pid)), { message: 'NATIVE_BINARY_MISMATCH' });
    assert.deepEqual(spawned, []);
  } finally { fs.readFileSync = read; await remove(dir); }
});
