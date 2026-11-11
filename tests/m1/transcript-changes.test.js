'use strict';
// The reading page's second group on synthetic records for each Agent: what a call changed, tokens per turn, sub-agents.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { change, diffLines, fromPatch } = require('../../src/m1/transcript-changes');
const { codex, claude, opencode, gemini, deepseek, antigravity, preview, transcript, part, find, markdown, stampNow } = require('../../src/m1/transcript');

const PATCH = ['*** Begin Patch', '*** Update File: src/a.js', '@@ function a()', ' keep', '-old', '+new', '+more', '*** Add File: src/b.js', '+first', '*** Delete File: src/c.js', '*** Update File: src/d.js', '*** Move to: src/e.js', '-x', '+y', '*** End Patch'].join('\n');
const tool = value => value.items.find(item => item.kind === 'tool');

test('line diffs keep common ends as context and count what changed', () => {
  assert.deepEqual(diffLines('a\nb\nc\n', 'a\nB\nc\n'), [' a', '-b', '+B', ' c']);
  assert.deepEqual(diffLines('same', 'same'), [' same']);
  assert.deepEqual(diffLines('', 'x\ny'), ['+x', '+y']);
  const edit = change('Edit', { file_path: 'C:/w/a.js', old_string: 'one\ntwo', new_string: 'one\n2\nthree' });
  assert.deepEqual(edit.files, [{ path: 'C:/w/a.js', kind: 'edit', added: 2, removed: 1 }]);
  assert.match(edit.diff, /^\*\*\* C:\/w\/a\.js\n one\n-two\n\+2\n\+three$/);
  // Past the comparison budget it still reads, as removed then added.
  const big = change('edit', { file_path: 'a', old_string: Array.from({ length: 500 }, (_, i) => 'o' + i).join('\n'), new_string: Array.from({ length: 500 }, (_, i) => 'n' + i).join('\n') });
  assert.equal(big.files[0].added, 500); assert.equal(big.files[0].removed, 500);
});

test('the Codex patch format: add, delete, update and move', () => {
  const value = fromPatch(PATCH);
  assert.deepEqual(value.files.map(file => [file.path, file.kind, file.added, file.removed, file.to]), [['src/a.js', 'edit', 2, 1, undefined], ['src/b.js', 'add', 1, 0, undefined], ['src/c.js', 'delete', 0, 0, undefined], ['src/d.js', 'edit', 1, 1, 'src/e.js']]);
  assert.match(value.diff, /\*\*\* src\/a\.js\n@@ function a\(\)\n keep\n-old\n\+new/);
  assert.equal(fromPatch('no patch here'), null);
});

test('each verified edit tool is read; other tools and unknown shapes change nothing', () => {
  const cases = [
    ['Edit', { file_path: 'f', old_string: 'a', new_string: 'b' }], ['replace', { file_path: 'f', old_string: 'a', new_string: 'b', instruction: 'x' }],
    ['edit', { filePath: 'f', oldString: 'a', newString: 'b' }], ['edit', { path: 'f', oldString: 'a', newString: 'b', replaceAll: true }],
    ['str_replace_editor', { command: 'str_replace', path: 'f', old_str: 'a', new_str: 'b' }],
    ['MultiEdit', { file_path: 'f', edits: [{ old_string: 'a', new_string: 'b' }] }],
  ];
  for (const [name, input] of cases) assert.deepEqual(change(name, input).files, [{ path: 'f', kind: 'edit', added: 1, removed: 1 }], name);
  // A file written whole does not claim removals: what it replaced is not in the record.
  for (const [name, input] of [['Write', { file_path: 'f', content: 'a\nb\n' }], ['write_file', { file_path: 'f', content: 'a\nb' }], ['write', { filePath: 'f', content: 'a\nb' }]]) assert.deepEqual(change(name, input).files, [{ path: 'f', kind: 'write', added: 2, removed: 0 }], name);
  for (const input of [PATCH, { input: PATCH }, { patchText: PATCH }, { command: ['apply_patch', PATCH] }, { command: 'apply_patch <<EOF\n' + PATCH + '\nEOF' }]) assert.equal(change('apply_patch', input).files.length, 4);
  assert.equal(change('shell', { command: ['sed', '-i', 's/a/b/', 'f'] }), null, 'a shell edit is not seen');
  assert.equal(change('Read', { file_path: 'f' }), null);
  assert.equal(change('Edit', { file_path: 'f', old_string: 1 }), null);
  assert.equal(change('Edit', null), null);
});

