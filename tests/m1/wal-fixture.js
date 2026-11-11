'use strict';
const { checksum } = require('../../src/m1/sqlite-memory');
// Synthetic pages with valid WAL framing; actual SQLite-generated WAL parity is
// independently exercised in core.test.js.
function wal(frames, size = 512) {
  const bytes = Buffer.alloc(32 + frames.length * (24 + size));
  bytes.writeUInt32BE(0x377f0682, 0); bytes.writeUInt32BE(3007000, 4); bytes.writeUInt32BE(size, 8);
  bytes.writeUInt32BE(123, 16); bytes.writeUInt32BE(456, 20);
  let sum = checksum(bytes.subarray(0, 24), [0, 0], true); bytes.writeUInt32BE(sum[0], 24); bytes.writeUInt32BE(sum[1], 28);
  frames.forEach((frame, i) => {
    const offset = 32 + i * (24 + size), header = bytes.subarray(offset, offset + 24), payload = bytes.subarray(offset + 24, offset + 24 + size);
    header.writeUInt32BE(frame.page, 0); header.writeUInt32BE(frame.commit || 0, 4); bytes.copy(header, 8, 16, 24); payload.fill(frame.fill);
    sum = checksum(header.subarray(0, 8), sum, true); sum = checksum(payload, sum, true); header.writeUInt32BE(sum[0], 16); header.writeUInt32BE(sum[1], 20);
  });
  return bytes;
}
module.exports = { wal };
