'use strict';
// A file from before 2026-11-05 may still hold archive marks: they are dropped on reading, so those sessions are back in the
// lists, and leave the file with the next change (docs/m2/UI-AGENT-ADMIN-TABLE-20261105.md).
// Names and pins the person gives sessions (docs/m2/SESSIONS-NEXT-20261101.md), and how far they read: a turn number,
// nothing of the conversation (docs/m2/UI-READER-POSITION-20261102.md). The app keeps them in its own file, keyed by the hashed session key: never the raw session ID
// or directory, never part of the statistics, their export or the query interface, and
// never written to any Agent's files.
const fs = require('node:fs');
const path = require('node:path');
const { atomic } = require('./store');
const { title } = require('./sessions');
const FILE = 'session-labels.json', SCHEMA = 'SessionLabelsV1', KEY = /^[a-f0-9]{64}$/, MAX = 10000, MAX_TURN = 100000, MAX_GROUP = 40;
const validTurn = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_TURN;
// A group the person sorted the session into (docs/m2/UI-SESSIONS-MULTI-20261102.md): their own short name.
const groupName = value => (title(value) ?? '').slice(0, MAX_GROUP) || null;
function entry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const alias = title(value.alias), pinned = value.pinned === true, turn = validTurn(value.turn) ? value.turn : null, group = groupName(value.group);
  return alias || pinned || turn || group ? { ...(alias ? { alias } : {}), ...(pinned ? { pinned } : {}), ...(turn ? { turn } : {}), ...(group ? { group } : {}) } : null;
}
class SessionLabels {
  constructor(dir) { this.file = path.join(dir, FILE); this.labels = this.read(); }
  // A missing, unreadable or foreign file means no labels; it is replaced on the next change.
  read() {
    const labels = {};
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (saved?.schemaVersion !== SCHEMA || !saved.labels || typeof saved.labels !== 'object') return labels;
      for (const [key, value] of Object.entries(saved.labels).slice(0, MAX)) { const label = KEY.test(key) && entry(value); if (label) labels[key] = label; }
    } catch { return labels; }
    return labels;
  }
  all() { return structuredClone(this.labels); }
  // patch: { alias?: string | null, pinned?: boolean, turn?: number | null, group?: string | null }; an empty alias, group or a null turn removes it.
  set(key, patch) {
    if (typeof key !== 'string' || !KEY.test(key)) throw new Error('SESSION_NOT_FOUND');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(name => !['alias', 'pinned', 'turn', 'group'].includes(name))) throw new Error('SESSION_LABEL_INVALID');
    if ('alias' in patch && patch.alias !== null && (typeof patch.alias !== 'string' || patch.alias.length > 400)) throw new Error('SESSION_LABEL_INVALID');
    if ('pinned' in patch && typeof patch.pinned !== 'boolean') throw new Error('SESSION_LABEL_INVALID');
    if ('turn' in patch && patch.turn !== null && !validTurn(patch.turn)) throw new Error('SESSION_LABEL_INVALID');
    if ('group' in patch && patch.group !== null && (typeof patch.group !== 'string' || patch.group.length > 400)) throw new Error('SESSION_LABEL_INVALID');
    const next = entry({ ...this.labels[key], ...patch }), labels = { ...this.labels };
    if (next) labels[key] = next; else delete labels[key];
    if (Object.keys(labels).length > MAX) throw new Error('SESSION_LABEL_LIMIT');
    atomic(this.file, { schemaVersion: SCHEMA, labels });
    this.labels = labels;
    return this.all();
  }
}
module.exports = { SessionLabels, FILE };
