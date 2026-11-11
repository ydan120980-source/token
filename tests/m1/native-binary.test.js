'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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
  const target = binary(), open = fs.openSync, spawned = [], tampered=path.join(dir,'tampered.exe');
  const copy=fs.readFileSync(target);copy[0]^=1;fs.writeFileSync(tampered,copy);
  fs.openSync = (file, ...rest) => open(path.resolve(String(file))===path.resolve(target)?tampered:file,...rest);
  try {
    await assert.rejects(verifyProjection([{ id: 'r', timestamp: '2026-10-10T00:00:00Z', totalTokens: 1 }], dir, pid => spawned.push(pid)), { message: 'NATIVE_BINARY_MISMATCH' });
    assert.deepEqual(spawned, []);
  } finally { fs.openSync = open; await remove(dir); }
});

test('chunked native input matches the original canonical bytes and never carries unrelated fields',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'usage-native-wire-'));
  const rows=Array.from({length:400},(_,i)=>({id:'synthetic-'+i,timestamp:'2026-11-04T00:00:00Z',totalTokens:i+1,body:'DO_NOT_TRANSPORT'}));
  rows.push({id:'zero',timestamp:'2026-11-04T00:00:00Z',totalTokens:0},{id:'excluded',timestamp:'2026-11-04T00:00:00Z',totalTokens:-1});
  let bytes;
  try{
    const result=await verifyProjection(rows,dir,()=>{const run=fs.readdirSync(dir).find(name=>name.startsWith('native-'));bytes=fs.readFileSync(path.join(dir,run,'projection','.claude','projects','statistics-only','usage.jsonl'));});
    assert.equal(result.status,'passed');assert.equal(result.records,401);assert.equal(result.tokens,80200);
    assert.equal(bytes.length,120754);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'e3de138574e4aedadd782b859363fe70668546e86b0423dcddf547fd7a99545b');
    assert(!bytes.includes(Buffer.from('DO_NOT_TRANSPORT')));assert(!bytes.includes(Buffer.from('excluded')));
  }finally{await remove(dir);}
});
