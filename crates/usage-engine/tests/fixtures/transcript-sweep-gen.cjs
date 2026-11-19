'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { search, fileHistory, toolUse } = require('../../../../src/m1/transcript');
const root = process.argv[2];
const codex = path.join(root, 'codex'), claude = path.join(root, 'claude');
fs.mkdirSync(codex);
fs.mkdirSync(claude);
const record = (type, fields) => ({ type: 'response_item', payload: { type, ...fields }, timestamp: '2026-11-01T12:00:00Z' });
const message = (role, text) => record('message', { role, content: [{ text }] });
const call = (name, args, id) => record('function_call', { name, arguments: args, call_id: id });
const patch = file => '*** Begin Patch\n*** Update File: ' + file + '\n@@\n-before\n+new\n+newer\n*** End Patch';
const directory = 'E:/Synthetic/fixture';
const source = (number, changes, cwd = directory, before = [], after = []) => {
  const id = '11111111-2222-4333-8444-' + String(number).padStart(12, '0');
  const rows = [...before, ...changes.map((file, index) => call('apply_patch', patch(file), 'edit-' + index)), ...after];
  fs.writeFileSync(path.join(codex, 'rollout-fixture-' + id + '.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'));
  return { key: String(number).padStart(64, '0'), agent: 'codex', id, cwd };
};
const entries = [
  source(1, ['src/change.js', 'src/change.js'], directory,
    [message('user', '开头 ' + 'x '.repeat(40) + 'SyNtHeTiC Needle ' + 'y '.repeat(60)), message('assistant', 'needle')], [
      call('mcp__example__list', {}, 'tool'), call('Skill', { skill: 'fixture' }, 'skill'),
      record('function_call_output', { call_id: 'tool', output: 'A synthetic needle here\non a new line' })
    ]),
  source(2, ['E:\\Synthetic\\fixture\\SRC\\change.js'], 'E:/Synthetic/another', [message('user', '🙂 text\n\tcase')]),
  source(3, ['src/change.js', 'README.md'], 'E:/Synthetic/worktree', [message('assistant', 'no match')]),
  source(4, ['src/change.js'], directory, [], [
    record('function_call_output', { call_id: 'edit-0', output: 'Process exited with code 1\nfailed' })
  ]),
  source(5, ['src/unrelated.js'], directory, [message('user', 'leading')]),
  { key: 'c'.repeat(64), agent: 'claude', id: 'claude-own', cwd: directory },
  { key: 'd'.repeat(64), agent: 'claude', id: 'nonexistent', cwd: null },
  { key: 'e'.repeat(64), agent: 'unknown', id: 'ignored' },
  { key: 'f'.repeat(64), agent: 'copilot', id: 'copilot-own', cwd: directory },
  { key: '0'.repeat(64), agent: 'workbuddy', id: 'buddy-own', cwd: directory },
  { key: 'a'.repeat(64), agent: 'cursor', id: 'cursor-own', cwd: directory }
];
const claudeFile = path.join(claude, 'claude-own.jsonl');
fs.writeFileSync(claudeFile, JSON.stringify({ type: 'user', message: { content: 'Synthetic needle from a person' }}));
const childDir = path.join(claude, 'claude-own', 'subagents');
fs.mkdirSync(childDir, { recursive: true });
fs.writeFileSync(path.join(childDir, 'agent-reader.jsonl'), JSON.stringify({
  type: 'assistant', message: { content: [{ type: 'text', text: 'Synthetic needle from a subagent' },
    { type: 'tool_use', id: 'write', name: 'Write', input: { filePath: 'src/change.js', content: 'new' } }] }
}));
const copilot = path.join(root, 'copilot', 'session-state'), workbuddy = path.join(root, 'buddy');
const cursor = path.join(root, 'cursor');
fs.mkdirSync(path.join(copilot, 'copilot-own'), { recursive: true });
fs.mkdirSync(workbuddy, { recursive: true });
fs.mkdirSync(path.join(cursor, 'project', 'agent-transcripts'), { recursive: true });
fs.writeFileSync(path.join(copilot, 'copilot-own', 'events.jsonl'), JSON.stringify({
  type: 'user.message', data: { content: 'Synthetic needle from Copilot' }
}));
fs.writeFileSync(path.join(workbuddy, 'buddy-own.jsonl'), JSON.stringify({
  type: 'message', role: 'user', content: 'Synthetic needle from WorkBuddy'
}));
fs.writeFileSync(path.join(cursor, 'project', 'agent-transcripts', 'cursor-own.jsonl'), JSON.stringify({
  role: 'assistant', message: { content: [{ type: 'text', text: 'Synthetic needle from Cursor' },
    { type: 'tool_use', name: 'Write', input: { filePath: 'src/change.js', content: 'added' } }] }
}));
const roots = { codex: [codex], claude: [claude], workbuddy: [workbuddy], copilot: [copilot], cursor: [cursor] };
const rootsOf = agent => roots[agent] || [];
async function generate() {
  const tests = [];
  for (const query of ['synthetic needle', 'needle', '🙂 text', 'absent', 'from a subagent']) {
    tests.push({ action: 'search', query, expected: await search(entries, rootsOf, query) });
    tests.push({ action: 'search', query, budget: 0, expected: await search(entries, rootsOf, query, { budgetMs: -1 }) });
  }
  for (const target of [{ path: 'E:/Synthetic/fixture/src/change.js', cwd: directory },
    { path: 'src/change.js', cwd: null }, { path: 'README.md', cwd: directory }, { path: 'src/missing.js', cwd: null }]) {
    tests.push({ action: 'history', target, expected: await fileHistory(entries, rootsOf, target) });
    tests.push({ action: 'history', target, budget: 0, expected: await fileHistory(entries, rootsOf, target, { budgetMs: -1 }) });
  }
  tests.push({ action: 'toolUse', expected: await toolUse(entries, rootsOf, null) });
  const { Store } = require('../../../../src/m1/store');
  const store = new Store(path.join(root, 'usage-js'), roots);
  const sessions = Object.fromEntries(entries.map((entry, index) => [
    entry.key, { ...entry, at: '2026-11-' + String(28 - index).padStart(2, '0') + 'T00:00:00Z' }
  ]));
  store.state.sessions = sessions;
  const storeTests = [];
  try {
    for (const request of [{ query: 'synthetic needle', offset: 1 }, { query: 'needle', agent: 'claude' },
      { query: 'needle', offset: 999 }, { query: 'needle', range: 'today' }]) {
      storeTests.push({ action: 'search', request, expected: await store.searchTranscripts(request) });
    }
    for (const request of [{ key: entries[0].key, path: 'src/change.js' },
      { key: entries[0].key, path: 'E:/Synthetic/fixture/src/change.js', offset: 1 }]) {
      storeTests.push({ action: 'history', request, expected: await store.transcriptFileHistory(request) });
    }
    storeTests.push({ action: 'toolUse', expected: await store.agentUse({}) });
  } finally { await require('../../../../src/m1/transcript-tasks').close(); }
  process.stdout.write(JSON.stringify({ entries, roots, tests, sessions, storeTests }));
}
generate().catch(error => { console.error(error); process.exitCode = 1; });
