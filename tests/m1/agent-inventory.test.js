'use strict';
// The local Agent admin against a synthetic home: what it finds, what it says is wrong, what it never returns, and
// that changes go through preview, backup and restore (owner 2026-11-03, docs/m2/UI-OWNER-FIVE-BATCHES-20261103.md).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { scanInventory } = require('../../src/m1/agent-inventory');
const { ConfigManager } = require('../../src/quota/config-manager');
const { AgentInventoryService } = require('../../src/quota/agent-inventory-service');

const SECRET = 'sentinel-secret-value-123';
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
function home(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-inventory-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'); write(path.join(bin, 'node.exe'), ''); write(path.join(bin, 'node'), '');
  write(path.join(root, '.codex/config.toml'), [
    '[mcp_servers.ok-server]', 'command = "node"', 'args = ["server.js", "--token=' + SECRET + '"]', '',
    '[mcp_servers.missing-command]', 'command = "not-installed-tool"', '',
    '[mcp_servers.off]', 'command = "node"', 'enabled = false', '',
    '[mcp_servers.remote]', 'url = "http://example.com/mcp?api_key=' + SECRET + '"', '',
    '[mcp_servers.with-env]', 'command = "node"', 'env = { API_TOKEN = "' + SECRET + '", OTHER = "${NOT_SET_HERE}" }', '',
    '[plugins."good@market"]', 'enabled = false', '',
  ].join('\n'));
  write(path.join(root, '.codex/auth.json'), JSON.stringify({ token: SECRET }));
  write(path.join(root, '.codex/AGENTS.md'), 'x'.repeat(40000));
  write(path.join(root, '.codex/plugins/cache/market/good/1.0.0/plugin.json'), JSON.stringify({ name: 'good', version: '1.0.0', description: '好插件' }));
  write(path.join(root, '.codex/plugins/cache/market/good/1.0.0/skills/inner/SKILL.md'), '---\nname: inner\ndescription: d\n---\n');
  write(path.join(root, '.agents/skills/fine/SKILL.md'), '---\nname: fine\ndescription: 能用\n---\n正文 ' + SECRET);
  write(path.join(root, '.agents/skills/no-description/SKILL.md'), '---\nname: no-description\n---\n');
  write(path.join(root, '.agents/skills/no-front/SKILL.md'), '没有前言');
  fs.mkdirSync(path.join(root, '.agents/skills/empty-dir'));
  write(path.join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'not-installed-tool --flag ' + SECRET }] }] } }));
  write(path.join(root, '.claude/settings.json'), JSON.stringify({ enabledPlugins: { 'off@market': false }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node stop.js' }] }] } }));
  write(path.join(root, '.claude.json'), JSON.stringify({ mcpServers: { hidden: { command: SECRET } }, oauthAccount: SECRET }));
  write(path.join(root, '.claude/.credentials.json'), SECRET);
  write(path.join(root, '.claude/CLAUDE.md'), '# 指令');
  write(path.join(root, '.claude/plugins/installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'off@market': [{ scope: 'user', installPath: path.join(root, '.claude/plugins/cache/market/off/2.0.0'), version: '2.0.0', lastUpdated: '2026-10-01T00:00:00Z' }], 'gone@market': [{ scope: 'user', installPath: path.join(root, '.claude/plugins/cache/market/gone/1.0.0'), version: '1.0.0' }], 'outside@market': [{ scope: 'user', installPath: path.join(root, 'elsewhere'), version: '1.0.0' }] } }));
  write(path.join(root, '.claude/plugins/cache/market/off/2.0.0/.claude-plugin/plugin.json'), JSON.stringify({ name: 'off', description: '插件' }));
  write(path.join(root, '.claude/plugins/cache/market/off/2.0.0/skills/a/SKILL.md'), '---\nname: a\ndescription: d\n---\n');
  write(path.join(root, '.claude/plugins/cache/market/off/2.0.0/.mcp.json'), JSON.stringify({ mcpServers: { inner: { command: 'x' } } }));
  write(path.join(root, '.gemini/settings.json'), '// 注释\n' + JSON.stringify({ mcpServers: { 'gemini-server': { command: 'node' } } }));
  write(path.join(root, '.gemini/extensions/ext-one/gemini-extension.json'), JSON.stringify({ name: 'ext-one', version: '0.1.0', mcpServers: { a: {} } }));
  write(path.join(root, '.gemini/GEMINI.md'), '# g');
  write(path.join(root, '.config/opencode/opencode.json'), JSON.stringify({ mcp: { 'oc-local': { type: 'local', command: ['node', 'a.js'], enabled: false }, 'oc-remote': { type: 'remote', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ' + SECRET } } }, plugin: ['some-plugin'] }));
  const project = path.join(root, 'work', 'my-app');
  write(path.join(project, '.mcp.json'), JSON.stringify({ mcpServers: { 'project-mcp': { command: 'node' }, broken: { command: 'node', url: 'https://x' } } }));
  write(path.join(project, '.claude/settings.local.json'), JSON.stringify({ disabledMcpjsonServers: ['project-mcp'] }));
  write(path.join(project, 'AGENTS.md'), '# 项目');
  write(path.join(project, 'CLAUDE.md'), '# 项目');
  return { root, project, env: { path: bin, pathExt: '.EXE', names: ['PATH'] } };
}
const scan = fixture => scanInventory({ home: fixture.root, projects: [fixture.project], env: fixture.env });
const find = (result, agent, kind, name) => result.items.find(item => item.agent === agent && item.kind === kind && item.name === name);

test('finds what each Agent has installed, across user and project', t => {
  const fixture = home(t), result = scan(fixture);
  assert.deepEqual(result.agents.map(agent => [agent.id, agent.found]), [['codex', true], ['claude', true], ['gemini', true], ['opencode', true]]);
  assert.equal(find(result, 'codex', 'mcp', 'ok-server').enabled, true);
  assert.equal(find(result, 'codex', 'mcp', 'off').enabled, false);
  assert.equal(find(result, 'codex', 'plugin', 'good@market').enabled, false);
  assert.equal(find(result, 'claude', 'plugin', 'off@market').enabled, false);
  assert.equal(find(result, 'claude', 'mcp', 'project-mcp').enabled, false, 'the deny list counts');
  assert.equal(find(result, 'claude', 'mcp', 'project-mcp').project, 'my-app');
  assert(find(result, 'gemini', 'mcp', 'gemini-server'), 'commented settings still parse');
  assert(find(result, 'gemini', 'plugin', 'ext-one'));
  assert.equal(find(result, 'opencode', 'mcp', 'oc-local').enabled, false);
  assert(find(result, 'opencode', 'plugin', 'some-plugin'));
  assert(find(result, 'codex', 'instruction', 'AGENTS.md'));
  assert(find(result, 'codex', 'instruction', 'AGENTS.md · my-app'));
  assert.match(result.notes.find(note => note.agent === 'claude').text, /没有读取/);
});

test('says what is wrong, in plain words, with what to do', t => {
  const fixture = home(t), result = scan(fixture), text = item => item.problems.map(entry => entry.text).join('；');
  assert.match(text(find(result, 'codex', 'mcp', 'missing-command')), /找不到命令 not-installed-tool/);
  assert.equal(find(result, 'codex', 'mcp', 'missing-command').health, 'warn');
  assert.match(text(find(result, 'codex', 'mcp', 'ok-server')), /明文密钥/);
  const remote = text(find(result, 'codex', 'mcp', 'remote')); assert.match(remote, /地址里好像带着密钥/); assert.match(remote, /没有加密/);
  const env = text(find(result, 'codex', 'mcp', 'with-env')); assert.match(env, /API_TOKEN 写了明文值/); assert.match(env, /NOT_SET_HERE 在本机没有设置/);
  assert.match(text(find(result, 'opencode', 'mcp', 'oc-remote')), /请求头 Authorization 写了明文值/);
  assert.equal(find(result, 'claude', 'mcp', 'broken').health, 'issue'); assert.match(text(find(result, 'claude', 'mcp', 'broken')), /命令和地址/);
  assert.equal(find(result, 'codex', 'skill', 'fine').health, 'ok');
  assert.match(text(find(result, 'codex', 'skill', 'no-description')), /description/);
  assert.equal(find(result, 'codex', 'skill', 'no-front').health, 'issue');
  assert.match(text(find(result, 'codex', 'skill', 'empty-dir')), /没有 SKILL\.md/);
  assert.match(text(find(result, 'codex', 'instruction', 'AGENTS.md')), /32 KB/);
  assert.equal(find(result, 'claude', 'plugin', 'gone@market').health, 'issue');
  assert.match(text(find(result, 'claude', 'plugin', 'outside@market')), /插件目录之外/);
  assert.match(text(result.items.find(item => item.kind === 'hook' && item.agent === 'codex')), /找不到 not-installed-tool/);
  for (const item of result.items) for (const entry of item.problems) if (entry.level === 'issue') assert.notEqual(entry.fix, undefined);
});

test('shows names and counts, never a value that may be a secret, and never reads authentication files', t => {
  const fixture = home(t), result = scan(fixture), text = JSON.stringify({ ...result, items: result.items.map(({ locator: _locator, ...item }) => item) });
  assert(!text.includes(SECRET));
  assert(!text.includes('hidden'), 'the mixed account file is not read');
  assert(!text.includes('auth.json')); assert(!text.includes('credentials'));
  const details = Object.fromEntries(find(result, 'codex', 'mcp', 'with-env').details.map(row => [row.label, row.value]));
  assert.equal(details['环境变量'], 'API_TOKEN、OTHER');
  assert.equal(Object.fromEntries(find(result, 'codex', 'mcp', 'remote').details.map(row => [row.label, row.value]))['地址'], 'example.com');
  assert.equal(Object.fromEntries(find(result, 'codex', 'mcp', 'ok-server').details.map(row => [row.label, row.value]))['参数'], '2 个');
  const plugin = Object.fromEntries(find(result, 'claude', 'plugin', 'off@market').details.map(row => [row.label, row.value]));
  assert.match(plugin.Skills, /1 个：a/); assert.equal(plugin.MCP, 'inner');
});

test('with nothing installed, finds nothing and fails on nothing', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-inventory-empty-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = scanInventory({ home: root, env: { path: '', names: [] } });
  assert.deepEqual(result.items, []); assert(result.agents.every(agent => !agent.found));
});

const vault = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString() };
function service(t, fixture) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-inventory-data-')); t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  return new AgentInventoryService({ dataDir, home: fixture.root, environment: () => fixture.env, manager: new ConfigManager(path.join(dataDir, 'backups'), vault), choose: async () => fixture.project, run: async request => scanInventory(request) });
}
const itemOf = (value, agent, kind, name) => value.state().inventory.items.find(item => item.agent === agent && item.kind === kind && item.name === name);

test('a check runs only when asked, remembers chosen projects, and sends no paths to the page', async t => {
  const fixture = home(t), value = service(t, fixture);
  assert.equal(value.state().inventory, null, 'nothing is read before the person asks');
  await value.addProject(); await value.check();
  assert.deepEqual(value.state().projects, [{ id: 0, name: 'my-app' }]);
  assert(itemOf(value, 'claude', 'mcp', 'project-mcp'));
  const sent = JSON.stringify(value.state()); assert(!sent.includes(fixture.root.replaceAll('\\', '\\\\')), 'no absolute path');
  // A second service with the same data directory still knows the project.
  const again = new AgentInventoryService({ dataDir: path.dirname(value.file), home: fixture.root, environment: () => fixture.env, manager: value.manager, choose: async () => null, run: async request => scanInventory(request) });
  assert.deepEqual(again.state().projects, [{ id: 0, name: 'my-app' }]);
  await value.removeProject(0); assert.deepEqual(value.state().projects, []);
});

test('turning something off is a preview first, writes on apply, and can be restored later', async t => {
  const fixture = home(t), value = service(t, fixture); await value.check();
  const file = path.join(fixture.root, '.codex/config.toml'), before = fs.readFileSync(file);
  const { preview } = value.preview({ id: itemOf(value, 'codex', 'mcp', 'ok-server').id, action: 'toggle', enabled: false });
  assert.match(preview.summary, /停用/); assert.deepEqual(fs.readFileSync(file), before, 'a preview writes nothing');
  value.apply(preview.id); assert.notDeepEqual(fs.readFileSync(file), before);
  await value.check(); assert.equal(itemOf(value, 'codex', 'mcp', 'ok-server').enabled, false);
  const { records } = value.history(); assert.equal(records.length, 1); assert.equal(records[0].restorable, true); assert.match(records[0].summary, /停用/);
  assert(!JSON.stringify(records).includes(SECRET), 'the list holds no config');
  // A new manager, as after a restart, can still restore it.
  value.manager = new ConfigManager(value.manager.backupRoot, vault);
  value.restore(records[0].id); assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(value.history().records[0].restorable, false, 'done once');
});

test('a plugin, a Skill and a whole Hook layer can be switched; an instruction file can be read and edited', async t => {
  const fixture = home(t), value = service(t, fixture); await value.check();
  const plugin = value.preview({ id: itemOf(value, 'claude', 'plugin', 'off@market').id, action: 'toggle', enabled: true }).preview; value.apply(plugin.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.root, '.claude/settings.json'))).enabledPlugins['off@market'], true);
  await value.check();
  const skill = value.preview({ id: itemOf(value, 'codex', 'skill', 'fine').id, action: 'toggle', enabled: false }).preview; value.apply(skill.id);
  assert(!fs.existsSync(path.join(fixture.root, '.agents/skills/fine'))); assert(fs.existsSync(path.join(fixture.root, '.agent-usage/disabled-skills/codex/fine/SKILL.md')));
  await value.check(); assert.equal(itemOf(value, 'codex', 'skill', 'fine').enabled, false);
  const hook = value.state().inventory.items.find(item => item.kind === 'hook' && item.agent === 'claude');
  value.apply(value.preview({ id: hook.id, action: 'toggle', enabled: false }).preview.id);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.root, '.claude/settings.json'))).disableAllHooks, true);
  await value.check();
  const instruction = itemOf(value, 'claude', 'instruction', 'CLAUDE.md'), read = value.instruction(instruction.id);
  assert.equal(read.text, '# 指令');
  const edit = value.preview({ id: instruction.id, action: 'text', text: '# 改过', revision: read.revision }).preview;
  assert.equal(fs.readFileSync(path.join(fixture.root, '.claude/CLAUDE.md'), 'utf8'), '# 指令', 'a preview writes nothing');
  value.apply(edit.id); assert.equal(fs.readFileSync(path.join(fixture.root, '.claude/CLAUDE.md'), 'utf8'), '# 改过');
  assert.throws(() => value.preview({ id: instruction.id, action: 'text', text: 'x', revision: read.revision }), /CONFIG_CHANGED/, 'changed since it was read');
});

