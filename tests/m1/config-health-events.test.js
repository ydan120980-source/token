'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { project } = require('../../src/m1/config-health-project');
const { scanConfigHealth } = require('../../src/m1/config-health');
const { remove } = require('./temp');
const handler = type => ({ type, command: 'PRIVATE_COMMAND', prompt: 'PRIVATE_PROMPT', url: 'https://private.invalid', server: 'PRIVATE_SERVER', tool: 'PRIVATE_TOOL' });
const hook = (agent, event, item) => project(agent, agent === 'codex' ? 'codex-hooks' : 'claude-settings', JSON.stringify({ hooks: { [event]: [{ hooks: [item] }] } }))[0];

test('event-handler compatibility distinguishes unsupported and conditional MCP startup contexts without execution', () => {
  const end = hook('codex', 'SessionEnd', handler('mcp_tool'));
  assert.equal(end.state, 'issue'); assert.equal(end.reason, 'EVENT_HANDLER_UNSUPPORTED'); assert.equal(end.executed, false);
  assert.equal(hook('codex', 'SessionStart', handler('mcp_tool')).reason, 'MCP_RUNTIME_UNCHECKED');
  for (const event of ['SessionStart','Setup']) for (const type of ['http','prompt','agent']) {
    assert.equal(hook('claude', event, handler(type)).reason, 'EVENT_HANDLER_UNSUPPORTED', event + type);
  }
  assert.equal(hook('claude', 'Setup', handler('mcp_tool')).reason, 'MCP_SETUP_UNAVAILABLE');
  assert.equal(hook('claude', 'SessionStart', handler('mcp_tool')).reason, 'MCP_STARTUP_CONTEXT_UNCHECKED');
  assert.equal(hook('claude', 'SessionEnd', handler('mcp_tool')).reason, 'MCP_RUNTIME_UNCHECKED');
  assert.equal(hook('claude', 'PermissionRequest', handler('agent')).state, 'issue');
  assert.equal(hook('claude', 'PermissionRequest', handler('prompt')).state, 'static-ok');
  for (const event of ['Stop','PreToolUse','TaskCreated','PostToolBatch','UserPromptExpansion']) for (const type of ['command','http','prompt','agent']) assert.equal(hook('claude', event, handler(type)).state, 'static-ok', event + type);
  for (const event of ['Notification','ConfigChange','DirectoryAdded','MessageDisplay','PreModelSwitch','PostModelSwitch']) {
    assert.equal(hook('claude', event, handler('http')).state, 'static-ok');
    assert.equal(hook('claude', event, handler('prompt')).state, 'issue');
  }
  for (const type of ['http','prompt','agent']) assert.equal(hook('codex', 'Stop', handler(type)).state, 'unchecked');
});

test('unknown event names do not hide deterministic group and handler shape errors or leak their original names', () => {
  const event = 'PRIVATE_FUTURE_EVENT';
  for (const groups of [7,[null],[{ hooks: 7 }],[{ matcher: 7, hooks: [] }],[{ hooks: [null] }],[{ hooks: [{ type: 'command', command: 7 }] }],[{ hooks: [{ type: 'http', url: 'invalid' }] }]]) {
    const rows = project('claude', 'claude-settings', JSON.stringify({ hooks: { [event]: groups } }));
    assert.equal(rows[0].state, 'issue'); assert(!JSON.stringify(rows).includes(event));
  }
  for (const groups of [[],[{ hooks: [] }],[{ hooks: [handler('command')] }]]) {
    const rows = project('claude', 'claude-settings', JSON.stringify({ hooks: { [event]: groups } }));
    assert.equal(rows[0].reason, 'EVENT_UNCONFIRMED');
  }
  const invalid = hook('claude', 'SessionStart', { ...handler('mcp_tool'), input: [] });
  assert.equal(invalid.state, 'issue'); assert.equal(invalid.reason, 'FIELD_TYPE');
});

