'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store } = require('../../src/m1/store');
const { transcript, codex, claude, gemini, geminiMessages, deepseek, antigravity, preview, LIMITS } = require('../../src/m1/transcript');
const { DatabaseSync } = require('node:sqlite');
const zlib = require('node:zlib');
const time = new Date().toISOString(), CODEX_ID = '019a7c2e-0000-4000-8000-0000000000aa', CLAUDE_ID = 'c1a0de00-0000-4000-8000-0000000000bb';
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const usage = { input_tokens: 100, output_tokens: 20, cached_input_tokens: 40, total_tokens: 120 };
function workspace(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
const response = payload => ({ timestamp: time, type: 'response_item', payload });
const codexRows = [
  { timestamp: time, type: 'session_meta', payload: { id: CODEX_ID, cwd: 'C:\\work\\alpha', originator: 'codex_cli_rs' } },
  response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] }),
  response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '修一下趋势图' }] }),
  { timestamp: time, type: 'event_msg', payload: { type: 'user_message', message: '修一下趋势图' } },
  response({ type: 'reasoning', summary: [{ type: 'summary_text', text: '先看看 line-chart' }], encrypted_content: 'secret' }),
  response({ type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['rg', 'sweep'] }) }),
  response({ type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: 'no match', metadata: { exit_code: 1 } }) }),
  response({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'c2', input: '*** Begin Patch' }),
  response({ type: 'custom_tool_call_output', call_id: 'c2', output: 'Done' }),
  response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '改好了。' }] }),
  { timestamp: time, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage, last_token_usage: usage } } },
];
const claudeRows = [
  { type: 'user', sessionId: CLAUDE_ID, cwd: 'C:\\work\\beta', timestamp: time, isMeta: true, message: { role: 'user', content: 'Caveat: injected' } },
  { type: 'user', sessionId: CLAUDE_ID, timestamp: time, message: { role: 'user', content: '<command-name>/model</command-name>' } },
  { type: 'user', sessionId: CLAUDE_ID, timestamp: time, message: { role: 'user', content: [{ type: 'text', text: '读一下 README' }] } },
  { type: 'assistant', sessionId: CLAUDE_ID, timestamp: time, message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '需要读文件' }], usage: { input_tokens: 10, output_tokens: 2 } } },
  { type: 'assistant', sessionId: CLAUDE_ID, timestamp: time, message: { id: 'm1', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'C:\\work\\beta\\README.md' } }], usage: { input_tokens: 10, output_tokens: 2 } } },
  { type: 'user', sessionId: CLAUDE_ID, timestamp: time, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '# Title' }], is_error: false }] } },
  { type: 'assistant', sessionId: CLAUDE_ID, timestamp: time, message: { id: 'm2', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }], usage: { input_tokens: 10, output_tokens: 2 } } },
  { type: 'user', sessionId: CLAUDE_ID, timestamp: time, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'fail 1', is_error: true }] } },
  { type: 'assistant', sessionId: CLAUDE_ID, timestamp: time, message: { id: 'm3', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: '有一个测试失败。' }], usage: { input_tokens: 10, output_tokens: 2 } } },
  { type: 'custom-title', customTitle: 'README 检查', sessionId: CLAUDE_ID },
];

test('Codex rollouts read as turns: injected context apart, tools paired with their output and exit status', () => {
  const value = codex(codexRows);
  assert.deepEqual(value.items.map(item => item.kind), ['context', 'user', 'thinking', 'tool', 'tool', 'assistant']);
  assert.equal(value.items[1].text, '修一下趋势图', 'event_msg repeats are skipped');
  assert.deepEqual(value.items[3].tool, { name: 'shell', summary: 'rg sweep', output: 'no match', error: true });
  assert.deepEqual(value.items[4].tool, { name: 'apply_patch', summary: '*** Begin Patch', output: 'Done', error: false });
  assert.equal(JSON.stringify(value).includes('secret'), false, 'encrypted reasoning is never returned');
  assert.deepEqual([value.turns, value.tools, value.failed, value.truncated], [1, 2, 1, false]);
});