test('a server can be copied to another Agent without overwriting, and Gemini and OpenCode stay read-only', async t => {
  const fixture = home(t), value = service(t, fixture); await value.addProject(); await value.check();
  const from = value.state().inventory.items.find(item => item.agent === 'claude' && item.name === 'project-mcp');
  const copy = value.preview({ id: from.id, action: 'copy', to: 'codex' }).preview; assert.match(copy.summary, /把 MCP project-mcp 加到 Codex/);
  value.apply(copy.id);
  assert.match(fs.readFileSync(path.join(fixture.project, '.codex/config.toml'), 'utf8'), /project-mcp/);
  await value.check();
  const already = itemOf(value, 'codex', 'mcp', 'project-mcp');
  assert.throws(() => value.preview({ id: from.id, action: 'copy', to: 'codex' }), /CONFIG_IMPORT_COLLISION/, 'never over one it has'); assert(already);
  const opencode = itemOf(value, 'opencode', 'mcp', 'oc-local'); assert.deepEqual(opencode.actions, []);
  assert.throws(() => value.preview({ id: opencode.id, action: 'toggle', enabled: true }), /INVENTORY_ACTION_UNSUPPORTED/);
  assert.throws(() => value.preview({ id: 'nothing', action: 'toggle', enabled: true }), /INVENTORY_ITEM_UNKNOWN/);
});

