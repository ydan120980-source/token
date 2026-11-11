'use strict';
const zlib = require('node:zlib');
function tgz(entries) {
  const chunks = [];
  for (const row of entries) {
    const bytes = Buffer.from(row.bytes || ''), header = Buffer.alloc(512); header.write(row.name); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116); header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header[156] = (row.type || '0').charCodeAt(0); header.write('ustar\0', 257); const sum = header.reduce((n, b) => n + b, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return zlib.gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
module.exports = { tgz };
