'use strict';
// Conversations of the Agents added on 2026-11-04. Every record here is invented from the public format descriptions in
// docs/m2/SESSIONS-READER-MORE-20261104.md; none comes from a real session.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { roots, filesUnder } = require('../../src/m1/policy');
const { transcript, part, search, READERS } = require('../../src/m1/transcript');
const time = '2026-11-01T01:00:00.000Z', jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
function home(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-more-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return { dir, selected: roots(dir) }; }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
const kinds = value => value.items.map(item => item.kind);
const words = (value, kind) => value.items.filter(item => item.kind === kind).map(item => item.text);
const tool = value => value.items.find(item => item.kind === 'tool')?.tool;

test('every source in the catalog has a reader', () => {
  const { agents } = require('../../src/m1/agent-catalog');
  for (const agent of Object.keys(agents)) assert(READERS.has(agent), agent);
});

test('Pi reads the branch the session is on, not the one it rewound from', async t => {
  const { selected } = home(t), rows = [
    { type: 'session', version: 3, id: 'demo-pi', timestamp: time, cwd: 'C:\\demo' },
    { type: 'message', id: 'a', parentId: null, timestamp: time, message: { role: 'user', content: '改一下图表', timestamp: 1 } },
    { type: 'message', id: 'b', parentId: 'a', timestamp: time, message: { role: 'assistant', content: [{ type: 'text', text: '弃用的回答' }], timestamp: 2 } },
    { type: 'message', id: 'c', parentId: 'a', timestamp: time, message: { role: 'assistant', content: [{ type: 'thinking', thinking: '想一想' }, { type: 'text', text: '先读文件' }, { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'chart.ts' } }], usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 }, timestamp: 3 } },
    { type: 'message', id: 'd', parentId: 'c', timestamp: time, message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'read', content: [{ type: 'text', text: '文件内容' }], isError: false, timestamp: 4 } },
    { type: 'compaction', id: 'e', parentId: 'd', timestamp: time, summary: '前面的摘要', firstKeptEntryId: 'd', tokensBefore: 1000 },
    { type: 'message', id: 'f', parentId: 'e', timestamp: time, message: { role: 'assistant', content: [{ type: 'text', text: '改好了' }], timestamp: 5 } },
  ];
  write(path.join(selected.pi[0], 'demo', '2026-11-01_demo-pi.jsonl'), jsonl(rows));
  const value = await transcript('pi', 'demo-pi', selected.pi);
  assert.deepEqual(words(value, 'user'), ['改一下图表']);
  assert(!words(value, 'assistant').join().includes('弃用'), 'the abandoned branch stays out');
  assert.equal(tool(value).name, 'read'); assert.equal(tool(value).summary, 'chart.ts'); assert.equal(tool(value).output, '文件内容');
  assert(kinds(value).includes('compact')); assert(kinds(value).includes('thinking'));
});

test('Copilot CLI reads messages, reasoning and tool results, and a failed tool says so', async t => {
  const { selected } = home(t), rows = [
    { type: 'session.start', timestamp: time, data: { sessionId: 'demo-copilot', context: { cwd: 'C:\\demo' } } },
    { type: 'user.message', timestamp: time, data: { content: '跑一下测试' } },
    { type: 'assistant.message', timestamp: time, data: { messageId: 'm1', content: '好的', reasoningText: '先看脚本', toolRequests: [{ toolCallId: 't1', name: 'shell', arguments: { command: 'npm test' } }] } },
    { type: 'tool.execution_start', timestamp: time, data: { toolCallId: 't1', toolName: 'shell', arguments: { command: 'npm test' } } },
    { type: 'tool.execution_complete', timestamp: time, data: { toolCallId: 't1', success: false, error: { message: '退出码 1' } } },
    { type: 'tool.execution_start', timestamp: time, data: { toolCallId: 't2', toolName: 'view', arguments: { path: 'a.md' } } },
    { type: 'tool.execution_complete', timestamp: time, data: { toolCallId: 't2', success: true, result: { content: '短', detailedContent: '详细内容' } } },
    { type: 'session.shutdown', timestamp: time, data: { modelMetrics: {} } },
  ];
  write(path.join(selected.copilot[0], 'demo-copilot', 'events.jsonl'), jsonl(rows));
  const value = await transcript('copilot', 'demo-copilot', selected.copilot), tools = value.items.filter(item => item.kind === 'tool');
  assert.equal(tools.length, 2, 'a call asked for and started is one row');
  assert.equal(tools[0].tool.error, true); assert.equal(tools[0].tool.output, '退出码 1');
  assert.equal(tools[1].tool.output, '详细内容'); assert.equal(value.failed, 1);
  assert.deepEqual(words(value, 'thinking'), ['先看脚本']);
});