const skillHome = (t, files) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-skills-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const marker of ['.codex', '.claude', '.gemini', '.config/opencode']) fs.mkdirSync(path.join(root, marker), { recursive: true });
  for (const [file, text] of Object.entries(files)) { if (file.endsWith('/')) fs.mkdirSync(path.join(root, file), { recursive: true }); else write(path.join(root, file), text); }
  return { root, project: path.join(root, 'none'), env: { path: '', names: [] } };
};
const named = (result, agent, name) => result.items.filter(item => item.agent === agent && item.kind === 'skill' && item.name === name);
const skillScan = fixture => scanInventory({ home: fixture.root, env: fixture.env });

test('a Skill is judged by what its own Agent does with it', t => {
  const nested = '---\nname: x\ndescription: d\nmetadata:\n  a: b\nallowed-tools:\n  - Read\n---\n', bare = '没有前言';
  const fixture = skillHome(t, { '.agents/skills/nested/SKILL.md': nested, '.agents/skills/bare/SKILL.md': bare, '.claude/skills/nested/SKILL.md': nested.replace('name: x', 'name: y'), '.claude/skills/bare/SKILL.md': bare, '.claude/skills/colon/SKILL.md': '---\nname: colon\ndescription: Use when: asked\n---\n', '.gemini/skills/bare/SKILL.md': bare, '.gemini/skills/colon/SKILL.md': '---\nname: colon\ndescription: Use when: asked\n---\n', '.config/opencode/skills/bare/SKILL.md': bare, '.config/opencode/skills/other/SKILL.md': '---\nname: elsewhere\ndescription: d\n---\n' });
  const result = skillScan(fixture);
  assert.equal(named(result, 'codex', 'x')[0].health, 'ok', 'a nested map and a list are fine');
  assert.equal(named(result, 'claude', 'y')[0].health, 'ok');
  assert.equal(named(result, 'codex', 'bare')[0].health, 'issue', 'Codex requires the header');
  assert.equal(named(result, 'gemini', 'bare')[0].health, 'issue'); assert.equal(named(result, 'opencode', 'bare')[0].health, 'issue');
  assert.equal(named(result, 'claude', 'bare')[0].health, 'unknown', 'Claude Code loads it without a header');
  assert.match(named(result, 'claude', 'bare')[0].problems[0].text, /用目录名和正文第一行代替/);
  assert.equal(named(result, 'claude', 'colon')[0].health, 'unknown', 'a doubt, not a fault'); assert.match(named(result, 'claude', 'colon')[0].problems[0].fix, /引号/);
  assert.equal(named(result, 'gemini', 'colon')[0].health, 'ok', 'Gemini has its own fallback for it');
  assert.match(named(result, 'opencode', 'elsewhere')[0].problems[0].text, /和目录名不一样/);
  assert.equal(named(result, 'codex', 'x')[0].details.find(row => row.label === '允许的工具').value, '1 个');
});
test('a folder holding Skills is not a broken Skill', t => {
  const skill = name => '---\nname: ' + name + '\ndescription: d\n---\n';
  const fixture = skillHome(t, { '.agents/skills/group/inner-a/SKILL.md': skill('inner-a'), '.agents/skills/group/deep/inner-b/SKILL.md': skill('inner-b'), '.agents/skills/plain/': '', '.gemini/skills/group/inner/SKILL.md': skill('inner'), '.claude/skills/group/inner/SKILL.md': skill('inner') });
  const result = skillScan(fixture);
  assert.equal(named(result, 'codex', 'group').length, 0, 'Codex scans below the first level');
  assert.equal(named(result, 'codex', 'inner-a')[0].health, 'ok'); assert.equal(named(result, 'codex', 'inner-b')[0].health, 'ok');
  assert.deepEqual(named(result, 'codex', 'inner-a')[0].actions, [], 'the switch only moves what sits directly in the directory');
  assert.equal(named(result, 'gemini', 'group')[0].health, 'warn'); assert.match(named(result, 'gemini', 'group')[0].problems[0].text, /不会读到/);
  assert.equal(named(result, 'claude', 'group')[0].health, 'unknown', 'not documented either way');
  assert.equal(named(result, 'codex', 'plain')[0].health, 'warn'); assert.match(named(result, 'codex', 'plain')[0].problems[0].text, /会跳过它/);
});
test('the same name says where the other one is, a stopped copy does not count, and only one is offered to stop', t => {
  const skill = '---\nname: twin\ndescription: d\n---\n';
  const fixture = skillHome(t, { '.agents/skills/twin/SKILL.md': skill, '.codex/skills/twin/SKILL.md': skill, '.agent-usage/disabled-skills/claude/solo/SKILL.md': '---\nname: solo\ndescription: d\n---\n', '.claude/skills/solo/SKILL.md': '---\nname: solo\ndescription: d\n---\n' });
  const twins = named(skillScan(fixture), 'codex', 'twin'), kept = twins.find(item => item.file.includes('.agents')), other = twins.find(item => item.file.includes('.codex'));
  assert.match(other.problems[0].text, /和 ~\/\.agents\/skills\/twin 同名/); assert.equal(other.problems[0].remedy, 'stop');
  assert.match(kept.problems[0].text, /\.codex\/skills\/twin/); assert.equal(kept.problems[0].remedy, 'none');
  assert.deepEqual(named(skillScan(fixture), 'claude', 'solo').map(item => item.health), ['ok', 'ok']);
});
test('every problem says what can be done about it', t => {
  const fixture = home(t), result = scan(fixture), allowed = new Set(['stop', 'stop-optional', 'manual', 'none']);
  for (const item of result.items) for (const entry of item.problems) { assert(allowed.has(entry.remedy), entry.text); if (entry.remedy === 'manual') assert(entry.fix, entry.text); }
  assert.equal(find(result, 'claude', 'plugin', 'gone@market').problems[0].remedy, 'stop');
  assert.equal(find(result, 'codex', 'mcp', 'missing-command').problems[0].remedy, 'stop-optional', 'the Agent may have another PATH: offered, not chosen');
  assert.equal(find(result, 'codex', 'mcp', 'with-env').problems[0].remedy, 'manual', 'a plaintext secret is the person\'s to move');
});