test('Claude Code rows read as turns: meta and commands apart, tool results attached, errors kept', () => {
  const value = claude(claudeRows);
  assert.deepEqual(value.items.map(item => item.kind), ['context', 'command', 'user', 'thinking', 'tool', 'tool', 'assistant']);
  assert.equal(value.items[1].text, '/model');
  assert.deepEqual(value.items[4].tool, { name: 'Read', summary: 'C:\\work\\beta\\README.md', output: '# Title', error: false });
  assert.deepEqual(value.items[5].tool, { name: 'Bash', summary: 'npm test', output: 'fail 1', error: true });
  assert.deepEqual([value.turns, value.tools, value.failed], [1, 2, 1]);
});

test('the whole conversation is kept; the window gets long text and outputs as previews with their length', () => {
  const long = 'x'.repeat(LIMITS.spoken + 10), lines = Array.from({ length: 40 }, (_, index) => 'line ' + index).join('\n');
  const value = codex([response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: long }] }), response({ type: 'function_call', name: 'shell', call_id: 'a', arguments: '{}' }), response({ type: 'function_call_output', call_id: 'a', output: lines }),
    response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'short' }] })]);
  assert.equal(value.items[0].text.length, long.length, 'parsing keeps everything');
  const light = preview(value);
  assert.deepEqual([light.items[0].text.length, light.items[0].length], [LIMITS.preview, long.length]);
  assert.deepEqual([light.items[1].tool.output.split('\n').length, light.items[1].tool.outputLength], [LIMITS.previewLines, lines.length]);
  assert.deepEqual(light.items[2], { kind: 'assistant', time: value.items[2].time, text: 'short' }, 'short text goes in full, without a length');
  const many = Array.from({ length: LIMITS.items + 5 }, (_, index) => response({ type: 'message', role: index % 2 ? 'assistant' : 'user', content: [{ type: 'input_text', text: 'turn ' + index }] }));
  const capped = codex(many);
  assert.equal(capped.items.length, LIMITS.items); assert.equal(capped.truncated, true);
});

test('images carried in the record become image items; the window gets their type and size only', () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  const value = claude([{ type: 'user', sessionId: CLAUDE_ID, timestamp: time, message: { role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }, { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }] } }]);
  assert.deepEqual(value.items.map(item => item.kind), ['user', 'image', 'user']);
  assert.equal(value.items[2].text, '[图片]', 'a remote image is not fetched');
  assert.deepEqual(preview(value).items[1], { kind: 'image', from: 'user', time: value.items[1].time, image: { mime: 'image/png', bytes: 8 } });
  assert.equal(codex([response({ type: 'message', role: 'user', content: [{ type: 'input_image', image_url: 'data:image/svg+xml;base64,' + png }] })]).items.length, 0, 'only raster types');
});

test('the store reads a listed session from its own file on request and keeps nothing', async t => {
  const dir = workspace(t), selected = roots(path.join(dir, 'home'));
  write(path.join(selected.codex[0], '2026', '11', '01', 'rollout-2026-11-01T09-00-00-' + CODEX_ID + '.jsonl'), jsonl(codexRows));
  write(path.join(selected.claude[0], 'C--work-beta', CLAUDE_ID + '.jsonl'), jsonl(claudeRows));
  const store = new Store(path.join(dir, 'app'), selected);
  store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' });
  const list = store.sessionList(), key = agent => list.sessions.find(item => item.agent === agent).key;
  const before = fs.readFileSync(path.join(dir, 'app', 'statistics.json'), 'utf8');
  const codexValue = await store.transcript(key('codex')), claudeValue = await store.transcript(key('claude'));
  assert.equal(codexValue.schemaVersion, 'TranscriptV2'); assert.match(codexValue.stamp, /^\d+:\d+$/); assert.equal(codexValue.items.at(-1).text, '改好了。');
  assert.equal(claudeValue.items.at(-1).text, '有一个测试失败。');
  assert.equal(JSON.stringify(codexValue).includes(dir), false, 'no file path is returned');
  assert.equal(fs.readFileSync(path.join(dir, 'app', 'statistics.json'), 'utf8'), before, 'reading saves nothing');
  assert.equal(JSON.stringify(store.snapshot()).includes('修一下趋势图'), false);
  await assert.rejects(store.transcript('0'.repeat(64)), /TRANSCRIPT_NOT_FOUND/);
  await assert.rejects(store.transcript('../x'), /TRANSCRIPT_NOT_FOUND/);
  for (const agent of ['no-such-agent']) await assert.rejects(transcript(agent, 'g-1', []), /TRANSCRIPT_UNSUPPORTED/);
  await assert.rejects(transcript('codex', 'a b', selected.codex), /TRANSCRIPT_NOT_FOUND/);
});

