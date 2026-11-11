'use strict';
// The reading view's promise (owner 2026-11-05, "内容不全"): what a record says reaches the window. Every shape below carries
// its own invented marker, and each marker must be found in what the window can get. A shape added to an Agent's format gets
// a line here; a row a reader does not know must stay readable rather than disappear.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { codex, claude, opencode, gemini, deepseek, antigravity, preview, transcript, part, find, stampNow, LIMITS } = require('../../src/m1/transcript');

const at = '2026-10-01T08:00:00.000Z';
const all = value => JSON.stringify(value.items.map(item => [item.text, item.tool?.name, item.tool?.summary, item.tool?.output, item.label]));
function reaches(value, markers) { const text = all(value); for (const marker of markers) assert.ok(text.includes(marker), 'missing ' + marker); }
const image = 'data:image/png;base64,iVBORw0KGgo=';
const response = payload => ({ timestamp: at, type: 'response_item', payload });
const event = payload => ({ timestamp: at, type: 'event_msg', payload });

test('Codex: every kind of row its rollout keeps reaches the window', () => {
  const value = codex([
    { timestamp: at, type: 'session_meta', payload: { id: 'demo' } },
    response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'CX-user' }] }),
    response({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'CX-developer' }] }),
    response({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'CX-summary' }], content: [{ type: 'reasoning_text', text: 'CX-reasoning' }] }),
    response({ type: 'agent_message', author: 'CX-author', recipient: 'root', content: [{ type: 'input_text', text: 'CX-agent' }] }),
    response({ type: 'function_call', name: 'read', namespace: 'CX-namespace', call_id: 'a', arguments: '{"path":"CX-args"}' }),
    response({ type: 'function_call_output', call_id: 'a', output: 'CX-output' }),
    response({ type: 'custom_tool_call', name: 'CX-custom', call_id: 'b', input: 'x' }),
    response({ type: 'custom_tool_call_output', call_id: 'b', output: [{ type: 'input_text', text: 'CX-list-output' }, { type: 'input_image', image_url: image }] }),
    response({ type: 'tool_search_call', call_id: 'c', arguments: { query: 'CX-tool-search' } }),
    response({ type: 'tool_search_output', call_id: 'c', status: 'completed', tools: [{ name: 'CX-found-tool' }] }),
    response({ type: 'web_search_call', action: { type: 'search', queries: ['CX-queries'] } }),
    response({ type: 'web_search_call', action: { type: 'open_page', url: 'https://example.test/CX-page' } }),
    response({ type: 'web_search_call', action: { type: 'find_in_page', url: 'https://example.test/', pattern: 'CX-pattern' } }),
    response({ type: 'image_generation_call', id: 'g', status: 'completed', revised_prompt: 'CX-drawn', result: 'iVBORw0KGgo=' }),
    response({ type: 'function_call_output', call_id: 'nowhere', output: 'CX-orphan' }),
    response({ type: 'a_new_kind', detail: 'CX-unknown-item' }),
    { timestamp: at, type: 'a_new_row', detail: 'CX-unknown-row' },
    event({ type: 'turn_aborted', reason: 'CX-aborted' }),
    event({ type: 'item_completed', item: { type: 'Plan', text: 'CX-plan' } }),
    response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'CX-reply' }] }),
  ]);
  reaches(value, ['CX-user', 'CX-developer', 'CX-summary', 'CX-reasoning', 'CX-agent', 'CX-namespace', 'CX-args', 'CX-output', 'CX-custom', 'CX-list-output', 'CX-tool-search', 'CX-found-tool', 'CX-queries', 'CX-page', 'CX-pattern', 'CX-drawn', 'CX-orphan', 'CX-unknown-item', 'CX-unknown-row', 'CX-aborted', 'CX-plan', 'CX-reply']);
  assert.equal(value.items.filter(item => item.kind === 'image').length, 2, 'the image a tool returned and the one a call generated');
  assert.equal(value.items.filter(item => item.kind === 'user').length, 1, 'an agent message or an image is never the person\'s turn');
  assert.ok(!all(value).includes('iVBORw0KGgo'), 'an image does not read as text');
});

