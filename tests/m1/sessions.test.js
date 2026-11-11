'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { roots } = require('../../src/m1/policy');
const { scanSources } = require('../../src/m1/sources');
const { Store } = require('../../src/m1/store');
const { selectSnapshot } = require('../../src/m1/local-snapshot');
const { selectSessions } = require('../../src/m1/session-list');
const { resumeCommand, directory, title } = require('../../src/m1/sessions');
const { sourceStamp } = require('../../src/m1/sources');
const time = new Date().toISOString();
const CODEX_ID = '019a7c2e-0000-4000-8000-000000000001';
function workspace(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessions-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function write(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
const usage = { input_tokens: 100, output_tokens: 20, cached_input_tokens: 40, cache_creation_input_tokens: 0, reasoning_output_tokens: 3, total_tokens: 120 };
function codexRows(cwd) {
  return [{ type: 'session_meta', payload: { id: CODEX_ID, originator: 'codex_cli_rs', ...(cwd ? { cwd } : {}) } }, { type: 'turn_context', payload: { model: 'gpt-4.1' } },
    { timestamp: time, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage, last_token_usage: usage } } }];
}
// One synthetic home with every source that keeps session metadata.
function home(dir) {
  const base = path.join(dir, 'home'), selected = roots(base);
  write(path.join(selected.codex[0], 'session.jsonl'), jsonl(codexRows('C:\\work\\alpha')));
  // Codex keeps thread names beside its sessions folder; a later line for the same id wins.
  write(path.join(path.dirname(selected.codex[0]), 'session_index.jsonl'), jsonl([{ id: CODEX_ID, thread_name: 'first name', updated_at: time }, { id: 'other', thread_name: 'unrelated' }, { id: CODEX_ID, thread_name: 'Codex thread', updated_at: time }]) + 'not json\n');
  write(path.join(selected.claude[0], 'p', 'c.jsonl'), jsonl([
    { type: 'user', sessionId: 'claude-1', cwd: 'C:\\work\\beta', timestamp: time, message: { role: 'user', content: 'text' } },
    { type: 'assistant', uuid: 'a-1', sessionId: 'claude-1', cwd: 'C:\\work\\elsewhere', timestamp: time, message: { id: 'm-1', model: 'claude-sonnet-4-20250514', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 } } },
    { type: 'custom-title', customTitle: '  Renamed\n  session  ', sessionId: 'claude-1' }]));
  const db = path.join(selected.opencode[0], 'opencode.db'); fs.mkdirSync(path.dirname(db), { recursive: true });
  const open = new DatabaseSync(db); open.exec('CREATE TABLE message(id TEXT, session_id TEXT, data TEXT); CREATE TABLE session(id TEXT, directory TEXT, title TEXT)');
  open.prepare('INSERT INTO message VALUES(?,?,?)').run('o-1', 'ses_open1', JSON.stringify({ id: 'o-1', role: 'assistant', sessionID: 'ses_open1', modelID: 'gpt-4.1', providerID: 'openai', tokens: { input: 80, output: 10, reasoning: 2, cache: { read: 20, write: 0 } }, time: { created: Date.parse(time) } }));
  open.prepare('INSERT INTO session VALUES(?,?,?)').run('ses_open1', 'C:\\work\\gamma', 'Open title'); open.close();
  const chats = path.join(selected.gemini[0], 'hash', 'chats');
  write(path.join(chats, 'session-g.jsonl'), jsonl([{ sessionId: 'gemini-1', projectHash: 'hash' }, { id: 'g-1', type: 'gemini', model: 'gemini-2.5-pro', timestamp: time, tokens: { input: 100, output: 20, cached: 40, thoughts: 5, tool: 0, total: 125 } }]));
  write(path.join(selected.gemini[0], 'hash', '.project_root'), 'C:\\work\\delta\n');
  const dsUsage = { inputTokens: 60, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 0, reasoningTokens: 2, totalTokens: 120 };
  write(path.join(selected.deepseek[0], 'project', 'child', 'session.v4.jsonl'), jsonl([{ type: 'session', version: 4, id: 'dsh-1', createdAt: Date.parse(time), cwd: 'C:\\work\\epsilon', isSeeded: false },
    { seq: 0, type: 'assistant/message', time: Date.parse(time), data: { turn: 0, step: 0, usage: dsUsage, message: { source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' } } } }]));
  write(path.join(selected.workbuddy[0], 'w.jsonl'), jsonl([{ id: 'w-1', sessionId: 'work-1', cwd: 'C:\\work\\zeta', timestamp: Date.parse(time), providerData: { requestModelId: 'gpt-4.1', rawUsage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } } }]));
  const mimo = path.join(selected.mimo[0], 'mimocode.db'); fs.mkdirSync(path.dirname(mimo), { recursive: true });
  const m = new DatabaseSync(mimo); m.exec('CREATE TABLE message(id TEXT, session_id TEXT, data TEXT); CREATE TABLE session(id TEXT, directory TEXT, version TEXT, title TEXT)');
  m.prepare('INSERT INTO message VALUES(?,?,?)').run('mi-1', 'ses_mimo1', JSON.stringify({ id: 'mi-1', role: 'assistant', sessionID: 'ses_mimo1', modelID: 'mimo-v2-pro', tokens: { input: 80, output: 10, reasoning: 2, cache: { read: 20, write: 0 } }, time: { created: Date.parse(time) } }));
  m.prepare('INSERT INTO session VALUES(?,?,?,?)').run('ses_mimo1', 'C:\\work\\eta', 'cli-1', 'MiMo title'); m.close();
  fs.mkdirSync(path.dirname(selected.zcode[0]), { recursive: true });
  const z = new DatabaseSync(selected.zcode[0]); z.exec('CREATE TABLE model_usage(id TEXT, session_id TEXT, provider_id TEXT, model_id TEXT, started_at INTEGER, completed_at INTEGER, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER, cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER, provider_total_tokens INTEGER, computed_total_tokens INTEGER, raw_usage_json TEXT); CREATE TABLE session(id TEXT, directory TEXT, title TEXT)');
  z.prepare('INSERT INTO model_usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('z-1', 'z-session', 'zai', 'GLM-5.3', Date.parse(time), Date.parse(time), 100, 20, 0, 0, 40, 120, 120, null);
  z.prepare('INSERT INTO session VALUES(?,?,?)').run('z-session', 'C:\\work\\iota', 'not read'); z.close();
  // Antigravity: the working directory is the conversation's single workspace URI.
  const agyId = 'a6f0c1d2-0000-4000-8000-000000000002', product = path.dirname(selected.antigravity[0]);
  write(path.join(selected.antigravity[0], agyId, '.system_generated', 'logs', 'transcript_full.jsonl'), jsonl([{ type: 'PLANNER_RESPONSE', source: 'MODEL', status: 'DONE', step_index: 1, created_at: time, input_tokens: 50, output_tokens: 10, cache_read_tokens: 30 }]));
  fs.mkdirSync(product, { recursive: true });
  const s = new DatabaseSync(path.join(product, 'conversation_summaries.db')); s.exec('CREATE TABLE conversation_summaries(conversation_id TEXT, title TEXT, workspace_uris TEXT)');
  s.prepare('INSERT INTO conversation_summaries VALUES(?,?,?)').run(agyId, 'Agy title', JSON.stringify(['file:///C:/work/theta'])); s.close();
  return selected;
}

test('session metadata comes only from sources with a recorded basis', async t => {
  const selected = home(workspace(t)), scan = await scanSources(selected, 'salt', { reads: 0 });
  const meta = agent => scan[agent].sessions.map(({ id, cwd }) => ({ id, cwd }));
  assert.deepEqual(meta('codex'), [{ id: CODEX_ID, cwd: 'C:\\work\\alpha' }]);
  assert.deepEqual(meta('claude'), [{ id: 'claude-1', cwd: 'C:\\work\\beta' }], 'the first directory a session reports is kept');
  assert.deepEqual(meta('opencode'), [{ id: 'ses_open1', cwd: 'C:\\work\\gamma' }]);
  assert.deepEqual(meta('gemini'), [{ id: 'gemini-1', cwd: 'C:\\work\\delta' }]);
  assert.deepEqual(meta('deepseek'), [{ id: 'dsh-1', cwd: 'C:\\work\\epsilon' }]);
  assert.deepEqual(meta('workbuddy'), [{ id: 'work-1', cwd: 'C:\\work\\zeta' }]);
  assert.deepEqual(meta('mimo'), [{ id: 'ses_mimo1', cwd: 'C:\\work\\eta' }]);
  assert.deepEqual(meta('zcode'), [{ id: 'z-session', cwd: 'C:\\work\\iota' }]);
  assert.deepEqual(meta('antigravity'), [{ id: 'a6f0c1d2-0000-4000-8000-000000000002', cwd: 'C:\\work\\theta' }]);
  for (const agent of ['codex', 'claude', 'opencode', 'gemini', 'deepseek', 'workbuddy', 'mimo', 'zcode', 'antigravity']) assert.equal(scan[agent].sessions[0].key, scan[agent].records[0].sessionKey, agent + ' metadata joins its records');
});

test('the session list joins metadata locally and nothing reaches the statistics export', async t => {
  const dir = workspace(t), selected = home(dir), store = new Store(path.join(dir, 'app'), selected);
  store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' });
  const list = store.sessionList(), byAgent = Object.fromEntries(list.sessions.map(s => [s.agent, s]));
  assert.equal(byAgent.codex.project, 'alpha'); assert.equal(byAgent.codex.resumable, true);
  assert.equal(store.resume(byAgent.codex.key), "Set-Location -LiteralPath 'C:\\work\\alpha'; codex resume " + CODEX_ID);
  assert.equal(store.directory(byAgent.codex.key), 'C:\\work\\alpha');
  assert.equal(store.directory(byAgent.deepseek.key), 'C:\\work\\epsilon');
  assert.equal(store.directory(byAgent.workbuddy.key), 'C:\\work\\zeta');
  assert.equal(byAgent.antigravity.project, 'theta'); assert.equal(byAgent.zcode.project, 'iota'); assert.equal(byAgent.mimo.project, 'eta');
  assert.equal(store.directory('0000000000000000000000000000000000000000000000000000000000000000'), null);
  assert.equal(byAgent.deepseek.resumable, false, 'Harness has a directory but no confirmed resume command');
  assert.equal(byAgent.workbuddy.resumable, false, 'a directory without a confirmed resume command');
  assert.equal(byAgent.codex.days[0].totalTokens, 120); assert(byAgent.codex.days[0].estimatedCostUsd > 0);
  const unattributed = selectSessions({ ...list, unattributed: { codex: { [list.today]: 2, 'bad-date': 5 }, nope: { [list.today]: 1 } } }).unattributed;
  assert.deepEqual(unattributed, { codex: { [list.today]: 2 } }, 'records without a session count per Agent and day');
  assert.equal(store.sessionList(), list, 'cached while the snapshot is unchanged');
  const exported = JSON.stringify(selectSnapshot(store.snapshot()));
  for (const secret of [CODEX_ID, 'claude-1', 'ses_open1', 'C:\\\\work', 'alpha', 'gamma']) assert.equal(exported.includes(secret), false, secret + ' must not reach the export');
  const projected = selectSessions({ ...list, sessions: list.sessions.map(s => ({ ...s, resume: 'injected' })) });
  assert.equal(JSON.stringify(projected).includes('injected'), false, 'the window never receives a command');
  assert.equal(JSON.stringify(projected).includes('Set-Location'), false);
  assert.throws(() => selectSessions({ ...list, sessions: [{ ...list.sessions[0], key: '../x' }] }), /INVALID_SESSION_LIST/);
});

test('a new observation replaces session metadata completely', async t => {
  const dir = workspace(t), selected = home(dir), store = new Store(path.join(dir, 'app'), selected);
  store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' });
  write(path.join(selected.codex[0], 'session.jsonl'), jsonl(codexRows(null)));
  store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' });
  const codex = store.sessionList().sessions.find(s => s.agent === 'codex');
  assert.equal(codex.cwd, null, 'a directory the source no longer reports is removed'); assert.equal(codex.project, null);
  assert.equal(store.resume(codex.key), 'codex resume ' + CODEX_ID);
  store.clear(); assert.deepEqual(store.state.sessions, {});
});

test('resume commands keep hostile directories literal and refuse unsafe IDs', () => {
  const directories = ["C:\\a'b", 'C:\\$(Remove-Item x)', 'C:\\`whoami`', 'C:\\a; calc', 'C:\\项目 测试\\it\u2019s \u2018x\u2019', 'C:\\plain'];
  const commands = directories.map(cwd => resumeCommand('claude', { id: 'claude-1', cwd }));
  // Parse with PowerShell itself: exactly two statements, the first a literal path.
  const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $out=@(); foreach($c in ($env:AU_COMMANDS | ConvertFrom-Json)){ $t=$null;$e=$null; $a=[System.Management.Automation.Language.Parser]::ParseInput($c,[ref]$t,[ref]$e); $s=$a.EndBlock.Statements; $arg=$s[0].PipelineElements[0].CommandElements[2]; $out+=[pscustomobject]@{n=$s.Count;errors=$e.Count;literal=($arg -is [System.Management.Automation.Language.StringConstantExpressionAst]);path=$arg.Value;second=$s[1].Extent.Text} }; ConvertTo-Json -InputObject $out -Compress";
  const parsed = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, AU_COMMANDS: JSON.stringify(commands) }, encoding: 'utf8' }));
  parsed.forEach((result, index) => {
    assert.deepEqual(result, { n: 2, errors: 0, literal: true, path: directories[index], second: 'claude --resume claude-1' }, directories[index]);
  });
  for (const id of ['a b', 'x;calc', '$(x)', '', 'a'.repeat(129)]) assert.equal(resumeCommand('codex', { id, cwd: null }), null, JSON.stringify(id));
  assert.equal(resumeCommand('workbuddy', { id: 'w-1', cwd: 'C:\\x' }), null);
  for (const value of ['relative\\dir', '\\\\server\\share', 'C:\\a\nb', '']) assert.equal(directory(value), null, JSON.stringify(value));
});

test('session titles come only from each Agent\'s own title field, never message text', async t => {
  const dir = workspace(t), selected = home(dir), store = new Store(path.join(dir, 'app'), selected), scan = await scanSources(selected, store.state.salt, { reads: 0 });
  const titles = Object.fromEntries(['codex', 'claude', 'opencode', 'mimo', 'antigravity', 'gemini', 'deepseek', 'workbuddy', 'zcode'].map(agent => [agent, scan[agent].sessions[0].title ?? null]));
  assert.deepEqual(titles, { codex: 'Codex thread', claude: 'Renamed session', opencode: 'Open title', mimo: 'MiMo title', antigravity: 'Agy title', gemini: null, deepseek: null, workbuddy: null, zcode: null });
  store.ingest(scan, { status: 'not-run' });
  const list = store.sessionList(), codex = list.sessions.find(item => item.agent === 'codex');
  assert.equal(codex.title, 'Codex thread'); assert.equal(selectSessions(list).sessions.find(item => item.agent === 'codex').title, 'Codex thread');
  const exported = JSON.stringify(selectSnapshot(store.snapshot()));
  for (const secret of ['Codex thread', 'Renamed', 'Open title', 'MiMo title', 'Agy title']) assert.equal(exported.includes(secret), false, secret + ' must not reach the export');
  // A rename in the thread index changes the source stamp, so the next scan picks it up.
  const before = sourceStamp(selected, 'salt', { reads: 0 });
  fs.appendFileSync(path.join(path.dirname(selected.codex[0]), 'session_index.jsonl'), JSON.stringify({ id: CODEX_ID, thread_name: 'Renamed again' }) + '\n');
  assert.notEqual(sourceStamp(selected, 'salt', { reads: 0 }), before);
  assert.equal((await scanSources(selected, 'salt', { reads: 0 })).codex.sessions[0].title, 'Renamed again');
  // Removing the title removes it from the saved metadata (complete replacement).
  fs.rmSync(path.join(path.dirname(selected.codex[0]), 'session_index.jsonl'));
  store.ingest(await scanSources(selected, store.state.salt, { reads: 0 }), { status: 'not-run' });
  assert.equal(store.sessionList().sessions.find(item => item.agent === 'codex').title, null);
});

test('titles are one line of at most 120 characters', () => {
  assert.equal(title('a\n\tb\u0000c   d'), 'a b c d');
  assert.equal(title('标'.repeat(300)), '标'.repeat(120));
  for (const value of ['', '   ', null, 7, {}]) assert.equal(title(value), null, JSON.stringify(value));
});

test('MiMo Code and Antigravity resume commands follow their recorded basis', () => {
  assert.equal(resumeCommand('mimo', { id: 'ses_mimo1', cwd: null }), 'mimo -s ses_mimo1');
  assert.equal(resumeCommand('antigravity', { id: 'a6f0c1d2-0000-4000-8000-000000000002', cwd: 'C:\\w' }), "Set-Location -LiteralPath 'C:\\w'; agy --conversation=a6f0c1d2-0000-4000-8000-000000000002");
  for (const agent of ['deepseek', 'workbuddy', 'zcode', 'cursor']) assert.equal(resumeCommand(agent, { id: 'x-1', cwd: 'C:\\x' }), null, agent);
});