test('Cline and Kilo Code read the conversation file, unwrap the task and fold the environment', async t => {
  const { selected } = home(t), history = [
    { role: 'user', ts: 1762000000000, content: [{ type: 'text', text: '<task>\n加一个按钮\n</task>' }, { type: 'text', text: '<environment_details>\n目录列表\n</environment_details>' }] },
    { role: 'assistant', ts: 1762000001000, content: [{ type: 'text', text: '我来改' }, { type: 'tool_use', id: 'u1', name: 'write_to_file', input: { path: 'a.tsx', content: 'x' } }] },
    { role: 'user', ts: 1762000002000, content: [{ type: 'tool_result', tool_use_id: 'u1', content: [{ type: 'text', text: '已写入' }] }] },
  ];
  write(path.join(selected.cline[0], '1762000000000', 'api_conversation_history.json'), JSON.stringify(history));
  write(path.join(selected.cline[0], '1762000000000', 'ui_messages.json'), '[]');
  const value = await transcript('cline', '1762000000000', selected.cline);
  assert.deepEqual(words(value, 'user'), ['加一个按钮']);
  assert(words(value, 'context')[0].includes('目录列表'));
  assert.equal(tool(value).output, '已写入');
  write(path.join(selected.kilo[0], 'demo-kilo', 'api_conversation_history.json'), JSON.stringify(history));
  assert.deepEqual(words(await transcript('kilo', 'demo-kilo', selected.kilo), 'user'), ['加一个按钮']);
  // The usage scan does not gain the conversation file.
  assert.deepEqual(filesUnder('cline', selected.cline[0], { reads: 0 }).map(file => path.basename(file)), ['ui_messages.json']);
});

test('Cline CLI and the Kilo Code CLI database are read too', async t => {
  const { selected } = home(t);
  write(path.join(selected.cline[1], 'demo-cli', 'demo-cli.messages.json'), JSON.stringify({ sessionId: 'demo-cli', messages: [{ id: 'm1', role: 'user', ts: 1, content: '你好' }, { id: 'm2', role: 'assistant', ts: 2, content: [{ type: 'text', text: '在' }], metrics: { inputTokens: 5, outputTokens: 1 } }] }));
  assert.deepEqual(words(await transcript('cline', 'demo-cli', selected.cline), 'assistant'), ['在']);
  fs.mkdirSync(path.dirname(selected.kilo[1]), { recursive: true });
  const db = new DatabaseSync(selected.kilo[1]);
  db.exec('CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE part(id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);');
  db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('m1', 'demo-db', 1, JSON.stringify({ role: 'user' }));
  db.prepare('INSERT INTO part VALUES(?,?,?,?,?)').run('p1', 'm1', 'demo-db', 1, JSON.stringify({ type: 'text', text: '数据库里的问题' }));
  db.close();
  assert.deepEqual(words(await transcript('kilo', 'demo-db', selected.kilo), 'user'), ['数据库里的问题']);
});

test('ZCode reads its session, message and part tables', async t => {
  const { selected } = home(t);
  fs.mkdirSync(path.dirname(selected.zcode[0]), { recursive: true });
  const db = new DatabaseSync(selected.zcode[0]);
  db.exec('CREATE TABLE session(id TEXT); CREATE TABLE message(id TEXT, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE part(id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);');
  db.prepare('INSERT INTO message VALUES(?,?,?,?)').run('m1', 'demo-z', 1, JSON.stringify({ role: 'assistant' }));
  db.prepare('INSERT INTO part VALUES(?,?,?,?,?)').run('p1', 'm1', 'demo-z', 1, JSON.stringify({ type: 'text', text: '回答' }));
  db.close();
  assert.deepEqual(words(await transcript('zcode', 'demo-z', selected.zcode), 'assistant'), ['回答']);
});