// OpenCode 1.x keeps parts in their own table; 2.x keeps them in session_message content.
function openDatabase(file, version) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (version === 1) {
    db.exec('CREATE TABLE session (id TEXT, directory TEXT, title TEXT); CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE part (id TEXT, session_id TEXT, message_id TEXT, time_created INTEGER, data TEXT)');
    const message = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)'), part = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?)');
    message.run('m1', 'ses_one', 1, JSON.stringify({ role: 'user' })); message.run('m2', 'ses_one', 2, JSON.stringify({ role: 'assistant' }));
    message.run('x1', 'ses_other', 3, JSON.stringify({ role: 'user' }));
    part.run('p1', 'ses_one', 'm1', 1, JSON.stringify({ type: 'text', text: '列出文件' }));
    part.run('p2', 'ses_one', 'm1', 1, JSON.stringify({ type: 'text', text: 'Use the above', synthetic: true }));
    part.run('p3', 'ses_one', 'm2', 2, JSON.stringify({ type: 'reasoning', text: '用 ls' }));
    part.run('p4', 'ses_one', 'm2', 3, JSON.stringify({ type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'error', input: { command: 'bunx biome' }, error: 'not found' } }));
    part.run('p5', 'ses_one', 'm2', 4, JSON.stringify({ type: 'tool', callID: 'c2', tool: 'read', state: { status: 'completed', input: { filePath: '/p/a.ts' }, output: 'export {}' } }));
    part.run('p6', 'ses_one', 'm2', 5, JSON.stringify({ type: 'step-finish', tokens: { total: 9 } }));
    part.run('p7', 'ses_one', 'm2', 6, JSON.stringify({ type: 'text', text: '有两个文件。' }));
    part.run('p8', 'ses_other', 'x1', 7, JSON.stringify({ type: 'text', text: '别的会话' }));
  } else {
    db.exec('CREATE TABLE session (id TEXT, directory TEXT, title TEXT); CREATE TABLE session_message (id TEXT, session_id TEXT, type TEXT, seq INTEGER, time_created INTEGER, data TEXT)');
    const row = db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?)');
    row.run('r2', 'ses_two', 'assistant', 2, 2, JSON.stringify({ content: [{ type: 'reasoning', text: 'thinking' }, { type: 'tool', name: 'shell', id: 'call_1' }, { type: 'text', text: 'All done in V2' }] }));
    row.run('r1', 'ses_two', 'user', 1, 9, JSON.stringify({ text: 'Hello V2' }));
  }
  db.close();
}

