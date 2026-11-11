'use strict';
// A session's conversation for the reading view (docs/m2/SESSIONS-READER-20261101.md).
// Read from the Agent's own session file only when the person opens it; the result is
// returned to the window and never saved, exported, logged or put in an error text.
// Codex, Claude Code, OpenCode, MiMo Code, ZCode, Gemini CLI, DeepSeek Harness and Antigravity here; the
// others in transcript-more.js, none of them checked on real records (SESSIONS-READER-MORE-20261104.md).
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { filesUnder, readBytes } = require('./policy');
const { readDatabase, query } = require('./sqlite-memory');
const { decodeDeepseek, generation } = require('./extended-sources');
const { normalize } = require('./normalize');
const { change: changeOf, fromAntigravity } = require('./transcript-changes');
const { classify, slash, citations, codeMode } = require('./transcript-marks');
const { readObjects } = require('./transcript-lines');
const more = require('./transcript-more');

const READERS = new Set(['codex', 'claude', 'opencode', 'mimo', 'zcode', 'gemini', 'deepseek', 'antigravity', 'copilot', 'cline', 'pi', 'continue', 'kilo', 'qwen', 'kimi', 'cursor', 'workbuddy']);
// Which agents keep their conversations in a database, and what those files are called.
const DATABASES = Object.freeze({ opencode: '.db', mimo: '.db', kilo: '.db', zcode: '.sqlite' });
const databaseFiles = (agent, roots) => { const listed = []; for (const root of roots) { try { listed.push(...filesUnder(agent, root, { reads: 0 }).filter(file => file.endsWith(DATABASES[agent]))); } catch { continue; } } return listed; };
// The whole conversation is parsed; the window gets each item light (CC Switch's model, MIT): text up to
// inline in full, longer text, tool outputs and images as a preview the window fetches in full by item
// when the person opens it (part), a page at a time. Find runs on the full text (find).
// The person's words and the replies arrive whole up to spoken; past payload the window gets shorter previews, never fewer
// items, so what is in a record stays reachable however long it is.
const LIMITS = Object.freeze({
  file: 512 * 1024 * 1024, database: 1024 * 1024 * 1024, headers: 5000, decoded: 500,
  items: 500000, item: 64 * 1024 * 1024, payload: 24 * 1024 * 1024,
  inline: 8 * 1024, spoken: 256 * 1024, preview: 1200, previewLines: 12, tight: 160, page: 512 * 1024, image: 20 * 1024 * 1024, hits: 5000, subagents: 4096, siblings: 5000, descendants: 256
});
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
function clip(value, max) {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
  return text.length > max ? { text: text.slice(0, max), clipped: true } : { text, clipped: false };
}
function time(value) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : null; }
function parseJson(text) { try { return JSON.parse(text); } catch { return null; } }
function oneLine(text, max = 240) { const line = String(text ?? '').replace(/\s+/g, ' ').trim(); return line.length > max ? line.slice(0, max) + '…' : line; }
// The one line a tool call reads as: its command, file or query, else its arguments.
function toolSummary(name, input) {
  const value = typeof input === 'string' ? parseJson(input) ?? input : input;
  if (value && typeof value === 'object') {
    const command = Array.isArray(value.command) ? value.command.join(' ') : value.command ?? value.cmd;
    for (const candidate of [command, value.file_path, value.filePath, value.path, value.absolute_path, value.pattern, value.query, value.url, value.description, value.prompt]) if (typeof candidate === 'string' && candidate.trim()) return oneLine(candidate);
    return oneLine(JSON.stringify(value));
  }
  return oneLine(value ?? '');
}
// Text from a string or an array of {text} parts.
function partsText(content) {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : []).map(part => typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n');
}
// One user-side text as the person's words, a typed command or what the Agent injected (transcript-marks.js).
function userText(out, value, at) {
  const text = typeof value === 'string' ? value : '';
  if (slash(text)) { out.text('command', text, at); return; }
  const { kind, text: words, ...extra } = classify(text);
  out.text(kind, words, at, extra);
}
// A reply without its memory citation, which the Agent's own app hides; where it cited stays with the reply.
function replyText(out, value, at) {
  const { text, cited } = citations(value);
  out.text('assistant', text, at);
  if (cited?.length) out.cite(cited);
}
// An image carried in the record itself (a data URL or base64 with its type); nothing is fetched.
function dataImage(url) { const match = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(typeof url === 'string' ? url : ''); return match ? { mime: match[1], data: match[2] } : null; }

class Builder {
  constructor(options = {}) { this.factsOnly = options.factsOnly === true; this.previewOnly = options.previewOnly === true; this.noImages = options.noImages === true || this.factsOnly || this.previewOnly; this.lengths = new WeakMap(); this.items = []; this.truncated = false; this.calls = new Map(); this.reported = new Map(); this.side = options.side ?? null; }
  // Keep the current reader contract: spoken text stays whole up to 256 KiB.
  // Detach only longer prefixes so a sliced string cannot retain an entire row.
  keep(text, limit = LIMITS.inline) { return this.factsOnly ? '' : this.previewOnly && text.length > limit ? Buffer.from(text.slice(0, limit + 1), 'utf16le').toString('utf16le') : text; }
  full() { return this.items.length >= LIMITS.items; }
  push(item) {
    if (this.full()) { this.truncated = true; return null; }
    if (this.side) item.side = this.side;
    this.items.push(item); return item;
  }
  text(kind, value, at, extra) {
    const { text, clipped } = clip(value, LIMITS.item);
    if (!text.trim()) return;
    const last = this.items.at(-1);
    const limit = kind === 'user' || kind === 'assistant' ? LIMITS.spoken : LIMITS.inline;
    const join = item => {
      const length = (this.lengths.get(item) ?? item.text.length) + 2 + text.length;
      this.lengths.set(item, length);
      if (!this.factsOnly && (!this.previewOnly || item.text.length <= limit)) item.text = this.keep(item.text + '\n\n' + text, limit);
      if (this.previewOnly) item.length = length;
    };
    // Small notes of one kind in a row (what Claude Code attached, rows not recognised) read as one fold.
    if (extra?.merge) {
      const { merge: _merge, ...marks } = extra; extra = marks;
      if (last?.kind === 'context' && last.label === marks.label && (last.side ?? null) === this.side && !last.clipped && (this.lengths.get(last) ?? 0) + text.length <= LIMITS.item) { join(last); return; }
    }
    // Streaming writes one block per line; consecutive text of the same speaker reads as one turn.
    if (last && last.kind === kind && (last.side ?? null) === this.side && !last.clipped && (this.lengths.get(last) ?? last.text.length) + text.length <= LIMITS.item && (kind === 'assistant' || kind === 'thinking')) { join(last); last.clipped = clipped; return; }
    const item = this.push({ kind, time: time(at), text: this.keep(text, limit), ...(this.previewOnly ? { length: text.length } : {}), ...(clipped ? { clipped } : {}), ...extra });
    if (item) this.lengths.set(item, text.length);
  }
  // A row or part no reader knows stays readable as what it is, rather than disappearing from the conversation.
  unknown(type, value, at) { this.text('context', JSON.stringify(value, null, 1), at, { label: '未识别的记录 · ' + oneLine(type ?? '未知', 40), merge: true }); }
  cite(cited) { for (let at = this.items.length - 1; at >= 0; at--) if (this.items[at].kind === 'assistant') { this.items[at].cited = [...(this.items[at].cited ?? []), ...cited].slice(0, 64); return; } }
  // Where the Agent compacted its context: what it reported, a following summary reads in the fold after it.
  compact(at, trigger, before) { if (this.items.at(-1)?.kind !== 'compact') this.push({ kind: 'compact', time: time(at), text: '', compact: { trigger: typeof trigger === 'string' ? trigger.slice(0, 40) : null, before: Number.isSafeInteger(before) ? before : null } }); }
  // A call's tokens belong to what came just before it; a request reported again (streamed rows, one key) counts once.
  usage(agent, usage, semantics, key) {
    const total = usage && typeof usage === 'object' ? normalize(agent, usage, { id: 'turn', session: 'turn', model: 'unknown', time: 1e12 }, 'turn', semantics)?.totalTokens : null;
    const item = this.items.at(-1);
    if (!Number.isSafeInteger(total) || !item) return;
    const known = key ? this.reported.get(key) : null;
    if (known) { if (total > known.total) { known.item.usage = (known.item.usage ?? 0) + total - known.total; known.total = total; } return; }
    item.usage = (item.usage ?? 0) + total;
    if (key) this.reported.set(key, { item, total });
  }
  image(from, mime, data, at) {
    const bytes = typeof data === 'string' ? Buffer.byteLength(data.replace(/\s+/g, ''), 'base64') : 0;
    if (!IMAGES.has(mime) || !bytes) return;
    if (bytes > LIMITS.image) { this.text(from, '[图片过大，未显示]', at); return; }
    this.push({ kind: 'image', from: from === 'assistant' ? 'assistant' : 'user', time: time(at), image: { mime, data: this.noImages ? '' : data.replace(/\s+/g, ''), bytes } });
  }
  call(id, name, input, at, summary, given, commands) {
    let changed = given ?? changeOf(name, input);
    if (changed && this.factsOnly) changed = { ...changed, diff: '' };
    const item = this.push({ kind: 'tool', time: time(at), tool: { name: oneLine(name || 'tool', 80), summary: summary ?? (changed ? oneLine(changed.files.map(file => file.path).join('、')) : toolSummary(name, input)), output: null, error: false, ...(changed ? { change: changed } : {}), ...(commands ? { commands } : {}) } });
    if (item && typeof id === 'string' && id) this.calls.set(id, item);
    return item;
  }
  // A result whose call is not in this record (it was compacted away, or written by another version) still reads.
  result(id, output, error, at) {
    let item = this.calls.get(id);
    if (!item && output !== '' && output !== null && output !== undefined) item = this.call(id, '工具结果', null, at, '这份记录里没有对应的调用');
    if (item) this.attach(item, output, error);
  }
  attach(item, output, error) {
    const { text, clipped } = clip(output, LIMITS.item);
    item.tool.output = this.keep(text); if (this.previewOnly) item.tool.outputLength = text.length; if (clipped) item.tool.outputClipped = true;
    item.tool.error = Boolean(error);
  }
  value() {
    const tools = this.items.filter(item => item.kind === 'tool');
    return { items: this.items, truncated: this.truncated, turns: this.items.filter(item => item.kind === 'user' && !item.side).length, tools: tools.length, failed: tools.filter(item => item.tool.error).length };
  }
}
function each(out, rows, visit) {
  for (const row of rows) { if (out.full()) { out.truncated = true; break; } visit(row); }
  return out.value();
}
// What the window gets for one item: text up to LIMITS.inline in full, else its opening; a tool
// output's first lines; an image's type and size. length / outputLength say how much there is.
function previewText(text, lines, inline = LIMITS.inline, keep = LIMITS.preview, length = text.length) {
  if (length <= inline && !lines) return { text };
  let cut = text.slice(0, keep);
  if (lines) { const at = cut.split('\n', LIMITS.previewLines).join('\n').length; cut = cut.slice(0, at); }
  return cut.length < length ? { text: cut, length } : { text };
}
function preview(value) {
  const items = []; let size = 0;
  for (const item of value.items) {
    const tight = size > LIMITS.payload, keep = tight ? LIMITS.tight : LIMITS.preview, spoken = item.kind === 'user' || item.kind === 'assistant';
    let light;
    const marks = { ...(item.side ? { side: item.side } : {}), ...(item.usage ? { usage: item.usage } : {}), ...(item.label ? { label: item.label } : {}), ...(item.attached ? { attached: item.attached } : {}), ...(item.cited ? { cited: item.cited } : {}), ...(item.answered ? { answered: true } : {}), ...(item.compact ? { compact: item.compact } : {}) };
    if (item.kind === 'image') light = { kind: 'image', from: item.from, time: item.time, ...marks, image: { mime: item.image.mime, bytes: item.image.bytes } };
    else if (item.kind === 'tool') {
      const output = item.tool.output === null ? null : previewText(item.tool.output, true, LIMITS.inline, keep, item.tool.outputLength ?? item.tool.output.length);
      light = { kind: 'tool', time: item.time, ...marks, tool: { name: item.tool.name, summary: item.tool.summary, output: output ? output.text : null, error: item.tool.error, ...(output?.length ? { outputLength: output.length } : {}), ...(item.tool.commands ? { commands: item.tool.commands } : {}), ...(item.tool.change ? { change: { files: item.tool.change.files.slice(0, 200), length: item.tool.change.diff.length } } : {}) } };
    } else { const text = previewText(item.text, false, tight ? LIMITS.tight : spoken ? LIMITS.spoken : LIMITS.inline, keep, item.length ?? item.text.length); light = { kind: item.kind, time: item.time, ...marks, text: text.text, ...(text.length ? { length: text.length } : {}) }; }
    size += (light.text?.length || 0) + (light.tool ? light.tool.summary.length + (light.tool.output?.length || 0) : 0) + 96;
    items.push(light);
  }
  return { items, truncated: value.truncated, turns: value.turns, tools: value.tools, failed: value.failed };
}

