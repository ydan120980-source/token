'use strict';
// Conversations of the Agents added to the reading view on the owner's 2026-11-04 decision
// (docs/m2/SESSIONS-READER-MORE-20261104.md). Same rules as transcript.js: read when the person opens a session,
// shown and never kept. Each reader takes the Builder from transcript.js and fills it. The formats come from each
// project's public source or, where that is noted, a third party's description; none was checked on real records.

// What a reader may use from transcript.js, passed in so the two modules do not import each other.
function textOf(content) {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : []).map(part => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n');
}
const parsed = text => { try { return JSON.parse(text); } catch { return null; } };
const tokens = (input, output, read, write, total) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: read, cache_creation_input_tokens: write, total_tokens: total });
// The path from the last entry back to the root: what the Agent itself treats as the conversation. A record that
// rewound or forked leaves other branches in the file. Records without ids (older files) are read in file order.
function branch(rows, idOf, parentOf) {
  const byId = new Map(), keyed = rows.filter(row => idOf(row));
  for (const row of keyed) byId.set(idOf(row), row);
  if (!keyed.length) return rows;
  const path = [], seen = new Set();
  for (let row = keyed.at(-1); row && !seen.has(row); row = byId.get(parentOf(row))) { seen.add(row); path.push(row); }
  return path.reverse();
}

// Anthropic-shaped messages, as Cline and Kilo Code keep them.
const RESULT_ECHO = /^\[[^\]\n]{1,120}\] Result:/;
function clineUser(out, text, at, h) {
  const inner = String(text).replace(/<environment_details>[\s\S]*?<\/environment_details>/g, match => { out.text('context', match, at); return ''; }).trim();
  if (!inner) return;
  if (RESULT_ECHO.test(inner)) { out.text('context', inner, at); return; }
  h.userText(out, inner.replace(/^<(task|feedback|answer|user_message)>\s*([\s\S]*?)\s*<\/\1>$/, '$2'), at);
}
function blocks(out, role, content, at, h) {
  if (typeof content === 'string') { if (role === 'user') clineUser(out, content, at, h); else out.text('assistant', content, at); return; }
  for (const block of Array.isArray(content) ? content : []) {
    if (block?.type === 'text') { if (role === 'user') clineUser(out, block.text ?? '', at, h); else out.text('assistant', block.text, at); }
    else if (block?.type === 'thinking') out.text('thinking', block.thinking ?? block.text, at);
    else if (block?.type === 'tool_use') out.call(block.id, block.name, block.input, at);
    else if (block?.type === 'tool_result') out.result(block.tool_use_id, textOf(block.content), block.is_error === true);
    else if (block?.type === 'image' && block.source?.type === 'base64') out.image(role, block.source.media_type, block.source.data, at);
    else if (block && typeof block === 'object') out.unknown(block.type, block, at);
  }
}
function cline(out, document, agent, h) {
  const messages = Array.isArray(document) ? document : Array.isArray(document?.messages) ? document.messages : [];
  for (const message of messages) {
    if (out.full()) { out.truncated = true; break; }
    if (message?.role !== 'user' && message?.role !== 'assistant') continue;
    blocks(out, message.role, message.content, message.ts, h);
    const used = message.metrics;
    if (message.role === 'assistant' && used) out.usage(agent, { input_tokens: used.inputTokens, output_tokens: used.outputTokens, cached_input_tokens: used.cacheReadTokens }, 'inclusive');
  }
  return out.value();
}

// Pi v3: a tree of entries, each message in pi-ai's shape (pi-mono session-manager.ts, ai/types.ts).
function pi(out, rows, h) {
  const entries = branch(rows.filter(row => row && typeof row === 'object' && row.type !== 'session' && row.type !== 'label'), row => row.id, row => row.parentId);
  for (const row of entries) {
    if (out.full()) { out.truncated = true; break; }
    const at = row.message?.timestamp ?? row.timestamp;
    if (row.type === 'compaction') { out.compact(at, null, row.tokensBefore); out.text('context', row.summary, at); continue; }
    if (row.type === 'branch_summary') { out.text('context', row.summary, at); continue; }
    if (row.type === 'custom_message') { if (row.display !== false) out.text('context', textOf(row.content), at); continue; }
    if (row.type !== 'message' || !row.message) continue;
    const message = row.message, parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : Array.isArray(message.content) ? message.content : [];
    if (message.role === 'user') {
      for (const part of parts) { if (part?.type === 'text') h.userText(out, part.text, at); else if (part?.type === 'image') out.image('user', part.mimeType, part.data, at); }
    } else if (message.role === 'assistant') {
      for (const part of parts) {
        if (part?.type === 'text') out.text('assistant', part.text, at);
        else if (part?.type === 'thinking') { if (!part.redacted) out.text('thinking', part.thinking, at); }
        else if (part?.type === 'toolCall') out.call(part.id, part.name, part.arguments, at);
      }
      if (message.errorMessage) out.text('context', message.errorMessage, at);
      const used = message.usage; if (used) out.usage('pi', tokens(used.input, used.output, used.cacheRead, used.cacheWrite, used.totalTokens), 'exclusive');
    } else if (message.role === 'toolResult') out.result(message.toolCallId, textOf(parts), message.isError === true);
    else if (message.role === 'bashExecution') { const item = out.call(row.id, 'bash', { command: message.command }, at); if (item) out.attach(item, message.output ?? '', Number.isInteger(message.exitCode) && message.exitCode !== 0); }
    else out.text('context', textOf(parts) || message.summary, at);
  }
  return out.value();
}