test('OpenCode and MiMo Code read from their database: parts in order, synthetic text folded, tool status kept', async t => {
  const dir = workspace(t), selected = roots(path.join(dir, 'home'));
  openDatabase(path.join(selected.opencode[0], 'opencode.db'), 1);
  openDatabase(path.join(selected.mimo[0], 'mimocode.db'), 2);
  const one = await transcript('opencode', 'ses_one', selected.opencode);
  assert.deepEqual(one.items.map(item => item.kind), ['user', 'context', 'thinking', 'tool', 'tool', 'assistant']);
  assert.deepEqual(one.items[3].tool, { name: 'bash', summary: 'bunx biome', output: 'not found', error: true });
  assert.deepEqual(one.items[4].tool, { name: 'read', summary: '/p/a.ts', output: 'export {}', error: false });
  assert.equal(JSON.stringify(one).includes('别的会话'), false, 'only the asked session');
  assert.match(one.items[1].text, /Use the above/, 'text the Agent added folds as context, never as the person\'s words');
  const two = await transcript('mimo', 'ses_two', selected.mimo);
  assert.deepEqual(two.items.map(item => [item.kind, item.text ?? item.tool.name]), [['user', 'Hello V2'], ['thinking', 'thinking'], ['tool', 'shell'], ['assistant', 'All done in V2']], 'ordered by seq, not time');
  assert.equal(two.items[2].tool.output, null, 'a call without a recorded state has no output');
  await assert.rejects(transcript('opencode', 'ses_missing', selected.opencode), /TRANSCRIPT_NOT_FOUND/);
});

test('Gemini CLI logs replay updates, checkpoints and rewinds; thoughts, tools and injected context sort apart', async t => {
  const user = (id, text) => ({ id, type: 'user', timestamp: time, content: [{ text }] });
  const reply = { id: 'g2', type: 'gemini', timestamp: time, content: '找到了', thoughts: [{ subject: '定位', description: '先搜索' }],
    toolCalls: [{ id: 't1', name: 'run_shell_command', args: { command: 'rg chart' }, status: 'error', result: [{ functionResponse: { response: { error: 'exit 2' } } }] },
      { id: 't2', name: 'read_file', args: { absolute_path: '/p/b.ts' }, status: 'success', resultDisplay: 'ok' }] };
  const log = [{ sessionId: 'gem-1', projectHash: 'h' }, user('g0', '<session_context>env</session_context>'), user('g1', '旧问题'), { $rewindTo: 'g1' }, user('g1', '搜一下图表'), { ...reply, content: '草稿' }, reply];
  const value = gemini(geminiMessages(log.map(row => JSON.stringify(row)).join('\n'), false));
  assert.deepEqual(value.items.map(item => item.kind), ['context', 'user', 'thinking', 'assistant', 'tool', 'tool']);
  assert.equal(value.items[1].text, '搜一下图表'); assert.equal(value.items[3].text, '找到了', 'a rewritten message replaces the draft in place');
  assert.equal(value.items[2].text, '**定位**\n\n先搜索');
  assert.deepEqual(value.items[4].tool, { name: 'run_shell_command', summary: 'rg chart', output: 'exit 2', error: true });
  assert.deepEqual(value.items[5].tool, { name: 'read_file', summary: '/p/b.ts', output: 'ok', error: false });
  assert.deepEqual(gemini(geminiMessages(JSON.stringify({ sessionId: 'gem-1', messages: [user('a', '/model')] }), true)).items.map(item => item.kind), ['command']);
  const dir = workspace(t), selected = roots(path.join(dir, 'home')), chats = path.join(selected.gemini[0], 'hash', 'chats');
  write(path.join(chats, 'session-2026-11-01T09-00-aaaa.json'), JSON.stringify({ sessionId: 'gem-1', messages: [user('old', '迁移前')] }));
  write(path.join(chats, 'session-2026-11-01T09-00-aaaa.jsonl'), log.map(row => JSON.stringify(row)).join('\n') + '\n');
  assert.equal((await transcript('gemini', 'gem-1', selected.gemini)).items[1].text, '搜一下图表', 'the .jsonl wins over its migrated .json');
});

