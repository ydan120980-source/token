'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readSavedSnapshot } = require('../../src/m1/read-snapshot');
if (require.main === module) {
  const file = path.join(process.env.APPDATA, 'AgentUsage-M1', 'statistics.json');
  const before = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const snapshot = readSavedSnapshot(file);
  const after = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (before !== after) throw new Error('SOURCE_CHANGED_DURING_PROJECTION');
  const target = path.resolve(__dirname, '../../.cache/desktop-ui/local-snapshot.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(snapshot), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ prepared: true, rows: snapshot.daily.length, models: new Set(snapshot.daily.map(row => row.model)).size, unchangedSource: true }) + '\n');
}
module.exports = { readSavedSnapshot };