// GitHub Copilot CLI: a flat event log (copilot-sdk generated/session-events.ts).
function copilot(out, rows, h) {
  for (const row of rows) {
    if (out.full()) { out.truncated = true; break; }
    const data = row?.data, at = row?.timestamp;
    if (!data || typeof data !== 'object') continue;
    out.side = typeof data.parentToolCallId === 'string' ? data.parentToolCallId.slice(0, 12) : null;
    if (row.type === 'user.message') h.userText(out, data.content, at);
    else if (row.type === 'assistant.reasoning') out.text('thinking', data.content, at);
    else if (row.type === 'assistant.message') {
      if (typeof data.reasoningText === 'string') out.text('thinking', data.reasoningText, at);
      out.text('assistant', data.content, at);
      for (const request of Array.isArray(data.toolRequests) ? data.toolRequests : []) if (!out.calls.has(request?.toolCallId)) out.call(request?.toolCallId, request?.name, request?.arguments, at);
    } else if (row.type === 'tool.execution_start') { if (!out.calls.has(data.toolCallId)) out.call(data.toolCallId, data.toolName, data.arguments, at); }
    else if (row.type === 'tool.execution_complete') out.result(data.toolCallId, data.success === false ? data.error?.message ?? data.result?.content ?? '' : data.result?.detailedContent ?? data.result?.content ?? '', data.success === false);
    else if (row.type === 'session.compaction_complete' && data.success !== false) out.compact(at, null, data.preCompactionTokens);
    // Errors, warnings and notices the record carries as words: every other event is bookkeeping.
    else if (typeof row.type === 'string' && (typeof data.message === 'string' || typeof data.content === 'string')) out.text('context', data.message ?? data.content, at, { label: row.type, merge: true });
  }
  out.side = null;
  return out.value();
}

// Qwen Code: chat records chained by parentUuid, with Gemini-style parts (chatRecordingService.ts).
function qwen(out, rows, h) {
  const usable = rows.filter(row => row && typeof row === 'object' && ['user', 'assistant', 'tool_result', 'system'].includes(row.type));
  const main = new Set(branch(usable.filter(row => !row.isSidechain), record => record.uuid, record => record.parentUuid));
  // The chain the Agent treats as the conversation, and its sub-agents' rows where they happened.
  for (const row of usable.filter(item => item.isSidechain || main.has(item))) {
    if (out.full()) { out.truncated = true; break; }
    const at = row.timestamp;
    out.side = row.isSidechain ? String(row.agentId ?? 'agent').slice(0, 40) : null;
    if (row.type === 'system') { if (row.subtype === 'chat_compression') out.compact(at, null, null); continue; }
    for (const part of Array.isArray(row.message?.parts) ? row.message.parts : []) {
      if (typeof part?.text === 'string') {
        if (part.thought === true) out.text('thinking', part.text, at);
        else if (row.type === 'user') h.userText(out, part.text, at); else out.text('assistant', part.text, at);
      } else if (part?.functionCall) out.call(part.functionCall.id ?? part.functionCall.name, part.functionCall.name, part.functionCall.args, at);
      else if (part?.functionResponse) {
        const answer = part.functionResponse.response;
        out.result(part.functionResponse.id ?? part.functionResponse.name, answer?.error ?? answer?.output ?? answer ?? '', Boolean(answer?.error) || row.toolCallResult?.status === 'error');
      } else if (part?.inlineData) out.image(row.type === 'user' ? 'user' : 'assistant', part.inlineData.mimeType, part.inlineData.data, at);
    }
    const used = row.usageMetadata;
    if (used) out.usage('qwen', { input_tokens: used.promptTokenCount, output_tokens: used.candidatesTokenCount, cached_input_tokens: used.cachedContentTokenCount, total_tokens: used.totalTokenCount }, 'inclusive', row.uuid);
  }
  out.side = null;
  return out.value();
}

