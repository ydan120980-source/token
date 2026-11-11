'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { classify, citations, codeMode } = require('../../src/m1/transcript-marks');
const { codex, claude, opencode, facts } = require('../../src/m1/transcript');

const row = (type, payload, timestamp = '2026-11-02T01:00:00Z') => ({ type, payload, timestamp });
const user = text => row('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const reply = text => row('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

test('what the Codex app injects folds; a person\'s words stay', () => {
  const page = '<external_codex_apps_open_page>{"page_id":null}\n</external_codex_apps_open_page>';
  assert.deepEqual(classify(page), { kind: 'context', text: page, label: '打开了一个应用页面' });
  assert.equal(classify('<turn_aborted>The user interrupted.</turn_aborted>').label, '这一轮被中断');
  assert.equal(classify('# AGENTS.md instructions for E:/x\n\nrules').kind, 'context');
  assert.equal(classify('<environment_context>\n<cwd>x</cwd>\n</environment_context>').kind, 'context');
  assert.equal(classify('<new_app_notice>x</new_app_notice>').kind, 'context', 'a new tag written the same way needs no release');
  assert.equal(classify('<b>bold</b>').kind, 'user', 'an ordinary tag is someone\'s words');
  assert.equal(classify('看看 <foo_bar>x</foo_bar> 这个标签').kind, 'user', 'a tag inside a sentence is someone\'s words');
  assert.equal(classify('## 交接\n\n内容').kind, 'user');
  assert.deepEqual(classify('<user_shell_command>\n<command>\nnpm test\n</command>\n<result>ok</result>\n</user_shell_command>'), { kind: 'command', text: 'npm test' });
});
test('the person\'s request is separated from the files the app prepends', () => {
  const value = classify('# Files mentioned by the user:\n\n## a.png: C:\\pics\\a.png\n\n## b.txt: C:\\b.txt\n\n## My request for Codex:\n修这个问题\n');
  assert.equal(value.kind, 'user'); assert.equal(value.text, '修这个问题');
  assert.deepEqual(value.attached, [{ name: 'a.png', path: 'C:\\pics\\a.png' }, { name: 'b.txt', path: 'C:\\b.txt' }]);
  const only = classify('# Files mentioned by the user:\n\n## a.png: C:\\pics\\a.png\n');
  assert.equal(only.label, '附带了 1 个文件');
  assert.equal(classify('# Context from my IDE setup:\n\n## Open tabs:\n- x\n\n## My request for Codex:\n普通的话').text, '普通的话');
});
test('an answered question reads as the question and the answer', () => {
  const body = JSON.stringify([{ questionItemId: '["request_user_input_async","c",0]', question: '先做哪个？', answer: '先做 A\n再说' }]);
  const value = classify('<send_user_message_question_reply>\n' + body + '\n</send_user_message_question_reply>');
  assert.equal(value.kind, 'user'); assert.equal(value.answered, true);
  assert.equal(value.text, '> 先做哪个？\n\n先做 A\n再说'); assert.equal(value.label, '回答：先做 A');
  assert.equal(classify('<send_user_message_question_reply>not json</send_user_message_question_reply>').kind, 'context', 'unreadable stays folded');
});
test('a memory citation leaves the reply and stays with it', () => {
  const { text, cited } = citations('结论。\n\n<oai-mem-citation>\n<citation_entries>\nMEMORY.md:462-462|note=[prior context]\nsummaries/a.md:17-18|note=[owner cutoff]\n</citation_entries>\n<rollout_ids>\n01a\n</rollout_ids>\n</oai-mem-citation>\n');
  assert.equal(text, '结论。');
  assert.deepEqual(cited, [{ path: 'MEMORY.md', lines: '462-462', note: 'prior context' }, { path: 'summaries/a.md', lines: '17-18', note: 'owner cutoff' }]);
  assert.deepEqual(citations('no tag'), { text: 'no tag', cited: null });
  const out = codex([reply('第一段\n<oai-mem-citation><citation_entries>\nM.md:1|note=[n]\n</citation_entries></oai-mem-citation>')]);
  assert.equal(out.items[0].text, '第一段'); assert.equal(out.items[0].cited[0].path, 'M.md');
});
test('code mode reads as the commands it ran', () => {
  const one = codeMode('// @exec: {"yield_time_ms": 10000}\ntext(await tools.exec_command({cmd:"Get-ChildItem \\"a b\\"", workdir:"E:/x"}));');
  assert.deepEqual(one.commands, ['Get-ChildItem "a b"']); assert.equal(one.name, 'exec_command'); assert.equal(one.summary, 'Get-ChildItem "a b"');
  const many = codeMode('const r = await Promise.allSettled([tools.exec_command({cmd:`rg -n x`}), tools.exec_command({ workdir: "w", cmd: \'git status\' })]);');
  assert.deepEqual(many.commands, ['rg -n x', 'git status']); assert.equal(many.summary, 'rg -n x 等 2 条');
  const other = codeMode('text(await tools.mcp__codex_app__create_worktree({name:"x"}));');
  assert.deepEqual(other.commands, []); assert.equal(other.name, 'mcp__codex_app__create_worktree'); assert.equal(other.summary, 'mcp__codex_app__create_worktree');
  assert.equal(codeMode('store("wd", "E:/x");'), null);
  const patchSource = 'await tools.apply_patch({input:"*** Begin Patch\\n*** Update File: a.js\\n@@\\n-a\\n+b\\n*** End Patch"});';
  assert.match(codeMode(patchSource).patch, /Update File: a\.js/);
  const out = codex([
    row('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'c1', input: 'text(await tools.exec_command({cmd:"npm test"}));' }),
    row('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'c2', input: 'store("wd","E:/x");' }),
    row('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'c3', input: patchSource }),
  ]);
  assert.equal(out.items[0].tool.name, 'exec_command'); assert.deepEqual(out.items[0].tool.commands, ['npm test']);
  assert.deepEqual(out.items[1].tool.commands, [], 'a script without tools is no command');
  assert.equal(out.items[2].tool.change.files[0].path, 'a.js');
});
test('exec_command reports failure in its result text', () => {
  const out = codex([
    row('response_item', { type: 'function_call', name: 'exec_command', call_id: 'a', arguments: '{"cmd":"x"}' }),
    row('response_item', { type: 'function_call_output', call_id: 'a', output: 'Chunk ID: 1\nProcess exited with code 2\nOutput:\nno' }),
    row('response_item', { type: 'function_call', name: 'exec_command', call_id: 'b', arguments: '{"cmd":"y"}' }),
    row('response_item', { type: 'function_call_output', call_id: 'b', output: 'Process exited with code 0\nOutput:\nyes' }),
  ]);
  assert.equal(out.items[0].tool.error, true); assert.equal(out.items[1].tool.error, false); assert.equal(out.failed, 1);
});
test('compaction is marked where it happened', () => {
  const a = codex([user('问'), reply('答'), row('compacted', { message: '摘要', replacement_history: [] }), user('又问')]);
  assert.deepEqual(a.items.map(item => item.kind), ['user', 'assistant', 'compact', 'context', 'user']);
  assert.equal(a.items[3].label, '压缩摘要');
  assert.equal(codex([row('event_msg', { type: 'context_compacted' }), row('compacted', { message: 's' })]).items.filter(item => item.kind === 'compact').length, 1, 'one compaction, however it is written');
  const b = claude([
    { type: 'user', message: { role: 'user', content: '问' }, timestamp: '2026-11-02T01:00:00Z' },
    { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 120000 }, timestamp: '2026-11-02T01:01:00Z' },
    { type: 'user', isCompactSummary: true, message: { role: 'user', content: 'This session is being continued' }, timestamp: '2026-11-02T01:01:00Z' },
  ]);
  assert.deepEqual(b.items[1].compact, { trigger: 'auto', before: 120000 });
  assert.equal(b.items[2].kind, 'context'); assert.equal(b.items[2].label, '压缩摘要');
  assert.equal(b.turns, 1, 'a summary is not a question');
  const c = opencode([{ role: 'assistant', time: 1, parts: [{ type: 'compaction', auto: true }], tokens: null }]);
  assert.equal(c.items[0].kind, 'compact'); assert.equal(c.items[0].compact.trigger, 'auto');
});
test('a comparison gets figures, no conversation text', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-'));
  try {
    const id = '11111111-2222-4333-8444-555555555555', file = path.join(root, 'rollout-2026-11-02T00-00-00-' + id + '.jsonl');
    const rows = [
      row('session_meta', { id }), user('机密问题'), reply('机密回答'),
      row('response_item', { type: 'custom_tool_call', name: 'exec', call_id: 'c', input: 'await Promise.all([tools.exec_command({cmd:"a"}),tools.exec_command({cmd:"b"})]);' }),
      row('response_item', { type: 'function_call', name: 'apply_patch', call_id: 'p', arguments: JSON.stringify({ input: '*** Begin Patch\n*** Update File: a.js\n@@\n-a\n+b\n*** End Patch' }) }),
      row('compacted', { message: 's' }), user('第二问'), user('紧接着'),
    ];
    fs.writeFileSync(file, rows.map(item => JSON.stringify(item)).join('\n'));
    const value = await facts('codex', id, [root]);
    assert.equal(value.turns, 2); assert.equal(value.commands, 2); assert.equal(value.compactions, 1); assert.equal(value.tools, 2);
    assert.deepEqual(value.files.map(item => item.path), ['a.js']);
    assert.equal(JSON.stringify(value).includes('机密'), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