const deepseekRows = [
  { type: 'session', id: 'ds-1', version: 4, isSeeded: false, cwd: 'C:\\work' },
  { seq: 0, type: 'user/message', time: 1, data: { id: 'u0', source: { kind: 'system' }, content: [{ type: 'text', text: '项目说明' }] } },
  { seq: 1, type: 'user/message', time: 2, data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '跑测试' }] } },
  { seq: 2, type: 'assistant/message', time: 3, data: { message: { id: 'a1', content: [{ type: 'thinking', thinking: '运行 npm test' }, { type: 'tool-call', id: 'k1', name: 'shell', arguments: '{"command":"npm test"}' }] } } },
  { seq: 3, type: 'tool/result', time: 4, data: { message: { id: 'r1', toolCallId: 'k1', isError: true, content: [{ type: 'text', text: 'fail 2' }] } } },
  { seq: 4, type: 'assistant/message', time: 5, surfaceOp: { op: 'replace' }, data: { message: { id: 'a2x', content: [{ type: 'text', text: '压缩副本' }] } } },
  { seq: 5, type: 'assistant/message', time: 6, data: { message: { id: 'a2', content: [{ type: 'text', text: '两个失败。' }] } } },
  { seq: 6, type: 'assistant/message', time: 7, data: { message: { id: 'a2', content: [{ type: 'text', text: '重复' }] } } },
];
test('DeepSeek Harness reads its event log, compressed or not, from the newest generation of the session folder', async t => {
  const value = deepseek(deepseekRows);
  assert.deepEqual(value.items.map(item => item.kind), ['context', 'user', 'thinking', 'tool', 'assistant']);
  assert.deepEqual(value.items[3].tool, { name: 'shell', summary: 'npm test', output: 'fail 2', error: true });
  assert.equal(JSON.stringify(value).includes('压缩副本') || JSON.stringify(value).includes('重复'), false);
  const dir = workspace(t), selected = roots(path.join(dir, 'home')), folder = path.join(selected.deepseek[0], 'project', 'ds-1');
  write(path.join(folder, 'session.v3.jsonl'), jsonl([{ ...deepseekRows[0], version: 3 }, deepseekRows[1]]));
  write(path.join(folder, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(jsonl(deepseekRows))));
  assert.equal((await transcript('deepseek', 'ds-1', selected.deepseek)).items.at(-1).text, '两个失败。');
});

test('Antigravity keeps the last row of each step, the typed request apart from added context, other steps as rows', async t => {
  const rows = [
    { step_index: 0, type: 'USER_INPUT', created_at: time, content: '<USER_REQUEST>\nfix the build\n</USER_REQUEST>\n<ADDITIONAL_METADATA>local time</ADDITIONAL_METADATA>' },
    { step_index: 1, type: 'PLANNER_RESPONSE', content: 'draft' },
    { step_index: 2, type: 'RUN_COMMAND', content: 'npm run build' },
    { step_index: 1, type: 'PLANNER_RESPONSE', content: 'done', input_tokens: 10 },
  ];
  const value = antigravity(rows);
  assert.deepEqual(value.items.map(item => [item.kind, item.text ?? item.tool.name]), [['user', 'fix the build'], ['context', '<ADDITIONAL_METADATA>local time</ADDITIONAL_METADATA>'], ['assistant', 'done'], ['tool', 'run_command']]);
  assert.equal(value.items[3].tool.output, 'npm run build');
  const dir = workspace(t), selected = roots(path.join(dir, 'home')), logs = path.join(selected.antigravity[1], 'agy-1', '.system_generated', 'logs');
  write(path.join(logs, 'transcript.jsonl'), jsonl(rows.slice(0, 1)));
  write(path.join(logs, 'transcript_full.jsonl'), jsonl(rows));
  assert.equal((await transcript('antigravity', 'agy-1', selected.antigravity)).items.length, 4, 'the full transcript wins');
});