test('async and condition options report ignored or inapplicable behavior and never evaluate permission patterns', () => {
  assert.equal(hook('codex', 'SessionEnd', { ...handler('command'), async: true }).reason, 'SESSION_END_FORCED_SYNC');
  assert.equal(hook('codex', 'Stop', { ...handler('command'), async: true }).state, 'static-ok');
  for (const agent of ['codex','claude']) assert.equal(hook(agent, 'Stop', { ...handler('http'), async: true }).reason, 'ASYNC_COMMAND_ONLY');
  assert.equal(hook('claude', 'Stop', { ...handler('command'), asyncRewake: true }).state, 'static-ok');
  assert.equal(hook('claude', 'Stop', { ...handler('http'), asyncRewake: true }).reason, 'ASYNC_COMMAND_ONLY');
  assert.equal(hook('claude', 'Stop', { ...handler('command'), once: true }).reason, 'ONCE_IGNORED_IN_SETTINGS');
  for (const key of ['asyncRewake','once']) assert.equal(hook('claude', 'Stop', { ...handler('command'), [key]: 'PRIVATE' }).state, 'issue');
  for (const event of ['Stop','SessionStart','Notification']) assert.equal(hook('claude', event, { ...handler('command'), if: 'Bash(PRIVATE_*)' }).reason, 'CONDITION_EVENT_UNSUPPORTED');
  for (const event of ['PreToolUse','PostToolUse','PostToolUseFailure','PermissionRequest','PermissionDenied']) {
    const row = hook('claude', event, { ...handler('command'), if: 'Bash($(PRIVATE_COMMAND))' });
    assert.equal(row.reason, 'CONDITION_UNCHECKED'); assert(!JSON.stringify(row).includes('PRIVATE'));
  }
  for (const condition of ['',7,[]]) assert.equal(hook('claude', 'PreToolUse', { ...handler('command'), if: condition }).state, 'issue');
  assert.equal(hook('claude', 'Stop', { ...handler('command'), args: ['PRIVATE_ARG'] }).state, 'static-ok');
  assert.equal(hook('claude', 'Stop', { ...handler('command'), args: [7] }).state, 'issue');
  assert.equal(hook('claude', 'Stop', { ...handler('prompt'), model: 7 }).state, 'issue');
  assert.equal(hook('claude', 'Stop', { ...handler('agent'), model: 'PRIVATE_MODEL' }).state, 'static-ok');
});

test('explicit per-file hook switches are typed and reported without resolving layers or hiding invalid handlers', () => {
  for (const disabled of [true,false,'false',0,null]) {
    const rows = project('claude', 'claude-settings-local', JSON.stringify({ disableAllHooks: disabled }));
    const row = rows.find(row => row.location?.section === 'disableAllHooks');
    assert.equal(row.state, typeof disabled !== 'boolean' ? 'issue' : disabled ? 'unchecked' : 'static-ok');
    if (typeof disabled === 'boolean') assert.equal(row.configuredEnabled, !disabled);
  }
  assert.equal(project('claude', 'claude-mcp', '{"disableAllHooks":true}').length, 1, 'MCP-only file is not a hook switch location');
  const disabled = project('claude', 'claude-settings', '{"disableAllHooks":true,"hooks":{"Stop":[{"hooks":[{"type":"command","command":7}]}]}}');
  assert(disabled.some(row => row.reason === 'HOOKS_DISABLED_IN_FILE')); assert(disabled.some(row => row.state === 'issue'));
  for (const [input, reason] of [
    ['[features]\nhooks=false','HOOKS_DISABLED_IN_FILE'],
    ['[features]\nhooks=true','STRUCTURE_ONLY'],
    ['[features]\ncodex_hooks=true','HOOKS_ALIAS_UNCHECKED'],
    ['[features]\nhooks=true\ncodex_hooks=false','HOOKS_PRECEDENCE_UNCHECKED']
  ]) assert.equal(project('codex', 'codex-config', input)[0].reason, reason);
  for (const input of ['features=7','[features]\nhooks="false"','[features]\ncodex_hooks=7']) assert.equal(project('codex', 'codex-config', input)[0].state, 'issue');
});

