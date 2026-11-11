'use strict';
const fs = require('node:fs'), path = require('node:path');
const { seed, CODEX_ID } = require('./sessions-reader-fixture');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store, atomic } = require('../../src/m1/store');
const { normalize } = require('../../src/m1/normalize');

// Tool-heavy turns and a separate long history exercise the three reader columns.
// Every name, command, path and paragraph is synthetic, independent of owner records.
async function seedReaderPerformance(root) {
  const fixture = await seed(root), ids = [CODEX_ID, CODEX_ID.replace(/13$/, '24')];
  const started = Date.now() - 900000;
  for (const [slot, id] of ids.entries()) {
    const turns = slot ? 180 : 37, tools = slot ? 6 : 80;
    const rows = [{ timestamp: new Date(started).toISOString(), type: 'session_meta', payload: { id, originator: 'codex_cli_rs', cwd: 'C:/synthetic/reader-speed' } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } }];
    for (let turn = 0; turn < turns; turn++) {
      const timestamp = new Date(started + turn * 2000).toISOString();
      const message = (role, text) => ({ timestamp, type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
      rows.push(message('user', '合成阅读任务 ' + slot + ' / ' + turn));
      for (let step = 0; step < tools; step++) {
        const edit = step % 10 === 0, name = edit ? 'apply_patch' : 'exec_command';
        const args = edit ? '*** Begin Patch\n*** Update File: C:/synthetic/reader-speed/src/part-' + turn % 5 + '/module-' + turn + '-' + step + '.js\n@@\n-before\n+after\n*** End Patch' : JSON.stringify({ cmd: 'echo synthetic-step-' + step });
        rows.push({ timestamp, type: 'response_item', payload: { type: 'function_call', name, call_id: turn + ':' + step, arguments: args } }, { timestamp, type: 'response_item', payload: { type: 'function_call_output', call_id: turn + ':' + step, output: edit ? 'Success. Updated files.' : '合成执行结果。'.repeat(20) } });
        if (step % 20 === 19) rows.push(message('assistant', '合成进展说明。'.repeat(20)));
      }
      rows.push(message('assistant', '```js\nconst syntheticResult = ' + turn + ';\n```\n\n' + '合成会话阅读段落。'.repeat(slot ? 300 : 60)), { timestamp, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: (turn + 1) * 100, output_tokens: (turn + 1) * 20, total_tokens: (turn + 1) * 120 }, last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } } } });
    }
    fs.writeFileSync(fixture.codexFile.replace(CODEX_ID, id), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  }
  const store = new Store(fixture.usage, roots(fixture.home));
  store.ingest(await scanSources(roots(fixture.home), store.state.salt, { reads: 0 }), { status: 'not-run' });
  store.setEnabled(false);
  for (let index = 0; index < 8000; index++) {
    const row = normalize('codex', { input_tokens: 80, output_tokens: 20, total_tokens: 100 }, { id: 'reader-speed-' + index, session: 'synthetic-reader-session-' + index, time: started, model: 'gpt-4.1', entry: 'cli' }, store.state.salt);
    store.state.records[row.id] = row;
  }
  store.state.sequence++; atomic(path.join(fixture.usage, 'statistics.json'), store.state);
  return { ...fixture, ids };
}
module.exports = { seedReaderPerformance };