test('streamed Antigravity revisions preserve previews, full parts, find and record-change protection', async t => {
  const { part, find } = require('../../src/m1/transcript');
  const dir = workspace(t), selected = roots(path.join(dir, 'home')), id = 'streamed-agy';
  const file = path.join(selected.antigravity[1], id, '.system_generated', 'logs', 'transcript_full.jsonl');
  const long = '中文🙂'.repeat(70000) + 'needle-at-end';
  const rows = [
    { step_index: 0, type: 'USER_INPUT', created_at: time, content: 'question' },
    ...Array.from({ length: 20 }, (_, index) => ({ step_index: 1, type: 'PLANNER_RESPONSE', content: 'old-' + index + long })),
    { step_index: 2, type: 'RUN_COMMAND', content: 'output-final' },
    { step_index: 1, type: 'PLANNER_RESPONSE', content: long },
  ];
  write(file, jsonl(rows).trimEnd() + '\nINVALID\nnull\n');
  const light = await transcript('antigravity', id, selected.antigravity);
  const { schemaVersion, agent, stamp, ...value } = light;
  assert.equal(schemaVersion, 'TranscriptV2'); assert.equal(agent, 'antigravity');
  assert.deepEqual(value, preview(antigravity(rows)), 'last revisions win without keeping the decoded file');
  const full = await part(agent, id, selected.antigravity, { stamp, index: 1, field: 'text', offset: 0 });
  assert.equal(full.text, long); assert.equal(full.total, long.length);
  assert.equal((await find(agent, id, selected.antigravity, { stamp, query: 'needle-at-end' })).total, 1);
  fs.appendFileSync(file, JSON.stringify({ step_index: 3, type: 'PLANNER_RESPONSE', content: 'later' }));
  await assert.rejects(part(agent, id, selected.antigravity, { stamp, index: 1, field: 'text' }), /TRANSCRIPT_CHANGED/);
});