test('locating takes an id, never a path, and opening starts nothing', async t => {
  const fixture = home(t), value = service(t, fixture), calls = [];
  Object.assign(value, { reveal: file => calls.push(['reveal', file]), open: async file => { calls.push(['open', file]); return ''; }, copy: async file => calls.push(['copy', file]) });
  await value.check();
  const skill = itemOf(value, 'codex', 'skill', 'fine'), file = path.join(fixture.root, '.agents/skills/fine/SKILL.md');
  assert.equal(skill.openable, true);
  for (const action of ['reveal', 'open', 'copy']) await value.locate({ id: skill.id, action });
  assert.deepEqual(calls, [['reveal', file], ['open', file], ['copy', file]]);
  await assert.rejects(value.locate({ id: file, action: 'reveal' }), /INVENTORY_ITEM_UNKNOWN/, 'a path is not an id');
  await assert.rejects(value.locate({ id: skill.id, action: 'run' }), /INVENTORY_ACTION_UNSUPPORTED/);
  const folder = itemOf(value, 'codex', 'skill', 'empty-dir'); assert.equal(folder.openable, false);
  await assert.rejects(value.locate({ id: folder.id, action: 'open' }), /INVENTORY_OPEN_REFUSED/, 'a directory is shown, not opened');
  const plugin = itemOf(value, 'codex', 'plugin', 'good@market'); await value.locate({ id: plugin.id, action: 'reveal' });
  // A file that turned into a program since the check is still only a name with the wrong extension: refused.
  value.locators.set('forged', { ...value.item(skill.id), file: path.join(fixture.root, '.codex/auth.json') });
  await assert.rejects(value.locate({ id: 'forged', action: 'open' }), /INVENTORY_OPEN_REFUSED/, 'an authentication file never opens');
  value.locators.set('tool', { ...value.item(skill.id), file: path.join(fixture.root, 'bin/node.exe') });
  await assert.rejects(value.locate({ id: 'tool', action: 'open' }), /INVENTORY_OPEN_REFUSED/, 'no program starts');
  fs.rmSync(file); await assert.rejects(value.locate({ id: skill.id, action: 'reveal' }), /INVENTORY_FILE_MISSING/);
});