test('Codex: rollouts of early versions and rollouts holding only events still read', () => {
  reaches(codex([{ id: 'demo', timestamp: at, instructions: '' }, { record_type: 'state' }, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'OLD-user' }] }, { type: 'function_call', name: 'shell', call_id: 'a', arguments: '{"command":["OLD-command"]}' }, { type: 'function_call_output', call_id: 'a', output: 'OLD-output' }]), ['OLD-user', 'OLD-command', 'OLD-output']);
  reaches(codex([event({ type: 'user_message', message: 'EV-user' }), event({ type: 'agent_reasoning', text: 'EV-thinking' }), event({ type: 'agent_message', message: 'EV-reply' })]), ['EV-user', 'EV-thinking', 'EV-reply']);
  // Beside message rows the same events are copies, and stay out.
  const both = codex([response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'once' }] }), event({ type: 'user_message', message: 'once' })]);
  assert.equal(both.items.length, 1);
});

test('Claude Code: messages typed while it worked, server tools, documents, screenshots and notices reach the window', () => {
  const row = (type, content, extra) => ({ type, timestamp: at, uuid: type + Math.random(), message: { role: type, content }, ...extra });
  const value = claude([
    { type: 'file-history-snapshot', snapshot: { detail: 'quiet' } }, { type: 'summary', summary: 'quiet' }, { type: 'queue-operation', operation: 'enqueue', content: 'quiet' },
    row('user', 'CC-user'),
    row('assistant', [{ type: 'thinking', thinking: 'CC-thinking' }, { type: 'text', text: 'CC-reply' }, { type: 'tool_use', id: 'a', name: 'Read', input: { file_path: 'CC-file' } }]),
    row('user', [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'CC-result' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }] }]),
    row('assistant', [{ type: 'server_tool_use', id: 'b', name: 'web_search', input: { query: 'CC-server-tool' } }]),
    row('user', [{ type: 'web_search_tool_result', tool_use_id: 'b', content: [{ type: 'web_search_result', title: 'CC-search-result' }] }]),
    row('assistant', [{ type: 'mcp_tool_use', id: 'c', name: 'mcp__demo__ask', input: { query: 'CC-mcp' } }]),
    row('user', [{ type: 'mcp_tool_result', tool_use_id: 'c', content: [{ type: 'text', text: 'CC-mcp-result' }] }]),
    row('user', [{ type: 'tool_result', tool_use_id: 'gone', content: 'CC-orphan' }]),
    row('user', [{ type: 'document', title: 'CC-document', source: { media_type: 'application/pdf' } }]),
    row('assistant', [{ type: 'a_new_block', detail: 'CC-unknown-block' }]),
    { type: 'attachment', timestamp: at, attachment: { type: 'queued_command', prompt: 'CC-queued' } },
    { type: 'attachment', timestamp: at, attachment: { type: 'file', filename: 'CC-attached' } },
    { type: 'attachment', timestamp: at, attachment: { type: 'skill_listing', content: 'noise' } },
    { type: 'system', subtype: 'local_command', timestamp: at, content: '<local-command-stdout>CC-local</local-command-stdout>' },
    { type: 'system', subtype: 'api_error', timestamp: at, error: { message: 'CC-api-error' } },
    { type: 'system', subtype: 'turn_duration', timestamp: at, durationMs: 5 },
    { type: 'a_new_row', timestamp: at, detail: 'CC-unknown-row' },
  ]);
  reaches(value, ['CC-user', 'CC-thinking', 'CC-reply', 'CC-file', 'CC-result', 'CC-server-tool', 'CC-search-result', 'CC-mcp', 'CC-mcp-result', 'CC-orphan', 'CC-document', 'CC-unknown-block', 'CC-queued', 'CC-attached', 'CC-local', 'CC-api-error', 'CC-unknown-row']);
  assert.ok(!all(value).includes('quiet') && !all(value).includes('noise'), 'bookkeeping rows stay out');
  assert.equal(value.items.filter(item => item.kind === 'image' && item.from === 'assistant').length, 1, 'a screenshot a tool returned does not open a turn');
});

