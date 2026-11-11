'use strict';
// Session spelling follows steipete/CodexBar CursorAppAuth.swift (MIT).
// Windows fixed location verified against ham0806/ai-usage-bar. No browser DB.
const fs = require('node:fs'), path = require('node:path');
const { readDatabase, query } = require('../m1/sqlite-memory');
function cursorContext(value) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).join(',') === 'subject' && typeof value.subject === 'string' && /^[A-Za-z0-9._-]{1,256}$/.test(value.subject) ? { subject: value.subject } : undefined; }
function cursorCredential(raw, now = Date.now()) {
  if (raw instanceof Uint8Array) {
    const bytes = Buffer.from(raw); let utf16 = bytes.length % 2 === 0 && bytes.length > 0;
    for (let i = 0; utf16 && i < bytes.length; i += 2) if (!bytes[i] || bytes[i] >= 128 || bytes[i + 1]) utf16 = false;
    raw = bytes.toString(utf16 ? 'utf16le' : 'utf8');
  }
  if (typeof raw !== 'string' || raw.length > 16000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw)) throw Error('PROVIDER_CLIENT_CREDENTIAL_MISSING');
  let payload; try { payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64url').toString('utf8')); } catch { throw Error('PROVIDER_CLIENT_CREDENTIAL_MISSING'); }
  const subject = typeof payload.sub === 'string' ? payload.sub.split('|').at(-1) : null, context = cursorContext({ subject });
  if (!context || !Number.isSafeInteger(payload.exp) || payload.exp <= 0 || payload.exp > 8640000000000) throw Error('PROVIDER_CLIENT_CREDENTIAL_MISSING');
  if (payload.exp * 1000 <= now + 60000) throw Error('PROVIDER_AUTH_REQUIRED');
  return { credential: 'WorkosCursorSessionToken=' + subject + '%3A%3A' + raw, expiresAt: new Date(payload.exp * 1000).toISOString(), context: { cursor: context } };
}
async function readCursor(environment, signal) {
  if (signal.aborted) throw Error('PROVIDER_CANCELED'); const file = path.join(environment.appData, 'Cursor/User/globalStorage/state.vscdb');
  try {
    for (const target of [file, file + '-wal']) {
      if (!fs.existsSync(target)) { if (target === file) throw Error(); continue; }
      for (let part = target; ; part = path.dirname(part)) { if (fs.lstatSync(part).isSymbolicLink()) throw Error(); if (part === path.dirname(part)) break; }
      const stat = fs.statSync(target); if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw Error();
    }
    const raw = await readDatabase(file, { reads: 0 }, db => query(db, "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1")[0]?.value);
    if (signal.aborted) throw Error('PROVIDER_CANCELED'); return cursorCredential(raw);
  } catch (error) { throw Error(['PROVIDER_AUTH_REQUIRED', 'PROVIDER_CANCELED'].includes(error.message) ? error.message : 'PROVIDER_CLIENT_CREDENTIAL_MISSING', { cause: error }); }
}
module.exports = { readCursor, cursorCredential, cursorContext };
