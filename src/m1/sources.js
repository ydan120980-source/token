'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SOURCES, filesUnder, readBytes } = require('./policy');
const { readDatabase, query } = require('./sqlite-memory');
const { normalize, number } = require('./normalize');
const extended = require('./extended-sources');
const {selectUsageSnapshot,keepIdentity} = require('./usage-snapshot');
function parseObjects(agent, objects, salt, fallbackSession) {
  if (agent === 'gemini') return extended.gemini(objects, salt, fallbackSession);
  if (agent === 'cursor') return extended.cursor(objects, salt);
  const records = []; let context = { session: fallbackSession, model: 'unknown', entry: 'unknown' }, previous = null, previousSignature = null;
  const laneSignatures = new Map();
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
      const signature = JSON.stringify([cumulative, last]), lane = p.rate_limits?.limit_id || p.limit_id || 'default';
      if (cumulative && (signature === previousSignature || laneSignatures.get(lane) === signature)) { previous = cumulative; continue; }
      previousSignature = signature; if (cumulative) laneSignatures.set(lane, signature);
      let usage = last;
      if (!usage && cumulative && !(context.fork && !previous)) {
        usage = {};
        const reset = previous && cumulative.total_tokens < previous.total_tokens;
        for (const [key, value] of Object.entries(cumulative)) if (number(value) !== null) usage[key] = Math.max(0, value - (reset ? 0 : previous?.[key] ?? 0));
      }
      previous = cumulative || previous;
      if (!usage) continue;
      const id = JSON.stringify([context.canonicalSession || context.session, obj.timestamp, cumulative || usage]);
      const r = normalize(agent, usage, { ...context, time: obj.timestamp, id }, salt, 'inclusive');
      if (r) records.push({ ...r, requestInputTokens: last ? number(last.input_tokens) : null });
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
    if (agent === 'cursor') {
      const records = []; let invalid = false;
      for (const row of query(db,'SELECT run_id, agent_id, model, created_at, started_at, usage_json FROM runs WHERE usage_json IS NOT NULL')) {
        let usage; try { usage = JSON.parse(row.usage_json); } catch { invalid = true; continue; }
        const parsed = extended.cursor([{runId:row.run_id,agentId:row.agent_id,model:{id:row.model},createdAt:row.created_at,startedAt:row.started_at,usage}],salt);
        records.push(...parsed); for (const warning of parsed.warnings || []) invalid ||= warning === 'SOURCE_ROW_INVALID';
      }
      if (invalid) records.warnings = ['SOURCE_ROW_INVALID'];
      return records;
    }
    if (agent === 'zcode') return extended.zcode(query(db, 'SELECT id, session_id, provider_id, model_id, started_at, completed_at, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, provider_total_tokens, computed_total_tokens FROM model_usage'), salt);
    if (agent === 'workbuddy') {
      return query(db, 'SELECT session_id, used, updated_at FROM session_usage WHERE used IS NOT NULL').map(row => {
        const record = normalize(agent, { total_tokens: row.used }, { id: 'aggregate:' + row.session_id, session: row.session_id, time: row.updated_at, model: 'unknown' }, salt);
        return record ? { ...record, accountingKind: 'session-aggregate' } : null;
      }).filter(Boolean);
    }
    const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name));
    const rows = [];
    // Do not pass database-sized arrays as function arguments: large histories
    // exceed V8's argument limit and used to be reported as a parse failure.
    if (tables.has('message')) for (const row of query(db, 'SELECT id, session_id, data FROM message')) rows.push(row);
    if (tables.has('session_message')) for (const row of query(db, "SELECT id, session_id, data, type FROM session_message WHERE type='assistant'")) rows.push(row);
    if (!tables.has('message') && !tables.has('session_message')) throw new Error('DATABASE_SCHEMA_UNSUPPORTED');
    const versions = agent === 'mimo' && tables.has('session') ? new Map(query(db, 'SELECT id, version FROM session').map(row => [row.id, row.version])) : new Map();
    const objects = []; let invalid = false;
    for (const row of rows) {
      let data; try { data = JSON.parse(row.data); } catch { invalid = true; continue; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) { invalid = true; continue; }
      const version = versions.get(row.session_id);
      objects.push({ ...data, role: data.role || row.type, id: data.id || row.id, session_id: row.session_id, entry: typeof version === 'string' ? version.startsWith('desktop-') ? 'desktop' : 'cli' : 'unknown' });
    }
    const records = parseObjects(agent, objects, salt, 'database');
    if (invalid) records.warnings = ['SOURCE_ROW_INVALID'];
    return records;
  });
}
// Every input a file's parse depends on: its bytes, plus committed WAL pages for
// databases. Size and modification time stand in for those bytes.
function fileStamp(file) {
  const stat = fs.statSync(file); let stamp = stat.size + ':' + stat.mtimeMs;
  if (file.endsWith('.db') || file.endsWith('.sqlite')) {
    try { const wal = fs.statSync(file + '-wal'); stamp += '|wal:' + wal.size + ':' + wal.mtimeMs; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return stamp;
}
function listFiles(agent, selectedRoots, audit) {
  let detected = false, files = []; const errors = [];
  for (const root of selectedRoots[agent] || []) {
    if (fs.existsSync(root)) detected = true;
    try { files.push(...filesUnder(agent, root, audit)); } catch (error) { errors.push(error.message); }
  }
  return { detected, files: [...new Set(files)], errors };
}
// Changes whenever a scan could produce a different result.
function sourceStamp(selectedRoots, salt, audit) {
  const hash = crypto.createHash('sha256').update(salt);
  for (const agent of SOURCES) {
    const listed = listFiles(agent, selectedRoots, audit);
    hash.update(JSON.stringify([agent, selectedRoots[agent] || [], listed.detected, listed.errors]));
    for (const file of listed.files) { let stamp; try { stamp = fileStamp(file); } catch { stamp = 'unreadable'; } hash.update('\0' + file + '\0' + stamp); }
  }
  return hash.digest('hex');
}
async function parseFile(agent, file, salt, audit) {
  const outcome = { records: null, partial: false, skipped: 0, errors: [], failure: null };
  try {
    let parsed;
    if (file.endsWith('.db') || file.endsWith('.sqlite')) parsed = await parseDatabase(agent, file, salt, audit);
    else if (/\.csv$/i.test(file)) parsed = extended.cursorCsv(readBytes(file, audit).toString('utf8'), salt);
    else {
      const bytes = readBytes(file, audit);
      const text = agent === 'deepseek' ? extended.decodeDeepseek(bytes, file.endsWith('.zstd'), () => { outcome.partial = true; outcome.errors.push('DEEPSEEK_LOG_INCOMPLETE'); }) : bytes.toString('utf8');
      const objects = [];
      if (file.endsWith('.json')) objects.push(JSON.parse(text));
      else for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { objects.push(JSON.parse(line)); } catch { outcome.partial = true; outcome.skipped++; if (agent === 'deepseek') break; }
      }
      parsed = agent === 'deepseek' ? extended.deepseek(objects, salt, file) : parseObjects(agent, objects, salt, path.basename(file));
    }
    outcome.errors.push(...parsed.warnings || []);
    outcome.records = [...parsed];
  } catch (error) { outcome.failure = /^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_PARSE_FAILED'; }
  return outcome;
}
// The cache keeps each file's parse outcome by stamp; merging below mutates
// records, so a cached outcome is cloned for every scan.
async function parsedFile(agent, file, salt, audit, cache) {
  if (!cache) return parseFile(agent, file, salt, audit);
  const key = agent + '\0' + file; cache.seen.add(key);
  let stamp = null; try { stamp = fileStamp(file); } catch {}
  const hit = cache.files.get(key);
  if (hit && stamp !== null && hit.stamp === stamp) return { ...hit.outcome, records: structuredClone(hit.outcome.records) };
  const outcome = await parseFile(agent, file, salt, audit);
  if (outcome.failure || stamp === null) cache.files.delete(key);
  else { cache.files.set(key, { stamp, outcome }); return { ...outcome, records: structuredClone(outcome.records) }; }
  return outcome;
}
// Re-parses only files whose stamp changed and reports whether any parse outcome,
// file or listing differs from what the cache held. Identical outcomes merge into an
// identical scan, so an unchanged report lets the caller skip the merge entirely.
async function refreshCache(selectedRoots, salt, audit, cache) {
  if (cache.salt !== salt) { cache.files.clear(); cache.salt = salt; cache.listing = null; }
  const report = { changed: false, failures: 0 }, seen = new Set(), listing = [];
  for (const agent of SOURCES) {
    const listed = listFiles(agent, selectedRoots, audit);
    listing.push([agent, listed.detected, listed.errors]);
    for (const file of agent === 'deepseek' ? extended.canonicalFiles(listed.files) : listed.files) {
      const key = agent + '\0' + file; seen.add(key);
      let stamp = null; try { stamp = fileStamp(file); } catch {}
      const hit = cache.files.get(key);
      if (hit && stamp !== null && hit.stamp === stamp) continue;
      const outcome = await parseFile(agent, file, salt, audit);
      if (outcome.failure || stamp === null) { cache.files.delete(key); report.failures++; report.changed = true; continue; }
      if (!hit || JSON.stringify(hit.outcome) !== JSON.stringify(outcome)) report.changed = true;
      cache.files.set(key, { stamp, outcome });
    }
  }
  for (const key of cache.files.keys()) if (!seen.has(key)) { cache.files.delete(key); report.changed = true; }
  const signature = JSON.stringify(listing);
  if (cache.listing !== signature) { cache.listing = signature; report.changed = true; }
  return report;
}
async function scanSources(selectedRoots, salt, audit, { cache = null, report = null } = {}) {
  if (cache) { if (cache.salt !== salt) { cache.files.clear(); cache.salt = salt; } cache.seen = new Set(); }
  const result = {}, physical = new Set(), shared = new Map();
  for (const agent of SOURCES) {
    const records = new Map(), detailedSessions = new Set(); let fileCount = 0, skipped = 0, partial = false;
    const started = Date.now();
    const listed = listFiles(agent, selectedRoots, audit), detected = listed.detected, errors = new Set(listed.errors);
    let allFiles = listed.files;
    if (agent === 'deepseek') allFiles = extended.canonicalFiles(allFiles);
    // Export snapshots and SDK runs are alternate Cursor acquisition modes.
    // Their identifiers cannot prove cross-mode identity; refuse ambiguous sums.
    if (agent === 'cursor' && allFiles.some(f => /\.csv$/i.test(f)) && allFiles.some(f => /\.(?:ndjson|db)$/i.test(f))) { errors.add('CURSOR_SOURCE_MODE_CONFLICT'); allFiles = []; }
    {
      const files = allFiles;
      const encodingConflicts = new Set();
      if (agent === 'deepseek') {
        const counts = new Map(); for (const file of files) counts.set(path.dirname(file), (counts.get(path.dirname(file)) || 0) + 1);
        for (const [dir,count] of counts) if (count > 1) { encodingConflicts.add(dir); errors.add('DEEPSEEK_ENCODING_CONFLICT'); }
      }
      // Detailed WorkBuddy logs supersede aggregate fallback, never sum them.
      files.sort((a, b) => Number(a.endsWith('.db')) - Number(b.endsWith('.db')));
      for (const file of files) {
        if (encodingConflicts.has(path.dirname(file))) continue;
        if (Date.now() - started > 55000) { errors.add('SOURCE_TIMEOUT'); if (report) report.failures++; break; }
        if (physical.has(file)) continue;
        fileCount++;
        try {
          const outcome = await parsedFile(agent, file, salt, audit, cache);
          if (outcome.partial) partial = true;
          skipped += outcome.skipped;
          for (const code of outcome.errors) errors.add(code);
          if (outcome.failure) throw new Error(outcome.failure);
          const parsed = outcome.records;
          physical.add(file);
          for (const record of parsed) {
            if (record.sharedKey) {
              const owner = shared.get(record.sharedKey);
              if (owner && owner.agent !== agent) {
                const choice = selectUsageSnapshot(owner,record);
                // Earlier results and the shared map retain this object. Replace
                // its snapshot contents while keeping that reference and identity.
                const snapshot = keepIdentity(owner,choice.record);
                for (const key of Object.keys(owner)) if (!Object.hasOwn(snapshot,key)) delete owner[key];
                Object.assign(owner,snapshot);
                if (choice.issue === 'SOURCE_USAGE_CONFLICT') {
                  errors.add(choice.issue);
                  const source = result[owner.agent];
                  if (source) { source.partial = true; if (!source.errors.includes(choice.issue)) source.errors.push(choice.issue); }
                }
                skipped++; continue;
              }
            }
            if (agent === 'workbuddy') {
              if (file.endsWith('.db') && detailedSessions.has(record.sessionKey)) continue;
              if (!file.endsWith('.db') && record.sessionKey) {
                detailedSessions.add(record.sessionKey);
              }
            }
            const old = records.get(record.id);
            const choice = selectUsageSnapshot(old,record);
            if (choice.issue === 'SOURCE_USAGE_CONFLICT') errors.add(choice.issue);
            records.set(record.id,choice.record);
            if (record.sharedKey) shared.set(record.sharedKey,choice.record);
          }
        } catch (error) { errors.add(/^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_PARSE_FAILED'); if (report) report.failures++; }
      }
    }
    const retained = [...records.values()].filter(record => record.accountingKind !== 'session-aggregate' || !detailedSessions.has(record.sessionKey));
    result[agent] = { records: retained, detected, fileCount, skipped, partial: partial || errors.size > 0, errors: [...errors], durationMs: Date.now() - started };
  }
  if (cache) for (const key of cache.files.keys()) if (!cache.seen.has(key)) cache.files.delete(key);
  return result;
}
module.exports = { parseObjects, parseDatabase, scanSources, sourceStamp, refreshCache };