test('MCP, hook and skill override ordinals identify a parsed entry without returning keys, names, commands or paths', () => {
  const rows = project('claude', 'claude-settings', JSON.stringify({ hooks: {
    PRIVATE_FIRST: [], Stop: [{ hooks: [handler('command'),null] },{ hooks: [handler('mcp_tool')] }]
  } }));
  assert.deepEqual(rows.map(row => row.location), [
    { section: 'hooks', event: 1 },
    { section: 'hooks', event: 2, group: 1, handler: 1 },
    { section: 'hooks', event: 2, group: 1, handler: 2 },
    { section: 'hooks', event: 2, group: 2, handler: 1 }
  ]);
  const servers = project('claude', 'claude-mcp', '{"mcpServers":{"PRIVATE_A":null,"PRIVATE_B":{"command":"PRIVATE_COMMAND"}}}');
  assert.deepEqual(servers.map(row => row.location), [{ section: 'mcpServers', entry: 1 },{ section: 'mcpServers', entry: 2 }]);
  const overrides = project('codex', 'codex-config', 'skills.config=[{path="PRIVATE_PATH",enabled=false},{path=7}]').filter(row => row.kind === 'skill-overrides');
  assert.deepEqual(overrides.map(row => row.location), [{ section: 'skills.config', entry: 1 },{ section: 'skills.config', entry: 2 }]);
  assert.deepEqual(overrides.map(row => row.state), ['unchecked','issue']);
  for (const result of [rows,servers,overrides]) assert(!JSON.stringify(result).includes('PRIVATE'));
  const skill = project('codex', 'skill', '---\nname: PRIVATE_SKILL\ndescription: PRIVATE_DESCRIPTION\n---');
  assert.deepEqual(skill[0].location, { section: 'frontmatter' }); assert(!JSON.stringify(skill).includes('PRIVATE'));
  const bounded = project('codex', 'codex-config', 'skills.config=[' + Array(65).fill('{path="PRIVATE_PATH"}').join(',') + ']').filter(row => row.kind === 'skill-overrides');
  assert.equal(bounded.length, 65); assert.equal(bounded.at(-1).reason, 'ENTRY_LIMIT'); assert.equal(bounded.at(-1).omitted, 1);
});

test('integrated synthetic scan retains read-only/no-execution boundaries, redaction and issue-first summaries', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-event-synthetic-')); t.after(() => { t.mock.restoreAll(); remove(root); });
  fs.mkdirSync(path.join(root, '.claude'));
  const target = path.join(root, '.claude/settings.json');
  const source = JSON.stringify({ disableAllHooks: true, hooks: { SessionStart: [{ hooks: [handler('http')] }], Stop: [{ hooks: [{ ...handler('command'), if: 'PRIVATE_CONDITION' }] }] } });
  fs.writeFileSync(target, source);
  const original = fs.readFileSync(target);
  for (const name of ['node:http','node:https']) for (const method of ['request','get']) t.mock.method(require(name), method, () => { throw Error('NETWORK_FORBIDDEN'); });
  for (const method of ['spawn','spawnSync','exec','execFile','fork']) t.mock.method(require('node:child_process'), method, () => { throw Error('PROCESS_FORBIDDEN'); });
  for (const method of ['writeFileSync','appendFileSync','renameSync','unlinkSync','mkdirSync','rmSync']) t.mock.method(fs, method, () => { throw Error('WRITE_FORBIDDEN'); });
  const result = scanConfigHealth({ project: root }), serialized = JSON.stringify(result);
  assert.equal(result.summary.hooks.state, 'issue'); assert.equal(result.state, 'unchecked'); assert.equal(result.runtimeVerified, false);
  assert(!serialized.includes('PRIVATE')); assert(!serialized.includes(root)); assert.equal(result.audit.filesRead, 1);
  assert.deepEqual(fs.readFileSync(target), original);
});