test('one click lists first, stops only what was chosen, keeps a record of each, and goes back in one step', async t => {
  const fixture = home(t), value = service(t, fixture); await value.check();
  const config = path.join(fixture.root, '.codex/config.toml'), before = fs.readFileSync(config), settings = fs.readFileSync(path.join(fixture.root, '.claude/settings.json'));
  const plan = value.plan(), row = name => plan.rows.find(entry => entry.name === name);
  assert.deepEqual(fs.readFileSync(config), before, 'a plan writes nothing');
  assert(fs.existsSync(path.join(fixture.root, '.agents/skills/no-front/SKILL.md')), 'and moves nothing');
  assert.equal(row('no-front').chosen, true); assert.equal(row('gone@market').chosen, true);
  assert.equal(row('missing-command').chosen, false, 'offered, not chosen');
  assert.equal(row('off'), undefined, 'what is already off is not offered');
  assert(plan.manual.some(entry => entry.name === 'with-env' && /环境变量/.test(entry.fix)), 'what needs the person says what to do');
  assert(plan.manual.some(entry => entry.name === 'oc-remote'), 'and OpenCode MCP stays by hand');
  assert(!JSON.stringify(plan).includes(SECRET)); assert(!JSON.stringify(plan).includes(fixture.root.replaceAll('\\', '\\\\')), 'no absolute path');
  const chosen = plan.rows.filter(entry => entry.chosen).map(entry => entry.id), done = value.repair(chosen);
  assert.deepEqual(done.failed, []); assert.equal(done.done.length, chosen.length); assert.equal(done.state.repaired, chosen.length);
  assert(!fs.existsSync(path.join(fixture.root, '.agents/skills/no-front'))); assert(fs.existsSync(path.join(fixture.root, '.agent-usage/disabled-skills/codex/no-front/SKILL.md')), 'moved, not deleted');
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture.root, '.claude/settings.json'))).enabledPlugins['gone@market'], false);
  assert.deepEqual(fs.readFileSync(config).includes('missing-command') && fs.readFileSync(config), before, 'what was not chosen is untouched');
  assert(value.history().records.length >= chosen.length, 'each change has its record');
  await value.check(); assert.equal(value.plan().rows.find(entry => entry.name === 'no-front'), undefined, 'done once');
  const back = value.undoRepair(); assert.equal(back.left, 0); assert.equal(back.restored, chosen.length); assert.equal(back.state.repaired, 0);
  assert(fs.existsSync(path.join(fixture.root, '.agents/skills/no-front/SKILL.md'))); assert.deepEqual(fs.readFileSync(path.join(fixture.root, '.claude/settings.json')), settings);
});
test('a Skill of any Agent can be stopped, from any directory it reads, and one of two twins goes', async t => {
  const skill = name => '---\nname: ' + name + '\ndescription: d\n---\n';
  const fixture = skillHome(t, { '.gemini/skills/one/SKILL.md': skill('one'), '.config/opencode/skills/two/SKILL.md': skill('two'), '.agents/skills/twin/SKILL.md': skill('twin'), '.codex/skills/twin/SKILL.md': skill('twin') });
  const value = service(t, fixture); await value.check();
  value.apply(value.preview({ id: itemOf(value, 'gemini', 'skill', 'one').id, action: 'toggle', enabled: false }).preview.id);
  assert(fs.existsSync(path.join(fixture.root, '.agent-usage/disabled-skills/gemini/one/SKILL.md')));
  value.apply(value.preview({ id: itemOf(value, 'opencode', 'skill', 'two').id, action: 'toggle', enabled: false }).preview.id);
  assert(fs.existsSync(path.join(fixture.root, '.agent-usage/disabled-skills/opencode/two/SKILL.md')));
  await value.check();
  assert.equal(itemOf(value, 'gemini', 'skill', 'one').enabled, false, 'still listed, as stopped');
  value.apply(value.preview({ id: itemOf(value, 'gemini', 'skill', 'one').id, action: 'toggle', enabled: true }).preview.id);
  assert(fs.existsSync(path.join(fixture.root, '.gemini/skills/one/SKILL.md')), 'and comes back');
  await value.check();
  const plan = value.plan(); assert.equal(plan.rows.length, 1); assert.match(plan.rows[0].file, /\.codex\/skills\/twin/, 'the old directory\'s copy');
  value.repair([plan.rows[0].id]);
  assert(!fs.existsSync(path.join(fixture.root, '.codex/skills/twin'))); assert(fs.existsSync(path.join(fixture.root, '.agents/skills/twin/SKILL.md')));
  value.undoRepair(); assert(fs.existsSync(path.join(fixture.root, '.codex/skills/twin/SKILL.md')), 'restored to where it was');
});

