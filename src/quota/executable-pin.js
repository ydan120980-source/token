'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
// Current official Codex/Claude native images exceed 256 MiB. Keep a finite
// streaming limit while admitting their reviewed Windows releases.
const MAX_BYTES = 512 * 1024 * 1024;
function fingerprint(executable) {
  let file;
  try {
    if (typeof executable !== 'string' || !path.isAbsolute(executable) || /[\x00-\x1f]/.test(executable)) throw new Error();
    if (process.platform === 'win32' && (!/^[A-Za-z]:[\\/]/.test(executable) || !/\.exe$/i.test(executable) || executable.slice(2).includes(':') || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(path.basename(executable)))) throw new Error();
    const resolved = path.resolve(executable);
    for (let part = resolved; ; part = path.dirname(part)) {
      if (fs.lstatSync(part).isSymbolicLink()) throw new Error();
      if (path.dirname(part) === part) break;
    }
    if (!fs.lstatSync(resolved).isFile()) throw new Error();
    file = fs.openSync(resolved, 'r');
    const before = fs.fstatSync(file, { bigint: true });
    if (!before.isFile() || before.size < 1n || before.size > BigInt(MAX_BYTES)) throw new Error();
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024);
    let count, size = 0n;
    while ((count = fs.readSync(file, buffer, 0, buffer.length, null))) {
      size += BigInt(count); if (size > before.size) throw new Error();
      hash.update(buffer.subarray(0, count));
    }
    const after = fs.fstatSync(file, { bigint: true });
    if (size !== before.size || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error();
    return Object.freeze({ schemaVersion: 'ExecutablePinV1', executable: resolved, sha256: hash.digest('hex'), size: String(after.size), device: String(after.dev), inode: String(after.ino) });
  } catch { throw new Error('JOB_BINARY_UNAVAILABLE'); }
  finally { if (file !== undefined) fs.closeSync(file); }
}
function checkPin(pin) {
  try {
    const current = fingerprint(pin?.executable);
    if (['schemaVersion', 'executable', 'sha256', 'size', 'device', 'inode'].some(key => current[key] !== pin[key])) throw new Error();
    return current;
  } catch { throw new Error('JOB_BINARY_CHANGED'); }
}
module.exports = { fingerprint, checkPin };