test('a change is light in the preview, in full by part, findable and exported', async t => {
  const value = codex([{ type: 'response_item', timestamp: '2026-11-02T01:00:00Z', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c', input: PATCH } }, { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c', output: 'done' } }]);
  assert.equal(tool(value).tool.summary, 'src/a.js、src/b.js、src/c.js、src/d.js', 'reads as its files, not as patch text');
  const light = preview(value).items[0].tool;
  assert.equal(light.change.files.length, 4); assert.equal(light.change.diff, undefined); assert(light.change.length > 0);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changes-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = '019a7c2e-0000-4000-8000-0000000000c1', file = path.join(dir, 'rollout-2026-11-02T01-00-00-' + id + '.jsonl');
  fs.writeFileSync(file, [{ type: 'response_item', timestamp: '2026-11-02T01:00:00Z', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c', input: PATCH } }].map(row => JSON.stringify(row)).join('\n') + '\n');
  const shown = await transcript('codex', id, [dir]);
  const page = await part('codex', id, [dir], { stamp: shown.stamp, index: 0, field: 'diff' });
  assert.match(page.text, /-old\n\+new/); assert.equal(page.next, null);
  assert.equal((await find('codex', id, [dir], { stamp: shown.stamp, query: 'more' })).total, 1, 'a change is searched');
  assert.match(await markdown('codex', id, [dir], { stamp: shown.stamp, from: 0, to: 0 }), /\+new/);
  await assert.rejects(part('codex', id, [dir], { stamp: shown.stamp, index: 0, field: 'nope' }), /TRANSCRIPT_PART_INVALID/);
  // The stamp moves when the record does, and reading it needs no content.
  assert.equal(await stampNow('codex', id, [dir]), shown.stamp);
  fs.appendFileSync(file, '{"type":"response_item"}\n');
  assert.notEqual(await stampNow('codex', id, [dir]), shown.stamp);
  await assert.rejects(stampNow('no-such-agent', id, [dir]), /TRANSCRIPT_UNSUPPORTED/);
});

test('tokens per turn use each Agent\'s own report, counted once; no report stays absent', () => {
  const user = (text, at = '2026-11-02T01:00:00Z') => ({ type: 'response_item', timestamp: at, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } });
  const count = (total, last) => ({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total }, last_token_usage: { input_tokens: last, output_tokens: 10, total_tokens: last + 10 } } } });
  // Codex: inclusive semantics, a repeated report once.
  const c = codex([user('q'), count(110, 100), count(110, 100), count(215, 95)]);
  assert.equal(c.items[0].usage, 110 + 105);
  // Claude Code: exclusive, one message's streamed rows once with the largest figures.
  const assistant = (id, output, content) => ({ type: 'assistant', timestamp: '2026-11-02T01:00:01Z', message: { id, role: 'assistant', content, usage: { input_tokens: 10, output_tokens: output, cache_read_input_tokens: 5, cache_creation_input_tokens: 5 } } });
  const k = claude([{ type: 'user', timestamp: '2026-11-02T01:00:00Z', message: { role: 'user', content: 'q' } }, assistant('m1', 5, [{ type: 'text', text: 'a' }]), assistant('m1', 7, [{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: 'f' } }]), assistant('m2', 1, [{ type: 'text', text: 'b' }])]);
  assert.equal(k.items.reduce((sum, item) => sum + (item.usage ?? 0), 0), (10 + 7 + 5 + 5) + (10 + 1 + 5 + 5));
  // OpenCode: the assistant message's tokens.
  const o = opencode([{ role: 'user', parts: [{ type: 'text', text: 'q' }] }, { role: 'assistant', parts: [{ type: 'text', text: 'a' }], tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 2, write: 1 } } }]);
  assert.equal(o.items[1].usage, 18);
  // Gemini CLI: promptTokenCount includes cached.
  const g = gemini([{ type: 'gemini', timestamp: '2026-11-02T01:00:00Z', content: 'a', tokens: { input: 10, output: 5, cached: 4, thoughts: 1, total: 16 } }]);
  assert.equal(g.items[0].usage, 15);
  // DeepSeek Harness: a call's counter, and inherited history does not count.
  const message = (id, usage) => ({ type: 'assistant/message', time: 1e12, data: { usage, message: { id, content: [{ type: 'text', text: id }] } } });
  const d = deepseek([message('old', { inputTokens: 100, outputTokens: 100 }), { type: 'session/end-seed', data: { inherited: true } }, { type: 'user/message', time: 1e12, data: { id: 'u', content: [{ type: 'text', text: 'q' }] } }, message('new', { inputTokens: 10, outputTokens: 5 })]);
  assert.equal(d.items[0].usage, undefined); assert.equal(d.items.at(-1).usage, 15);
  // No report: nothing, never 0; Antigravity's steps carry none.
  assert.equal(codex([user('q')]).items[0].usage, undefined);
  assert.equal(gemini([{ type: 'gemini', content: 'a' }]).items[0].usage, undefined);
  assert.equal(antigravity([{ step_index: 0, type: 'PLANNER_RESPONSE', content: 'a' }]).items[0].usage, undefined, 'a transcript without tokens stays unknown');
  // Antigravity: the planner's own counters, as disjoint buckets.
  assert.equal(antigravity([{ step_index: 0, type: 'PLANNER_RESPONSE', content: 'a', input_tokens: 10, output_tokens: 5, cache_read_tokens: 3 }]).items[0].usage, 18);
  assert.equal(preview(c).items[0].usage, 215);
  assert.equal('usage' in preview(codex([user('q')])).items[0], false);
});

