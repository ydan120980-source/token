'use strict';
// The session list the window accepts: a whitelist over Store.sessionList(). It carries
// the local session ID and working directory for display, but never the resume command
// (built in the main process on copy) and is never written by the statistics export.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./agent-catalog'));else root.sessionListContract=factory(root.agentCatalog);})(typeof window==='object'?window:globalThis,function(builtin){
const ENTRIES = new Set(['desktop', 'cli', 'sdk', 'export', 'harness', 'unknown']);
const COUNTS = ['totalTokens', 'records', 'partialRecords', 'pricedTokens', 'boundedTokens'];
const NULLABLE = ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'estimatedCostUsd', 'estimatedCostUpperUsd'];
const KNOWN = ['inputUncached', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'outputPlain'];
function text(value, limit) { return typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\0-\x1f\x7f]/.test(value) ? value : null; }
function time(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && value.length <= 40 ? value : null; }
function count(value, nullable) { if (value === null && nullable) return null; if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_SESSION_LIST'); return value; }
const knownUsage = value => Object.fromEntries(Object.entries(value || {}).filter(([key, amount]) => KNOWN.includes(key) && Number.isFinite(amount) && amount >= 0));
function day(row) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row?.date)) throw new Error('INVALID_SESSION_LIST');
  const selected = { date: row.date };
  for (const field of COUNTS) selected[field] = count(row[field] ?? 0, false);
  for (const field of NULLABLE) selected[field] = count(row[field] ?? null, true);
  selected.knownUsage = knownUsage(row.knownUsage);
  return selected;
}
// Validate packed values directly into the final day. The codec checks row
// dimensions/indices first; counts, nulls, dates and usage use the same rules as
// ordinary object selection. No expanded intermediate day or field-pair arrays.
function selectPackedDay(date, values, usage) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('INVALID_SESSION_LIST');
  const selected = { date };
  for (let index = 0; index < COUNTS.length; index++) selected[COUNTS[index]] = count(values[index + 1] ?? 0, false);
  for (let index = 0; index < NULLABLE.length; index++) selected[NULLABLE[index]] = count(values[COUNTS.length + index + 1] ?? null, true);
  selected.knownUsage = knownUsage(usage);
  return selected;
}
function createSelector(catalog=builtin.agents) {
 const sourceTypes=new Set(Object.keys(catalog));
 return session=>{
    if (!/^[a-f0-9]{64}$/.test(session?.key) || !sourceTypes.has(session.agent) || !Array.isArray(session.days) || session.days.length > 4000) throw new Error('INVALID_SESSION_LIST');
    const start = time(session.start), end = time(session.end);
    if (!start || !end) throw new Error('INVALID_SESSION_LIST');
    return {
      key: session.key, agent: session.agent,
      entries: (Array.isArray(session.entries) ? session.entries : []).map(entry => ENTRIES.has(entry) ? entry : 'unknown').filter((entry, index, all) => all.indexOf(entry) === index),
      models: (Array.isArray(session.models) ? session.models : []).map(model => text(model, 180) || '模型未记录').slice(0, 24),
      start, end, id: text(session.id, 200), cwd: text(session.cwd, 1024), title: text(session.title, 200), project: text(session.project, 260), resumable: session.resumable === true,
      days: session.days.map(day)
    };

 };
}
function selectSessions(list, catalog=builtin.agents) {
 const sourceTypes=new Set(Object.keys(catalog));
 if(list?.schemaVersion!=='SessionListV1'||!Array.isArray(list.sessions)||list.sessions.length>50000)throw Error('INVALID_SESSION_LIST');
 const sessions=list.sessions.map(createSelector(catalog));
  // Records without a session identity, per Agent and local day.
  const unattributed = Object.fromEntries(Object.entries(list.unattributed || {}).filter(([agent, days]) => sourceTypes.has(agent) && days && typeof days === 'object').map(([agent, days]) => [agent, Object.fromEntries(Object.entries(days).filter(([date, value]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isSafeInteger(value) && value > 0))]));
  return { schemaVersion: 'SessionListV1', sequence: count(list.sequence ?? 0, false), timezone: text(list.timezone, 64) || 'Asia/Shanghai', today: /^\d{4}-\d{2}-\d{2}$/.test(list.today) ? list.today : null, sessions, unattributed };
}
return { selectSessions, createSelector, selectPackedDay, COUNTS, NULLABLE };
});