test('Antigravity locates only the requested branch, preserves full-transcript precedence and selected file roots', async t => {
  const dir = workspace(t), selected = roots(path.join(dir, 'home')), id = 'wanted';
  const first = path.join(selected.antigravity[0], id, '.system_generated', 'logs', 'transcript.jsonl');
  const full = path.join(selected.antigravity[1], id, '.system_generated', 'logs', 'transcript_full.jsonl');
  const row = content => jsonl([{ step_index: 0, type: 'USER_INPUT', content }]);
  write(first, row('short-root')); write(full, row('full-root'));
  write(path.join(selected.antigravity[0], 'unrelated', '.system_generated', 'logs', 'transcript_full.jsonl'), row('other session'));
  write(path.join(selected.antigravity[0], id, 'artifacts', 'large', 'ignored.txt'), 'unrelated artifact');
  const visited = [], original = fs.readdirSync;
  fs.readdirSync = function(directory, ...args) { visited.push(String(directory)); return original.call(this, directory, ...args); };
  try {
    const value = await transcript('antigravity', id, selected.antigravity);
    assert.equal(value.items[0].text, 'full-root', 'full transcript in another selected root still wins');
  } finally { fs.readdirSync = original; }
  assert.equal(visited.some(directory => directory.includes(path.sep + 'unrelated')), false);
  assert.equal(visited.some(directory => directory.includes(path.sep + 'artifacts')), false);
  assert.equal((await transcript('antigravity', id, [first])).items[0].text, 'short-root');
  const outside = path.join(dir, 'outside'); fs.mkdirSync(outside); fs.mkdirSync(selected.antigravity[2], { recursive: true });
  fs.symlinkSync(outside, path.join(selected.antigravity[2], id), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(transcript('antigravity', id, [selected.antigravity[2]]), /TRANSCRIPT_NOT_FOUND/);
});

test('uncompressed DeepSeek streaming matches parsed events and keeps full text reachable', async t => {
  const { part } = require('../../src/m1/transcript');
  const dir = workspace(t), selected = roots(path.join(dir, 'home')), id = 'ds-streamed';
  const long = '中🙂'.repeat(25000), rows = [...deepseekRows, { type: 'assistant/message', data: { message: { id: 'long-final', content: [{ type: 'text', text: long }] } } }];
  write(path.join(selected.deepseek[0], 'project', id, 'session.v4.jsonl'), jsonl(rows));
  const { schemaVersion, agent, stamp, ...value } = await transcript('deepseek', id, selected.deepseek);
  assert.equal(schemaVersion, 'TranscriptV2'); assert.deepEqual(value, preview(deepseek(rows)));
  const index = value.items.length - 1;
  assert.ok((await part(agent, id, selected.deepseek, { stamp, index, field: 'text' })).text.endsWith(long));
});

test('search across conversations scans listed sessions now, newest first, and returns places, not files', async t => {
  const dir = workspace(t), selected = roots(path.join(dir, 'home'));
  write(path.join(selected.codex[0], '2026', '11', '01', 'rollout-2026-11-01T09-00-00-' + CODEX_ID + '.jsonl'), jsonl(codexRows));
  write(path.join(selected.claude[0], 'C--work-beta', CLAUDE_ID + '.jsonl'), jsonl(claudeRows));
  const store = new Store(path.join(dir, 'app'), selected);
  store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' });
  const before = fs.readFileSync(path.join(dir, 'app', 'statistics.json'), 'utf8');
  const all = await store.searchTranscripts({ query: 'README', range: 'all', agent: 'all', offset: 0 });
  assert.equal(all.schemaVersion, 'TranscriptSearchV1'); assert.deepEqual([all.total, all.searched, all.next], [2, 2, null]);
  assert.equal(all.results.length, 1); assert.equal(all.results[0].hits, 2, 'the request and the Read call');
  assert.deepEqual(all.results[0].snippets[0], { kind: 'user', before: '读一下 ', match: 'README', after: '' });
  assert.equal((await store.searchTranscripts({ query: '趋势图', range: 'all', agent: 'claude', offset: 0 })).results.length, 0, 'the Agent filter applies');
  assert.equal((await store.searchTranscripts({ query: 'absent-phrase', range: 'all', agent: 'all', offset: 0 })).results.length, 0);
  assert.equal(JSON.stringify(all).includes(dir), false, 'no file path is returned');
  assert.equal(fs.readFileSync(path.join(dir, 'app', 'statistics.json'), 'utf8'), before, 'searching saves nothing');
  for (const request of [{ query: '' }, { query: 'x'.repeat(121) }, { query: 'a\nb' }, { query: 'a', offset: -1 }, { query: 'a', extra: 1 }, { query: 'a', range: 'year' }]) await assert.rejects(store.searchTranscripts(request), /TRANSCRIPT_SEARCH_INVALID/);
});

test('search reads each database once and matches its sessions one by one', async t => {
  const { search } = require('../../src/m1/transcript');
  const dir = workspace(t), selected = roots(path.join(dir, 'home'));
  openDatabase(path.join(selected.opencode[0], 'opencode.db'), 1);
  const value = await search([{ key: 'k1', agent: 'opencode', id: 'ses_one' }, { key: 'k2', agent: 'opencode', id: 'ses_other' }, { key: 'k3', agent: 'zcode', id: 'z' }], () => selected.opencode, '文件');
  assert.equal(value.scanned, 3);
  assert.deepEqual(value.results.map(result => [result.key, result.hits]), [['k1', 2]]);
  assert.deepEqual(value.results[0].snippets.map(snippet => snippet.kind), ['user', 'assistant']);
});


test('an open conversation gives items in full by page and finds over the full text; a changed record is refused', async t => {
  const { part, find } = require('../../src/m1/transcript');
  const dir = workspace(t), selected = roots(path.join(dir, 'home')), file = path.join(selected.claude[0], 'C--work-beta', CLAUDE_ID + '.jsonl');
  const long = 'a'.repeat(LIMITS.page + 5) + ' needle', png = Buffer.from('89504e470d0a1a0a', 'hex').toString('base64');
  write(file, jsonl([...claudeRows, { type: 'assistant', sessionId: CLAUDE_ID, timestamp: time, message: { id: 'm9', role: 'assistant', content: [{ type: 'tool_use', id: 't9', name: 'Bash', input: { command: 'cat big' } }] } },
    { type: 'user', sessionId: CLAUDE_ID, timestamp: time, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't9', content: long }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] } }]));
  const shown = await transcript('claude', CLAUDE_ID, selected.claude), tool = shown.items.findIndex(item => item.tool?.name === 'Bash' && item.tool.summary === 'cat big');
  assert.equal(shown.items[tool].tool.outputLength, long.length);
  const first = await part('claude', CLAUDE_ID, selected.claude, { stamp: shown.stamp, index: tool, field: 'output' });
  assert.deepEqual([first.text.length, first.total, first.next], [LIMITS.page, long.length, LIMITS.page]);
  const rest = await part('claude', CLAUDE_ID, selected.claude, { stamp: shown.stamp, index: tool, field: 'output', offset: first.next });
  assert.equal(first.text + rest.text, long); assert.equal(rest.next, null);
  const image = shown.items.findIndex(item => item.kind === 'image');
  assert.equal((await part('claude', CLAUDE_ID, selected.claude, { stamp: shown.stamp, index: image, field: 'image' })).image, 'data:image/png;base64,' + png);
  const found = await find('claude', CLAUDE_ID, selected.claude, { stamp: shown.stamp, query: 'NEEDLE' });
  assert.deepEqual(found.hits, [{ index: tool, count: 1 }], 'beyond the preview');
  for (const request of [{ stamp: shown.stamp, index: 0, field: 'output' }, { stamp: shown.stamp, index: 9999, field: 'text' }, { stamp: shown.stamp, index: tool, field: 'nope' }, { index: 0, field: 'text' }]) await assert.rejects(part('claude', CLAUDE_ID, selected.claude, request), /TRANSCRIPT_PART_INVALID/);
  fs.appendFileSync(file, jsonl([{ type: 'user', sessionId: CLAUDE_ID, timestamp: time, message: { role: 'user', content: '又一条' } }]));
  await assert.rejects(part('claude', CLAUDE_ID, selected.claude, { stamp: shown.stamp, index: 0, field: 'text' }), /TRANSCRIPT_CHANGED/);
  await assert.rejects(find('claude', CLAUDE_ID, selected.claude, { stamp: shown.stamp, query: 'x' }), /TRANSCRIPT_CHANGED/);
});

