'use strict';
// Usage-only projections. Format basis and deliberately unsupported variants:
// docs/m2/AGENT-BATCH1-CONTRACT-20261102.md. Never inspect message content,
// prompts, tools, manifests, credentials or account credit/cost fields.
const path = require('node:path');
const {normalize, number, timestamp} = require('./normalize');
const {selectUsageSnapshot} = require('./usage-snapshot');
const {observe} = require('./sessions');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
function result() { const rows = []; rows.warnings = []; rows.sessions = []; return rows; }
function warn(rows, code = 'SOURCE_ROW_INVALID') { if (!rows.warnings.includes(code)) rows.warnings.push(code); }
function add(rows, agent, usage, info, salt, semantics) {
  if (!object(usage) || !info.id || !info.session) { warn(rows); return; }
  const record = normalize(agent, usage, info, salt, semantics);
  if (!record) { warn(rows); return; }
  // A malformed supplied bucket is not the same as an unreported bucket.
  if (Object.values(usage).some(value => value != null && number(value) === null)) { record.quality = 'partial'; warn(rows); }
  rows.push(record);
}
function pi(objects, salt) {
  const rows = result(), header = objects.find(row => row?.type === 'session');
  if (!header || header.version !== 3 || !identity(header.id)) { warn(rows, 'SOURCE_FORMAT_UNSUPPORTED'); return rows; }
  const session = header.id;
  for (const row of objects) {
    const message = row?.message;
    if (row?.type !== 'message' || message?.role !== 'assistant' || !object(message.usage)) continue;
    const usage = message.usage, time = timestamp(message.timestamp ?? row.timestamp), id = identity(row.id);
    // Forked v3 files copy entries with their original IDs and timestamps.
    // Neither the file path nor the child's session ID changes a billed call.
    add(rows, 'pi', {input:usage.input, output:usage.output, cacheReadTokens:usage.cacheRead,
      cacheWriteTokens:usage.cacheWrite, reasoning:usage.reasoning, totalTokens:usage.totalTokens},
    {id:id && time ? JSON.stringify([id,time]) : null, session, model:message.model, provider:message.provider, time, entry:'cli'}, salt, 'exclusive');
  }
  const meta = observe('pi', session, header.cwd, salt); if (meta) rows.sessions.push(meta);
  return rows;
}
function cline(objects, salt, file, agent = 'cline') {
  const rows = result(), root = objects[0], cli = file.endsWith('.messages.json');
  const session = cli ? identity(root?.sessionId) : identity(path.basename(path.dirname(file)));
  const messages = cli ? root?.messages : root;
  if (!session || !Array.isArray(messages)) { warn(rows, 'SOURCE_FORMAT_UNSUPPORTED'); return rows; }
  for (const row of messages) {
    if (cli) {
      if (row?.role !== 'assistant' || !object(row.metrics)) continue;
      const u = row.metrics;
      add(rows, agent, {inputTokens:u.inputTokens, outputTokens:u.outputTokens, cacheReadTokens:u.cacheReadTokens, cacheWriteTokens:u.cacheWriteTokens},
        {id:identity(row.id) ? JSON.stringify(['cli',session,row.id]) : null, session, model:row.modelInfo?.id,
          provider:row.modelInfo?.provider, time:row.ts, entry:'cli'}, salt, 'inclusive');
    } else {
      if (row?.type !== 'say' || row.say !== 'api_req_started') continue;
      let u; try { u = JSON.parse(row.text); } catch { warn(rows); continue; }
      if (!object(u)) { warn(rows); continue; }
      // An in-progress request may not have reported usage yet.
      if (![u.tokensIn,u.tokensOut,u.cacheReads,u.cacheWrites].some(value => value != null)) continue;
      const time = timestamp(row.ts);
      const inclusive = agent === 'kilo' && (Date.parse(time) >= Date.parse('2025-11-02T00:00:00Z') || u.apiProtocol === 'openai');
      if (agent === 'kilo' && !inclusive) { warn(rows,'SOURCE_FORMAT_UNSUPPORTED'); continue; }
      add(rows, agent, {input:u.tokensIn, output:u.tokensOut, cacheReadTokens:u.cacheReads, cacheWriteTokens:u.cacheWrites},
        {id:time ? JSON.stringify(['ide',session,time]) : null, session, model:row.modelInfo?.modelId,
          provider:row.modelInfo?.providerId, time, entry:'desktop'}, salt, inclusive ? 'inclusive' : 'exclusive');
    }
  }
  const meta = observe(agent, session, null, salt); if (meta) rows.sessions.push(meta);
  return rows;
}
function copilotState(objects, salt, file) {
  const rows = result(), session = identity(path.basename(path.dirname(file))), snapshots = new Map();
  if (!session) { warn(rows); return rows; }
  for (const row of objects) {
    if (row?.type !== 'session.shutdown') continue;
    if (!object(row.data?.modelMetrics)) { warn(rows, 'USAGE_UNREPORTED'); continue; }
    for (const [model, metrics] of Object.entries(row.data.modelMetrics)) {
      const u = metrics?.usage;
      if (!object(u)) { warn(rows, 'USAGE_UNREPORTED'); continue; }
      const projected = result();
      add(projected, 'copilot', {inputTokens:u.inputTokens, outputTokens:u.outputTokens, cacheReadTokens:u.cacheReadTokens,
        cacheWriteTokens:u.cacheWriteTokens, reasoningTokens:u.reasoningTokens},
      {id:identity(row.id) ? JSON.stringify([session,model,row.id]) : null, session, model, time:row.timestamp, entry:'cli'}, salt, 'inclusive');
      for (const code of projected.warnings) warn(rows, code);
      const current = projected[0]; if (!current) continue;
      const choice = selectUsageSnapshot(snapshots.get(current.id), current);
      if (choice.issue) warn(rows, choice.issue);
      snapshots.set(current.id, choice.record);
    }
  }
  rows.push(...snapshots.values());
  const meta = observe('copilot',session,null,salt); if (meta) rows.sessions.push(meta);
  return rows;
}
// Reconstruct intervals from the complete set of saved + newly observed numeric
// checkpoints. Keeping those checkpoints in the app ledger allows an older file
// to disappear or arrive later without making a later interval count twice.
function copilotIntervals(records) {
  const rows = result(), snapshots = new Map();
  const fields = ['inputUncached','output','cacheRead','cacheWrite','reasoning','totalTokens'];
  for (const record of records) {
    const raw = {...record,...record.copilotCumulative};
    const choice = selectUsageSnapshot(snapshots.get(raw.id),raw);
    if (choice.issue) warn(rows,choice.issue);
    snapshots.set(raw.id,choice.record);
  }
  const previous = new Map();
  for (const current of [...snapshots.values()].sort((a,b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id))) {
    const key = JSON.stringify([current.sessionKey,current.model]);
    const before = previous.get(key), diff = {...current,copilotCumulative:Object.fromEntries([...fields,'quality'].map(field => [field,current[field]]))};
    if (before) {
      // A reset or shrinking bucket is ambiguous. Do not guess new spend or
      // erase the last accepted baseline. Existing saved history stays intact.
      if (fields.some(key => current[key] !== null && before[key] !== null && current[key] < before[key])) { warn(rows, 'SOURCE_USAGE_REGRESSION'); continue; }
      for (const key of fields) diff[key] = current[key] === null || before[key] === null ? null : current[key] - before[key];
      if (fields.some(key => current[key] !== null && before[key] === null)) diff.quality = 'partial';
    }
    previous.set(key, current);
    diff.accountingKind = 'session-model-interval';
    rows.push(diff);
  }
  return rows;
}
function otelTime(row) {
  const value = row.startTime ?? row.endTime ?? row.hrTime ?? row.timestamp;
  if (Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)) return timestamp(value[0] * 1000 + value[1] / 1e6);
  return timestamp(value);
}
function copilotOtel(objects, salt) {
  const rows = result();
  for (const row of objects) {
    const a = row?.attributes;
    // Only individual model-call spans. invoke_agent/turn summaries, logs,
    // histograms and metric exports can repeat those calls and are excluded.
    if (row?.type !== 'span' || !object(a) || a['gen_ai.operation.name'] !== 'chat') continue;
    if (a['gen_ai.usage.input_tokens'] == null && a['gen_ai.usage.output_tokens'] == null) { warn(rows,'USAGE_UNREPORTED'); continue; }
    const session = identity(a['gen_ai.conversation.id']) ?? identity(a['session.id']);
    const response = identity(a['gen_ai.response.id']), trace = identity(row.traceId), span = identity(row.spanId);
    const id = session && (response ? ['response',session,response] : trace && span ? ['span',trace,span] : null);
    add(rows,'copilot',{input:a['gen_ai.usage.input_tokens'],output:a['gen_ai.usage.output_tokens'],
      cacheReadTokens:a['gen_ai.usage.cache_read.input_tokens'],cacheWriteTokens:a['gen_ai.usage.cache_write.input_tokens'],
      reasoning:a['gen_ai.usage.reasoning_tokens'],total:a['gen_ai.usage.total_tokens']},
    {id:id && JSON.stringify(id),session,model:a['gen_ai.response.model'] ?? a['gen_ai.request.model'],time:otelTime(row),entry:'otel'},salt,'inclusive');
  }
  return rows;
}
function parse(agent, objects, salt, file) {
  if (agent === 'pi') return pi(objects,salt);
  if (agent === 'cline') return cline(objects,salt,file);
  return path.basename(file) === 'events.jsonl' && path.basename(path.dirname(path.dirname(file))) === 'session-state'
    ? copilotState(objects,salt,file) : copilotOtel(objects,salt);
}
module.exports = {parse, pi, cline, copilotState, copilotOtel, copilotIntervals};
