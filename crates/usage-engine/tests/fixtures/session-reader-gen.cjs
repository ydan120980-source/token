'use strict';

const { selectSessions } = require('../../../../src/m1/session-list');
const { pack, unpack } = require('../../../../src/m1/session-list-codec');
const { agents } = require('../../../../src/m1/agent-catalog');
const section = process.argv[2];
const cases = [];
const add = (args, get) => {
  try { cases.push({ args, expected: JSON.stringify(get()) }); }
  catch (error) { cases.push({ args, error: error.message }); }
};
const catalog = { ...agents, 'custom-owned': {} };
const make = () => ({
  schemaVersion: 'SessionListV1', sequence: 8, timezone: 'Asia/Shanghai', today: '2026-11-03',
  sessions: ['codex', 'custom-owned'].map((agent, index) => ({
    key: String(index).repeat(64), agent, entries: ['desktop', 'wat', 'cli', 'cli', 'wat', null],
    models: ['gpt-4.1', '', 'line\nbreak'], start: '2026-11-03T00:00:00Z', end: '2026-11-03T00:01Z',
    id: 'own-' + index, cwd: 'C:/Synthetic', title: '会话', project: 'Synthetic', resumable: true,
    resume: 'DO_NOT_TRANSPORT', days: [
      { date: '2026-11-03', totalTokens: 10, records: 1, partialRecords: 1, estimatedCostUpperUsd: 0,
        output: 0, knownUsage: index ? {} : { cacheWrite: 0, output: 1.25, inputUncached: 0, reasoning: null, private: 100 } },
      { date: '2026-11-04', records: 0, totalTokens: null, estimatedCostUpperUsd: 1e-9 }
    ]
  })),
  unattributed: { codex: { '2026-11-03': 2, '2026-11-04': 0, nonsense: 8, '2026-11-05': 1.5 },
    'custom-owned': { '2026-11-03': 1 }, 'unapproved': { '2026-11-03': 123 } }
});
const listMutations = [
  frame => frame, frame => ({ ...frame, sequence: null, timezone: '', today: false, sessions: [] }),
  frame => ({ ...frame, schemaVersion: 'Other' }), frame => ({ ...frame, sequence: -1 }),
  frame => { frame.sessions[0].key = 'A'.repeat(64); return frame; },
  frame => { frame.sessions[0].agent = 'unapproved'; return frame; },
  frame => { frame.sessions[0].start = 'bad'; return frame; },
  frame => { frame.sessions[0].resumable = 1; frame.sessions[1].title = '😀'.repeat(101); return frame; },
  frame => { frame.sessions[0].days[0].date = 'not-a-date'; return frame; },
  frame => { frame.sessions[0].days[0].estimatedCostUpperUsd = '1'; return frame; },
  frame => { frame.sessions[0].days[0].totalTokens = -1; return frame; }
];
const utf8 = new TextDecoder();
if (section === 'list' || section === 'pack') {
  for (const mutate of listMutations) {
    const source = mutate(make());
    add([source, catalog], () => section === 'list'
      ? selectSessions(source, catalog) : utf8.decode(pack(source, catalog).sessionBytes));
  }
}
if (section === 'unpack') {
  const original = JSON.parse(utf8.decode(pack(make(), catalog).sessionBytes));
  for (const mutate of [
    () => {}, frame => { frame.rows[0][0] = 9999; }, frame => { frame.rows[0][2] = false; },
    frame => { frame.rows[0][3] = 9999; }, frame => { frame.rows[0][11] = 1; }, frame => { frame.rows[0][12] = 4001; },
    frame => { frame.days.at(-1)[1] = -1; }, frame => { frame.days[0][13] = null; },
    frame => { frame.days.push(frame.days[0]); }, frame => { frame.rows[0].pop(); },
    frame => { frame.agents.push('\0'); }, frame => { frame.usage[0] = { output: 1.5, unknown: 1, cacheRead: -1 }; }
  ]) {
    const frame = structuredClone(original); mutate(frame);
    const bytes = JSON.stringify(frame);
    add([bytes], () => unpack({ schemaVersion: 'SessionListBytesV1', sessionBytes: new TextEncoder().encode(bytes).buffer }));
  }
}
if (section === 'labels') {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { SessionLabels, FILE } = require('../../../../src/m1/session-labels');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-label-gold-'));
  const key = 'a'.repeat(64), other = 'b'.repeat(64);
  try {
    fs.writeFileSync(path.join(dir, FILE), JSON.stringify({ schemaVersion: 'SessionLabelsV1', labels: {
      [key]: { group: '留存', archived: true, turn: 12, content: 'DO_NOT_KEEP' }, [other]: { archived: true }, bad: { pinned: true }
    }}));
    const before = fs.readFileSync(path.join(dir, FILE), 'utf8');
    let labels = new SessionLabels(dir);
    add(['init', before], () => labels.all());
    for (const [id, patch] of [
      [key, { alias: '  重构\n计费  ' }], [key, { pinned: true }], [other, { turn: 100000, group: '😀'.repeat(40) }],
      [key, { archived: true }], [key, { turn: 100001 }], [key, { alias: '😀'.repeat(201) }], [other, { group: 3 }],
      ['../bad', { pinned: true }], [key, []], [key, { turn: null }], [key, { alias: null, pinned: false, group: null }]
    ]) add(['set', id, patch], () => labels.set(id, patch));
    labels = new SessionLabels(dir);
    add(['restart'], () => labels.all());
    add(['bytes'], () => fs.readFileSync(path.join(dir, FILE), 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (section === 'lines') {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { readObjects } = require('../../../../src/m1/transcript-lines');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-lines-gold-'));
  const file = path.join(dir, 'own.jsonl');
  try {
    for (const text of ['', 'null\n', '\n\ninvalid\n', '\n' + JSON.stringify({ text: '中🙂文'.repeat(40000) }) + '\r\nnull\nINVALID\n42\n{"text":"final"}']) {
      fs.writeFileSync(file, text);
      add([text], () => { const lines = []; const rows = [...readObjects(file, 1024 * 1024, line => lines.push(line))]; return { rows, lines }; });
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (section === 'changes') {
  const changes = require('../../../../src/m1/transcript-changes');
  for (const [before, after] of [
    ['same\r\nold\r\nend\r\n', 'same\r\nnew\r\nend\r\n'],
    ['', 'create'], ['before\n', ''], ['1\n2\n3\n4\n5', '1\n3\n2\n4\n5'], ['x\n', 'x\n'],
    ['before\n'.repeat(201), 'after\n'.repeat(201)]
  ]) add(['diffLines', before, after], () => changes.diffLines(before, after));
  const patch = 'prefix\n*** Begin Patch\n*** Add File: add.txt\n+new\n*** Update File: old.txt\n*** Move to: moved.txt\n@@\n-old\n+replacement\n*** Delete File: gone.txt\n-old\n*** End Patch\n+discarded';
  for (const [tool, input] of [
    ['apply_patch', patch], ['custom', { command: ['echo ok', patch] }], ['write', { filePath: 'own.txt', content: '' }],
    ['write_file', { path: 'own.txt', content: 'first\nsecond\n' }], ['edit', { path: 'own.txt', oldString: 'x', newString: 'y' }],
    ['multiEdit', { path: 'own.txt', edits: [{ old_string: 'x', new_string: 'y' }, { oldString: 'a', newString: 'b' }, null] }],
    ['str_replace_editor', { path: 'own.txt', command: 'str_replace', old_str: 'x', new_str: 'y' }],
    ['replace', { path: 'own.txt', old_string: 1, oldString: 'x', newString: 'z' }],
    ['edit', '{"file_path":"own.txt","old_string":"a","new_string":"b"}'], ['shell', { command: 'echo ok' }]
  ]) add(['change', tool, input], () => changes.change(tool, input));
  for (const [content, written] of [
    ['Used tool to: E:/Synthetic/own.txt.\n[diff_block_start]\n@@\n-a\n+b\n[diff_block_end]', {}],
    ['Created file file:///E:/Synthetic/A%20B.txt with requested content.', { 'e:/synthetic/a b.txt': 'text\n' }],
    ['Created file file:///tmp/a.txt with requested content.', { '/tmp/a.txt': 'first' }],
    ['Created file file:///tmp/missing.txt with requested content.', {}]
  ]) add(['antigravity', content, written], () => changes.fromAntigravity(content, new Map(Object.entries(written))));
}
if (section === 'prefix') {
  const delta = require('../../../../src/m1/transcript-continuation');
  const item = index => ({ kind: index % 2 ? 'assistant' : 'user', time: null, text: '合成 ' + index + '\n🙂', ...(index % 3 ? {} : { usage: 0 }) });
  const value = count => ({ schemaVersion: 'TranscriptV2', agent: 'codex', stamp: 'first', turns: Math.ceil(count / 2), tools: 0, failed: 0, truncated: false,
    items: Array.from({ length: count }, (_, index) => index === 65 ? { ...item(index), text: 'x'.repeat(32767) + '🙂长回复'.repeat(2000) } : item(index)) });
  const open = source => delta.merge(null, delta.make(source, 'own-record', delta.request(null)));
  for (const count of [0, 1, 63, 64, 65, 70, 127, 128, 129]) {
    const base = value(count), previous = open(base), next = { ...base, stamp: 'next', items: [...base.items, item(count)] };
    const proof = delta.request(previous);
    const wire = delta.make(next, 'own-record', proof);
    add(['make', next, 'own-record', proof], () => wire);
    add(['merge', previous, wire], () => delta.merge(previous, wire));
  }
  const base = value(71), previous = open(base), proof = delta.request(previous);
  for (const next of [{ ...base, items: base.items.slice(0, 67) }, { ...base, items: base.items.map((entry, index) => index === 67 ? { ...entry, text: 'rewritten' } : entry) }]) {
    const wire = delta.make(next, 'own-record', proof);
    add(['make', next, 'own-record', proof], () => wire);
    add(['merge', previous, wire], () => delta.merge(previous, wire));
  }
  add(['make', base, 'another-record', proof], () => delta.make(base, 'another-record', proof));
  const wire = delta.make(base, 'own-record', proof);
  add(['merge', null, wire], () => delta.merge(null, wire));
  add(['merge', previous, { ...wire, offset: 1 }], () => delta.merge(previous, { ...wire, offset: 1 }));
  add(['merge', null, base], () => delta.merge(null, base));
  for (const bad of [null, {}, { count: -1, digests: [] }, { count: 1.5, digests: [] }, { count: 1, digests: [] }, { ...proof, ignored: true }]) {
    add(['validate', bad], () => delta.validate(bad));
  }
  for (const view of [null, base, previous, { ...previous, continuation: { count: 71, digests: [] } }]) {
    add(['request', view], () => delta.request(view));
  }
}
if (section === 'marks') {
  const marks = require('../../../../src/m1/transcript-marks');
  const question = '<send_user_message_question_reply>' + JSON.stringify([{ question: '先做哪个？\n原因？', answer: 'A\nB' }, { question: 'Q', answer: '我' }, { question: 0 }]) + '</send_user_message_question_reply>';
  for (const text of [
    null, '原话', '<b>bold</b>', '<image id="123"></image>\n保留', '<new_app_notice>x</new_app_notice>',
    '<turn_aborted>The user interrupted.</turn_aborted>', '  # AGENTS.md instructions for Synthetic\n\nrules',
    '<permissions instructions><INSTRUCTIONS>Rule</INSTRUCTIONS>', '<environment_context>未闭合',
    '<user_shell_command>\n<command>\nnpm test\n</command>\n<result>ok</result>\n</user_shell_command>',
    '# Files mentioned by the user:\n\n## a.png: C:/Synthetic/a.png\n\n## b.txt: C:/Synthetic/b.txt\n\n## My request for Codex:\n修这个问题\n',
    '# Files mentioned by the user:\n\n## a.png: C:/Synthetic/a.png\n', '<system-reminder>前</system-reminder><turn_aborted>后</turn_aborted>',
    question, '<send_user_message_question_reply>not json</send_user_message_question_reply>'
  ]) add(['classify', text], () => marks.classify(text));
  for (const text of [' /model ', '/foo-bar:b a', '/foo\nmore', '/文件', '/first.txt', 'a /first', '/x ' + '中'.repeat(500)]) {
    add(['slash', text], () => marks.slash(text));
  }
  for (const text of ['no tag', ' bad <oai-mem-citation>  ', '信\n<oai-mem-citation><citation_entries>\nMEMORY.md:462-462|note=[prior context]\nsummaries/a.md:17-18|note=[second]\nbad\n</citation_entries></oai-mem-citation> 后']) {
    add(['citations', text], () => marks.citations(text));
  }
  for (const source of [
    'text(await tools.exec_command({cmd:"Get-ChildItem \\"a b\\""}));',
    'tools.exec_command({cmd:"a\\tb\\u4e2d"}); tools["shell"]({command:"git status"});',
    'tools.mcp_example({name:"x"}); tools.mcp_example({name:"y"});', 'store("wd", "Synthetic");',
    'tools.apply_patch({input:"*** Begin Patch\\n*** Update File: a.js\\n@@\\n-a\\n+b\\n*** End Patch"});',
    'tools.write_stdin_never({unknown:true}); tools.local_shell({command:""});'
  ]) add(['codeMode', source], () => marks.codeMode(source));
}
if (section === 'projection') {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { Store } = require('../../../../src/m1/store');
  const { normalize } = require('../../../../src/m1/normalize');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-projection-gold-'));
  try {
    const store = new Store(dir, {});
    const noon = new Date(); noon.setHours(12, 0, 0, 0);
    for (const age of [1, 3, 45]) for (const [index, agent] of ['codex', 'claude'].flatMap(agent => Array.from({ length: 8 }, (_, index) => [index, agent]))) {
      const time = noon.getTime() - age * 86400000 + index * 1000;
      const record = normalize(agent, { input_tokens: 11, output_tokens: 2, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 13 },
        { id: agent + index + '-' + age, session: 'session-' + index, time, model: 'synthetic-unpriced', entry: index % 2 ? 'desktop' : 'cli' }, store.state.salt);
      store.state.records[record.id] = record;
      store.state.sessions[record.sessionKey] = { agent, id: 'session-' + index, cwd: 'E:/Synthetic/project', title: '会话 ' + index };
    }
    const duplicate = Object.keys(store.state.records)[2];
    store.state.duplicateIds[duplicate] = true;
    const orphan = normalize('codex', { input_tokens: 3, output_tokens: 1, total_tokens: 4 },
      { id: 'orphan', time: noon.getTime(), model: 'synthetic-unpriced', entry: 'cli' }, store.state.salt);
    store.state.records[orphan.id] = orphan;
    store.state.sessions['e'.repeat(64)] = { agent: 'continue', at: noon.toISOString(), id: 'index-only', title: '未记录用量' };
    store.state.sequence++;
    const state = { records: store.state.records, duplicateIds: store.state.duplicateIds, sessions: store.state.sessions, sequence: store.state.sequence };
    for (const selection of [{}, {range:'7'}, {range:'30'}, {range:'today'}, {recent:true}, {recent:true,range:'7'}, null, 'today', {range:'year'}, {range:'all', recent:1}, {path:'x'}]) {
      add([state, selection], () => ({ list: selectSessions(store.sessionList(selection), store.catalog()), packed: utf8.decode(store.sessionListPacked(selection).sessionBytes) }));
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
process.stdout.write(JSON.stringify(cases));