test('Qwen follows the record chain, so a rewound turn stays out', async t => {
  const { selected } = home(t), base = { sessionId: 'demo-qwen', timestamp: time };
  write(path.join(selected.qwen[0], 'demo', 'chats', 'demo-qwen.jsonl'), jsonl([
    { ...base, uuid: 'a', parentUuid: null, type: 'user', message: { role: 'user', parts: [{ text: '问题' }] } },
    { ...base, uuid: 'b', parentUuid: 'a', type: 'assistant', message: { role: 'model', parts: [{ text: '撤回的回答' }] } },
    { ...base, uuid: 'c', parentUuid: 'a', type: 'assistant', message: { role: 'model', parts: [{ text: '想法', thought: true }, { text: '回答' }, { functionCall: { id: 'f1', name: 'read_file', args: { path: 'b.ts' } } }] }, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 } },
    { ...base, uuid: 'd', parentUuid: 'c', type: 'tool_result', message: { role: 'user', parts: [{ functionResponse: { id: 'f1', name: 'read_file', response: { output: '内容' } } }] } },
    { ...base, uuid: 'e', parentUuid: 'x', type: 'assistant', isSidechain: true, message: { role: 'model', parts: [{ text: '子代理' }] } },
  ]));
  const value = await transcript('qwen', 'demo-qwen', selected.qwen);
  assert.deepEqual(words(value, 'assistant'), ['回答', '子代理'], 'its sub-agent is read too, the rewound reply is not');
  assert.equal(value.items.find(item => item.text === '子代理').side, 'agent');
  assert.deepEqual(words(value, 'thinking'), ['想法']);
  assert.equal(tool(value).output, '内容'); assert.equal(tool(value).summary, 'b.ts');
});

test('Kimi CLI puts a call together from its pieces; a log with no known text says it cannot be read', async t => {
  const { selected } = home(t), at = Date.parse(time) / 1000, row = (type, payload) => ({ timestamp: at, message: { type, payload } });
  write(path.join(selected.kimi[0], 'workspace', 'demo-kimi', 'wire.jsonl'), jsonl([
    { type: 'metadata', protocol_version: '1' },
    row('TurnBegin', { user_input: '查一下' }),
    row('ContentPart', { type: 'think', think: '思考' }),
    row('ContentPart', { type: 'text', text: '好' }),
    row('ToolCall', { type: 'function', id: 'k1', function: { name: 'Shell', arguments: '{"comm' } }),
    row('ToolCallPart', { arguments_part: 'and":"ls"}' }),
    row('ToolResult', { tool_call_id: 'k1', return_value: { is_error: true, output: '失败', message: '', display: [] } }),
    row('StatusUpdate', { token_usage: { input_other: 5, output: 1, input_cache_read: 0, input_cache_creation: 0 }, message_id: 'id-1' }),
  ]));
  const value = await transcript('kimi', 'demo-kimi', selected.kimi);
  assert.equal(tool(value).summary, 'ls'); assert.equal(tool(value).error, true); assert.equal(tool(value).output, '失败');
  write(path.join(selected.kimi[1], 'workspace', 'demo-code', 'agents', 'main', 'wire.jsonl'), jsonl([{ type: 'usage.record', usageScope: 'turn', time: 1, usage: { output: 1 } }]));
  await assert.rejects(transcript('kimi', 'demo-code', selected.kimi), /TRANSCRIPT_UNSUPPORTED/);
});

test('Cursor reads agent transcripts in both layouts and leaves other files alone', async t => {
  const { selected } = home(t), rows = [
    { role: 'user', message: { content: [{ type: 'text', text: '<user_query>\n改配色\n</user_query>' }] } },
    { role: 'assistant', message: { content: [{ type: 'text', text: '好' }, { type: 'tool_use', name: 'Edit', input: { file_path: 'a.css' } }] } },
    { role: 'tool', message: { content: [] } },
  ];
  write(path.join(selected.cursor[0], 'demo', 'agent-transcripts', 'demo-flat.jsonl'), jsonl(rows));
  write(path.join(selected.cursor[0], 'demo', 'agent-transcripts', 'demo-nested', 'demo-nested.jsonl'), jsonl(rows));
  write(path.join(selected.cursor[0], 'demo', 'other', 'demo-other.jsonl'), jsonl(rows));
  assert.deepEqual(words(await transcript('cursor', 'demo-flat', selected.cursor), 'user'), ['改配色']);
  assert.deepEqual(words(await transcript('cursor', 'demo-nested', selected.cursor), 'assistant'), ['好']);
  await assert.rejects(transcript('cursor', 'demo-other', selected.cursor), /TRANSCRIPT_NOT_FOUND/);
  assert.deepEqual(filesUnder('cursor', selected.cursor[0], { reads: 0 }), [], 'the usage scan does not gain them');
});