test('OpenCode family: sub-tasks, added text, retries and a reply\'s error read', () => {
  const value = opencode([
    { role: 'user', time: at, parts: [{ type: 'text', text: 'OC-user' }, { type: 'text', text: 'OC-synthetic', synthetic: true }, { type: 'subtask', description: 'OC-subtask', prompt: 'OC-prompt', agent: 'demo' }] },
    { role: 'assistant', time: at, error: { data: { message: 'OC-error' } }, parts: [{ type: 'step-start' }, { type: 'retry', error: { message: 'OC-retry' } }, { type: 'a_new_part', detail: 'OC-unknown' }, { type: 'text', text: 'OC-reply' }] },
  ]);
  reaches(value, ['OC-user', 'OC-synthetic', 'OC-subtask', 'OC-prompt', 'OC-error', 'OC-retry', 'OC-unknown', 'OC-reply']);
});

test('Gemini, DeepSeek and Antigravity: warnings, images, unknown parts and calls without a result read', () => {
  const said = gemini([{ type: 'user', timestamp: at, content: [{ text: 'GM-user' }, { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }] }, { type: 'warning', timestamp: at, content: 'GM-warning' }, { type: 'a_new_type', timestamp: at, content: 'GM-new' }]);
  reaches(said, ['GM-user', 'GM-warning', 'GM-new']); assert.equal(said.items.filter(item => item.kind === 'image').length, 1);
  reaches(deepseek([{ type: 'assistant/message', time: at, data: { message: { id: 'm', content: [{ type: 'text', text: 'DS-reply' }, { type: 'a_new_part', detail: 'DS-unknown' }] } } }]), ['DS-reply', 'DS-unknown']);
  reaches(antigravity([{ step_index: 0, type: 'PLANNER_RESPONSE', source: 'MODEL', created_at: at, content: 'AG-reply', tool_calls: [{ name: 'AG-unpaired', args: { Query: 'AG-args' } }] }]), ['AG-reply', 'AG-unpaired']);
});

test('a very long conversation keeps every item: past the budget the previews shorten, the items do not go', () => {
  const big = 'y'.repeat(LIMITS.spoken - 8), count = Math.ceil(LIMITS.payload / big.length) + 40;
  const rows = []; for (let index = 0; index < count; index++) rows.push(response({ type: 'message', role: index % 2 ? 'assistant' : 'user', content: [{ type: 'output_text', text: index + big }] }));
  const light = preview(codex(rows));
  assert.equal(light.items.length, count); assert.equal(light.truncated, false);
  const last = light.items.at(-1);
  assert.equal(last.length, big.length + String(count - 1).length, 'its full length is known, so the window can fetch it');
  assert.ok(last.text.length <= LIMITS.tight);
});

test('the person\'s words and replies arrive whole up to the spoken limit; folded text stays a preview', () => {
  const long = 'z'.repeat(LIMITS.inline * 3), light = preview(codex([response({ type: 'message', role: 'user', content: [{ type: 'input_text', text: long }] }), response({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: long }] }), response({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: long }] })]));
  assert.equal(light.items[0].text.length, long.length); assert.equal(light.items[0].length, undefined);
  assert.equal(light.items[1].text.length, LIMITS.preview); assert.equal(light.items[1].length, long.length);
  assert.equal(light.items[2].text.length, long.length);
});