// What a tool returned to Codex: a string, or text and images as a list (codex-rs/protocol models.rs FunctionCallOutputBody).
function codexOutput(out, raw, at) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.content_items) ? raw.content_items : null;
  if (!list) return raw;
  const words = [];
  for (const part of list) {
    if (typeof part?.text === 'string') words.push(part.text);
    else if (part?.type === 'input_image') { const image = dataImage(part.image_url); if (image) out.image('assistant', image.mime, image.data, at); else words.push('[图片]'); }
    else if (part?.type !== 'encrypted_content') words.push(JSON.stringify(part));
  }
  return words.join('\n');
}
const CODEX_ITEMS = new Set(['message', 'agent_message', 'reasoning', 'local_shell_call', 'function_call', 'custom_tool_call', 'tool_search_call', 'function_call_output', 'custom_tool_call_output', 'local_shell_call_output', 'tool_search_output', 'web_search_call', 'image_generation_call', 'compaction', 'context_compaction', 'compaction_summary']);
const CODEX_QUIET = new Set(['ghost_snapshot', 'additional_tools', 'configuration_update', 'compaction_trigger', 'other']);
const isCodexMessage = row => (row?.type === 'response_item' ? row.payload : row)?.type === 'message';
// Codex rollout files: response_item rows carry the conversation (rollout files of early versions write those rows
// without the wrapper); event_msg rows repeat it. A file with no message rows at all reads from those events instead.
function codex(objects, options = {}) {
  const out = new Builder(options);
  const events = options.events ?? (Array.isArray(objects) && !objects.some(isCodexMessage));
  let reported = null;
  return each(out, objects, row => {
    // The same report written twice counts once, as in the statistics.
    if (row?.type === 'event_msg' && row.payload?.type === 'token_count' && row.payload.info) {
      const signature = JSON.stringify([row.payload.info.total_token_usage, row.payload.info.last_token_usage]);
      if (signature !== reported) out.usage('codex', row.payload.info.last_token_usage, 'inclusive');
      reported = signature; return;
    }
    if (row?.type === 'compacted') { out.compact(row.timestamp, null, null); if (typeof row.payload?.message === 'string') out.text('context', row.payload.message, row.timestamp, { label: '压缩摘要' }); return; }
    if (row?.type === 'event_msg' && row.payload?.type === 'context_compacted') { out.compact(row.timestamp, null, null); return; }
    if (row?.type === 'event_msg' && row.payload) {
      const event = row.payload, at = row.timestamp;
      if (event.type === 'turn_aborted') { if (out.items.at(-1)?.label !== '这一轮被中断') out.text('context', '这一轮被中断' + (typeof event.reason === 'string' ? '：' + event.reason : ''), at, { label: '这一轮被中断' }); }
      else if (event.type === 'entered_review_mode' || event.type === 'exited_review_mode') out.text('context', JSON.stringify(event, null, 1), at, { label: event.type === 'entered_review_mode' ? '进入审查' : '结束审查' });
      else if (event.type === 'item_completed' && String(event.item?.type).toLowerCase() === 'plan' && typeof event.item.text === 'string') out.text('context', event.item.text, at, { label: '计划' });
      else if (events && event.type === 'user_message') userText(out, event.message, at);
      else if (events && event.type === 'agent_message') replyText(out, event.message, at);
      else if (events && event.type === 'agent_reasoning') out.text('thinking', event.text, at);
      return;
    }
    const wrapped = row?.type === 'response_item';
    if (!wrapped && !CODEX_ITEMS.has(row?.type)) {
      if (typeof row?.type === 'string' && !['session_meta', 'turn_context', 'event_msg', 'compacted'].includes(row.type)) out.unknown(row.type, row, row.timestamp);
      return;
    }
    const p = wrapped ? row.payload : row, at = row.timestamp;
    if (!p || typeof p !== 'object') return;
    if (CODEX_QUIET.has(p.type)) return;
    if (!CODEX_ITEMS.has(p.type)) { out.unknown(p.type, p, at); return; }
    if (p.type === 'message') {
      const parts = Array.isArray(p.content) ? p.content : [];
      const text = parts.map(part => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n\n');
      if (p.role === 'assistant') replyText(out, text, at);
      else if (p.role === 'user') userText(out, text, at);
      else out.text('context', text, at);
      for (const part of parts) if (part?.type === 'input_image') { const image = dataImage(part.image_url); if (image) out.image(p.role, image.mime, image.data, at); else if (p.role === 'user') out.text('user', '[图片]', at); }
    } else if (p.type === 'agent_message') {
      // What one agent of a run told another (codex-rs/protocol models.rs): a step of the turn, never the person's question.
      out.text('context', partsText(p.content), at, { label: '子 Agent 消息' + (typeof p.author === 'string' ? ' · ' + oneLine(p.author, 40) : '') });
    } else if (p.type === 'reasoning') {
      // The summary, and the reasoning text itself when the model's provider returns it.
      out.text('thinking', [...(Array.isArray(p.summary) ? p.summary : []), ...(Array.isArray(p.content) ? p.content : [])].map(part => part?.text || '').filter(Boolean).join('\n\n'), at);
    } else if (p.type === 'compaction' || p.type === 'context_compaction' || p.type === 'compaction_summary') {
      out.compact(at, null, null);
    } else if (p.type === 'tool_search_call') {
      out.call(p.call_id, 'tool_search', p.arguments, at);
    } else if (p.type === 'tool_search_output') {
      out.result(p.call_id, JSON.stringify(p.tools ?? [], null, 1), p.status === 'failed', at);
    } else if (p.type === 'image_generation_call') {
      out.call(p.id ?? null, 'image_generation', { prompt: p.revised_prompt }, at);
      if (typeof p.result === 'string' && p.result) out.image('assistant', 'image/png', p.result, at);
    } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const coded = p.type === 'custom_tool_call' && p.name === 'exec', code = coded ? codeMode(p.input) : null;
      if (code) { const changed = code.patch ? changeOf('apply_patch', code.patch) : null; out.call(p.call_id, code.name, null, at, code.summary || undefined, changed ?? undefined, code.commands); }
      else if (coded) out.call(p.call_id, 'exec', String(p.input ?? '').replace(/^\/\/ @exec:.*\n/, ''), at, undefined, undefined, []);
      else out.call(p.call_id, typeof p.namespace === 'string' && p.namespace ? p.namespace + '__' + p.name : p.name, p.arguments ?? p.input, at);
    } else if (p.type === 'local_shell_call') {
      out.call(p.call_id, 'shell', { command: p.action?.command }, at);
    } else if (p.type === 'web_search_call') {
      const action = p.action ?? {}, asked = action.query ?? (Array.isArray(action.queries) ? action.queries.join('、') : null);
      out.call(p.id ?? null, 'web_search', { query: asked ?? action.pattern ?? action.url ?? '' }, at);
    } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output' || p.type === 'local_shell_call_output') {
      const raw = typeof p.output === 'string' ? p.output : codexOutput(out, p.output?.content ?? p.output, at);
      const parsed = typeof raw === 'string' ? parseJson(raw) : null;
      const exit = parsed?.metadata?.exit_code ?? p.output?.metadata?.exit_code;
      // exec_command reports its exit in the text of its result (codex-rs/core/src/unified_exec).
      const said = typeof raw === 'string' ? /^Process exited with code (\d+)$/m.exec(raw.slice(0, 400))?.[1] : null;
      const failed = (Number.isInteger(exit) && exit !== 0) || p.output?.success === false || (said !== null && said !== undefined && said !== '0');
      out.result(p.call_id, parsed && typeof parsed.output === 'string' ? parsed.output : raw, failed, at);
    }
  });
}

