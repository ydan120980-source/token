'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const files = ['opencode.db', 'opencode.db-wal', 'opencode.db-shm'];
const at = Date.parse('2026-11-19T09:00:00Z');

function seedSqlite(scratch, home) {
  const { DatabaseSync } = require('node:sqlite');
  const generation = path.join(scratch, 'generation');
  const directory = path.join(home, '.local', 'share', 'opencode');
  fs.mkdirSync(generation);
  fs.mkdirSync(directory, { recursive: true });
  const source = path.join(generation, files[0]);
  const db = new DatabaseSync(source);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA cache_size=-2048;');
    db.exec('CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, data TEXT); CREATE TABLE unrelated_storage(data BLOB);');
    const insert = db.prepare('INSERT INTO message VALUES(?,?,?)');
    const message = (id, input, output) => ({
      id, role: 'assistant', sessionID: 'local-fixture', modelID: 'gpt-4.1',
      providerID: 'openai', time: { created: at + input }, content: 'SQLITE_PRIVATE_FIXTURE_CONTENT',
      tokens: { input, output, cache: { read: 0 } },
    });
    db.exec('BEGIN');
    for (let i = 0; i < 12; i++) db.exec('INSERT INTO unrelated_storage VALUES(zeroblob(8388608))');
    insert.run('committed-main', 'local-fixture', JSON.stringify(message('committed-main', 80, 6)));
    db.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE)');
    db.exec('BEGIN; INSERT INTO unrelated_storage VALUES(zeroblob(4194304));');
    insert.run('committed-wal', 'local-fixture', JSON.stringify(message('committed-wal', 101, 18)));
    db.exec('COMMIT');
    assert.equal(db.prepare('SELECT count(*) AS count FROM message').get().count, 2);
    for (const name of files) fs.copyFileSync(path.join(generation, name), path.join(directory, name));
  } finally {
    db.close();
  }
  const dbFile = path.join(directory, files[0]);
  assert(fs.statSync(dbFile).size >= 96 * 1024 * 1024);
  assert(fs.statSync(dbFile + '-wal').size > 4 * 1024 * 1024);
  return dbFile;
}

const fields = ['agent', 'model', 'timestamp', 'totalTokens', 'inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning'];
function usageFacts(rows) {
  return rows.map(row => Object.fromEntries(fields.map(key => [key, row[key] ?? null])))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

async function fingerprint(dbFile) {
  const directory = path.dirname(dbFile);
  assert.deepEqual(fs.readdirSync(directory).sort(), [...files].sort());
  return Promise.all(files.map(async name => {
    const file = path.join(directory, name);
    const stat = await fs.promises.stat(file);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return { name, bytes: stat.size, modifiedMs: stat.mtimeMs, sha256: hash.digest('hex') };
  }));
}

async function electronFacts(dbFile) {
  const { stdout } = await promisify(execFile)(process.execPath, [__filename, '--oracle', dbFile], {
    windowsHide: true, timeout: 25000,
  });
  return JSON.parse(stdout);
}

if (require.main === module) {
  assert.equal(process.argv[2], '--oracle');
  const { parseDatabase } = require('../../src/m1/sources');
  parseDatabase('opencode', process.argv[3], 'sqlite-gate-fixture', { reads: 0, bytes: 0 })
    .then(records => process.stdout.write(JSON.stringify(usageFacts(records))))
    .catch(() => { process.exitCode = 1; });
}

module.exports = { seedSqlite, usageFacts, fingerprint, electronFacts };