// Kimi CLI: the wire log (kimi-cli wire/types.py, kosong message.py). Arguments of a call may arrive in pieces, so a
// call is added once its last piece has been seen. Kimi Code's newer log has no public description of its text.
function kimi(out, rows, h) {
  let pending = null;
  const flush = () => { if (pending) { out.call(pending.id, pending.name, pending.args, pending.at); pending = null; } };
  const event = (type, data, at) => {
    if (type === 'ToolCallPart') { if (pending && typeof data?.arguments_part === 'string') pending.args += data.arguments_part; return; }
    flush();
    if (type === 'TurnBegin' || type === 'SteerInput') {
      const input = data?.user_input;
      if (typeof input === 'string') h.userText(out, input, at);
      else for (const part of Array.isArray(input) ? input : []) { if (part?.type === 'text') h.userText(out, part.text, at); else if (part?.type === 'image_url') { const image = h.dataImage(part.image_url?.url); if (image) out.image('user', image.mime, image.data, at); } }
    } else if (type === 'ContentPart') {
      if (data?.type === 'text') out.text('assistant', data.text, at); else if (data?.type === 'think' && data.think) out.text('thinking', data.think, at);
    } else if (type === 'ToolCall') pending = { id: data?.id, name: data?.function?.name, args: data?.function?.arguments ?? '', at };
    else if (type === 'ToolResult') {
      const value = data?.return_value;
      out.result(data?.tool_call_id, textOf(value?.output) || value?.message || '', value?.is_error === true);
    } else if (type === 'CompactionBegin') out.compact(at, null, null);
    else if (type === 'PlanDisplay' || type === 'Notification') out.text('context', typeof data?.content === 'string' ? data.content : JSON.stringify(data, null, 1), at, { label: type === 'PlanDisplay' ? '计划' : '通知', merge: true });
    else if (type === 'StatusUpdate') {
      const used = data?.token_usage;
      if (used) out.usage('kimi', tokens(used.input_other, used.output, used.input_cache_read, used.input_cache_creation), 'exclusive', data.message_id ?? undefined);
    } else if (type === 'SubagentEvent' && data?.event) {
      out.side = String(data.agent_id ?? data.subagent_type ?? 'agent').slice(0, 40);
      event(data.event.type, data.event.payload, at); flush(); out.side = null;
    }
  };
  for (const row of rows) {
    if (out.full()) { out.truncated = true; break; }
    if (row?.message?.type) event(row.message.type, row.message.payload, typeof row.timestamp === 'number' ? row.timestamp * 1000 : row.timestamp);
  }
  flush();
  return out.value();
}

// Cursor's agent transcripts keep only role and content: text and tool_use, no results or times. From third-party
// descriptions (agent-chorus, a 2026 Cursor forum post); Cursor documents no on-disk format.
function cursor(out, rows, h) {
  for (const row of rows) {
    if (out.full()) { out.truncated = true; break; }
    if (row?.role !== 'user' && row?.role !== 'assistant') continue;
    for (const part of Array.isArray(row.message?.content) ? row.message.content : typeof row.message?.content === 'string' ? [{ type: 'text', text: row.message.content }] : []) {
      if (part?.type === 'text') { if (row.role === 'user') h.userText(out, String(part.text ?? '').replace(/^\s*<user_query>\s*([\s\S]*?)\s*<\/user_query>\s*$/, '$1'), null); else out.text('assistant', part.text, null); }
      else if (part?.type === 'tool_use') out.call(part.id, part.name, part.input, null);
      else if (part?.type === 'thinking') out.text('thinking', part.thinking ?? part.text, null);
      else if (part && typeof part === 'object') out.unknown(part.type, part, null);
    }
  }
  return out.value();
}

