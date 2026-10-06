'use strict';
// Frame boundaries only; native zlib still validates and decompresses payloads.
// https://github.com/facebook/zstd/blob/dev/doc/zstd_compression_format.md
function frameEnd(bytes, start) {
  const magic = Buffer.from([0x28,0xb5,0x2f,0xfd]);
  const remaining = bytes.length - start;
  if (remaining < 4) {
    if (!bytes.subarray(start).equals(magic.subarray(0,remaining))) throw new Error('SOURCE_COMPRESSION_INVALID');
    return null;
  }
  const code = bytes.readUInt32LE(start);
  if (code >= 0x184d2a50 && code <= 0x184d2a5f) {
    if (remaining < 8) return null;
    const end = start + 8 + bytes.readUInt32LE(start + 4);
    return end <= bytes.length ? end : null;
  }
  if (code !== 0xfd2fb528) throw new Error('SOURCE_COMPRESSION_INVALID');
  if (remaining < 5) return null;
  const descriptor = bytes[start + 4], single = Boolean(descriptor & 32);
  if (descriptor & 8) throw new Error('SOURCE_COMPRESSION_INVALID');
  const contentBytes = [single ? 1 : 0,2,4,8][descriptor >>> 6];
  let offset = start + 5 + (single ? 0 : 1) + [0,1,2,4][descriptor & 3] + contentBytes;
  if (offset > bytes.length) return null;
  while (true) {
    if (offset + 3 > bytes.length) return null;
    const header = bytes.readUIntLE(offset,3), type = (header >>> 1) & 3;
    if (type === 3) throw new Error('SOURCE_COMPRESSION_INVALID');
    offset += 3 + (type === 1 ? 1 : header >>> 3);
    if (offset > bytes.length) return null;
    if (header & 1) break;
  }
  if (descriptor & 4) offset += 4;
  return offset <= bytes.length ? offset : null;
}
module.exports = {frameEnd};