function claudeText(content) {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : []).map(part => typeof part === 'string' ? part : part?.type === 'text' ? part.text : '').filter(Boolean).join('\n');
}
// Rows Claude Code writes beside the conversation: names, snapshots, the queue. A queued message that was sent comes back as
// an attachment or a user row, and a tool's progress as its result.
const CLAUDE_QUIET = new Set(['summary', 'file-history-snapshot', 'queue-operation', 'progress', 'custom-title', 'ai-title', 'last-prompt', 'pr-link', 'permission-mode', 'agent-name', 'agent-color', 'agent-setting', 'tag', 'mode', 'worktree-state', 'content-replacement', 'marble-origami-commit', 'marble-origami-snapshot', 'attribution-snapshot', 'speculation-accept', 'task-summary']);
const CLAUDE_NOISE = new Set(['skill_listing', 'deferred_tools_delta', 'mcp_instructions_delta', 'todo_reminder', 'task_reminder', 'hook_success', 'hook_additional_context_empty', 'token_usage', 'budget_usd', 'output_token_usage']);
const SYSTEM_LABELS = { api_error: '接口错误', informational: '提示', local_command: '本地命令', stop_hook_summary: 'Hook', away_summary: '离开时的摘要', scheduled_task_fire: '定时任务' };
// Claude Code JSONL: one row per message block; tool results come back in user rows.
function claude(objects, side = null, options = {}) {
  const out = new Builder(options);
  const counted = row => { if (row.type === 'assistant' && row.message.usage) out.usage('claude', row.message.usage, 'exclusive', row.message.id || row.uuid); };
  const visit = row => {
    if (row?.type === 'system') {
      out.side = side ?? (row.isSidechain === true ? (typeof row.agentId === 'string' && row.agentId ? row.agentId : 'agent') : null);
      if (row.subtype === 'compact_boundary' || row.subtype === 'microcompact_boundary') { if (row.subtype === 'compact_boundary') { out.side = side; out.compact(row.timestamp, row.compactMetadata?.trigger, row.compactMetadata?.preTokens); } return; }
      const said = typeof row.content === 'string' ? row.content : row.error ? JSON.stringify(row.error, null, 1) : '';
      if (row.subtype === 'local_command' && said) out.text('command', said.replace(/<\/?[a-z-]+>/g, ' ').replace(/\s+/g, ' ').trim(), row.timestamp);
      else if (said) out.text('context', said, row.timestamp, { label: SYSTEM_LABELS[row.subtype] ?? '系统消息' });
      return;
    }
    // What the person typed while the Agent worked is written as an attachment, and what they attached with it too.
    if (row?.type === 'attachment') {
      out.side = side ?? (row.isSidechain === true ? (typeof row.agentId === 'string' && row.agentId ? row.agentId : 'agent') : null);
      const note = row.attachment;
      if (note?.type === 'queued_command') userText(out, claudeText(note.prompt ?? note.content), row.timestamp);
      else if (note && !CLAUDE_NOISE.has(note.type)) out.text('context', typeof note.content === 'string' ? note.content : JSON.stringify(note, null, 1), row.timestamp, { label: '附加内容', merge: true });
      return;
    }
    // Early versions keep a sub-agent's steps inside the parent's progress rows instead of a file of their own.
    if (row?.type === 'progress' && options.embedded && row.data?.type === 'agent_progress' && row.data.message?.message) { visit({ ...row.data.message, isSidechain: true, agentId: row.data.agentId, timestamp: row.data.message.timestamp ?? row.timestamp }); return; }
    if (row && typeof row.type === 'string' && row.type !== 'user' && row.type !== 'assistant') { if (!CLAUDE_QUIET.has(row.type)) out.unknown(row.type, row, row.timestamp); return; }
    if (!row || (row.type !== 'user' && row.type !== 'assistant') || !row.message) return;
    const at = row.timestamp, content = row.message.content;
    // Rows of a sub-agent kept in the same file read as its steps, never as the person's own turns.
    out.side = side ?? (row.isSidechain === true ? (typeof row.agentId === 'string' && row.agentId ? row.agentId : 'agent') : null);

    if (row.isCompactSummary === true) { out.text('context', claudeText(content), at, { label: '压缩摘要' }); return; }
    if (row.isMeta === true) { out.text('context', claudeText(content), at); return; }
    if (typeof content === 'string') {
      if (row.type === 'assistant') out.text('assistant', content, at);
      else if (/^\s*<(?:command-name|command-message|local-command-stdout)/.test(content)) out.text('command', content.replace(/<\/?[a-z-]+>/g, ' ').replace(/\s+/g, ' ').trim(), at);
      else userText(out, content, at);
      counted(row);
      return;
    }
    for (const part of Array.isArray(content) ? content : []) {
      if (!part || typeof part !== 'object') continue;
      if (part.type === 'text') { if (row.type === 'assistant') out.text('assistant', part.text, at); else userText(out, part.text, at); }
      else if (part.type === 'thinking') out.text('thinking', part.thinking, at);
      else if (part.type === 'tool_use' || part.type === 'server_tool_use' || part.type === 'mcp_tool_use') out.call(part.id, part.name, part.input, at);
      else if (part.type === 'tool_result' || part.type === 'mcp_tool_result' || /_tool_result$/.test(part.type ?? '')) {
        // A result's text, or what a server-side tool returned as a list of its own; a screenshot it returned shows as an image.
        const pieces = Array.isArray(part.content) ? part.content : [], words = claudeText(part.content);
        out.result(part.tool_use_id, words || (pieces.some(piece => piece?.type !== 'image') || (!Array.isArray(part.content) && part.content) ? JSON.stringify(part.content, null, 1) : ''), part.is_error === true, at);
        for (const piece of pieces) if (piece?.type === 'image' && piece.source?.type === 'base64') out.image('assistant', piece.source.media_type, piece.source.data, at);
      }
      else if (part.type === 'image') { if (part.source?.type === 'base64') out.image(row.type, part.source.media_type, part.source.data, at); else out.text(row.type === 'assistant' ? 'assistant' : 'user', '[图片]', at); }
      else if (part.type === 'document') out.text(row.type === 'assistant' ? 'assistant' : 'user', '[文档] ' + oneLine(part.title || part.source?.media_type || '', 120), at);
      else if (part.type !== 'redacted_thinking' && part.type !== 'tool_reference') out.unknown(part.type, part, at);
    }
    counted(row);
  };
  return each(out, objects, visit);
}

