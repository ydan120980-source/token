'use strict';
const fs = require('node:fs'), path = require('node:path'), zlib = require('node:zlib');
// Only regular files/directories from a verified npm platform archive. No links,
// scripts, devices, extended metadata or absolute/Windows-special paths.
async function extract(file, destination, { signal, maxBytes = 2 * 1024 ** 3, confine } = {}) {
  let buffer = Buffer.alloc(0), remaining = 0, padding = 0, handle = null, count = 0, expanded = 0, ended = false;
  const text = bytes => bytes.toString('utf8').replace(/\0.*$/s, '');
  const input = fs.createReadStream(file), unzip = zlib.createGunzip(); input.on('error', error => unzip.destroy(error)); input.pipe(unzip);
  const abort = () => { input.destroy(); unzip.destroy(new Error('INSTALL_CANCELED')); }; signal?.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of unzip) {
      if (signal?.aborted) throw new Error('INSTALL_CANCELED');
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      while (buffer.length) {
        if (ended) { if (buffer.some(byte => byte !== 0)) throw new Error('INSTALL_ARCHIVE_REJECTED'); buffer = Buffer.alloc(0); break; }
        if (remaining) { const take = Math.min(remaining, buffer.length); let written = 0; while (written < take) { const count = fs.writeSync(handle, buffer, written, take - written); if (!count) throw new Error('INSTALL_WRITE_FAILED'); written += count; } remaining -= take; buffer = buffer.subarray(take); if (!remaining) { fs.closeSync(handle); handle = null; } continue; }
        if (padding) { const take = Math.min(padding, buffer.length); buffer = buffer.subarray(take); padding -= take; continue; }
        if (buffer.length < 512) break;
        const header = buffer.subarray(0, 512); buffer = buffer.subarray(512);
        if (header.every(byte => byte === 0)) { ended = true; continue; }
        const octal = bytes => { const value = text(bytes).trim(); if (!/^[0-7]+$/.test(value)) throw new Error('INSTALL_ARCHIVE_REJECTED'); const number = parseInt(value, 8); if (!Number.isSafeInteger(number)) throw new Error('INSTALL_ARCHIVE_REJECTED'); return number; };
        const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0); if (checksum !== octal(header.subarray(148, 156))) throw new Error('INSTALL_ARCHIVE_REJECTED');
        const prefix = text(header.subarray(345, 500)), name = (prefix ? prefix + '/' : '') + text(header.subarray(0, 100)), type = header[156], size = octal(header.subarray(124, 136));
        if (++count > 50000 || (expanded += size) > maxBytes || ![0, 48, 53].includes(type) || type === 53 && size || !name.startsWith('package/') || /[\\:\x00-\x1f<>"|?*]/.test(name)) throw new Error('INSTALL_ARCHIVE_REJECTED');
        const parts = name.slice(8).split('/').filter(Boolean); if (!parts.length || parts.some(part => part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('INSTALL_ARCHIVE_REJECTED');
        const target = confine(destination, path.join(destination, ...parts));
        if (type === 53) fs.mkdirSync(target, { recursive: true });
        else { fs.mkdirSync(path.dirname(target), { recursive: true }); handle = fs.openSync(target, 'wx', 0o600); remaining = size; padding = (512 - size % 512) % 512; if (!remaining) { fs.closeSync(handle); handle = null; } }
      }
    }
    if (remaining || padding || !ended) throw new Error('INSTALL_ARCHIVE_REJECTED');
    return { files: count, expandedBytes: expanded };
  } finally { if (handle !== null) fs.closeSync(handle); signal?.removeEventListener('abort', abort); input.destroy(); unzip.destroy(); }
}
module.exports = { extract };