test('a turn or the whole conversation reads as Markdown in full: context left out, outputs fenced past their own backticks', async t => {
  const { markdown } = require('../../src/m1/transcript');
  const dir = workspace(t), selected = roots(path.join(dir, 'home')), file = path.join(selected.claude[0], 'C--work-beta', CLAUDE_ID + '.jsonl');
  const output = 'x'.repeat(LIMITS.inline + 50) + '\n```\ninner\n```';
  write(file, jsonl([...claudeRows.slice(0, 6), { type: 'user', sessionId: CLAUDE_ID, timestamp: time, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: output }] } }, ...claudeRows.slice(6)]));
  const shown = await transcript('claude', CLAUDE_ID, selected.claude), last = shown.items.length - 1;
  const text = await markdown('claude', CLAUDE_ID, selected.claude, { stamp: shown.stamp, from: 0, to: last });
  assert.equal(text.includes('Caveat: injected'), false, 'injected context is left out');
  assert.match(text, /### 你\n\n读一下 README/); assert.match(text, /### 回复\n\n有一个测试失败。/); assert.match(text, /> \*\*思考\*\*\n>\n> 需要读文件/);
  assert.ok(text.includes('**Read**：C:\\work\\beta\\README.md\n\n````\n' + output + '\n````'), 'full output in a fence longer than its own');
  assert.ok(text.includes('**Bash**（失败）：npm test'));
  const words = shown.items.findIndex(item => item.kind === 'user');
  assert.equal(await markdown('claude', CLAUDE_ID, selected.claude, { stamp: shown.stamp, from: words, to: words, plain: true }), shown.items[words].text, 'one message copies as its words alone');
  const one = await markdown('claude', CLAUDE_ID, selected.claude, { stamp: shown.stamp, from: 2, to: 2 });
  assert.equal(one, '### 你\n\n读一下 README\n');
  for (const request of [{ stamp: shown.stamp, from: 3, to: 2 }, { stamp: shown.stamp, from: 0, to: last + 1 }, { stamp: shown.stamp, from: -1, to: 0 }]) await assert.rejects(markdown('claude', CLAUDE_ID, selected.claude, request), /TRANSCRIPT_PART_INVALID/);
  await assert.rejects(markdown('claude', CLAUDE_ID, selected.claude, { stamp: '1:1', from: 0, to: 0 }), /TRANSCRIPT_CHANGED/);
});
