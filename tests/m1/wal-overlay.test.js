'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { overlayWal } = require('../../src/m1/sqlite-memory');
const { wal } = require('./wal-fixture');
test('WAL overlays only the last verified commit, never an uncommitted overwrite or torn tail', () => {
  const main = Buffer.alloc(1536, 7), frames = [{ page: 1, commit: 3, fill: 11 }, { page: 2, fill: 22 }, { page: 3, commit: 3, fill: 33 }, { page: 1, fill: 44 }];
  const bytes = wal(frames), original = Buffer.from(bytes), saved = Buffer.from(main), expected = Buffer.concat([Buffer.alloc(512, 11), Buffer.alloc(512, 22), Buffer.alloc(512, 33)]);
  assert.deepEqual(overlayWal(main, bytes), expected);
  assert.deepEqual(overlayWal(main, bytes.subarray(0, -8)), expected);
  const damaged = Buffer.from(bytes); damaged[damaged.length - 1] ^= 1; assert.deepEqual(overlayWal(main, damaged), expected);
  assert.deepEqual(bytes, original); assert.deepEqual(main, saved);
  assert.equal(overlayWal(main, wal([{ page: 1, fill: 99 }])), main);
});
test('a corrupt commit is not visible; replacement pages and a committed shrink use the final database size', () => {
  const main = Buffer.alloc(1536, 7), bytes = wal([{ page: 1, commit: 3, fill: 11 }, { page: 2, commit: 3, fill: 22 }]); bytes[bytes.length - 1] ^= 1;
  assert.deepEqual(overlayWal(main, bytes), Buffer.concat([Buffer.alloc(512, 11), Buffer.alloc(1024, 7)]));
  const shrunk = overlayWal(main, wal([{ page: 1, commit: 3, fill: 11 }, { page: 1, commit: 2, fill: 55 }]));
  assert.deepEqual(shrunk, Buffer.concat([Buffer.alloc(512, 55), Buffer.alloc(512, 7)]));
  const badHeader = wal([]); badHeader[24] ^= 1; assert.throws(() => overlayWal(main, badHeader), /WAL_CHECKSUM_INVALID/);
  assert.throws(() => overlayWal(main, wal([{ page: 1048577, commit: 1, fill: 1 }])), /WAL_SIZE_LIMIT/);
});
test('many committed WAL generations preserve all final pages without changing input bytes', () => {
  const count = 4000, bytes = wal(Array.from({ length: count }, (_, i) => ({ page: i + 1, commit: i + 1, fill: i % 255 }))), before = Buffer.from(bytes);
  const image = overlayWal(Buffer.alloc(512), bytes); assert.equal(image.length, count * 512);
  for (let i = 0; i < count; i++) assert(image.subarray(i * 512, (i + 1) * 512).equals(Buffer.alloc(512, i % 255)));
  assert.deepEqual(bytes, before);
});