test('Antigravity: an edit carries its diff, a new file its text; calls name their results and failures show', () => {
  const steps = [
    { step_index: 0, source: 'USER_EXPLICIT', type: 'USER_INPUT', content: '<USER_REQUEST>改</USER_REQUEST>' },
    { step_index: 1, source: 'MODEL', type: 'PLANNER_RESPONSE', content: '好', thinking: '想一下', tool_calls: [{ name: 'replace_file_content', args: { TargetFile: 'C:/w/a.go' } }, { name: 'write_to_file', args: { TargetFile: 'C:/w/new.txt', CodeContent: 'one\ntwo\n' } }, { name: 'run_command', args: { CommandLine: 'go test' } }, { name: 'run_command', args: { CommandLine: 'go vet' } }] },
    { step_index: 2, source: 'MODEL', type: 'CODE_ACTION', status: 'DONE', content: 'Created At: x\nCompleted At: y\nThe following changes were made by the replace_file_content tool to: C:/w/a.go. If relevant, run it.\n[diff_block_start]\n@@ -1,3 +1,3 @@\n keep\n-old\n+new\n[diff_block_end]' },
    { step_index: 3, source: 'MODEL', type: 'CODE_ACTION', status: 'DONE', content: 'Created file file:///C:/w/new.txt with requested content.\nIf relevant, run it.' },
    { step_index: 4, source: 'MODEL', type: 'RUN_COMMAND', status: 'DONE', content: 'Created At: x\nThe command failed with exit code: 1\nOutput: boom' },
    { step_index: 5, source: 'MODEL', type: 'RUN_COMMAND', status: 'DONE', content: 'Created At: x\nThe command completed successfully.' },
    { step_index: 6, source: 'SYSTEM', type: 'CHECKPOINT', content: 'kept as a step named by its kind' },
  ];
  const value = antigravity(steps), tools = value.items.filter(item => item.kind === 'tool');
  assert(value.items.some(item => item.kind === 'thinking' && item.text === '想一下'));
  assert.deepEqual(tools.map(item => item.tool.name), ['replace_file_content', 'write_to_file', 'run_command', 'run_command', 'checkpoint']);
  assert.deepEqual(tools[0].tool.change.files, [{ path: 'C:/w/a.go', kind: 'edit', added: 1, removed: 1 }]);
  assert.match(tools[0].tool.change.diff, /^\*\*\* C:\/w\/a\.go\n@@ -1,3 \+1,3 @@\n keep\n-old\n\+new$/);
  assert.deepEqual(tools[1].tool.change.files, [{ path: 'C:/w/new.txt', kind: 'write', added: 2, removed: 0 }]);
  assert.equal(tools[2].tool.summary, 'go test'); assert.equal(tools[2].tool.error, true, 'the failure is in the text, the status says DONE');
  assert.equal(tools[3].tool.error, false);
  assert.equal(value.failed, 1);
  // A new file whose call is missing changes nothing rather than claiming an empty file.
  assert.equal(antigravity([{ step_index: 0, source: 'MODEL', type: 'CODE_ACTION', content: 'Created file file:///C:/w/x.txt with requested content.' }]).items[0].tool.change, undefined);
  assert.equal(antigravity([{ step_index: 0, source: 'MODEL', type: 'CODE_ACTION', status: 'ERROR', content: 'Encountered error in step execution' }]).items[0].tool.error, true);
});

