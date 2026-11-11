'use strict';
// Synthetic native-format records for the reader UI. No real home is an input.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store } = require('../../src/m1/store');
const CODEX_ID = '019a7c2e-1101-4000-8000-000000000013';
const CLAUDE_ID = 'c1a0de00-1101-4000-8000-000000000013';
const COMMON = 'M13_READER_SHARED_NEEDLE', TEXT_TAIL = 'M13_TEXT_AFTER_PREVIEW', OUTPUT_TAIL = 'M13_OUTPUT_AFTER_SECOND_PAGE';
const CHANGE_PATH = 'C:/synthetic/fixture-edit.js', CHANGE_TAIL = 'NOV2_CHANGED_LINE';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZl8AAAAASUVORK5CYII=';
const LONG_OUTPUT = Array.from({ length: 400 }, (_, n) => 'line ' + String(n).padStart(3, '0') + ' ' + 'x'.repeat(1400)).join('\n') + '\n' + OUTPUT_TAIL;
// Longer than a reply arrives whole (transcript.js LIMITS.spoken), so it still has to be asked for.
const LONG_TEXT = '正文开头\n\n' + '合成段落。'.repeat(53000) + '\n\n' + TEXT_TAIL;
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); return file; };
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
function hashes(home) {
  const files = {};
  const walk = dir => { for (const item of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, item.name); if (item.isDirectory()) walk(file); else if (item.isFile()) files[path.relative(home, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); else throw Error('FIXTURE_LINK_REJECTED'); } };
  walk(home); return files;
}
async function seed(root, { now = Date.now() } = {}) {
  const home = path.join(root, 'home'), usage = path.join(root, 'usage'), selected = roots(home), start = now - 600000;
  const time = n => new Date(start + n * 1000).toISOString(), counts = { input_tokens: 100, output_tokens: 20, cached_input_tokens: 0, total_tokens: 120 };
  const response = (n, payload) => ({ timestamp: time(n), type: 'response_item', payload });
  const codex = [{ timestamp: time(0), type: 'session_meta', payload: { id: CODEX_ID, originator: 'codex_cli_rs', cwd: 'C:\\synthetic\\reader-codex' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } }];
  for (let n = 0; n < 45; n++) {
    codex.push(response(n, { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题 ' + String(n + 1).padStart(2, '0') + ' ' + COMMON }, ...(n === 0 ? [{ type: 'input_image', image_url: 'data:image/png;base64,' + PNG }] : [])] }));
    if (n === 0) {
      codex.push(response(n, { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>M13_CONTEXT_NOT_FOR_EXPORT</environment_context>' }] }));
      for (let k = 0; k < 3; k++) codex.push(response(n, { type: 'function_call', name: 'shell', call_id: 'run-' + k, arguments: JSON.stringify({ command: 'synthetic command ' + k }) }), response(n, { type: 'function_call_output', call_id: 'run-' + k, output: 'synthetic result ' + k }));
      codex.push(response(n, { type: 'function_call', name: 'read_file', call_id: 'failed', arguments: '{"path":"synthetic-missing"}' }), response(n, { type: 'function_call_output', call_id: 'failed', output: JSON.stringify({ output: 'synthetic failure', metadata: { exit_code: 2 } }) }));
    }
    if (n === 1) codex.push(response(n, { type: 'function_call', name: 'shell', call_id: 'long-output', arguments: '{"command":"synthetic long output"}' }), response(n, { type: 'function_call_output', call_id: 'long-output', output: LONG_OUTPUT }));
    codex.push(response(n, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: n === 2 ? LONG_TEXT : '回复 ' + String(n + 1).padStart(2, '0') + '\n\n**合成粗体**\n\n|键|值|\n|---|---|\n|a|1|\n\n[合成链接](https://example.invalid/m13-reader)' }] }));
  }
  codex.push({ timestamp: time(45), type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: counts, last_token_usage: counts } } });
  const codexFile = write(path.join(selected.codex[0], '2026', '11', '01', 'rollout-2026-11-01T12-00-00-' + CODEX_ID + '.jsonl'), jsonl(codex));
  write(path.join(selected.claude[0], 'reader-claude', CLAUDE_ID + '.jsonl'), jsonl([
    { type: 'user', sessionId: CLAUDE_ID, cwd: 'C:\\synthetic\\reader-claude', timestamp: time(50), message: { role: 'user', content: COMMON + ' Claude question' } },
    { type: 'assistant', uuid: 'm13-claude', sessionId: CLAUDE_ID, timestamp: time(51), message: { id: 'm13-claude', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'CLAUDE_READER_REPLY\n' + 'c'.repeat(300000) + '\nCLAUDE_LATE_TAIL' }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  ]));
  for (const agent of ['opencode', 'mimo']) {
    const file = path.join(selected[agent][0], agent === 'mimo' ? 'mimocode.db' : 'opencode.db'); fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file), id = 'm13-' + agent;
    db.exec('CREATE TABLE session(id TEXT, directory TEXT, title TEXT, version TEXT); CREATE TABLE session_message(id TEXT, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, data TEXT)');
    db.prepare('INSERT INTO session VALUES(?,?,?,?)').run(id, 'C:\\synthetic\\reader-' + agent, 'Synthetic ' + agent, 'cli-2');
    const insert = db.prepare('INSERT INTO session_message VALUES(?,?,?,?,?,?)');
    insert.run(id + '-u', id, 'user', 0, start + 60000, JSON.stringify({ content: [{ type: 'text', text: COMMON + ' ' + agent + ' question' }] }));
    insert.run(id + '-a', id, 'assistant', 1, start + 61000, JSON.stringify({ role: 'assistant', sessionID: id, modelID: 'gpt-4.1', providerID: 'openai', time: { created: start + 61000 }, tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }, content: [{ type: 'text', text: agent.toUpperCase() + '_READER_REPLY' }, { type: 'tool', tool: 'edit', callID: agent + '-edit', state: { status: 'completed', input: { path: CHANGE_PATH, oldString: 'before', newString: CHANGE_TAIL }, output: 'synthetic edit done' } }] })); db.close();
  }
  write(path.join(selected.gemini[0], 'm13', 'chats', 'session-m13.jsonl'), jsonl([{ sessionId: 'm13-gemini' }, { id: 'm13-gu', type: 'user', timestamp: time(70), content: [{ text: COMMON + ' Gemini question' }] }, { id: 'm13-ga', type: 'gemini', timestamp: time(71), model: 'gemini-2.5-pro', content: 'GEMINI_READER_REPLY', toolCalls: [{ id: 'g-edit', name: 'replace', args: { file_path: CHANGE_PATH, old_string: 'before', new_string: CHANGE_TAIL }, status: 'success', resultDisplay: 'synthetic edit done' }], tokens: { input: 100, output: 20, cached: 0, thoughts: 0, total: 120 } }]));
  const deepseek = [{ type: 'session', id: 'm13-deepseek', version: 4, isSeeded: false, cwd: 'C:\\synthetic\\reader-deepseek' }, { seq: 0, type: 'user/message', time: time(80), data: { id: 'm13-du', source: { kind: 'user' }, content: [{ type: 'text', text: COMMON + ' DeepSeek question' }] } }, { seq: 1, type: 'assistant/message', time: time(81), data: { turn: 0, step: 0, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 120 }, message: { id: 'm13-da', source: { model: 'deepseek-chat', provider: 'deepseek' }, content: [{ type: 'text', text: 'DEEPSEEK_READER_REPLY' }, { type: 'tool-call', id: 'd-edit', name: 'str_replace_editor', arguments: { command: 'str_replace', path: CHANGE_PATH, old_str: 'before', new_str: CHANGE_TAIL } }] } } }];
  deepseek.push({ seq: 2, type: 'tool/result', time: time(82), data: { message: { id: 'd-result', toolCallId: 'd-edit', content: [{ type: 'text', text: 'synthetic edit done' }] } } });
  write(path.join(selected.deepseek[0], 'project', 'm13-deepseek', 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(jsonl(deepseek))));
  write(path.join(selected.antigravity[1], 'm13-antigravity', '.system_generated', 'logs', 'transcript_full.jsonl'), jsonl([{ step_index: 0, type: 'USER_INPUT', created_at: time(90), content: '<USER_REQUEST>\n' + COMMON + ' Antigravity question\n</USER_REQUEST>' }, { step_index: 1, type: 'PLANNER_RESPONSE', created_at: time(91), content: 'ANTIGRAVITY_READER_REPLY', input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, tool_calls: [{ name: 'replace_file_content', args: { TargetFile: CHANGE_PATH } }, { name: 'run_command', args: { CommandLine: 'synthetic check' } }] }, { step_index: 2, source: 'MODEL', type: 'CODE_ACTION', status: 'DONE', created_at: time(92), content: 'The following changes were made by the replace_file_content tool to: ' + CHANGE_PATH + '. If relevant, run it.\n[diff_block_start]\n@@ -1 +1 @@\n-before\n+' + CHANGE_TAIL + '\n[diff_block_end]' }, { step_index: 3, source: 'MODEL', type: 'RUN_COMMAND', status: 'DONE', created_at: time(93), content: 'The command failed with exit code: 1\nOutput: synthetic failure' }]));
  const store = new Store(usage, selected); store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' }); store.setEnabled(false);
  return { home, usage, codexFile, sourceHashes: hashes(home), ledgerBytes: fs.readFileSync(path.join(usage, 'statistics.json')) };
}
module.exports = { seed, hashes, CODEX_ID, CLAUDE_ID, COMMON, TEXT_TAIL, OUTPUT_TAIL, LONG_OUTPUT, LONG_TEXT, PNG, CHANGE_PATH, CHANGE_TAIL };
