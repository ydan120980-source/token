'use strict';
const fs = require('node:fs'), path = require('node:path');
function readBounded(file, json = true) {
  try {
    for (let current = path.resolve(file); ; current = path.dirname(current)) { if (fs.lstatSync(current).isSymbolicLink()) return null; if (current === path.dirname(current)) break; }
    const fd = fs.openSync(file, 'r');
    try { const stat = fs.fstatSync(fd); if (!stat.isFile() || stat.size > 1024 * 1024) return null; const bytes = Buffer.alloc(stat.size + 1), count = fs.readSync(fd, bytes, 0, bytes.length, 0); if (count > stat.size) return null; const text = bytes.subarray(0, count).toString('utf8'); return json ? JSON.parse(text) : text; }
    finally { fs.closeSync(fd); }
  } catch { return null; }
}
module.exports = { readBounded };
