'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { project } = require('../../src/m1/config-health-project');
const { scanConfigHealth, summary } = require('../../src/m1/config-health');
const syntax = require('../../src/m1/config-health-syntax');
const { remove } = require('./temp');
const mcp = item => project('claude', 'claude-mcp', JSON.stringify({ mcpServers: { PRIVATE_SERVER: item } }))[0];
const hook = (handler, agent = 'claude') => project(agent, agent === 'codex' ? 'codex-hooks' : 'claude-settings', JSON.stringify({ hooks: { Stop: [{ hooks: [handler] }] } }))[0];
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-deep-synthetic-')); t.after(() => remove(root));
  return { root, write(relative, contents) { const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, contents); return file; } };
}

test('unknown MCP transports and dynamic helpers cannot downgrade deterministic field failures', () => {
  for (const item of [
    { type: 'future', url: 'https://private.invalid', args: 42 },
    { type: 'future', command: 'node', env: { SECRET: 7 } },
    { type: 'future', url: 'https://private.invalid', enabled: 'false' },
    { type: 'future', url: 'https://private.invalid', headers: { SECRET: [] } },
    { type: 'future', url: 'https://private.invalid', timeout: -1 },
    { type: 'http', url: 'https://private.invalid', headersHelper: 'PRIVATE_COMMAND', args: [7] }
  ]) assert.equal(mcp(item).state, 'issue');
  assert.equal(mcp({ type: 'future', url: 'wss://private.invalid' }).state, 'unchecked');
  assert.equal(mcp({ type: 'http', url: 'https://private.invalid', headersHelper: 'PRIVATE_COMMAND' }).reason, 'DYNAMIC_HELPER_UNCHECKED');
  assert.equal(mcp({ type: 'http', url: 'https://private.invalid', headersHelper: 7 }).state, 'issue');
});

test('MCP timeout, environment whitelist and tool-selection field types are checked without returning their values', () => {
  const base = '[mcp_servers.PRIVATE_SERVER]\ncommand="node"\n';
  for (const bad of ['required="yes"','tool_timeout_sec=-1','startup_timeout_ms="10"','enabled_tools=[1]','disabled_tools="PRIVATE_TOOL"','cwd=7','env_vars=[{name="PRIVATE_ENV",source="future"}]']) assert.equal(project('codex', 'codex-config', base + bad)[0].state, 'issue', bad);
  const valid = project('codex', 'codex-config', base + 'required=true\nenabled_tools=["PRIVATE_TOOL"]\nenv_vars=["PRIVATE_ENV",{name="OTHER_ENV",source="remote"}]\nstartup_timeout_sec=0\n');
  assert.equal(valid[0].state, 'static-ok'); assert(!JSON.stringify(valid).includes('PRIVATE_'));
  assert.equal(project('codex', 'codex-config', base + 'startup_timeout_sec=1\nstartup_timeout_ms=1000')[0].reason, 'TIMEOUT_ALIAS_UNCHECKED');
});

test('literal invalid HTTP endpoints are issues; unresolved references remain unchecked with no evaluation', () => {
  for (const url of ['not a URL','file:///PRIVATE','ftp://private.invalid','https://private.invalid:INVALID']) {
    assert.equal(mcp({ type: 'http', url }).state, 'issue'); assert.equal(hook({ type: 'http', url }).state, 'issue');
  }
  for (const url of ['${PRIVATE_ENDPOINT}','https://private.invalid/${PRIVATE_TOKEN}','%PRIVATE_ENDPOINT%','{file:PRIVATE_PATH}']) {
    assert.equal(mcp({ type: 'http', url }).state, 'unchecked'); assert.equal(hook({ type: 'http', url }).reason, 'DYNAMIC_REFERENCE_UNCHECKED');
  }
  assert.equal(hook({ type: 'http', url: 'http://127.0.0.1:8080/private', headers: { SECRET: 'PRIVATE' }, allowedEnvVars: ['SECRET'] }).state, 'static-ok');
  assert.equal(hook({ type: 'http', url: 'https://private.invalid', headers: { SECRET: 7 } }).state, 'issue');
  assert.equal(hook({ type: 'http', url: 'https://private.invalid', allowedEnvVars: 'SECRET' }).state, 'issue');
});

