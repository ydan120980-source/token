'use strict';
// Run only after npm run verify && npm run test:native. The original source
// content never leaves memory; report contains anonymous aggregate counters.
const fs = require('node:fs');
const path = require('node:path');
const { roots, filesUnder, readBytes, disableNetwork, SOURCES } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { readDatabase, query } = require('../../src/m1/sqlite-memory');
const { verifyProjection } = require('../../src/m1/native');
const { Store, atomic } = require('../../src/m1/store');
const crypto = require('node:crypto');
async function independent(agent, file, audit) {
  if (file.endsWith('.db')) return readDatabase(file, audit, db => {
    const tables = new Set(query(db, "SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name));
    if (agent === 'workbuddy') return { expected: query(db, 'SELECT used FROM session_usage').reduce((s, r) => s + (Number.isSafeInteger(r.used) ? r.used : 0), 0), method: 'independent-session-total-sum', comparable: true };
    let sum = 0, count = 0;
    for (const table of ['message', 'session_message']) if (tables.has(table)) for (const row of query(db, 'SELECT data' + (table === 'session_message' ? ',type' : '') + ' FROM ' + table)) {
      const data = JSON.parse(row.data), u = data.tokens; if ((data.role || row.type) !== 'assistant' || !u) continue;
      const values = [u.input, u.output, u.cache?.read, u.cache?.write, u.reasoning];
      if (values.every(v => Number.isSafeInteger(v) && v >= 0)) { sum += values.reduce((s, v) => s + v, 0); count++; }
    }
    return { expected: sum, records: count, method: 'independent-disjoint-five-bucket-sum', comparable: count > 0 };
  });
  const rows = readBytes(file, audit).toString('utf8').split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  if (agent === 'codex') {
    const totals = rows.filter(r => r.type === 'event_msg' && r.payload?.type === 'token_count').map(r => r.payload.info?.total_token_usage?.total_tokens).filter(Number.isSafeInteger);
    const fork = rows.some(r => r.type === 'session_meta' && (r.payload?.forked_from_id || r.payload?.parent_thread_id));
    return { expected: totals.at(-1) ?? 0, method: 'independent-final-session-cumulative-total', comparable: totals.length > 0 && !fork };
  }
  const byId = new Map();
  for (const row of rows) {
    if (agent === 'claude' && row.type === 'assistant' && row.message?.usage) {
      const u = row.message.usage, values = [u.input_tokens, u.output_tokens, u.cache_read_input_tokens, u.cache_creation_input_tokens];
      if (values.every(v => Number.isSafeInteger(v) && v >= 0)) byId.set(row.message.id || row.uuid, values.reduce((s, v) => s + v, 0));
    }
    if (agent === 'workbuddy' && row.providerData?.rawUsage && Number.isSafeInteger(row.providerData.rawUsage.total_tokens)) byId.set(row.providerData.messageId || row.id, row.providerData.rawUsage.total_tokens);
  }
  return { expected: [...byId.values()].reduce((s, v) => s + v, 0), method: 'independent-unique-message-bucket-ledger', comparable: byId.size > 0 };
}
(async () => {
  const directory = fs.mkdtempSync(path.resolve('.cache/local-validation-')), selected = roots(), salt = crypto.randomBytes(32).toString('hex'), audit = { reads: 0, networkAttempts: 0 };
  disableNetwork(audit); const started = Date.now(), scan = await scanSources(selected, salt, audit);
  const native = await verifyProjection(Object.values(scan).flatMap(s => s.records), path.join(directory, 'native'));
  const elapsed = Date.now() - started, report = { at: new Date().toISOString(), elapsedMs: elapsed, audit, native, sources: {} }, validation = {};
  for (const agent of SOURCES) {
    const samples = [], candidates = selected[agent].flatMap(root => filesUnder(agent, root, audit));
    for (const file of candidates.slice().reverse()) {
      if (samples.length >= 3) break;
      try {
        const source = await independent(agent, file, audit);
        if (!source.comparable || source.expected === 0) continue;
        const single = await scanSources({ [agent]: [file] }, salt, audit), actual = single[agent].records.reduce((s, r) => s + r.totalTokens, 0);
        samples.push({ method: source.method, expectedTokens: source.expected, actualTokens: actual, matches: source.expected === actual });
      } catch { /* Unsupported schemas remain unverified. No original error/path logged. */ }
    }
    const verified = samples.length > 0 && samples.every(s => s.matches) && scan[agent].errors.length === 0;
    report.sources[agent] = { detected: scan[agent].detected, files: scan[agent].fileCount, records: scan[agent].records.length, tokens: scan[agent].records.reduce((s, r) => s + r.totalTokens, 0), errors: scan[agent].errors, partial: scan[agent].partial, samples, verified };
    validation[agent] = { verified, at: report.at, sampleCount: samples.length };
  }
  const store = new Store(path.join(directory, 'statistics'), selected); store.validation = validation; store.ingest(scan, native);
  fs.mkdirSync('artifacts', { recursive: true }); atomic('artifacts/local-validation.json', report);
  atomic(path.join(process.env.APPDATA, 'AgentUsage-M1/validation.json'), validation);
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(/^[A-Z_]+$/.test(error.message) ? error.message : 'LOCAL_VALIDATION_FAILED'); process.exitCode = 1; });
