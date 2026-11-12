'use strict';
const { fileURLToPath } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SOURCES, filesUnder, readBytes, projectRoot, threadIndexes, threadNames } = require('./policy');
const { readDatabase, query } = require('./sqlite-memory');
const { normalize, number } = require('./normalize');
const extended = require('./extended-sources');
const antigravity = require('./antigravity');
const batch1 = require('./batch1-sources');
const extra = require('./batch1-extra-sources');
const {selectUsageSnapshot,keepIdentity} = require('./usage-snapshot');
const sessions = require('./sessions');
// Sources whose session ID and working directory have a recorded basis (SESSIONS-LAYER1).
const SESSION_SOURCES = new Set(['codex', 'claude', 'opencode', 'mimo', 'workbuddy', 'gemini', 'deepseek']);
function parseObjects(agent, objects, salt, fallbackSession) {
  if (agent === 'kilo') return extra.kilo(objects,salt);
  if (agent === 'gemini') return extended.gemini(objects, salt, fallbackSession);
  if (agent === 'cursor') return extended.cursor(objects, salt);
  const records = []; let context = { session: fallbackSession, model: 'unknown', entry: 'unknown' }, previous = null, previousSignature = null;
  const laneSignatures = new Map(), seen = new Map();
  const note = (session, cwd, name = null) => { const entry = SESSION_SOURCES.has(agent) && sessions.observe(agent, session, cwd, salt, name); if (entry) sessions.merge(seen, [entry]); };
  let current = null;
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
        if (p.id) note(p.id, p.cwd);
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
      if (typeof obj.sessionId === 'string') { current = obj.sessionId; note(obj.sessionId, obj.cwd); }
      // A /rename writes a custom-title row; only its customTitle is taken, never message text.
      if (obj.type === 'custom-title') { note(typeof obj.sessionId === 'string' ? obj.sessionId : current ?? fallbackSession, null, obj.customTitle); continue; }
      if (obj.type !== 'assistant' || !message?.usage) continue;
      const r = normalize(agent, message.usage, { id: message.id || obj.uuid, session: obj.sessionId || fallbackSession, model: message.model, time: obj.timestamp, entry: 'cli' }, salt, 'exclusive');
      if (r) records.push(r);
    } else if (agent === 'workbuddy') {
      const data = obj.providerData;
      // Every project JSONL row carries the session's working directory.
      if (typeof obj.cwd === 'string') note(obj.sessionId || fallbackSession, obj.cwd);
      const usage = data?.rawUsage || data?.usage || obj.usage;
      if (!usage) continue;
      const r = normalize(agent, usage, { id: data?.messageId || obj.id, model: data?.requestModelId || obj.model, time: obj.timestamp, session: obj.sessionId || fallbackSession }, salt, 'inclusive');
      if (r) records.push(r);
    } else {
      if (obj.role !== 'assistant' || !obj.tokens) continue;
      note(obj.sessionID || obj.session_id, null);
      const r = normalize(agent, obj.tokens, { id: obj.id, session: obj.sessionID || obj.session_id || fallbackSession, model: obj.modelID || obj.model?.id || obj.model, provider: obj.providerID || obj.model?.providerID, time: obj.time?.created ?? obj.timestamp, entry: obj.entry || 'unknown' }, salt, 'exclusive');
      if (r) records.push(r);
    }
  }
  records.sessions = [...seen.values()];
  return records;
}
// Session metadata from a session table: only its id and one working-directory
// column are read, and only when both exist. Sessions without usage are dropped
// later (parseFile keeps the sessions its records refer to).
function sessionRows(agent, db, table, column, salt) {
  const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name));
  if (!tables.has(table)) return [];
  const columns = new Set(query(db, 'PRAGMA table_info("' + table + '")').map(row => row.name));
  if (!columns.has('id') || !columns.has(column)) return [];
  const found = new Map();
  for (const row of query(db, 'SELECT id, "' + column + '" AS directory FROM "' + table + '"')) { const entry = sessions.observe(agent, row.id, row.directory, salt); if (entry) sessions.merge(found, [entry]); }
  return [...found.values()];
}
async function parseDatabase(agent, file, salt, audit) {
  return readDatabase(file, audit, db => {
    if (agent === 'continue') return extra.continueRows(query(db,'SELECT id, model, provider, tokens_prompt, tokens_generated, timestamp FROM tokens_generated'),salt);
    if (agent === 'kilo') return extra.kiloDatabase(query(db,'SELECT id, session_id, data FROM message'),salt);
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
    if (agent === 'zcode') {
      const records = extended.zcode(query(db, 'SELECT id, session_id, provider_id, model_id, started_at, completed_at, input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, provider_total_tokens, computed_total_tokens FROM model_usage'), salt);
      records.sessions = sessionRows(agent, db, 'session', 'directory', salt);
      return records;
    }
    if (agent === 'workbuddy') {
      const records = query(db, 'SELECT session_id, used, updated_at FROM session_usage WHERE used IS NOT NULL').map(row => {
        const record = normalize(agent, { total_tokens: row.used }, { id: 'aggregate:' + row.session_id, session: row.session_id, time: row.updated_at, model: 'unknown' }, salt);
        return record ? { ...record, accountingKind: 'session-aggregate' } : null;
      }).filter(Boolean);
      records.sessions = sessionRows(agent, db, 'sessions', 'cwd', salt);
      return records;
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
    // OpenCode and MiMo Code keep the working directory and their own session title
    // on the session row (SESSIONS-NEXT-20261101.md); no other column is read.
    if ((agent === 'opencode' || agent === 'mimo') && tables.has('session')) {
      const columns = new Set(query(db, 'PRAGMA table_info(session)').map(column => column.name));
      if (columns.has('directory')) {
        const rows = new Map(query(db, 'SELECT id, directory' + (columns.has('title') ? ', title' : '') + ' FROM session').map(row => [row.id, row]));
        records.sessions = records.sessions.map(entry => { const row = rows.get(entry.id); return { ...entry, cwd: sessions.directory(row?.directory) ?? entry.cwd, title: sessions.title(row?.title) ?? entry.title ?? null }; });
      }
    }
    if (invalid) records.warnings = ['SOURCE_ROW_INVALID'];
    return records;
  });
}
// Every input a file's parse depends on: its bytes, plus committed WAL pages for
// databases. Size and modification time stand in for those bytes.
// An Antigravity transcript's models and working directory come from two databases
// beside it, so those (and their WALs) are part of the transcript's stamp.
function fileStamp(file, agent) {
  const stat = fs.statSync(file); let stamp = stat.size + ':' + stat.mtimeMs;
  if (file.endsWith('.db') || file.endsWith('.sqlite')) {
    try { const wal = fs.statSync(file + '-wal'); stamp += '|wal:' + wal.size + ':' + wal.mtimeMs; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (agent === 'antigravity') for (const companion of antigravity.companions(file)) { try { stamp += '|db:' + fileStamp(companion); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  return stamp;
}
// The stamps of the side files a source's session titles come from (Codex's thread index).
// Continue's own list of its sessions, beside its usage database: id, title, time and folder, never a message.
function continueIndexes(selectedRoots) {
  return (selectedRoots.continue || []).filter(root => path.basename(root) === 'devdata.sqlite').map(root => path.join(path.dirname(path.dirname(root)), 'sessions')).flatMap(dir => { try { return filesUnder('transcript:continue-index', dir, { reads: 0 }).filter(file => path.dirname(file) === dir); } catch { return []; } });
}
function continueSessions(selectedRoots, salt, audit) {
  const seen = [];
  for (const file of continueIndexes(selectedRoots)) {
    let rows; try { rows = JSON.parse(readBytes(file, audit).toString('utf8')); } catch { continue; }
    for (const row of Array.isArray(rows) ? rows.slice(0, 5000) : []) {
      const millis = Number(row?.dateCreated), at = Number.isFinite(millis) && millis > 0 ? new Date(millis) : new Date(row?.dateCreated ?? NaN);
      if (Number.isNaN(at.getTime())) continue;
      let cwd; try { cwd = typeof row.workspaceDirectory === 'string' && row.workspaceDirectory.startsWith('file:') ? fileURLToPath(row.workspaceDirectory) : row.workspaceDirectory; } catch { cwd = null; }
      const meta = sessions.observe('continue', row.sessionId, cwd, salt, row.title);
      if (meta) seen.push({ ...meta, at: at.toISOString() });
    }
  }
  return seen;
}
function indexStamps(agent, selectedRoots) {
  if (agent === 'continue') return continueIndexes(selectedRoots).map(file => { try { return fileStamp(file, agent); } catch { return null; } });
  if (agent !== 'codex') return [];
  return threadIndexes(selectedRoots.codex || []).map(file => { try { return fileStamp(file, agent); } catch { return null; } });
}
// Files that hold the same calls as another listed file are read once.
function canonical(agent, files) { return agent === 'deepseek' ? extended.canonicalFiles(files) : agent === 'antigravity' ? antigravity.canonical(files) : files; }
function listFiles(agent, selectedRoots, audit) {
  let detected = false, files = []; const errors = [];
  for (const root of selectedRoots[agent] || []) {
    if (fs.existsSync(root)) detected = true;
    // Only fixed codes leave the listing: an OS error message would carry the path.
    try {
      const listed = filesUnder(agent, root, audit); files.push(...listed);
      if (listed.limited) errors.push('SOURCE_LIMIT');
      if (listed.aliased) errors.push('SOURCE_ALIAS_REJECTED');
      if (listed.unreadable) errors.push('SOURCE_UNREADABLE');
    } catch (error) { errors.push(/^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_UNREADABLE'); }
  }
  return { detected, files: [...new Set(files)], errors };
}
// One walk of every root, shared by the stamp, the refresh and the scan of the same
// collection. Each stage used to list the folders and stat every file again, so a
// refresh walked the same tree three times and stat'ed every file twice.
function* surveyEntries(selectedRoots, audit) {
  for (const agent of SOURCES) {
    const listed = listFiles(agent, selectedRoots, audit);
    yield;
    const stamps = new Map();
    for (const file of listed.files) {
      try { stamps.set(file, fileStamp(file, agent)); } catch { stamps.set(file, null); }
      yield;
    }
    yield { agent, detected: listed.detected, errors: [...listed.errors], all: listed.files, files: canonical(agent, listed.files).slice(), stamps, index: indexStamps(agent, selectedRoots) };
  }
}
function survey(selectedRoots, audit) {
  const agents = [];
  for (const entry of surveyEntries(selectedRoots, audit)) if (entry) agents.push(entry);
  return { agents };
}
async function surveyWithCheckpoint(selectedRoots, audit, checkpoint) {
  const agents = [];
  for (const entry of surveyEntries(selectedRoots, audit)) {
    if (entry) agents.push(entry);
    const wait = checkpoint();
    if (wait) await wait;
  }
  return { agents };
}
// Changes whenever a scan could produce a different result.
function sourceStamp(selectedRoots, salt, audit, prepared = null) {
  const hash = crypto.createHash('sha256').update(salt);
  const walk = prepared || survey(selectedRoots, audit);
  for (const entry of walk.agents) {
    hash.update(JSON.stringify([entry.agent, selectedRoots[entry.agent] || [], entry.detected, entry.errors, entry.index]));
    for (const file of entry.all) hash.update('\0' + file + '\0' + (entry.stamps.get(file) ?? 'unreadable'));
  }
  return hash.digest('hex');
}
async function parseFile(agent, file, salt, audit) {
  const outcome = { records: null, sessions: [], partial: false, skipped: 0, errors: [], failure: null };
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
      parsed = agent === 'kilo' ? batch1.cline(objects,salt,file,'kilo') : agent === 'qwen' ? extra.qwen(objects,salt) : agent === 'kimi' ? extra.kimi(objects,salt,file) : ['copilot','cline','pi'].includes(agent) ? batch1.parse(agent, objects, salt, file) : agent === 'deepseek' ? extended.deepseek(objects, salt, file) : agent === 'antigravity' ? await antigravity.parse(objects, file, salt, audit) : parseObjects(agent, objects, salt, path.basename(file));      if (agent === 'deepseek') { const header = objects[0]; const entry = header?.type === 'session' && sessions.observe(agent, header.id, header.cwd, salt); parsed.sessions = entry ? [entry] : []; }
      if (agent === 'gemini') {
        const cwd = projectRoot(file, audit), found = new Map();
        for (const obj of objects) { const entry = sessions.observe(agent, obj?.sessionId ?? obj?.$set?.sessionId, cwd, salt); if (entry) sessions.merge(found, [entry]); }
        parsed.sessions = [...found.values()];
      }
    }
    outcome.errors.push(...parsed.warnings || []);
    outcome.records = [...parsed];
    // Only sessions that carry usage: a usage-less line must not change the outcome.
    const used = new Set(outcome.records.map(record => record.sessionKey));
    outcome.sessions = (parsed.sessions || []).filter(entry => used.has(entry.key));
  } catch (error) { outcome.failure = /^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_PARSE_FAILED'; }
  return outcome;
}
// Public scans detach their results. The ledger owner's internal scan can share
// immutable ordinary observations; cross-source owners still need private copies
// because reconciliation below replaces their contents in place.
function scanOutcome(outcome, borrowRecords) {
  return { ...outcome, records: borrowRecords ? outcome.records.map(record => record.sharedKey ? structuredClone(record) : Object.freeze(record)) : structuredClone(outcome.records) };
}
const outcomeSignature = text => crypto.createHash('sha256').update(text).digest('hex');
function remember(cache,key,stamp,signature) {
  if(cache.fingerprints.size>=100000&&!cache.fingerprints.has(key))cache.fingerprints.delete(cache.fingerprints.keys().next().value);
  cache.fingerprints.set(key,{stamp,signature});
}
const listingSignature = walk => JSON.stringify(walk.agents.map(entry => [entry.agent, entry.detected, entry.errors, entry.index]));
async function parsedFile(agent, file, salt, audit, cache, knownStamp, borrowRecords) {
  if (!cache) return parseFile(agent, file, salt, audit);
  const key = agent + '\0' + file; cache.seen.add(key);
  let stamp = knownStamp === undefined ? null : knownStamp;
  if (knownStamp === undefined) { try { stamp = fileStamp(file, agent); } catch {} }
  const hit = cache.files.get(key);
  if (hit && stamp !== null && hit.stamp === stamp) return scanOutcome(hit.outcome, borrowRecords);
  const outcome = await parseFile(agent, file, salt, audit);
  if (outcome.failure || stamp === null) {cache.files.delete(key);cache.fingerprints?.delete(key);}
  else {
    cache.files.set(key, { stamp, outcome });
    if (cache.fingerprints) remember(cache,key,stamp,outcomeSignature(JSON.stringify(outcome)));
    return scanOutcome(outcome, borrowRecords);
  }
  return outcome;
}
// Re-parses only files whose stamp changed and reports whether any parse outcome,
// file or listing differs from what the cache held. Identical outcomes merge into an
// identical scan, so an unchanged report lets the caller skip the merge entirely.
async function refreshCache(selectedRoots, salt, audit, cache, prepared = null, checkpoint = null) {
  if (cache.salt !== salt) { cache.files.clear(); cache.fingerprints?.clear();cache.salt = salt; cache.listing = null; }
  const report = { changed: false, failures: 0 }, seen = new Set();
  const walk = prepared || survey(selectedRoots, audit);
  for (const entry of walk.agents) {
    const agent = entry.agent;
    for (const file of entry.files) {
      const wait = checkpoint?.();
      if (wait) await wait;
      const key = agent + '\0' + file; seen.add(key);
      const stamp = entry.stamps.has(file) ? entry.stamps.get(file) : null;
      const hit = cache.files.get(key);
      const fingerprint=cache.fingerprints?.get(key);
      if (stamp !== null && (hit?.stamp === stamp || fingerprint?.stamp===stamp)) continue;
      const outcome = await parseFile(agent, file, salt, audit);
      if (outcome.failure || stamp === null) { cache.files.delete(key);cache.fingerprints?.delete(key); report.failures++; report.changed = true; continue; }
      const serialized = JSON.stringify(outcome), signature = cache.fingerprints ? outcomeSignature(serialized) : null;
      const changed = fingerprint ? fingerprint.signature !== signature : !hit || JSON.stringify(hit.outcome) !== serialized;
      if (changed) report.changed = true;
      cache.files.set(key, { stamp, outcome });
      if (cache.fingerprints) remember(cache,key,stamp,signature);
    }
  }
  const signature = listingSignature(walk);
  if (cache.listing !== signature) { cache.listing = signature; report.changed = true; }
  for (const key of cache.files.keys()) if (!seen.has(key)) { cache.files.delete(key); report.changed = true; }
  if(cache.fingerprints)for(const key of cache.fingerprints.keys())if(!seen.has(key)){cache.fingerprints.delete(key);report.changed=true;}
  return report;
}
async function scanSources(selectedRoots, salt, audit, { cache = null, report = null, prepared = null, borrowRecords = false, checkpoint = null } = {}) {
  if (cache) { if (cache.salt !== salt) { cache.files.clear();cache.fingerprints?.clear(); cache.salt = salt; } cache.seen = new Set(); }
  const result = {}, physical = new Set(), shared = new Map();
  const walk = prepared || survey(selectedRoots, audit);
  for (const entry of walk.agents) {
    const agent = entry.agent;
    const records = new Map(), detailedSessions = new Set(), seenSessions = new Map(); let fileCount = 0, skipped = 0, partial = false;
    const started = Date.now();
    const detected = entry.detected, errors = new Set(entry.errors);
    let allFiles = entry.files;
    // Export snapshots and SDK runs are alternate Cursor acquisition modes.
    // Their identifiers cannot prove cross-mode identity; refuse ambiguous sums.
    if (agent === 'cursor' && allFiles.some(f => /\.csv$/i.test(f)) && allFiles.some(f => /\.(?:ndjson|db)$/i.test(f))) { errors.add('CURSOR_SOURCE_MODE_CONFLICT'); allFiles = []; }
    // Cumulative shutdown intervals cannot safely be summed with per-call OTel.
    if (agent === 'copilot' && allFiles.some(f => path.basename(f) === 'events.jsonl' && path.basename(path.dirname(path.dirname(f))) === 'session-state') && allFiles.some(f => f.split(path.sep).includes('otel'))) { errors.add('COPILOT_SOURCE_MODE_CONFLICT'); allFiles = []; }
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
        const wait = checkpoint?.();
        if (wait) await wait;
        if (encodingConflicts.has(path.dirname(file))) continue;
        if (Date.now() - started > 55000) { errors.add('SOURCE_TIMEOUT'); if (report) report.failures++; break; }
        if (physical.has(file)) continue;
        fileCount++;
        try {
          const outcome = await parsedFile(agent, file, salt, audit, cache, entry.stamps.has(file) ? entry.stamps.get(file) : undefined, borrowRecords);
          if (outcome.partial) partial = true;
          skipped += outcome.skipped;
          for (const code of outcome.errors) errors.add(code);
          if (outcome.failure) throw new Error(outcome.failure);
          const parsed = outcome.records;
          physical.add(file);
          sessions.merge(seenSessions, outcome.sessions);
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
    // Codex keeps thread names (a /rename or its own title) in session_index.jsonl beside its sessions folder.
    if (agent === 'codex' && seenSessions.size) { const names = threadNames(selectedRoots.codex || [], audit); if (names.size) for (const session of seenSessions.values()) { const name = sessions.title(names.get(session.id)); if (name) session.title = name; } }
    let retained = [...records.values()].filter(record => record.accountingKind !== 'session-aggregate' || !detailedSessions.has(record.sessionKey));
    if (agent === 'copilot' && retained.some(record => record.entry === 'cli')) {
      retained = batch1.copilotIntervals(retained);
      for (const code of retained.warnings) errors.add(code);
    }
    const listed = agent === 'continue' ? continueSessions(selectedRoots, salt, audit) : [];
    result[agent] = { records: retained, sessions: [...seenSessions.values(), ...listed], detected, fileCount, skipped, partial: partial || errors.size > 0, errors: [...errors], durationMs: Date.now() - started };
  }
  if (cache) {
    cache.listing = listingSignature(walk);
    for (const key of cache.files.keys()) if (!cache.seen.has(key)) cache.files.delete(key);
    if (cache.fingerprints) for (const key of cache.fingerprints.keys()) if (!cache.seen.has(key)) cache.fingerprints.delete(key);
  }
  return result;
}
module.exports = { parseObjects, parseDatabase, scanSources, sourceStamp, refreshCache, canonical, survey, surveyWithCheckpoint };