test('hook types, Windows overrides, MCP-tool required fields and common options remain static and redacted', () => {
  for (const agent of ['codex','claude']) {
    assert.equal(hook({ type: 'future', timeout: -1 }, agent).state, 'issue');
    assert.equal(hook({ type: 'command', command: 'PRIVATE_COMMAND', async: 'yes' }, agent).state, 'issue');
    assert.equal(hook({ type: 'mcp_tool', server: 'PRIVATE_SERVER' }, agent).state, 'issue');
    assert.equal(hook({ type: 'mcp_tool', server: 'PRIVATE_SERVER', tool: 'PRIVATE_TOOL', input: [] }, agent).state, 'issue');
    const valid = hook({ type: 'mcp_tool', server: 'PRIVATE_SERVER', tool: 'PRIVATE_TOOL', input: { PRIVATE: '${PRIVATE_FIELD}' } }, agent);
    assert.equal(valid.reason, 'MCP_RUNTIME_UNCHECKED'); assert.equal(valid.executed, false); assert(!JSON.stringify(valid).includes('PRIVATE'));
  }
  assert.equal(hook({ type: 'command', commandWindows: 'PRIVATE_COMMAND', additionalContextLimit: 0 }, 'codex').state, 'static-ok');
  assert.equal(hook({ type: 'command', command: 'PRIVATE_COMMAND', commandWindows: 7 }, 'codex').state, 'issue');
  assert.equal(hook({ type: 'command', command: 'PRIVATE_COMMAND', additionalContextLimit: 0.5 }, 'codex').state, 'issue');
  assert.equal(hook({ type: 'http', url: 'not a URL' }, 'codex').state, 'unchecked', 'unsupported Codex HTTP handler is not assessed as a supported Claude handler');
});

test('bounded skill lists and invocation switches are validated, with version-dependent coercions left unchecked', () => {
  for (const list of ['allowed-tools: ["Read", "Grep"]','allowed-tools:\n  - Read\n  - "Grep"','allowed-tools: Read Grep']) {
    const checks = project('claude', 'skill', '---\n' + list + '\ndisable-model-invocation: true\nuser-invocable: false\ncontext: fork\n---');
    assert.equal(checks[0].state, 'static-ok', list);
  }
  for (const value of ['maybe','null','2']) assert.equal(project('claude', 'skill', '---\ndisable-model-invocation: ' + value + '\n---')[0].state, 'issue');
  for (const value of ['yes','NO','on','off','1','0','"true"']) assert.equal(project('claude', 'skill', '---\nuser-invocable: ' + value + '\n---')[0].reason, 'BOOLEAN_COERCION_UNCHECKED');
  for (const line of ['allowed-tools: [1]','agent: 42','model: false','argument-hint: null','context: 1']) assert.equal(project('claude', 'skill', '---\n' + line + '\n---')[0].state, 'issue');
  assert.equal(project('claude', 'skill', '---\ncontext: future\n---')[0].state, 'unchecked');
  assert.equal(project('claude', 'skill', '---\n---')[0].state, 'static-ok'); assert.equal(project('codex', 'skill', '---\n---')[0].state, 'issue');
  for (const body of ['allowed-tools:\n  - !!js/function PRIVATE','allowed-tools:\n  - &PRIVATE value','allowed-tools:\n  - *PRIVATE','allowed-tools:\n  - Read\n    - Grep','allowed-tools: [Read, Grep]']) assert.throws(() => syntax.frontmatter('---\n' + body + '\n---'));
  assert.throws(() => syntax.frontmatter('---\nallowed-tools:\n' + '  - Read\n'.repeat(65) + '---'), /PARSE_LIMIT/);
});

