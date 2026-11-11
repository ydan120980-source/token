'use strict';
// The synthetic home the collection scripts share: Codex rollouts and Claude Code sessions, in the
// shapes those Agents write. Synthetic records only; nothing here touches a real home directory.
//
// Every usage row carries what the normalizers require, so a benchmark measures records being
// counted rather than filtered out: a timestamp on the row that reports the usage, and, for Claude
// Code, a message id that identifies the call. Without them `normalize` returns null and the whole
// run measures traversal alone.
const fs = require('node:fs'), path = require('node:path');

const START = Date.UTC(2026, 10, 2, 3, 0, 0);

function rows(agent, file, turnNo, text) {
  const time = new Date(START + file * 60000 + turnNo * 1000).toISOString();
  if (agent === 'codex') {
    return [
      { timestamp: time, type: 'session_meta', payload: { id: 'collect-codex-' + file, cwd: 'C:/synthetic/collect' } },
      { timestamp: time, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题 ' + turnNo }] } },
      { timestamp: time, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] } },
      { timestamp: time, type: 'event_msg', payload: { type: 'token_count', info: { model: 'gpt-5-codex', total_token_usage: { input_tokens: 100 * (turnNo + 1), output_tokens: 20 * (turnNo + 1), cached_input_tokens: 40 * (turnNo + 1) }, last_token_usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 40 } } } }
    ];
  }
  return [
    { timestamp: time, type: 'summary', summary: 'collect-claude-' + file, leafUuid: 'leaf-' + file + '-' + turnNo },
    { timestamp: time, type: 'user', message: { role: 'user', content: [{ type: 'text', text: '问题 ' + turnNo }] } },
    {
      timestamp: time, sessionId: 'collect-claude-' + file, cwd: 'C:/synthetic/collect',
      type: 'assistant',
      message: { id: 'msg-' + file + '-' + turnNo, role: 'assistant', model: 'claude-synthetic', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text }] }
    }
  ];
}

function build(root, count, turns = 20) {
  const home = path.join(root, 'home');
  const codex = path.join(home, '.codex', 'sessions'), claude = path.join(home, '.claude', 'projects');
  fs.mkdirSync(codex, { recursive: true }); fs.mkdirSync(claude, { recursive: true });
  let files = 0, usageRows = 0;
  for (let file = 0; file < count; file += 1) {
    const agent = file % 2 ? 'codex' : 'claude';
    const out = [];
    for (let turnNo = 0; turnNo < turns; turnNo += 1) out.push(...rows(agent, file, turnNo, '回答 ' + turnNo + ' '.repeat(200)));
    usageRows += turns;
    if (agent === 'codex') {
      const dir = path.join(codex, '2026', '11', '02'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'rollout-2026-11-02T03-00-00-collect-codex-' + file + '.jsonl'), out.map(row => JSON.stringify(row)).join('\n') + '\n');
    } else {
      const dir = path.join(claude, 'proj-' + (file % 8)); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'collect-claude-' + file + '.jsonl'), out.map(row => JSON.stringify(row)).join('\n') + '\n');
    }
    files += 1;
  }
  return { home, roots: { codex: [codex], claude: [claude] }, files, usageRows, oneFile: path.join(codex, '2026', '11', '02', 'rollout-2026-11-02T03-00-00-collect-codex-1.jsonl') };
}

module.exports = build;
module.exports.START = START;
