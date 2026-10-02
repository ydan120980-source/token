'use strict';
// No connection to a source database: bytes and committed WAL pages are read
// O_RDONLY; SQLite runs exclusively on an in-memory image. No source shm locks.
const fs = require('node:fs');
const { readBytes } = require('./policy');
let sqlPromise;
function sql() { return sqlPromise ||= require('sql.js')(); }
function checksum(bytes, initial, little) {
  let [s1, s2] = initial;
  for (let i = 0; i < bytes.length; i += 8) {
    const a = little ? bytes.readUInt32LE(i) : bytes.readUInt32BE(i);
    const b = little ? bytes.readUInt32LE(i + 4) : bytes.readUInt32BE(i + 4);
    s1 = (s1 + a + s2) >>> 0; s2 = (s2 + b + s1) >>> 0;
  }
  return [s1, s2];
}
function overlayWal(main, wal) {
  if (!wal || wal.length === 0) return main;
  if (wal.length < 32 || ![0x377f0682, 0x377f0683].includes(wal.readUInt32BE(0))) throw new Error('WAL_HEADER_INVALID');
  const size = wal.readUInt32BE(8), little = wal.readUInt32BE(0) === 0x377f0682;
  if (size < 512 || size > 65536 || (size & (size - 1))) throw new Error('WAL_PAGE_INVALID');
  let sum = checksum(wal.subarray(0, 24), [0, 0], little);
  if (sum[0] !== wal.readUInt32BE(24) || sum[1] !== wal.readUInt32BE(28)) throw new Error('WAL_CHECKSUM_INVALID');
  const staged = new Map(); let committed = new Map(), pages = 0;
  for (let at = 32; at + 24 + size <= wal.length; at += 24 + size) {
    const header = wal.subarray(at, at + 24), payload = wal.subarray(at + 24, at + 24 + size);
    if (!header.subarray(8, 16).equals(wal.subarray(16, 24))) break;
    sum = checksum(header.subarray(0, 8), sum, little); sum = checksum(payload, sum, little);
    if (sum[0] !== header.readUInt32BE(16) || sum[1] !== header.readUInt32BE(20)) break;
    const page = header.readUInt32BE(0);
    if (!page || page * size > 512 * 1024 * 1024) throw new Error('WAL_SIZE_LIMIT');
    staged.set(page, payload);
    if (header.readUInt32BE(4)) { pages = header.readUInt32BE(4); committed = new Map(staged); }
  }
  if (!pages) return main;
  if (pages * size > 512 * 1024 * 1024) throw new Error('WAL_SIZE_LIMIT');
  const image = Buffer.alloc(pages * size); main.copy(image, 0, 0, image.length);
  for (const [page, payload] of committed) if (page <= pages) payload.copy(image, (page - 1) * size);
  return image;
}
async function readDatabase(file, audit, visit) {
  const before = fs.statSync(file), walPath = file + '-wal';
  const walBefore = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
  const main = readBytes(file, audit);
  if (main.subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('DATABASE_FORMAT_UNSUPPORTED');
  const wal = walBefore ? readBytes(walPath, audit) : null;
  const after = fs.statSync(file), walAfter = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
  if (before.mtimeMs !== after.mtimeMs || before.size !== after.size || Boolean(walBefore) !== Boolean(walAfter) || (walBefore && (walBefore.size !== walAfter.size || walBefore.mtimeMs !== walAfter.mtimeMs))) throw new Error('SOURCE_BUSY');
  const SQL = await sql(), db = new SQL.Database(overlayWal(main, wal));
  try { return visit(db); } finally { db.close(); }
}
function query(db, queryText) {
  const result = db.exec(queryText)[0];
  return result ? result.values.map(row => Object.fromEntries(result.columns.map((key, i) => [key, row[i]]))) : [];
}
module.exports = { sql, checksum, overlayWal, readDatabase, query };