// WorkBuddy and CodeBuddy: message, function_call, function_call_result and reasoning lines. The line types come from a
// third party's usage parser (tokmesh-core tencent_buddy.rs), which does not read text; the shape of the text is read
// loosely here and has not been checked on a real record.
function workbuddy(out, rows, h) {
  const words = value => textOf(value) || (typeof value?.text === 'string' ? value.text : '');
  for (const row of rows) {
    if (out.full()) { out.truncated = true; break; }
    const at = row?.timestamp, id = row?.callId ?? row?.call_id ?? row?.id;
    if (row?.type === 'message') {
      const content = row.content ?? row.message?.content;
      if (row.role === 'user') h.userText(out, words(content), at);
      else if (row.role === 'assistant') out.text('assistant', words(content), at);
      else out.text('context', words(content), at);
      const used = row.message?.usage ?? row.providerData?.usage;
      if (row.role === 'assistant' && used) out.usage('workbuddy', used, 'exclusive', row.providerData?.messageId);
    } else if (row?.type === 'function_call') out.call(id, row.name, row.arguments, at);
    else if (row?.type === 'function_call_result') out.result(id, words(row.output) || (typeof row.output === 'object' ? JSON.stringify(row.output) : row.output ?? ''), row.isError === true || row.status === 'failed' || row.status === 'error');
    else if (row?.type === 'reasoning') out.text('thinking', words(row.rawContent) || words(row.summary) || words(row.content), at);
    // Line types not described anywhere: kept as they are, because this format is the least known of all.
    else if (row && typeof row === 'object' && (typeof row.text === 'string' || row.content !== undefined)) out.unknown(row.type, row, at);
  }
  return out.value();
}

// Continue: one JSON document per session (core/index.d.ts Session, ChatHistoryItem).
function continueSession(out, document, h) {
  for (const entry of Array.isArray(document?.history) ? document.history : []) {
    if (out.full()) { out.truncated = true; break; }
    const message = entry?.message; if (!message) continue;
    if (message.role === 'user') {
      for (const part of Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }]) {
        if (part?.type === 'text') h.userText(out, part.text, null);
        else if (part?.type === 'imageUrl') { const image = h.dataImage(part.imageUrl?.url); if (image) out.image('user', image.mime, image.data, null); }
      }
    } else if (message.role === 'assistant') {
      if (typeof entry.reasoning?.text === 'string') out.text('thinking', entry.reasoning.text, null);
      out.text('assistant', textOf(message.content), null);
      for (const call of Array.isArray(message.toolCalls) ? message.toolCalls : []) out.call(call?.id, call?.function?.name, call?.function?.arguments, null);
    } else if (message.role === 'thinking') out.text('thinking', textOf(message.content), null);
    else if (message.role === 'tool') out.result(message.toolCallId, textOf(message.content), false);
    else if (message.role === 'system') out.text('context', textOf(message.content), null);
    for (const state of Array.isArray(entry.toolCallStates) ? entry.toolCallStates : []) if (state?.output) out.result(state.toolCallId, (Array.isArray(state.output) ? state.output : []).map(item => item?.content ?? '').join('\n'), state.status === 'errored');
  }
  return out.value();
}

const PARSERS = Object.freeze({
  copilot: (out, text, h, objects) => copilot(out, objects(text), h),
  pi: (out, text, h, objects) => pi(out, objects(text), h),
  qwen: (out, text, h, objects) => qwen(out, objects(text), h),
  kimi: (out, text, h, objects) => kimi(out, objects(text), h),
  cursor: (out, text, h, objects) => cursor(out, objects(text), h),
  workbuddy: (out, text, h, objects) => workbuddy(out, objects(text), h),
  cline: (out, text, h) => cline(out, parsed(text), 'cline', h),
  kilo: (out, text, h) => cline(out, parsed(text), 'kilo', h),
  continue: (out, text, h) => continueSession(out, parsed(text), h),
});

// Which files hold a conversation and which session each belongs to. Cline, Kilo Code, Cursor and Continue keep their
// text in files the usage scan never reads, so these go through their own list in policy.js ('transcript:<agent>').
const LISTS = Object.freeze({ cline: 'transcript:cline', kilo: 'transcript:kilo', cursor: 'transcript:cursor', continue: 'transcript:continue' });
const listed = agent => LISTS[agent] ?? agent;
function sessionOf(agent, file, dirname, basename, sep) {
  const base = basename(file), parent = basename(dirname(file));
  if (agent === 'copilot') return parent;
  if (agent === 'cline' || agent === 'kilo') return parent;
  if (agent === 'pi') return /(?:^|_)([^_]+)\.jsonl$/.exec(base)?.[1] ?? null;
  if (agent === 'qwen' || agent === 'cursor' || agent === 'workbuddy') return base.replace(/\.jsonl$/, '');
  if (agent === 'continue') return base.replace(/\.json$/, '');
  if (agent === 'kimi') { const parts = file.split(sep); return parts.at(-3) === 'agents' ? parts.at(-4) : parts.at(-2); }
  return null;
}
// Continue's conversations sit beside its usage database, not under it.
function rootsFor(agent, roots, dirname, join) {
  return agent === 'continue' ? roots.map(root => join(dirname(dirname(root)), 'sessions')) : roots;
}
module.exports = { PARSERS, listed, sessionOf, rootsFor };