test('use is counted from a session record: names and counts only', async t => {
  const { toolUse } = require('../../src/m1/transcript');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-use-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = '11111111-2222-4333-8444-555555555555', file = path.join(root, 'projects', 'p', id + '.jsonl');
  const tool = (index, name, input) => JSON.stringify({ type: 'assistant', sessionId: id, uuid: 'a' + index, timestamp: '2026-11-01T00:00:0' + index + 'Z', message: { id: 'm' + index, role: 'assistant', content: [{ type: 'tool_use', id: 't' + index, name, input }] } });
  write(file, [JSON.stringify({ type: 'user', sessionId: id, uuid: 'u', timestamp: '2026-11-01T00:00:00Z', message: { role: 'user', content: '${SECRET_PLACEHOLDER}' } }), tool(1, 'mcp__context7__query-docs', { q: SECRET }), tool(2, 'mcp__context7__query-docs', { q: SECRET }), tool(3, 'Skill', { skill: 'pdf', args: SECRET }), tool(4, 'Bash', { command: SECRET })].join('\n'));
  const { results } = await toolUse([{ key: 'k', agent: 'claude', id, cwd: null }], () => [path.join(root, 'projects')], null);
  assert.deepEqual(results, [{ key: 'k', mcp: { context7: 2 }, skill: { pdf: 1 } }]);
  assert(!JSON.stringify(results).includes(SECRET));
});
