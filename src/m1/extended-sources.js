'use strict';
// Field projection only. No SDK execution, credentials, source mutation or network.
const path = require('node:path');
const zlib = require('node:zlib');
const {normalize, number, digest} = require('./normalize');
const {frameEnd} = require('./zstd-frame');
const {selectUsageSnapshot} = require('./usage-snapshot');

function marked(records, warning) {
  records.warnings ||= [];
  if (!records.warnings.includes(warning)) records.warnings.push(warning);
  return records;
}
function camelUsage(usage) {
  return {inputTokens:usage.inputTokens, outputTokens:usage.outputTokens, totalTokens:usage.totalTokens,
    cacheReadTokens:usage.cacheReadTokens, cacheWriteTokens:usage.cacheWriteTokens, reasoningTokens:usage.reasoningTokens};
}
function gemini(objects, salt, fallback) {
  const messages = new Map(), warnings = new Set(); let session = fallback;
  function add(message) {
    if (message?.type !== 'gemini' || !message.tokens || typeof message.id !== 'string') return;
    const t = message.tokens;
    const record = normalize('gemini', {input:t.input, output:t.output, cached_input_tokens:t.cached, reasoning:t.thoughts, total:t.total},
      {id:session + ':' + message.id, session, model:message.model, time:message.timestamp, entry:'cli', outputExcludesReasoning:true}, salt);
    if (record) {
      // Tool-use prompt tokens are not assumed to overlap with promptTokenCount.
      // Preserve an authoritative total, but refuse to invent a pricing bucket.
      if (number(t.tool) > 0) { record.totalTokens = number(t.total) ?? record.totalTokens; record.quality = 'partial'; }
      const choice = selectUsageSnapshot(messages.get(record.id),record);
      if (choice.issue === 'SOURCE_USAGE_CONFLICT') warnings.add(choice.issue);
      messages.set(record.id,choice.record);
    }
  }
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    if (typeof obj.sessionId === 'string') session = obj.sessionId;
    if (typeof obj.$set?.sessionId === 'string') session = obj.$set.sessionId;
    for (const message of obj.messages || obj.$set?.messages || []) add(message);
    add(obj);
    // Rewinds/content patches change the conversation view, not incurred usage.
    // They have no token fields in the official recording contract.
  }
  const result = [...messages.values()];
  for (const warning of warnings) marked(result,warning);
  return result;
}
function cursor(objects, salt) {
  const records = [];
  for (const obj of objects) {
    if (!obj?.usage) { marked(records, 'USAGE_UNREPORTED'); continue; }
    if (typeof obj.runId !== 'string' || typeof obj.agentId !== 'string') { marked(records, 'SOURCE_ROW_INVALID'); continue; }
    const record = normalize('cursor', camelUsage(obj.usage), {id:'sdk:' + obj.agentId + ':' + obj.runId, session:obj.agentId,
      model:obj.model?.id, time:obj.startedAt ?? obj.createdAt, entry:'sdk'}, salt, 'exclusive');
    if (record) records.push(record); else marked(records, 'SOURCE_ROW_INVALID');
  }
  return records;
}
// Bounded RFC 4180 reader; quoted commas/newlines and escaped quotes are valid.
function csvRows(text) {
  const rows = []; let row = [], value = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else value += c;
    } else if (c === '"' && value === '' && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(value); value = ''; closed = false;
      if (c !== ',') { if (c === '\r' && text[i + 1] === '\n') i++; if (row.some(v => v !== '')) rows.push(row); row = []; }
    } else { if (closed || c === '"') throw new Error('CURSOR_CSV_INVALID'); value += c; }
    if (rows.length > 1000000 || value.length > 1024 * 1024) throw new Error('SOURCE_LIMIT');
  }
  if (quoted) throw new Error('CURSOR_CSV_INVALID');
  if (row.length || value !== '') { row.push(value); rows.push(row); }
  return rows;
}
function cursorCsv(text, salt) {
  const rows = csvRows(text.replace(/^\uFEFF/, '')), header = rows.shift() || [], keys = header.map(k => k.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  if (new Set(keys).size !== keys.length) throw new Error('CURSOR_CSV_SCHEMA');
  const index = (...names) => names.map(n => keys.indexOf(n)).find(n => n >= 0) ?? -1;
  const timeIndex = index('date','timestamp'), modelIndex = index('model');
  const inputIndex = index('inputtokenswocachewrite','inputtokens'), readIndex = index('cachereadtokens'), writeIndex = index('cachewritetokens'), outputIndex = index('outputtokens'), totalIndex = index('totaltokens');
  const combinedIndex = index('inputtokenswcachewrite'), baseIndex = index('inputtokenswocachewrite');
  if ([timeIndex, modelIndex, inputIndex, readIndex, outputIndex].some(i => i < 0) || writeIndex < 0 && (combinedIndex < 0 || baseIndex < 0)) throw new Error('CURSOR_CSV_SCHEMA');
  const requestIndex = index('requestid','usageid'), seen = new Map(), records = [];
  const count = v => typeof v === 'string' && /^(?:0|[1-9]\d*)$/.test(v.trim()) ? number(Number(v.trim())) : null;
  for (const row of rows) {
    const time = row[timeIndex], date = typeof time === 'string' ? new Date(time.slice(0,10) + 'T00:00:00Z') : null;
    if (row.length !== header.length || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(time) || !date || !Number.isFinite(date.valueOf()) || date.toISOString().slice(0,10) !== time.slice(0,10)) { marked(records, 'SOURCE_ROW_INVALID'); continue; }
    const combined = combinedIndex < 0 ? null : count(row[combinedIndex]), base = baseIndex < 0 ? null : count(row[baseIndex]);
    const cacheWrite = writeIndex >= 0 ? count(row[writeIndex]) : combined !== null && base !== null ? number(combined - base) : null;
    const usage = {inputTokens:count(row[inputIndex]), outputTokens:count(row[outputIndex]), cacheReadTokens:count(row[readIndex]), cacheWriteTokens:cacheWrite, totalTokens:totalIndex < 0 ? undefined : count(row[totalIndex])};
    if (Object.values(usage).some(v => v === null)) { marked(records, 'SOURCE_ROW_INVALID'); continue; }
    const record = normalize('cursor', usage, {id:'pending', time:row[timeIndex], model:row[modelIndex], entry:'export'}, salt, 'exclusive');
    if (!record) { marked(records, 'SOURCE_ROW_INVALID'); continue; }
    const signature = csvIdentity(record), occurrence = seen.get(signature) || 0; seen.set(signature, occurrence + 1);
    const request = requestIndex >= 0 && row[requestIndex];
    record.id = digest(salt,'cursor:csv:' + (request || signature + ':' + occurrence));
    record.csvIdentity = request ? null : digest(salt,'cursor-export/2:' + signature + ':' + occurrence);
    records.push(record);
  }
  return records;
}
function csvIdentity(record) { return JSON.stringify([record.timestamp,record.model,record.inputUncached,record.output,record.cacheRead,record.cacheWrite]); }
function generation(file) { const match = /^session(?:\.v([1-9]\d*))?\.jsonl(?:\.zstd)?$/.exec(path.basename(file)); return match ? Number(match[1] || 0) : null; }
function canonicalFiles(files) {
  const groups = new Map();
  for (const file of files) {
    const dir = path.dirname(file), version = generation(file), old = groups.get(dir);
    if (!old || version > old.version) groups.set(dir, {version, files:[file]});
    else if (version === old.version && !old.files.includes(file)) old.files.push(file);
  }
  return [...groups.values()].flatMap(group => group.files);
}
function decodeDeepseek(bytes, compressed, onIncomplete) {
  if (!compressed) return bytes.toString('utf8');
  if (typeof zlib.zstdDecompressSync !== 'function') throw new Error('SOURCE_COMPRESSION_UNSUPPORTED');
  // Node's synchronous API ends at the first frame. The harness appends one
  // frame per durable batch, so advance by the decoder's consumed byte count.
  try {
    const chunks = []; let offset = 0, size = 0;
    while (offset < bytes.length) {
      const end = frameEnd(bytes,offset);
      if (end === null) { if (!onIncomplete) throw new Error('INCOMPLETE_FRAME'); onIncomplete(); break; }
      const decoded = zlib.zstdDecompressSync(bytes.subarray(offset,end), {info:true, maxOutputLength:512 * 1024 * 1024 - size});
      if (decoded.engine.bytesWritten !== end - offset) throw new Error('INVALID_FRAME');
      offset = end; size += decoded.buffer.length; chunks.push(decoded.buffer);
      if (size >= 512 * 1024 * 1024 || chunks.length > 1000000) throw new Error('SOURCE_LIMIT');
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  catch { throw new Error('SOURCE_COMPRESSION_INVALID'); }
}
function deepseek(objects, salt, file) {
  const header = objects[0], version = generation(file), records = [];
  if (!header || header.type !== 'session' || typeof header.id !== 'string' || typeof header.isSeeded !== 'boolean' || header.version !== version || ![2,3,4].includes(version)) throw new Error('DEEPSEEK_FORMAT_UNSUPPORTED');
  const events = objects.slice(1); let cut = -1;
  if (header.isSeeded === true) {
    for (const event of events) if (event?.type === 'session/end-seed' && event.data?.inherited === true) cut = event.seq;
    if (number(cut) === null) throw new Error('DEEPSEEK_SEED_INVALID');
  } else if (events.some(e => e?.type === 'session/end-seed' && e.data?.inherited === true)) throw new Error('DEEPSEEK_SEED_INVALID');
  let model, provider, expected = 0; const attempts = new Map();
  for (const event of events) {
    if (!event || event.seq !== expected++) { marked(records, 'DEEPSEEK_LOG_INCOMPLETE'); break; }
    const data = event.data || {};
    if (event.type === 'request/header') { model = data.header?.config?.model; provider = data.header?.config?.provider; }
    if (event.type === 'request/context') { model = data.model; provider = data.provider; }
    if (!['assistant/message','assistant/attempt'].includes(event.type)) continue;
    // Format migrations insert/remap event seqs. The logical call coordinates
    // and retry order remain stable, so a later generation cannot rebill old
    // calls under new physical sequence numbers.
    const turn = number(data.turn), step = number(data.step);
    if (turn === null || step === null) { if (event.seq > cut) marked(records,'SOURCE_ROW_INVALID'); continue; }
    const lane = turn + ':' + step, attempt = attempts.get(lane) || 0; attempts.set(lane,attempt + 1);
    if (event.seq <= cut) continue;
    // A final assembled counter wins over stream snapshots for this attempt.
    let usage = data.usage;
    if (!usage) for (const part of data.stream || []) if (part.type === 'chunk' && part.chunk?.type === 'usage') usage = part.chunk.usage;
    if (!usage) { marked(records, 'USAGE_UNREPORTED'); continue; }
    const source = data.message?.source;
    const record = normalize('deepseek', camelUsage(usage), {id:header.id + ':call:' + lane + ':' + attempt, session:header.id, model:source?.model ?? model, provider:source?.provider ?? provider, time:event.time, entry:'harness'}, salt, 'exclusive');
    if (record) records.push(record); else marked(records, 'SOURCE_ROW_INVALID');
  }
  return records;
}
function zcode(rows, salt) {
  const records = [];
  for (const row of rows) {
    if (typeof row.id !== 'string') { marked(records, 'SOURCE_ROW_INVALID'); continue; }
    // This installed schema reports inclusive input/output. If a future build
    // changes those buckets, its exact computed total must establish the split.
    const input = number(row.input_tokens), output = number(row.output_tokens), total = number(row.computed_total_tokens);
    const caches = (number(row.cache_read_input_tokens) ?? 0) + (number(row.cache_creation_input_tokens) ?? 0), reasoning = number(row.reasoning_tokens) ?? 0;
    let semantics = 'inclusive', separateReasoning = false;
    if (input !== null && output !== null && total !== null && total !== input + output) {
      if (total === input + output + caches) semantics = 'exclusive';
      else if (total === input + output + caches + reasoning) { semantics = 'exclusive'; separateReasoning = true; }
    }
    const usage = {input_tokens:row.input_tokens, output_tokens:row.output_tokens, reasoning_output_tokens:row.reasoning_tokens, cache_read_input_tokens:row.cache_read_input_tokens, cache_creation_input_tokens:row.cache_creation_input_tokens, total_tokens:row.provider_total_tokens ?? row.computed_total_tokens};
    const record = normalize('zcode', usage, {id:row.id, session:row.session_id, model:row.model_id, provider:row.provider_id, time:row.started_at ?? row.completed_at, entry:'cli', outputExcludesReasoning:separateReasoning}, salt, semantics);
    if (record) { if (total !== null && total !== record.totalTokens) record.quality = 'total-mismatch'; records.push(record); } else if (total !== null) marked(records, 'SOURCE_ROW_INVALID');
  }
  return records;
}
module.exports = {gemini, cursor, cursorCsv, csvIdentity, csvRows, generation, canonicalFiles, decodeDeepseek, deepseek, zcode};