test('WorkBuddy reads messages, calls and results, whether text is a string or a list', async t => {
  const { selected } = home(t), base = { sessionId: 'demo-wb', cwd: 'C:\\demo', timestamp: Date.parse(time) };
  write(path.join(selected.workbuddy[0], 'demo', 'demo-wb.jsonl'), jsonl([
    { ...base, id: '1', type: 'message', role: 'user', content: [{ type: 'input_text', text: '帮我看看' }] },
    { ...base, id: '2', type: 'reasoning', rawContent: [{ type: 'text', text: '想' }] },
    { ...base, id: '3', type: 'function_call', name: 'Read', callId: 'w1', arguments: '{"file_path":"c.ts"}' },
    { ...base, id: '4', type: 'function_call_result', callId: 'w1', status: 'failed', output: { type: 'text', text: '读不到' } },
    { ...base, id: '5', type: 'message', role: 'assistant', content: '看完了', status: 'completed' },
  ]));
  const value = await transcript('workbuddy', 'demo-wb', selected.workbuddy);
  assert.deepEqual(words(value, 'user'), ['帮我看看']); assert.deepEqual(words(value, 'assistant'), ['看完了']);
  assert.equal(tool(value).summary, 'c.ts'); assert.equal(tool(value).error, true); assert.equal(tool(value).output, '读不到');
});

test('Continue reads the session document beside its usage database, never its index', async t => {
  const { selected } = home(t), dir = path.join(path.dirname(path.dirname(selected.continue[0])), 'sessions');
  write(path.join(dir, 'sessions.json'), JSON.stringify([{ sessionId: 'demo-c', title: '标题' }]));
  write(path.join(dir, 'demo-c.json'), JSON.stringify({ sessionId: 'demo-c', title: '标题', workspaceDirectory: 'file:///demo', history: [
    { message: { role: 'user', content: [{ type: 'text', text: '问' }] }, contextItems: [] },
    { message: { role: 'assistant', content: '答', toolCalls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"filepath":"d.ts"}' } }] }, contextItems: [], toolCallStates: [{ toolCallId: 'c1', status: 'errored', output: [{ name: 'x', content: '出错' }] }] },
  ] }));
  const value = await transcript('continue', 'demo-c', selected.continue);
  assert.deepEqual(words(value, 'user'), ['问']); assert.equal(tool(value).error, true); assert.equal(tool(value).output, '出错');
  await assert.rejects(transcript('continue', 'sessions', selected.continue), /TRANSCRIPT_NOT_FOUND/);
});

test('long output opens in full and cross-session search reaches the new readers', async t => {
  const { selected } = home(t), long = '第一行\n' + 'x'.repeat(20000), rows = [
    { type: 'user.message', timestamp: time, data: { content: '独特的问题词' } },
    { type: 'tool.execution_start', timestamp: time, data: { toolCallId: 't1', toolName: 'shell', arguments: { command: 'cat' } } },
    { type: 'tool.execution_complete', timestamp: time, data: { toolCallId: 't1', success: true, result: { content: long } } },
  ];
  write(path.join(selected.copilot[0], 'demo-s', 'events.jsonl'), jsonl(rows));
  const value = await transcript('copilot', 'demo-s', selected.copilot), index = value.items.findIndex(item => item.kind === 'tool');
  const full = await part('copilot', 'demo-s', selected.copilot, { stamp: value.stamp, index, field: 'output', offset: 0 });
  assert.equal(full.text, long);
  const found = await search([{ key: 'k', agent: 'copilot', id: 'demo-s' }], agent => selected[agent], '独特的问题词');
  assert.equal(found.results.length, 1); assert.equal(found.results[0].hits, 1);
});

test('nothing but the session\'s own file is opened: other files in the folder are not conversations', async t => {
  const { selected } = home(t);
  write(path.join(selected.continue[0]), 'not a database');
  write(path.join(path.dirname(path.dirname(selected.continue[0])), 'sessions', 'config.json'), JSON.stringify({ history: [{ message: { role: 'user', content: '不该读' } }] }));
  await assert.rejects(transcript('continue', 'config', selected.continue), /TRANSCRIPT_NOT_FOUND/);
});
