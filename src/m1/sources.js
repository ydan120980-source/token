'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SOURCES, filesUnder, readBytes } = require('./policy');
const { readDatabase, query } = require('./sqlite-memory');
const { normalize, number } = require('./normalize');
function parseObjects(agent, objects, salt, fallbackSession) {
  const records = []; let context = { session: fallbackSession, model: 'unknown', entry: 'unknown' }, previous = null;
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    if (agent === 'codex') {
      const p = obj.payload || {};
      if (obj.type === 'session_meta') {
        context.session = p.id || context.session;
        context.provider = p.model_provider;
        const origin = String(p.originator || p.source || '');
        context.entry = /desktop|vscode|app/i.test(origin) ? 'desktop' : /cli/i.test(origin) ? 'cli' : 'unknown';
        context.fork = Boolean(p.forked_from_id || p.forked_from);
        context.canonicalSession = p.forked_from_id || p.forked_from || context.session;
      }
      if (obj.type === 'turn_context' && p.model) context.model = p.model;
      if (obj.type !== 'event_msg' || p.type !== 'token_count' || !p.info) continue;
      if (p.info.model || p.info.model_name) context.model = p.info.model || p.info.model_name;
      const cumulative = p.info.total_token_usage, last = p.info.last_token_usage;
      let usage = last;
      if (cumulative && !(context.fork && !previous)) {
        usage = {};
        for (const [key, value] of Object.entries(cumulative)) if (number(value) !== null) usage[key] = Math.max(0, value - (previous?.[key] ?? 0));
        if (previous && cumulative.total_tokens === previous.total_tokens) { previous = cumulative; continue; }
      }
      previous = cumulative || previous;
      if (!usage) continue;
      const id = JSON.stringify([context.canonicalSession || context.session, obj.timestamp, cumulative || usage]);
      const r = normalize(agent, usage, { ...context, time: obj.timestamp, id }, salt, 'inclusive');
      if (r) records.push(r);
    } else if (agent === 'claude') {
      const message = obj.message;
      if (obj.type !== 'assistant' || !message?.usage) continue;
      const r = normalize(agent, message.usage, { id: message.id || obj.uuid, session: obj.sessionId || fallbackSession, model: message.model, time: obj.timestamp, entry: 'cli' }, salt, 'exclusive');
      if (r) records.push(r);
    } else if (agent === 'workbuddy') {
      const data = obj.providerData;
      const usage = data?.rawUsage || data?.usage || obj.usage;
      if (!usage) continue;
      const r = normalize(agent, usage, { id: data?.messageId || obj.id, model: data?.requestModelId || obj.model, time: obj.timestamp, session: obj.sessionId || fallbackSession }, salt, 'inclusive');
      if (r) records.push(r);
    } else {
      if (obj.role !== 'assistant' || !obj.tokens) continue;
      const r = normalize(agent, obj.tokens, { id: obj.id, session: obj.sessionID || obj.session_id || fallbackSession, model: obj.modelID || obj.model?.id || obj.model, provider: obj.providerID || obj.model?.providerID, time: obj.time?.created ?? obj.timestamp, entry: obj.entry || 'unknown' }, salt, 'exclusive');
      if (r) records.push(r);
    }
  }
  return records;
}
async function parseDatabase(agent, file, salt, audit) {
  return readDatabase(file, audit, db => {
    if (agent === 'workbuddy') {
      return query(db, 'SELECT session_id, used, updated_at FROM session_usage WHERE used IS NOT NULL').map(row => {
        const record = normalize(agent, { total_tokens: row.used }, { id: 'aggregate:' + row.session_id, session: row.session_id, time: row.updated_at, model: 'unknown' }, salt);
        return record ? { ...record, accountingKind: 'session-aggregate' } : null;
      }).filter(Boolean);
    }
    const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name));
    const rows = [];
    if (tables.has('message')) rows.push(...query(db, 'SELECT id, session_id, data FROM message'));
    if (tables.has('session_message')) rows.push(...query(db, "SELECT id, session_id, data, type FROM session_message WHERE type='assistant'"));
    if (!tables.has('message') && !tables.has('session_message')) throw new Error('DATABASE_SCHEMA_UNSUPPORTED');
    const versions = agent === 'mimo' && tables.has('session') ? new Map(query(db, 'SELECT id, version FROM session').map(row => [row.id, row.version])) : new Map();
    const objects = rows.map(row => {
      const data = JSON.parse(row.data);
      const version = versions.get(row.session_id);
      return { ...data, role: data.role || row.type, id: data.id || row.id, session_id: row.session_id, entry: typeof version === 'string' ? version.startsWith('desktop-') ? 'desktop' : 'cli' : 'unknown' };
    });
    return parseObjects(agent, objects, salt, 'database');
  });
}
async function scanSources(selectedRoots, salt, audit) {
  const result = {}, physical = new Set(), shared = new Map();
  for (const agent of SOURCES) {
    const records = new Map(), detailedSessions = new Set(); let detected = false, fileCount = 0, skipped = 0, partial = false; const errors = new Set();
    const started = Date.now();
    for (const root of selectedRoots[agent] || []) {
      if (fs.existsSync(root)) detected = true;
      let files;
      try { files = filesUnder(agent, root, audit); } catch (error) { errors.add(error.message); continue; }
      // Detailed WorkBuddy logs supersede aggregate fallback, never sum them.
      files.sort((a, b) => Number(a.endsWith('.db')) - Number(b.endsWith('.db')));
      for (const file of files) {
        if (Date.now() - started > 55000) { errors.add('SOURCE_TIMEOUT'); break; }
        if (physical.has(file)) continue;
        fileCount++;
        try {
          let parsed;
          if (file.endsWith('.db')) parsed = await parseDatabase(agent, file, salt, audit);
          else {
            const text = readBytes(file, audit).toString('utf8');
            const objects = [];
            if (file.endsWith('.json')) objects.push(JSON.parse(text));
            else for (const line of text.split('\n')) {
              if (!line.trim()) continue;
              try { objects.push(JSON.parse(line)); } catch { partial = true; skipped++; }
            }
            parsed = parseObjects(agent, objects, salt, path.basename(file));
          }
          physical.add(file);
          for (const record of parsed) {
            if (record.sharedKey) { const owner = shared.get(record.sharedKey); if (owner && owner !== agent) { skipped++; continue; } shared.set(record.sharedKey, agent); }
            if (agent === 'workbuddy') {
              if (file.endsWith('.db') && detailedSessions.has(record.sessionKey)) continue;
              if (!file.endsWith('.db') && record.sessionKey) {
                detailedSessions.add(record.sessionKey);
                for (const [id, old] of records) if (old.accountingKind === 'session-aggregate' && old.sessionKey === record.sessionKey) records.delete(id);
              }
            }
            const old = records.get(record.id);
            if (!old || record.totalTokens >= old.totalTokens) records.set(record.id, record);
          }
        } catch (error) { errors.add(/^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_PARSE_FAILED'); }
      }
    }
    result[agent] = { records: [...records.values()], detected, fileCount, skipped, partial: partial || errors.size > 0, errors: [...errors], durationMs: Date.now() - started };
  }
  return result;
}
module.exports = { parseObjects, parseDatabase, scanSources };
