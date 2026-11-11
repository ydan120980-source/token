'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ConfigManager } = require('../../src/quota/config-manager');
const syntax = require('../../src/m1/config-health-syntax'), { remove } = require('./temp');

function fixture(t, relative, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-repair-synthetic-')), file = path.join(root, relative), backup = path.join(root, 'backups');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, source); t.after(() => remove(root));
  const manager = new ConfigManager(backup, { isEncryptionAvailable() { throw Error('PREVIEW_MUST_NOT_USE_VAULT'); } });
  return { root, file, source, backup, manager };
}

for (const agent of ['codex','claude']) test(agent + ' MCP can repair one invalid entry while preserving a different invalid entry', t => {
  const codex = agent === 'codex', key = codex ? 'mcp_servers' : 'mcpServers', relative = codex ? '.codex/config.toml' : '.mcp.json';
  const value = { [key]: { first: { command: 'fixture', args: [7], env: { TOKEN: 'SYNTHETIC_KEEP' } }, second: { command: 'fixture', args: [8] } }, unrelated: 'keep' };
  const source = codex ? 'unrelated="keep"\n[mcp_servers.first]\ncommand="fixture"\nargs=[7]\nenv={TOKEN="SYNTHETIC_KEEP"}\n[mcp_servers.second]\ncommand="fixture"\nargs=[8]\n' : JSON.stringify(value);
  const f = fixture(t, relative, source), view = f.manager.list(f.root,agent,'project','mcp');
  const preview = f.manager.prepare(view.id,{action:'edit',row:0,patch:{args:['fixed']}});
  assert(preview.id); assert.equal(fs.readFileSync(f.file,'utf8'),source); assert(!fs.existsSync(f.backup));
  const bytes = f.manager.draft.writes[0].bytes.toString('utf8'), next = codex ? syntax.toml(bytes) : JSON.parse(bytes);
  assert.deepEqual(next[key].first.args,['fixed']); assert.deepEqual(next[key].second,codex ? syntax.toml(source)[key].second : value[key].second);
  assert.equal(next[key].first.env.TOKEN,'SYNTHETIC_KEEP'); assert.equal(next.unrelated,'keep');
  assert.throws(() => f.manager.prepare(view.id,{action:'edit',row:0,patch:{command:'changed-but-args-still-invalid'}}), /CONFIG_EDIT_INVALID/);
});

for (const agent of ['codex','claude']) test(agent + ' hook repair validates the chosen handler with its original event and group', t => {
  const relative = agent === 'codex' ? '.codex/hooks.json' : '.claude/settings.local.json';
  const value = { hooks: { PreToolUse: [{ matcher: 'fixture', hooks: [{ type: 'command', command: '' }, { type: 'command', command: '', timeout: 8 }] }], Stop: [{ hooks: [{ type: 'command', command: '' }] }] }, unrelated: 9 };
  const f = fixture(t,relative,JSON.stringify(value)), view = f.manager.list(f.root,agent,'project','hooks');
  f.manager.prepare(view.id,{action:'edit',row:1,patch:{command:'fixed-second-handler'}});
  const next = JSON.parse(f.manager.draft.writes[0].bytes);
  assert.equal(next.hooks.PreToolUse[0].hooks[1].command,'fixed-second-handler');
  assert.deepEqual(next.hooks.PreToolUse[0].hooks[0],value.hooks.PreToolUse[0].hooks[0]); assert.deepEqual(next.hooks.Stop,value.hooks.Stop);
  assert.equal(next.hooks.PreToolUse[0].matcher,'fixture'); assert.equal(next.unrelated,9);
  assert.equal(fs.readFileSync(f.file,'utf8'),f.source); assert(!fs.existsSync(f.backup));
  assert.throws(() => f.manager.prepare(view.id,{action:'edit',row:1,patch:{command:'fixed',timeout:-1}}), /CONFIG_EDIT_INVALID/);
});

test('Claude handler repair retains event compatibility and rejects an invalid parent group', t => {
  const f = fixture(t,'.claude/settings.local.json',JSON.stringify({hooks:{SessionStart:[{hooks:[{type:'http',url:'https://fixture.invalid'}]}]}}));
  let view = f.manager.list(f.root,'claude','project','hooks');
  assert.throws(() => f.manager.prepare(view.id,{action:'edit',row:0,patch:{url:'https://new-fixture.invalid'}}), /CONFIG_EDIT_INVALID/);
  fs.writeFileSync(f.file,JSON.stringify({hooks:{PreToolUse:[{matcher:7,hooks:[{type:'command',command:''}]}]}}));
  view = f.manager.list(f.root,'claude','project','hooks');
  assert.throws(() => f.manager.prepare(view.id,{action:'edit',row:0,patch:{command:'fixed'}}), /CONFIG_EDIT_INVALID/);
  assert(!fs.existsSync(f.backup));
});

test('a selected handler beyond whole-file static scan limits must still be validated', t => {
  const handlers = Array.from({length:128},() => ({type:'command',command:'fixture'})); handlers[127].timeout = -1;
  const f = fixture(t,'.claude/settings.local.json',JSON.stringify({hooks:{PreToolUse:[{hooks:handlers}]}}));
  const view = f.manager.list(f.root,'claude','project','hooks'); assert.equal(view.rows.length,128);
  assert.throws(() => f.manager.prepare(view.id,{action:'edit',row:127,patch:{command:'still-invalid'}}), /CONFIG_EDIT_INVALID/);
  const preview = f.manager.prepare(view.id,{action:'edit',row:127,patch:{timeout:10}}); assert(preview.id);
  assert.equal(JSON.parse(f.manager.draft.writes[0].bytes).hooks.PreToolUse[0].hooks[127].timeout,10);
  assert.equal(fs.readFileSync(f.file,'utf8'),f.source); assert(!fs.existsSync(f.backup));
});
