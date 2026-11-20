'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_COUNTS = [810, 1683, 1560];
const epoch = Date.parse('2026-11-19T00:00:00.000Z');
const project = 'C:/synthetic/memory-gate';

function seed(home, counts = DEFAULT_COUNTS) {
  const hash = crypto.createHash('sha256');
  let sourceBytes = 0;
  counts.forEach((count, index) => {
    const id = '11111111-1111-4111-8111-00000000000' + index;
    const codex = index === 0;
    const name = codex ? path.join('.codex', 'sessions', '2026', '11', '19',
      'rollout-2026-11-19T00-00-00-' + id + '.jsonl') :
      path.join('.claude', 'projects', 'synthetic', id + '.jsonl');
    const rows = codex ? [
      { type: 'session_meta', timestamp: new Date(epoch).toISOString(), payload: { id, cwd: project, originator: 'codex_cli_rs' } },
      { type: 'turn_context', payload: { cwd: project, model: 'gpt-4.1' } },
    ] : [];
    for (let turn = 0; turn < count; turn++) {
      const timestamp = new Date(epoch + turn * 1000 + index).toISOString();
      const counted = (turn + 1) % 24 === 0 || turn === count - 1;
      const question = '合成问题 ' + index + '/' + turn;
      const answer = '合成答复 ' + index + '/' + turn + '\n\n' + '会话阅读内存诊断。'.repeat(96)
        + '\n\n```text\n' + ('synthetic line ' + turn + '\n').repeat(15) + '```';
      if (codex) {
        rows.push(
          { timestamp, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: question }] } },
          { timestamp, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] } }
        );
        if (counted) rows.push({ timestamp, type: 'event_msg', payload: { type: 'token_count', info: {
            last_token_usage: { input_tokens: 100, output_tokens: 200, total_tokens: 300 },
            total_token_usage: { input_tokens: (turn + 1) * 100, output_tokens: (turn + 1) * 200, total_tokens: (turn + 1) * 300 },
        } } });
      } else {
        const meta = { timestamp, cwd: project, sessionId: id };
        rows.push(
          { ...meta, type: 'user', uuid: id + '-q' + turn, message: { role: 'user', content: question } },
          { ...meta, type: 'assistant', uuid: id + '-a' + turn, message: {
            id: id + '-m' + turn, role: 'assistant', model: 'claude-sonnet-4-20250514',
            ...(counted ? { usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } : {}),
            content: [{ type: 'text', text: answer }],
          } }
        );
      }
    }
    const file = path.join(home, name);
    const content = Buffer.from(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    hash.update(content);
    sourceBytes += content.length;
  });
  return { turns: counts, sourceBytes, sourceSha256: hash.digest('hex'), sourceFormats: ['codex-jsonl', 'claude-jsonl'] };
}

module.exports = { seed };
