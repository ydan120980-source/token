'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { roots } = require('../../src/m1/policy');
const SENTINEL = 'M1_PRIVATE_SENTINEL_BODY_EMAIL_SECRET';
function fixtures(home) {
  const selected = roots(home), time = new Date().toISOString();
  function jsonl(file, rows) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); }
  const usage = (input, output, cached = 0) => ({ input_tokens: input, output_tokens: output, cached_input_tokens: cached, cache_creation_input_tokens: 0, reasoning_output_tokens: 3, total_tokens: input + output });
  const codex = [
    { type: 'session_meta', payload: { id: 'synthetic-session', originator: 'codex_cli_rs', title: SENTINEL } },
    { type: 'turn_context', payload: { model: 'gpt-4.1' } },
    { timestamp: time, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(100, 20, 40), last_token_usage: usage(100, 20, 40) } } },
    { timestamp: time, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage(150, 30, 50), last_token_usage: usage(50, 10, 10) } } }
  ];
  jsonl(path.join(selected.codex[0], 'session.jsonl'), codex);
  jsonl(path.join(selected.codex[1], 'copied.jsonl'), codex);
  jsonl(path.join(selected.claude[0], 'project', 'session.jsonl'), [{ type: 'assistant', uuid: 'claude-a', timestamp: time, message: { id: 'claude-msg', model: 'claude-sonnet-4-20250514', content: SENTINEL, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 } } }]);
  const msg = { id: 'open-message', role: 'assistant', sessionID: 'session', modelID: 'gpt-4.1', providerID: 'openai', tokens: { input: 80, output: 10, reasoning: 2, cache: { read: 20, write: 0 } }, time: { created: Date.parse(time) }, content: SENTINEL };
  jsonl(path.join(selected.workbuddy[0], 'session.jsonl'), [{ id: 'work-a', timestamp: Date.parse(time), providerData: { requestModelId: 'gpt-4.1', rawUsage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 40, cache_creation_input_tokens: 0 } }, content: SENTINEL }]);
  for (const agent of ['opencode', 'mimo']) {
    const file = agent === 'opencode' ? path.join(selected.opencode[0], 'opencode.db') : path.join(selected.mimo[0], 'mimocode.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file); db.exec('CREATE TABLE message(id TEXT, session_id TEXT, data TEXT)');
    const row = agent === 'mimo' ? { ...msg, id: 'mimo-message' } : msg;
    db.prepare('INSERT INTO message VALUES(?,?,?)').run(row.id, 'session', JSON.stringify(row)); db.close();
  }
  // Migration overlap: same message in legacy JSON and SQLite counts once.
  const legacy = path.join(selected.opencode[0], 'storage', 'message', 'session', 'message.json'); fs.mkdirSync(path.dirname(legacy), { recursive: true }); fs.writeFileSync(legacy, JSON.stringify(msg));
  fs.writeFileSync(path.join(home, '.codex', 'auth.json'), SENTINEL);
  return { roots: selected, expected: { codex: 180, claude: 170, opencode: 112, workbuddy: 120, mimo: 112 }, total: 694, sentinel: SENTINEL };
}
module.exports = { fixtures, SENTINEL };