test('a Claude Code sub-agent reads as steps of its turn: same file or its own file', async t => {
  const row = (type, content, extra = {}, at = '2026-11-02T01:00:00Z') => ({ type, timestamp: at, sessionId: 'S', message: { role: type, content }, ...extra });
  const same = claude([row('user', 'question'), row('user', 'task for the helper', { isSidechain: true, agentId: 'h1' }), row('assistant', [{ type: 'text', text: 'helper says' }], { isSidechain: true, agentId: 'h1' }), row('assistant', [{ type: 'text', text: 'answer' }])]);
  assert.equal(same.turns, 1, 'the helper\'s prompt is not a turn of the person');
  assert.deepEqual(same.items.map(item => [item.kind, item.side ?? null]), [['user', null], ['user', 'h1'], ['assistant', 'h1'], ['assistant', null]]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const id = '019a7c2e-0000-4000-8000-0000000000d1', project = path.join(dir, 'project'), sub = path.join(project, id, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  const jsonl = rows => rows.map(item => JSON.stringify(item)).join('\n') + '\n';
  const main = path.join(project, id + '.jsonl');
  fs.writeFileSync(main, jsonl([row('user', 'question', { sessionId: id }, '2026-11-02T01:00:00Z'), row('assistant', [{ type: 'text', text: 'answer' }], { sessionId: id }, '2026-11-02T01:05:00Z')]));
  fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), jsonl([row('user', 'task', { sessionId: id, isSidechain: true }, '2026-11-02T01:01:00Z'), row('assistant', [{ type: 'tool_use', id: 'x', name: 'Write', input: { file_path: 'made.txt', content: 'z' } }], { sessionId: id, isSidechain: true }, '2026-11-02T01:02:00Z')]));
  const shown = await transcript('claude', id, [dir]);
  assert.deepEqual(shown.items.map(item => item.side ?? null), [null, 'a1', 'a1', null], 'in time order, between the question and the answer');
  assert.equal(shown.turns, 1); assert.equal(shown.tools, 1);
  assert.equal(shown.items[2].tool.change.files[0].path, 'made.txt');
  // The sub-agent's file is part of the stamp, and is never taken for the session.
  const before = await stampNow('claude', id, [dir]);
  fs.appendFileSync(path.join(sub, 'agent-a1.jsonl'), '{"type":"x"}\n');
  assert.notEqual(await stampNow('claude', id, [dir]), before);
  await assert.rejects(transcript('claude', 'a1', [dir]), /TRANSCRIPT_NOT_FOUND/);
});