// OpenCode and MiMo Code: one message per row, its text, reasoning and tool parts in order
// (the part table in the 1.x schema, the message's content array in session_message).
// Structure per cc-switch opencode_blocks.rs (MIT).
function openPart(out, role, part, at) {
  if (!part || typeof part !== 'object') return;
  if (part.type === 'text') {
    const text = typeof part.text === 'string' ? part.text : '';
    // Text the Agent added itself, not the person's or the model's words; it folds rather than disappears.
    if (part.synthetic === true || part.ignored === true) { out.text('context', text, at, { label: '注入的上下文', merge: true }); return; }
    if (role === 'assistant') out.text('assistant', text, at); else if (role === 'user') userText(out, text, at); else out.text('context', text, at);
  } else if (part.type === 'reasoning') out.text('thinking', part.text, at);
  else if (part.type === 'compaction') out.compact(at, part.auto === true ? 'auto' : part.auto === false ? 'manual' : null, null);
  else if (part.type === 'tool') {
    const state = part.state && typeof part.state === 'object' ? part.state : {}, id = part.callID ?? part.id ?? null;
    const input = state.input ?? part.input ?? {}, titled = typeof state.title === 'string' && state.title.trim() && !Object.keys(input).length;
    const item = out.call(id, part.tool ?? part.name, input, at, titled ? oneLine(state.title) : undefined), error = state.status === 'error';
    if (item && (state.status === 'completed' || error)) out.attach(item, error && typeof state.error === 'string' && state.error ? state.error : state.output ?? '', error);
  } else if (part.type === 'file') { const image = dataImage(part.url); if (image) out.image(role, image.mime, image.data, at); else out.text(role === 'assistant' ? 'assistant' : 'user', '[文件] ' + oneLine(part.filename || part.mime || '', 120), at); }
  else if (part.type === 'subtask') out.text('context', [part.description, part.prompt].filter(Boolean).join('\n\n'), at, { label: '子任务' + (typeof part.agent === 'string' ? ' · ' + oneLine(part.agent, 40) : '') });
  else if (part.type === 'retry') out.text('context', JSON.stringify(part.error ?? part, null, 1), at, { label: '重试', merge: true });
  else if (!['step-start', 'step-finish', 'snapshot', 'patch', 'agent'].includes(part.type)) out.unknown(part.type, part, at);
}
function opencode(messages, agent = 'opencode', options = {}) {
  const out = new Builder(options);
  return each(out, messages, message => {
    const role = message.role, at = message.time;
    if (role === 'system') { out.text('context', partsText(message.parts.map(part => part?.type === 'text' ? part.text : '')), at); return; }
    for (const part of message.parts) openPart(out, role, part, at);
    if (role === 'assistant') out.usage(agent, message.tokens, 'exclusive');
    if (message.error) out.text('context', typeof message.error?.data?.message === 'string' ? message.error.data.message : JSON.stringify(message.error, null, 1), at, { label: '这次回复出错' });
  });
}
function columns(db, table) { return new Set(query(db, 'PRAGMA table_info("' + table + '")').map(row => row.name)); }
function tables(db) { return new Set(query(db, "SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name)); }
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
// The session's messages from one database, or null when it does not hold the session.
function databaseMessages(db, id) {
  const names = tables(db), out = [];
  if (names.has('session_message')) {
    const has = columns(db, 'session_message'), order = has.has('seq') ? 'seq, rowid' : 'rowid';
    const rows = query(db, 'SELECT type, ' + (has.has('time_created') ? 'time_created' : 'NULL') + ' AS at, data FROM session_message WHERE session_id = ' + quote(id) + ' ORDER BY ' + order);
    for (const row of rows) {
      const data = parseJson(row.data); if (!data || typeof data !== 'object') continue;
      if (!['user', 'assistant', 'system'].includes(row.type)) continue;
      const parts = (row.type === 'user' || row.type === 'system') && typeof data.text === 'string' ? [{ type: 'text', text: data.text }]
        : Array.isArray(data.content) ? data.content : typeof data.content === 'string' ? [{ type: 'text', text: data.content }] : typeof data.text === 'string' ? [{ type: 'text', text: data.text }] : [];
      out.push({ role: row.type, time: row.at, parts, tokens: data.tokens, error: data.error });
    }
    if (out.length) return out;
  }
  if (!names.has('message')) return null;
  const has = columns(db, 'message'), order = has.has('time_created') ? 'time_created, id' : 'rowid';
  const rows = query(db, 'SELECT id, ' + (has.has('time_created') ? 'time_created' : 'NULL') + ' AS at, data FROM message WHERE session_id = ' + quote(id) + ' ORDER BY ' + order);
  if (!rows.length) return null;
  const parts = new Map();
  if (names.has('part')) {
    const partOrder = columns(db, 'part').has('time_created') ? 'time_created, id' : 'rowid';
    for (const row of query(db, 'SELECT message_id, data FROM part WHERE session_id = ' + quote(id) + ' ORDER BY ' + partOrder)) {
      const data = parseJson(row.data); if (!data) continue;
      if (!parts.has(row.message_id)) parts.set(row.message_id, []);
      parts.get(row.message_id).push(data);
    }
  }
  for (const row of rows) { const data = parseJson(row.data) || {}; out.push({ role: data.role || 'unknown', time: row.at ?? data.time?.created, parts: parts.get(row.id) || [], tokens: data.tokens, error: data.error }); }
  return out;
}
// The sessions an OpenCode-family session started for its sub-agents, whose messages sit under their own ids.
function databaseDescendants(db, id) {
  const names = tables(db); if (!names.has('session') || !columns(db, 'session').has('parent_id')) return [];
  const found = [], queue = [id], seen = new Set(queue);
  while (queue.length && found.length < LIMITS.descendants) {
    for (const row of query(db, 'SELECT id FROM session WHERE parent_id = ' + quote(queue.shift()))) if (typeof row.id === 'string' && !seen.has(row.id)) { seen.add(row.id); queue.push(row.id); found.push({ id: row.id, messages: databaseMessages(db, row.id) ?? [] }); }
  }
  return found;
}
// OpenCode's and MiMo Code's earlier home for a conversation: one JSON file per message and per part, under storage/ or
// project/<hash>/storage/session/ (the same structure as the database's rows).
function legacyFiles(agent, id, roots) {
  const all = { messages: [], parts: [] }, list = dir => { try { return filesUnder('transcript:legacy', dir, { reads: 0 }).sort(); } catch { return []; } };
  for (const root of roots) {
    const places = [{ messages: path.join(root, 'storage', 'message', id), parts: messageId => path.join(root, 'storage', 'part', messageId) }];
    let projects = []; try { projects = fs.readdirSync(path.join(root, 'project')); } catch { /* No earlier layout here. */ }
    for (const project of projects) { const base = path.join(root, 'project', project, 'storage', 'session'); places.push({ messages: path.join(base, 'message', id), parts: messageId => path.join(base, 'part', id, messageId) }); }
    for (const place of places) {
      const messages = stat(place.messages) ? list(place.messages) : [];
      all.messages.push(...messages);
      for (const file of messages) { const dir = place.parts(path.basename(file, '.json')); if (stat(dir)) all.parts.push(...list(dir)); }
    }
  }
  return all;
}
function legacyMessages({ messages, parts }) {
  const json = file => { try { return parseJson(readBytes(file, { reads: 0 }).toString('utf8')); } catch { return null; } };
  const held = new Map();
  for (const file of parts) { const key = path.basename(path.dirname(file)); if (!held.has(key)) held.set(key, []); const data = json(file); if (data) held.get(key).push(data); }
  const out = [];
  for (const file of messages) { const data = json(file); if (data) out.push({ role: data.role || 'unknown', time: data.time?.created, parts: held.get(path.basename(file, '.json')) || [], tokens: data.tokens, error: data.error }); }
  return out;
}

// Gemini CLI: a legacy .json document, or a .jsonl log replayed as the CLI does (a message
// id written again replaces it in place, $set merges metadata or replaces the list,
// $rewindTo drops that message and the ones after). Per cc-switch gemini.rs (MIT).
function geminiMessages(text, json) {
  if (json) { const document = parseJson(text); return Array.isArray(document?.messages) ? document.messages : []; }
  const list = [], index = new Map();
  const upsert = message => { if (typeof message?.id !== 'string') return; if (index.has(message.id)) list[index.get(message.id)] = message; else { index.set(message.id, list.length); list.push(message); } };
  for (const line of text.split('\n')) {
    const record = parseJson(line); if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    if (typeof record.$rewindTo === 'string') { const cut = index.get(record.$rewindTo) ?? 0; list.length = cut; for (const [key, at] of index) if (at >= cut) index.delete(key); }
    else if (typeof record.id === 'string') upsert(record);
    else if (record.$set && typeof record.$set === 'object') { if (Array.isArray(record.$set.messages)) { list.length = 0; index.clear(); record.$set.messages.forEach(upsert); } }
    else if (typeof record.sessionId === 'string' && Array.isArray(record.messages)) record.messages.forEach(upsert);
  }
  return list;
}
function geminiOutput(call) {
  const display = call.resultDisplay;
  if (typeof display === 'string' && display) return display;
  if (display && typeof display === 'object') return typeof display.fileDiff === 'string' ? display.fileDiff : JSON.stringify(display);
  for (const item of Array.isArray(call.result) ? call.result : []) for (const key of ['output', 'error']) { const value = item?.functionResponse?.response?.[key]; if (typeof value === 'string') return value; }
  return typeof call.result === 'string' ? call.result : call.result ? JSON.stringify(call.result) : '';
}
function gemini(messages, options = {}) {
  const out = new Builder(options);
  return each(out, messages, message => {
    if (!message || typeof message !== 'object') return;
    const at = message.timestamp, text = partsText(message.content);
    for (const part of Array.isArray(message.content) ? message.content : []) if (part?.inlineData) out.image(message.type === 'gemini' ? 'assistant' : 'user', part.inlineData.mimeType, part.inlineData.data, at);
    if (message.type === 'user') userText(out, text, at);
    else if (message.type !== 'gemini') out.text('context', text, at, message.type === 'error' ? { label: '错误' } : message.type === 'warning' ? { label: '警告' } : undefined);
    else if (message.type === 'gemini') {
      const thoughts = (Array.isArray(message.thoughts) ? message.thoughts : []).map(item => [item?.subject ? '**' + item.subject + '**' : '', item?.description || ''].filter(Boolean).join('\n\n')).filter(Boolean).join('\n\n');
      out.text('thinking', thoughts, at);
      out.text('assistant', text, at);
      (Array.isArray(message.toolCalls) ? message.toolCalls : []).forEach((call, index) => {
        if (typeof call?.name !== 'string') return;
        const id = typeof call.id === 'string' ? call.id : call.name + '-' + index;
        out.call(id, call.name, call.args ?? {}, at);
        if (call.status && !['executing', 'scheduled', 'validating', 'awaiting_approval'].includes(call.status)) out.result(id, geminiOutput(call), ['error', 'cancelled', 'canceled'].includes(call.status));
      });
      const tokens = message.tokens;
      if (tokens) out.usage('gemini', { input: tokens.input, output: tokens.output, cached_input_tokens: tokens.cached, reasoning: tokens.thoughts, total: tokens.total }, 'inclusive');
    }
  });
}

// DeepSeek Harness: an event log whose user, assistant and tool-result events carry the
// conversation; replacement copies only change what the model sees and are skipped.
// Per cc-switch dsh.rs (MIT).
function deepseek(objects, options = {}) {
  const out = new Builder(options), seen = new Set();
  let pendingUsage = null;
  const flushUsage = () => { if (pendingUsage) out.usage('deepseek', pendingUsage, 'exclusive'); pendingUsage = null; };
  return each(out, objects, record => {
    if (record?.type === 'session/end-seed' && record.data?.inherited === true) { for (const item of out.items) delete item.usage; return; }
    if (record?.type === 'assistant/message' || record?.type === 'assistant/attempt') {
      const usage = record.data?.usage ?? (Array.isArray(record.data?.stream) ? record.data.stream.find(part => part?.type === 'chunk' && part.chunk?.type === 'usage')?.chunk.usage : null);
      if (usage) pendingUsage = usage;
    }
    if (!record || typeof record !== 'object' || record.surfaceOp?.op === 'replace') { flushUsage(); return; }
    const raw = record.type === 'user/message' ? record.data : record.type === 'assistant/message' || record.type === 'tool/result' ? record.data?.message : null;
    if (!raw || typeof raw !== 'object') { flushUsage(); return; }
    if (typeof raw.id === 'string') { if (seen.has(raw.id)) { flushUsage(); return; } seen.add(raw.id); }
    const at = record.time;
    if (record.type === 'tool/result') { out.result(raw.toolCallId, partsText(raw.content), raw.isError === true, at); flushUsage(); return; }
    const user = record.type === 'user/message', injected = user && typeof raw.source?.kind === 'string' && raw.source.kind !== 'user';
    for (const part of Array.isArray(raw.content) ? raw.content : typeof raw.content === 'string' ? [{ type: 'text', text: raw.content }] : []) {
      if (part?.type === 'text') { if (!user) out.text('assistant', part.text, at); else if (injected) out.text('context', part.text, at); else userText(out, part.text, at); }
      else if (part?.type === 'thinking' || part?.type === 'reasoning') out.text('thinking', part.text ?? part.thinking, at);
      else if (part?.type === 'tool-call') out.call(part.id, part.name, part.arguments ?? {}, at);
      else if (part && typeof part === 'object') out.unknown(part.type, part, at);
    }
    flushUsage();
  });
}

// Antigravity: one row per step, rewritten as it finishes (the last row of a step wins).
// The person's prompt is the <USER_REQUEST> part of a USER_INPUT step; the rest is context
// Antigravity adds. Steps of other kinds read as tool rows named by their kind.
// Per cc-switch agy.rs (MIT).
const RESULT_STEPS = new Set(['RUN_COMMAND', 'CODE_ACTION', 'VIEW_FILE', 'GREP_SEARCH', 'LIST_DIRECTORY', 'GENERIC']);
function antigravity(objects, options = {}) {
  const steps = new Map();
  for (const row of objects) if (Number.isInteger(row?.step_index)) steps.set(row.step_index, row);
  const out = new Builder(options), calls = [], written = new Map();
  const value = each(out, [...steps.entries()].sort((a, b) => a[0] - b[0]).map(entry => entry[1]), step => {
    const content = typeof step.content === 'string' ? step.content : '', at = step.created_at;
    // A model step lists its calls; their results follow in order as steps of their own.
    if (step.type === 'PLANNER_RESPONSE') for (const call of Array.isArray(step.tool_calls) ? step.tool_calls : []) {
      if (call?.name === 'write_to_file' && typeof call.args?.TargetFile === 'string' && typeof call.args.CodeContent === 'string') written.set(call.args.TargetFile.replace(/\\/g, '/').toLowerCase(), call.args.CodeContent);
      if (call && typeof call.name === 'string') calls.push(call);
    }
    if (step.type === 'USER_INPUT') {
      const match = /<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/.exec(content);
      if (match && match[1].trim()) { out.text('user', match[1].trim(), at); out.text('context', content.replace(match[0], '').trim(), at); }
      else userText(out, content, at);
    } else if (step.type === 'PLANNER_RESPONSE') {
      if (typeof step.thinking === 'string') out.text('thinking', step.thinking, at);
      out.text('assistant', content, at);
      out.usage('antigravity', { input_tokens: step.input_tokens, output_tokens: step.output_tokens, cached_input_tokens: step.cache_read_tokens }, 'exclusive');
    } else if (step.source === 'MODEL' && !RESULT_STEPS.has(step.type)) out.text('assistant', content, at);
    else {
      const call = RESULT_STEPS.has(step.type) ? calls.shift() : null, changed = step.type === 'CODE_ACTION' ? fromAntigravity(content, written) : null;
      const args = call?.args && typeof call.args === 'object' ? call.args : {};
      const name = call?.name ?? (typeof step.type === 'string' ? step.type.toLowerCase() : 'step');
      const said = [args.CommandLine, args.TargetFile, args.AbsolutePath, args.Query, args.DirectoryPath].find(value => typeof value === 'string' && value.trim());
      const item = out.call(null, name, null, at, changed ? undefined : oneLine(said ?? (content || JSON.stringify(step))), changed);
      // A shell command's failure is only in its text; the step's status stays DONE.
      if (item) out.attach(item, content || JSON.stringify(step, null, 2), step.status === 'ERROR' || (step.type === 'RUN_COMMAND' && /The command failed with exit code: \d+/.test(content)));
    }
  });
  // A call the record has no result step for (still running, or a kind of step not paired above) is still a call it made.
  if (!calls.length) return value;
  for (const call of calls) out.call(null, call.name, call.args ?? null, null);
  return out.value();
}

// The readers in transcript-more.js fill the same Builder and use the same reading of a person's words.
const helpers = Object.freeze({ userText, dataImage });
const parseMore = (agent, text, options) => more.PARSERS[agent](new Builder(options), text, helpers, objects);
function objects(text) {
  const rows = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { rows.push(JSON.parse(line)); } catch { continue; } }
  return rows;
}
function head(file) {
  let fd; try { fd = fs.openSync(file, fs.constants.O_RDONLY); const buffer = Buffer.alloc(64 * 1024), read = fs.readSync(fd, buffer, 0, buffer.length, 0); return buffer.subarray(0, read).toString('utf8'); }
  catch { return ''; } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function names(agent, id, text) {
  if (agent === 'gemini') return new RegExp('"sessionId"\\s*:\\s*"' + id + '"').test(text);
  for (const line of text.split('\n')) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    if (agent === 'codex' ? row?.type === 'session_meta' && row.payload?.id === id : row?.sessionId === id) return true;
  }
  return false;
}
const stat = file => { try { return fs.statSync(file); } catch { return null; } };
function readText(agent, file) {
  const info = stat(file);
  if (!info) throw new Error('TRANSCRIPT_NOT_FOUND');
  if (info.size > LIMITS.file) throw new Error('TRANSCRIPT_TOO_LARGE');
  try {
    const bytes = readBytes(file, { reads: 0 });
    return agent === 'deepseek' ? decodeDeepseek(bytes, file.endsWith('.zstd'), () => {}) : bytes.toString('utf8');
  } catch { throw new Error('TRANSCRIPT_UNREADABLE'); }
}
const isSubagent = file => path.basename(path.dirname(file)) === 'subagents';
// Cursor keeps a sub-agent's transcript in subagents/ beside the conversation's own file (third-party descriptions, as above).
function cursorSubagents(file) {
  const dir = path.join(path.dirname(file), 'subagents');
  try { return stat(dir) ? filesUnder('transcript:cursor-sub', dir, { reads: 0 }).sort().slice(0, LIMITS.subagents) : []; } catch { return []; }
}
// The session's own file. Codex names it rollout-<time>-<id>.jsonl, Claude Code <id>.jsonl,
// Antigravity brain/<id>/.system_generated/logs/transcript*.jsonl and DeepSeek Harness keeps
// it in a folder named for the session (the newest session.vN generation). A file named
// otherwise is found by its header naming the session; at most 5000 headers are read
// (500 DeepSeek files, which must be decompressed to read their header).
function sessionFile(agent, id, roots) {
  if (more.PARSERS[agent]) return moreFile(agent, id, roots);
  const listed = [];
  // Antigravity's whitelist is brain/<id>/.system_generated/logs/transcript*.jsonl.
  // Walk only the requested branch instead of stat'ing every conversation's
  // artifacts on every open, follow tick, find and part. This still goes through
  // the normal per-directory link/alias checks and works for selected file roots.
  const descend = agent === 'antigravity' ? (directory, name) => {
    if (path.basename(directory) === 'brain') return name === id;
    if (path.basename(path.dirname(directory)) === 'brain') return name === '.system_generated';
    if (path.basename(directory) === '.system_generated' && path.basename(path.dirname(path.dirname(directory))) === 'brain') return name === 'logs';
    return true;
  } : undefined;
  for (const root of roots) { try { listed.push(...filesUnder(agent, root, { reads: 0 }, { descend })); } catch { continue; } }
  let found;
  if (agent === 'antigravity') {
    found = listed.filter(file => file.split(path.sep).at(-4) === id);
    return found.find(file => path.basename(file) === 'transcript_full.jsonl') ?? found[0] ?? null;
  }
  if (agent === 'deepseek') {
    found = listed.filter(file => path.basename(path.dirname(file)) === id);
    if (!found.length) found = listed.slice(0, LIMITS.decoded).filter(file => { try { return objects(readText(agent, file).split('\n', 1)[0])[0]?.id === id; } catch { return false; } });
    return found.sort((a, b) => (generation(b) ?? -1) - (generation(a) ?? -1))[0] ?? null;
  }
  if (agent === 'codex' || agent === 'claude') found = listed.filter(file => { const base = path.basename(file, '.jsonl'); return agent === 'claude' ? base === id : base.endsWith('-' + id) || base === id; });
  else found = [];
  if (!found.length) found = listed.filter(file => !isSubagent(file)).slice(0, LIMITS.headers).filter(file => names(agent, id, head(file)));
  // A session kept twice (an archive copy, a migrated Gemini .json) is read once: the
  // .jsonl, then the larger, then the newer file.
  const ranked = found.map(file => ({ file, stat: stat(file) })).filter(entry => entry.stat)
    .sort((a, b) => Number(b.file.endsWith('.jsonl')) - Number(a.file.endsWith('.jsonl')) || b.stat.size - a.stat.size || b.stat.mtimeMs - a.stat.mtimeMs);
  return ranked[0]?.file ?? null;
}
// A session of the agents in transcript-more.js: the file named for it, the largest of those, else one whose opening names it.
function moreFile(agent, id, roots) {
  const files = [];
  for (const root of more.rootsFor(agent, roots, path.dirname, path.join)) { try { files.push(...filesUnder(more.listed(agent), root, { reads: 0 })); } catch { continue; } }
  let found = files.filter(file => more.sessionOf(agent, file, path.dirname, path.basename, path.sep) === id);
  if (agent === 'kimi' && found.length > 1) { const main = found.filter(file => file.split(path.sep).at(-2) === 'main'); if (main.length) found = main; }
  if (!found.length && ['qwen', 'workbuddy'].includes(agent)) found = files.slice(0, LIMITS.headers).filter(file => names(agent, id, head(file)));
  if (!found.length && agent === 'pi') found = files.slice(0, LIMITS.headers).filter(file => objects(head(file).split('\n', 1)[0])[0]?.id === id);
  return found.map(file => ({ file, size: stat(file)?.size ?? -1 })).sort((a, b) => b.size - a.size)[0]?.file ?? null;
}
// The size and time of what was read; a later part or find must see the same record. Fixed length however many files a
// conversation has: with many sub-agents a plain list outgrew what a later request may carry, and every part of it failed.
const stampOf = files => { const list = files.map(file => { const info = stat(file); return info ? info.size + ':' + Math.round(info.mtimeMs) : '-'; }).join('|'); return list.length <= 64 ? list : crypto.createHash('sha256').update(list).digest('hex'); };
async function databaseTranscript(agent, id, roots, options = {}) {
  for (const file of databaseFiles(agent, roots)) {
    if ((stat(file)?.size ?? 0) > LIMITS.database) throw new Error('TRANSCRIPT_TOO_LARGE');
    const stamp = stampOf([file, file + '-wal']);
    let found;
    try { found = await readDatabase(file, { reads: 0 }, db => { const messages = databaseMessages(db, id); return messages ? { messages, descendants: databaseDescendants(db, id) } : null; }); } catch { throw new Error('TRANSCRIPT_UNREADABLE'); }
    if (found) return { stamp, value: mergeSides(opencode(found.messages, agent, options), found.descendants.map(child => opencode(child.messages, agent, { ...options, side: child.id }).items)) };
  }
  const legacy = ['opencode', 'mimo'].includes(agent) ? legacyFiles(agent, id, roots) : null;
  if (legacy?.messages.length) return { stamp: stampOf([...legacy.messages, ...legacy.parts]), value: opencode(legacyMessages(legacy), agent, options) };
  throw new Error('TRANSCRIPT_NOT_FOUND');
}
// Claude Code keeps a sub-agent's conversation in <session>/subagents/agent-<id>.jsonl beside the session's file (newer
// versions may nest it deeper); earlier versions wrote agent-<id>.jsonl directly beside it, naming the session in each row.
function subagentFiles(file, id = path.basename(file, '.jsonl')) {
  const dir = path.join(path.dirname(file), path.basename(file, '.jsonl'), 'subagents'), found = [];
  const agentFile = item => /^agent-[^/\\]+\.jsonl$/.test(path.basename(item));
  if (stat(dir)) { try { found.push(...filesUnder('claude', dir, { reads: 0 }).filter(agentFile)); } catch { /* The conversation itself still reads. */ } }
  if (!agentFile(file)) {
    let beside = []; try { beside = fs.readdirSync(path.dirname(file)); } catch { /* Nothing beside it. */ }
    for (const name of beside.filter(agentFile).slice(0, LIMITS.siblings)) { const item = path.join(path.dirname(file), name); if (stat(item)?.isFile() && names('claude', id, head(item))) found.push(item); }
  }
  return found.sort().slice(0, LIMITS.subagents);
}
// Each sub-agent's steps go where they happened in time, as one run; the main record's order is untouched.
function mergeSides(value, lists) {
  if (!lists.some(rows => rows.length)) return value;
  const items = value.items.slice(), when = item => item.time ? Date.parse(item.time) : null;
  for (const rows of lists) {
    if (!rows.length) continue;
    const first = when(rows[0]), at = first === null ? items.length : items.findIndex(item => { const time = when(item); return time !== null && time > first; });
    items.splice(at < 0 ? items.length : at, 0, ...rows);
  }
  if (items.length > LIMITS.items) { items.length = LIMITS.items; value.truncated = true; }
  const tools = items.filter(item => item.kind === 'tool');
  return { ...value, items, tools: tools.length, failed: tools.filter(item => item.tool.error).length };
}
function withSubagents(value, files, options = {}) {
  return mergeSides(value, files.map(file => { try { return claude(readObjects(file, LIMITS.file), path.basename(file, '.jsonl').slice(6) || 'agent', options).items; } catch { return []; } }));
}
// The whole conversation, full text, and the stamp of the record it came from.
async function load(agent, id, roots, options = {}) {
  if (!READERS.has(agent)) throw new Error('TRANSCRIPT_UNSUPPORTED');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('TRANSCRIPT_NOT_FOUND');
  if (['opencode', 'mimo', 'zcode'].includes(agent)) return databaseTranscript(agent, id, roots, options);
  const file = sessionFile(agent, id, roots);
  if (!file && agent === 'kilo') return databaseTranscript(agent, id, roots, options);
  if (!file) throw new Error('TRANSCRIPT_NOT_FOUND');
  const extra = agent === 'claude' ? subagentFiles(file, id) : agent === 'cursor' ? cursorSubagents(file) : [];
  const stamp = stampOf([file, ...extra]);
  if (agent === 'codex' || agent === 'claude') {
    const info = stat(file); if (!info) throw new Error('TRANSCRIPT_NOT_FOUND');
    if (info.size > LIMITS.file) throw new Error('TRANSCRIPT_TOO_LARGE');
    try {
      const rows = readObjects(file, LIMITS.file);
      if (agent === 'claude') return { stamp, value: withSubagents(claude(rows, null, { ...options, embedded: !extra.length }), extra, options) };
      // Almost every rollout has a message row near its opening, so this stops almost at once.
      let events = true; for (const row of readObjects(file, LIMITS.file)) if (isCodexMessage(row)) { events = false; break; }
      return { stamp, value: codex(rows, { ...options, events }) };
    } catch (error) { throw new Error(error?.message === 'SOURCE_BUSY' ? 'TRANSCRIPT_CHANGED' : 'TRANSCRIPT_UNREADABLE', { cause: error }); }
  }
  // These JSONL readers consume records in order. Do not materialize both the
  // decoded file and every parsed revision before keeping the final steps.
  // The iterator retains the same byte ceiling and rejects a moving record.
  if (agent === 'antigravity' || agent === 'deepseek' && !file.endsWith('.zstd')) {
    const info = stat(file); if (!info) throw new Error('TRANSCRIPT_NOT_FOUND');
    if (info.size > LIMITS.file) throw new Error('TRANSCRIPT_TOO_LARGE');
    try {
      const rows = readObjects(file, LIMITS.file);
      return { stamp, value: agent === 'antigravity' ? antigravity(rows, options) : deepseek(rows, options) };
    } catch (error) { throw new Error(error?.message === 'SOURCE_BUSY' ? 'TRANSCRIPT_CHANGED' : 'TRANSCRIPT_UNREADABLE', { cause: error }); }
  }
  const text = readText(agent, file);
  if (more.PARSERS[agent]) {
    let value = parseMore(agent, text, options);
    if (extra.length) value = mergeSides(value, extra.map(item => { try { return parseMore(agent, readText(agent, item), { ...options, side: path.basename(item, '.jsonl').slice(0, 12) }).items; } catch { return []; } }));
    // Kimi Code's newer log has no public description of its text: say so rather than show an empty conversation.
    if (agent === 'kimi' && !value.items.length) throw new Error('TRANSCRIPT_UNSUPPORTED');
    return { stamp, value };
  }
  const value = agent === 'gemini' ? gemini(geminiMessages(text, file.endsWith('.json')), options)
    : agent === 'deepseek' ? deepseek(objects(text), options) : antigravity(objects(text), options);
  return { stamp, value };
}
// Whether the record moved, for a conversation the person follows: no content is read.
async function stampNow(agent, id, roots) {
  if (!READERS.has(agent)) throw new Error('TRANSCRIPT_UNSUPPORTED');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('TRANSCRIPT_NOT_FOUND');
  if (['opencode', 'mimo', 'zcode'].includes(agent)) {
    const listed = databaseFiles(agent, roots);
    if (listed.length) return stampOf(listed.flatMap(file => [file, file + '-wal']));
    const legacy = agent === 'zcode' ? null : legacyFiles(agent, id, roots);
    return legacy?.messages.length ? stampOf([...legacy.messages, ...legacy.parts]) : '-';
  }
  const file = sessionFile(agent, id, roots);
  if (!file && agent === 'kilo') { const listed = databaseFiles(agent, roots); return listed.length ? stampOf(listed.flatMap(item => [item, item + '-wal'])) : '-'; }
  if (!file) throw new Error('TRANSCRIPT_NOT_FOUND');
  return stampOf([file, ...(agent === 'claude' ? subagentFiles(file, id) : agent === 'cursor' ? cursorSubagents(file) : [])]);
}
async function transcript(agent, id, roots, request) {
  if (request !== undefined) require('./transcript-continuation').validate(request);
  let loaded;
  try { loaded = await load(agent, id, roots, { previewOnly: true }); }
  catch (error) {
    if (error?.message !== 'TRANSCRIPT_CHANGED') throw error;
    // An actively written JSONL may have moved during the bounded read. Drop
    // that incomplete attempt and try once from a fresh source stamp. Parts
    // and find still require their original stamp and never take this retry.
    await new Promise(resolve => setImmediate(resolve));
    loaded = await load(agent, id, roots, { previewOnly: true });
  }
  const { stamp, value } = loaded;
  const shown = { schemaVersion: 'TranscriptV2', agent, stamp, ...preview(value) };
  return request === undefined ? shown : require('./transcript-continuation').make(shown, id, request);
}
// The same record as the window was shown, or TRANSCRIPT_CHANGED.
async function same(agent, id, roots, stamp, options = { noImages: true }) {
  if (typeof stamp !== 'string' || stamp.length > 200) throw new Error('TRANSCRIPT_PART_INVALID');
  const loaded = await load(agent, id, roots, options);
  if (loaded.stamp !== stamp) throw new Error('TRANSCRIPT_CHANGED');
  return loaded.value;
}
// One item in full: a page of its text or tool output from offset (characters), or its image.
async function part(agent, id, roots, request) {
  const { stamp, index, field, offset = 0 } = request || {};
  if (!Number.isInteger(index) || index < 0 || !['text', 'output', 'image', 'diff'].includes(field) || !Number.isInteger(offset) || offset < 0) throw new Error('TRANSCRIPT_PART_INVALID');
  const item = (await same(agent, id, roots, stamp, { noImages: field !== 'image' })).items[index];
  if (!item) throw new Error('TRANSCRIPT_PART_INVALID');
  if (field === 'image') { if (item.kind !== 'image') throw new Error('TRANSCRIPT_PART_INVALID'); return { image: 'data:' + item.image.mime + ';base64,' + item.image.data }; }
  const text = field === 'output' ? item.tool?.output : field === 'diff' ? item.tool?.change?.diff : item.kind === 'tool' || item.kind === 'image' ? null : item.text;
  if (typeof text !== 'string') throw new Error('TRANSCRIPT_PART_INVALID');
  const end = Math.min(text.length, offset + LIMITS.page);
  return { text: text.slice(offset, end), offset, total: text.length, next: end < text.length ? end : null, clipped: Boolean(field === 'output' ? item.tool.outputClipped : field === 'diff' ? false : item.clipped) };
}
// Figures of one conversation for a comparison (docs/m2/UI-SESSIONS-MULTI-20261102.md): counts and the files it changed,
// read when the person compares; the window gets no text of the conversation, nothing is kept.
async function facts(agent, id, roots) {
  const { stamp, value } = await load(agent, id, roots, { factsOnly: true }), files = new Map(), agents = new Set();
  let turns = 0, asked = false, commands = 0, compactions = 0, images = 0, reported = 0, known = false, first = null, last = null;
  for (const item of value.items) {
    if (item.side) agents.add(item.side);
    if (item.time) { first ??= item.time; last = item.time; }
    if (item.usage) { reported += item.usage; known = true; }
    if (item.kind === 'compact') compactions++;
    if (item.kind === 'image') images++;
    const opens = !item.side && (item.kind === 'user' || (item.kind === 'image' && item.from === 'user'));
    if (opens && !asked) turns++;
    asked = opens;
    if (item.kind !== 'tool') continue;
    commands += item.tool.commands ? item.tool.commands.length : /^(shell|bash|exec|local_shell|powershell|run_shell_command|run_command)/i.test(item.tool.name) ? 1 : 0;
    if (item.tool.error) continue;
    for (const file of item.tool.change?.files ?? []) { const entry = files.get(file.path) ?? { path: file.path, added: 0, removed: 0, calls: 0 }; entry.added += file.added; entry.removed += file.removed; entry.calls++; files.set(file.path, entry); }
  }
  return { schemaVersion: 'TranscriptFactsV1', agent, stamp, turns, tools: value.tools, failed: value.failed, commands, compactions, images, subagents: agents.size, reported: known ? reported : null, first, last, files: [...files.values()].slice(0, 500), truncated: value.truncated };
}
// Where a phrase appears in the full conversation: the items and how often in each.
// Items from..to of an open conversation as Markdown, in full: the person's messages, replies, thinking as a
// quote, tool calls with their output in a fence. Injected context is left out; images read as [图片].
const MARKDOWN_LIMIT = 64 * 1024 * 1024;
function fenced(text) { const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map(run => run[0].length)); const fence = '`'.repeat(longest + 1); return fence + '\n' + text + '\n' + fence; }
function itemMarkdown(item) {
  if (item.kind === 'user') return '### 你\n\n' + item.text;
  if (item.kind === 'assistant') return '### 回复\n\n' + item.text;
  if (item.kind === 'thinking') return '> **思考**\n>\n' + item.text.split('\n').map(line => '> ' + line).join('\n');
  if (item.kind === 'compact') return '---\n\n上下文在这里压缩了\n\n---';
  if (item.kind === 'command') return '`' + item.text.replace(/`/g, "'") + '`';
  if (item.kind === 'image') return '[图片]';
  if (item.kind === 'tool') return '**' + item.tool.name + '**' + (item.tool.error ? '（失败）' : '') + '：' + item.tool.summary.replace(/\n/g, ' ') + (item.tool.change ? '\n\n' + fenced(item.tool.change.diff) : '') + (item.tool.output ? '\n\n' + fenced(item.tool.output) : '');
  return null;
}
async function markdown(agent, id, roots, request) {
  const { stamp, from, to, plain } = request || {};
  const items = (await same(agent, id, roots, stamp)).items;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= items.length) throw new Error('TRANSCRIPT_PART_INVALID');
  // One message copied on its own is its words, without the heading a longer copy gives it.
  if (plain === true && from === to && typeof items[from].text === 'string') return items[from].text;
  const parts = []; let size = 0;
  for (let index = from; index <= to; index++) {
    const text = itemMarkdown(items[index]); if (text === null) continue;
    size += text.length; if (size > MARKDOWN_LIMIT) throw new Error('TRANSCRIPT_TOO_LARGE');
    parts.push(text);
  }
  return parts.join('\n\n') + '\n';
}
async function find(agent, id, roots, request) {
  const { stamp, query: phrase } = request || {};
  const needle = typeof phrase === 'string' ? phrase.trim().toLowerCase() : '';
  if (!needle || needle.length > 120) throw new Error('TRANSCRIPT_PART_INVALID');
  const items = (await same(agent, id, roots, stamp)).items, hits = [];
  let total = 0;
  items.forEach((item, index) => {
    let count = 0;
    for (const text of [item.text, item.tool?.name, item.tool?.summary, item.tool?.output, item.tool?.change?.diff]) {
      if (typeof text !== 'string') continue;
      const lower = text.toLowerCase();
      for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) count++;
    }
    if (count) { total += count; if (hits.length < LIMITS.hits) hits.push({ index, count }); }
  });
  return { hits, total };
}
// Cross-session search (SESSIONS-READER-20261101.md, step 3): the listed sessions' own files
// are scanned when the person searches, newest first, until a time budget runs out; the
// caller continues from where it stopped. There is no index: nothing found is kept.
const SEARCH = Object.freeze({ budgetMs: 6000, snippets: 3, before: 36, after: 72 });
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
// Every listed file of one Agent, by the session ID its name, folder or header gives.
function fileIndex(agent, roots) {
  const listed = [], index = new Map();
  for (const root of more.PARSERS[agent] ? more.rootsFor(agent, roots, path.dirname, path.join) : roots) { try { listed.push(...filesUnder(more.listed(agent), root, { reads: 0 })); } catch { continue; } }
  const better = (old, file) => {
    if (!old) return true;
    if (agent === 'antigravity') return path.basename(file) === 'transcript_full.jsonl';
    if (agent === 'deepseek') return (generation(file) ?? -1) > (generation(old) ?? -1);
    if (agent === 'gemini') return file.endsWith('.jsonl') && !old.endsWith('.jsonl');
    return (stat(file)?.size ?? 0) > (stat(old)?.size ?? 0);
  };
  for (const file of listed) {
    const base = path.basename(file);
    const id = agent === 'codex' ? UUID.exec(base.replace(/\.jsonl$/, ''))?.[1] : agent === 'claude' ? base.replace(/\.jsonl$/, '')
      : agent === 'antigravity' ? file.split(path.sep).at(-4) : agent === 'deepseek' ? path.basename(path.dirname(file))
      : agent === 'gemini' ? /"sessionId"\s*:\s*"([A-Za-z0-9_-]{1,128})"/.exec(head(file))?.[1]
      : more.PARSERS[agent] ? more.sessionOf(agent, file, path.dirname, path.basename, path.sep) : null;
    if (id && better(index.get(id), file)) index.set(id, file);
  }
  return index;
}
// The forms a phrase can take inside a JSON line: as is, with JSON escapes, with \u escapes.
function forms(needle) {
  const escaped = JSON.stringify(needle).slice(1, -1).toLowerCase();
  const ascii = escaped.replace(/[^\x20-\x7e]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
  return [...new Set([needle, escaped, ascii])];
}
function snippet(text, at, length) {
  const flat = value => value.replace(/\s+/g, ' ');
  const start = Math.max(0, at - SEARCH.before), end = Math.min(text.length, at + length + SEARCH.after);
  return { before: (start > 0 ? '…' : '') + flat(text.slice(start, at)).trimStart(), match: text.slice(at, at + length), after: flat(text.slice(at + length, end)).trimEnd() + (end < text.length ? '…' : '') };
}
// Matches in one conversation: how many items contain the phrase and the first few places.
function matches(value, needle) {
  let hits = 0; const snippets = [];
  for (const item of value.items) {
    let found = false;
    for (const text of [item.text, item.tool?.summary, item.tool?.output, item.tool?.change?.diff]) {
      if (typeof text !== 'string') continue;
      const at = text.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      found = true;
      if (snippets.length < SEARCH.snippets) snippets.push({ kind: item.kind, ...snippet(text, at, needle.length) });
      break;
    }
    if (found) hits++;
  }
  return { hits, snippets };
}
// entries: [{ key, agent, id }] newest first. Returns the sessions with matches and how many
// entries were looked at; the caller continues from that count.
async function search(entries, rootsOf, phrase, options = {}) {
  const needle = phrase.toLowerCase();
  return scan(entries, rootsOf, forms(needle), value => { const found = matches(value, needle); return found.hits ? found : null; }, options);
}
// Which of the listed sessions changed a file (docs/m2/UI-READER-FILE-HISTORY-20261102.md), scanned when the person asks,
// nothing kept. Exact is the same absolute path; a session in another directory with the same path under its own working
// directory (another worktree of the project) is returned too and says it is not exact.
const slashes = value => String(value).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').toLowerCase();
const rooted = value => /^(?:[a-z]:)?\//.test(value);
function placed(file, cwd) {
  const name = slashes(file), base = cwd ? slashes(cwd).replace(/\/$/, '') : null;
  if (rooted(name)) return { absolute: name, relative: base && name.startsWith(base + '/') ? name.slice(base.length + 1) : null };
  return { absolute: base ? base + '/' + name : null, relative: name };
}
function fileHistory(entries, rootsOf, target, options = {}) {
  const wanted = placed(target.path, target.cwd), base = slashes(target.path).split('/').pop();
  const of = cwd => value => {
    let exact = false, near = false, path = null, added = 0, removed = 0, calls = 0;
    for (const item of value.items) {
      if (item.kind !== 'tool' || item.tool.error) continue;
      for (const file of item.tool.change?.files ?? []) {
        const here = placed(file.path, cwd), same = Boolean(wanted.absolute && here.absolute === wanted.absolute), like = !same && Boolean(wanted.relative && here.relative === wanted.relative && wanted.relative.includes('/'));
        if (!same && !like) continue;
        exact ||= same; near ||= like; path ??= file.path; added += file.added; removed += file.removed; calls++;
      }
    }
    return exact || near ? { exact, path, added, removed, calls } : null;
  };
  return scan(entries, rootsOf, forms(base), (value, entry) => of(entry.cwd)(value), { ...options, factsOnly: true });
}
// Which MCP servers and Skills a session called: names and counts, from the tool rows alone. A hook leaves no row of its own.
function toolUse(entries, rootsOf, _target, options = {}) {
  return scan(entries, rootsOf, ['mcp__', '"skill"'], value => {
    const mcp = {}, skill = {}; let any = false;
    for (const item of value.items) {
      if (item.kind !== 'tool') continue;
      const server = /^mcp__(.+?)__/.exec(item.tool.name)?.[1], used = item.tool.name === 'Skill' ? /"skill"\s*:\s*"([^"]{1,120})"/.exec(item.tool.summary ?? '')?.[1] : null;
      if (server) { mcp[server] = (mcp[server] ?? 0) + 1; any = true; }
      if (used) { skill[used] = (skill[used] ?? 0) + 1; any = true; }
    }
    return any ? { mcp, skill } : null;
  }, { ...options, factsOnly: true });
}
async function scan(entries, rootsOf, raw, match, options = {}) {
  const deadline = Date.now() + (options.budgetMs ?? SEARCH.budgetMs);
  const results = [], indexes = new Map(), databases = new Map();
  let scanned = 0;
  const parse = (agent, text, file) => more.PARSERS[agent] ? parseMore(agent, text, options) : agent === 'codex' ? codex(objects(text)) : agent === 'claude' ? claude(objects(text)) : agent === 'gemini' ? gemini(geminiMessages(text, file.endsWith('.json')))
    : agent === 'deepseek' ? deepseek(objects(text)) : antigravity(objects(text));
  for (const entry of entries) {
    if (scanned > 0 && Date.now() > deadline) break;
    scanned++;
    if (!READERS.has(entry.agent)) continue;
    let value;
    try {
      // Kilo Code keeps the IDE's conversations in files and the CLI's in a database.
      if (entry.agent === 'kilo' && !indexes.has('kilo')) indexes.set('kilo', fileIndex('kilo', rootsOf('kilo') || []));
      if (['opencode', 'mimo', 'zcode'].includes(entry.agent) || entry.agent === 'kilo' && !indexes.get('kilo').has(entry.id)) {
        // Each database is read once per search; its sessions are matched as they are read and only
        // the matches kept, so one conversation at a time is held in memory.
        if (!databases.has(entry.agent)) {
          const files = databaseFiles(entry.agent, rootsOf(entry.agent) || []).filter(file => (stat(file)?.size ?? Infinity) <= LIMITS.database);
          const found = new Map(), ids = new Set(entries.filter(other => other.agent === entry.agent).map(other => other.id));
          for (const file of files) {
            try { await readDatabase(file, { reads: 0 }, db => { for (const id of ids) if (!found.has(id)) { const messages = databaseMessages(db, id); if (messages) found.set(id, match(mergeSides(opencode(messages, entry.agent, options), databaseDescendants(db, id).map(child => opencode(child.messages, entry.agent, { ...options, side: child.id }).items)), entries.find(other => other.agent === entry.agent && other.id === id))); } }); } catch { continue; }
          }
          databases.set(entry.agent, found);
        }
        const found = databases.get(entry.agent).get(entry.id);
        if (found) results.push({ key: entry.key, ...found });
        else if (entry.agent !== 'zcode' && entry.agent !== 'kilo') {
          const legacy = legacyFiles(entry.agent, entry.id, rootsOf(entry.agent) || []);
          if (legacy.messages.length) { const earlier = match(opencode(legacyMessages(legacy), entry.agent, options), entry); if (earlier) results.push({ key: entry.key, ...earlier }); }
        }
        continue;
      }
      if (!indexes.has(entry.agent)) indexes.set(entry.agent, fileIndex(entry.agent, rootsOf(entry.agent) || []));
      const file = indexes.get(entry.agent).get(entry.id);
      if (!file) continue;
      if (options.factsOnly && (entry.agent === 'codex' || entry.agent === 'claude')) {
        // File history needs changes, not message bodies. Preserve the raw prefilter
        // while parsing one line at a time; no full source/lowercase copy is retained.
        let contains = false;
        const look = line => { if (!contains) { const lower = line.toLowerCase(); contains = raw.some(form => lower.includes(form)); } };
        const rows = readObjects(file, LIMITS.file, look);
        value = entry.agent === 'codex' ? codex(rows, options) : claude(rows, null, options);
        if (entry.agent === 'claude') { const extra = subagentFiles(file, entry.id); value = mergeSides(value, extra.map(item => { try { return claude(readObjects(item, LIMITS.file, look), path.basename(item, '.jsonl').slice(6) || 'agent', options).items; } catch { return []; } })); }
        if (!contains) continue;
      } else {
        const text = readText(entry.agent, file), lower = text.toLowerCase(), extra = entry.agent === 'claude' ? subagentFiles(file, entry.id) : [];
        const texts = extra.map(item => { try { return readText('claude', item); } catch { return ''; } });
        if (!raw.some(form => lower.includes(form)) && !texts.some(body => { const inner = body.toLowerCase(); return raw.some(form => inner.includes(form)); })) continue;
        value = parse(entry.agent, text, file);
        if (extra.length) value = mergeSides(value, texts.map((body, at) => claude(objects(body), path.basename(extra[at], '.jsonl').slice(6) || 'agent').items));
      }
    } catch { continue; }
    if (!value) continue;
    const found = match(value, entry);
    if (found) results.push({ key: entry.key, ...found });
  }
  return { results, scanned };
}
module.exports = { READERS, LIMITS, SEARCH, search, fileHistory, toolUse, transcript, load, fileIndex, facts, stampNow, part, find, markdown, preview, codex, claude, opencode, databaseMessages, gemini, geminiMessages, deepseek, antigravity, toolSummary };