function home(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-coverage-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';

test('Claude Code: many sub-agents all arrive, and showing more, finding and following still work with them', async t => {
  const root = home(t), id = 'demo-session', project = path.join(root, 'demo');
  write(path.join(project, id + '.jsonl'), jsonl([{ type: 'user', sessionId: id, timestamp: at, message: { role: 'user', content: 'main question' } }, { type: 'assistant', sessionId: id, timestamp: '2026-10-01T09:00:00.000Z', message: { role: 'assistant', content: 'x'.repeat(LIMITS.spoken + 10) } }]));
  // More than the old limit of 64 files and far more than the 200 characters a stamp may be.
  for (let index = 0; index < 80; index++) write(path.join(project, id, 'subagents', 'agent-' + String(index).padStart(3, '0') + '.jsonl'), jsonl([{ type: 'assistant', isSidechain: true, timestamp: at, message: { role: 'assistant', content: 'side-' + index + '-end' } }]));
  // The layout of earlier versions: beside the session, naming it in each row; another session's stays out.
  write(path.join(project, 'agent-early.jsonl'), jsonl([{ type: 'assistant', isSidechain: true, sessionId: id, timestamp: at, message: { role: 'assistant', content: 'early-layout' } }]));
  write(path.join(project, 'agent-other.jsonl'), jsonl([{ type: 'assistant', isSidechain: true, sessionId: 'another', timestamp: at, message: { role: 'assistant', content: 'not-this-session' } }]));
  const value = await transcript('claude', id, [root]), text = all(value);
  for (let index = 0; index < 80; index += 13) assert.ok(text.includes('side-' + index + '-end'), 'sub-agent ' + index);
  assert.ok(text.includes('early-layout')); assert.ok(!text.includes('not-this-session'));
  assert.ok(value.stamp.length <= 200, 'a later request may carry it');
  const long = value.items.findIndex(item => item.length);
  const page = await part('claude', id, [root], { stamp: value.stamp, index: long, field: 'text', offset: 0 });
  assert.equal(page.total, LIMITS.spoken + 10);
  assert.equal((await find('claude', id, [root], { stamp: value.stamp, query: 'side-79-end' })).total, 1);
  assert.equal(await stampNow('claude', id, [root]), value.stamp);
});

test('OpenCode: a conversation still in the earlier JSON files reads, with its parts', async t => {
  const root = home(t), id = 'ses_demo';
  write(path.join(root, 'storage', 'message', id, 'msg_a.json'), JSON.stringify({ id: 'msg_a', sessionID: id, role: 'user', time: { created: 1759305600000 } }));
  write(path.join(root, 'storage', 'message', id, 'msg_b.json'), JSON.stringify({ id: 'msg_b', sessionID: id, role: 'assistant', time: { created: 1759305601000 } }));
  write(path.join(root, 'storage', 'part', 'msg_a', 'prt_a.json'), JSON.stringify({ type: 'text', text: 'LG-user' }));
  write(path.join(root, 'storage', 'part', 'msg_b', 'prt_b.json'), JSON.stringify({ type: 'reasoning', text: 'LG-thinking' }));
  write(path.join(root, 'storage', 'part', 'msg_b', 'prt_c.json'), JSON.stringify({ type: 'text', text: 'LG-reply' }));
  const value = await transcript('opencode', id, [root]);
  assert.deepEqual(value.items.map(item => item.kind), ['user', 'thinking', 'assistant']);
  reaches(value, ['LG-user', 'LG-thinking', 'LG-reply']);
  assert.equal(await stampNow('opencode', id, [root]), value.stamp);
});

test('OpenCode: the older per-project layout reads too', async t => {
  const root = home(t), id = 'ses_old', base = path.join(root, 'project', 'hash', 'storage', 'session');
  write(path.join(base, 'message', id, 'msg_a.json'), JSON.stringify({ id: 'msg_a', role: 'user', time: { created: 1759305600000 } }));
  write(path.join(base, 'part', id, 'msg_a', 'prt_a.json'), JSON.stringify({ type: 'text', text: 'LG-older' }));
  reaches(await transcript('opencode', id, [root]), ['LG-older']);
});