test('redacted category summaries count parser failures and missing scopes without claiming runtime health', t => {
  const f = fixture(t); f.write('.mcp.json', '{"mcpServers":{"PRIVATE":{"type":"http","url":"not a URL"}}}');
  f.write('.agents/skills/private/SKILL.md', '---\nname: PRIVATE_SKILL\ndescription: PRIVATE_DESCRIPTION\n---\nNEVER_READ_BODY');
  const result = scanConfigHealth({ project: f.root });
  assert.equal(result.summary.mcp.state, 'issue'); assert(result.summary.mcp.counts.issue > 0); assert(result.summary.hooks.counts.unchecked > 0); assert.equal(result.summary.skills.counts['static-ok'], 1);
  assert.equal(result.state, 'unchecked'); assert.equal(result.runtimeVerified, false); assert(!JSON.stringify(result).includes('PRIVATE')); assert(!JSON.stringify(result).includes(f.root));
  const malformed = summary([{ kind: 'codex-config', checks: [{ kind: 'file', state: 'unchecked', reason: 'PARSE_UNSUPPORTED' }] }]);
  for (const row of Object.values(malformed)) { assert.equal(row.counts.unchecked, 1); assert.equal(row.state, 'unchecked'); assert.equal(row.runtimeVerified, false); }
  assert.equal(summary([]).mcp.state, 'unchecked');
});

test('YAML numeric/boolean/null scalars are not mistaken for valid skill names, and unsupported numbers stay unchecked', () => {
  for (const name of ['-1','1.25','1e3','True','FALSE','null','~']) assert.equal(project('codex', 'skill', '---\nname: ' + name + '\ndescription: fixture\n---')[0].state, 'issue', name);
  for (const name of ['+1','01','1_000','0xF','0o17','.inf','.NaN']) assert.equal(project('codex', 'skill', '---\nname: ' + name + '\ndescription: fixture\n---')[0].state, 'unchecked', name);
  for (const name of ['"-1"','"True"','"~"','skill_1','1st-skill']) assert.equal(project('codex', 'skill', '---\nname: ' + name + '\ndescription: fixture\n---')[0].state, 'static-ok', name);
});

test('a hard-link race after initial lstat is rejected before content reads and closes the opened descriptor', t => {
  const f = fixture(t), file = f.write('.mcp.json', '{"mcpServers":{}}'), linked = path.join(f.root, 'unselected-link');
  const open = fs.openSync, close = fs.closeSync; let reads = 0, closes = 0;
  t.mock.method(fs, 'openSync', (target, ...args) => { if (target === file) fs.linkSync(file, linked); return open(target, ...args); });
  t.mock.method(fs, 'readSync', () => { reads++; throw Error('CONTENT_MUST_NOT_BE_READ'); });
  t.mock.method(fs, 'closeSync', fd => { closes++; return close(fd); });
  const result = scanConfigHealth({ project: f.root });
  assert.equal(reads, 0); assert.equal(closes, 1); assert.equal(result.audit.bytesRead, 0); assert(result.files.flatMap(file => file.checks).some(row => row.reason === 'FILE_CHANGED'));
});

test('descriptor ctime changes are rejected even when size and mtime stay unchanged', t => {
  const f = fixture(t); f.write('.mcp.json', '{"mcpServers":{}}'); const stat = fs.fstatSync; let calls = 0;
  t.mock.method(fs, 'fstatSync', fd => { const value = stat(fd); if (++calls > 1) return { ...value, ctimeMs: value.ctimeMs + 10 }; return value; });
  const result = scanConfigHealth({ project: f.root }); assert(result.files.flatMap(file => file.checks).some(row => row.reason === 'FILE_CHANGED')); assert.equal(result.audit.filesRead, 0);
});
