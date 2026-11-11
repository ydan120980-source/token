'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { ConfigManager, read } = require('../../src/quota/config-manager');
const syntax = require('../../src/m1/config-health-syntax'), { remove } = require('./temp');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-managed-synthetic-')), home = path.join(root, 'selected'), backup = path.join(root, 'backups'); fs.mkdirSync(home); t.after(() => { t.mock.restoreAll(); remove(root); });
  const key = crypto.randomBytes(32), vault = { isEncryptionAvailable: () => true,
    encryptString(text) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const value = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv,cipher.getAuthTag(),value]); },
    decryptString(bytes) { const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12)); decipher.setAuthTag(bytes.subarray(12,28)); return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'); }
  };
  return { root, home, backup, vault, manager: new ConfigManager(backup, vault), write(relative, text, directory = home) { const file = path.join(directory, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; } };
}
test('MCP edit preserves private fields and unrelated TOML values, previews without writes, encrypts backup and restores original bytes', t => {
  const f = fixture(t), source = '# keep original on undo\nmodel="fixture-model"\n[mcp_servers.fixture]\ncommand="PRIVATE_COMMAND"\nargs=["PRIVATE_ARG"]\nenv={TOKEN="PRIVATE_TOKEN"}\n', file = f.write('.codex/config.toml', source);
  const view = f.manager.list(f.home, 'codex','home','mcp'); assert.equal(view.rows[0].name, 'fixture'); assert(!JSON.stringify(view).includes('PRIVATE')); assert(!JSON.stringify(view).includes(f.home));
  const preview = f.manager.prepare(view.id, { action: 'edit', row: 0, patch: { command: 'new-fixture-command' } }); assert.equal(fs.readFileSync(file, 'utf8'), source); assert(!fs.existsSync(f.backup));
  f.manager.apply(preview.id); const next = syntax.toml(fs.readFileSync(file,'utf8')); assert.equal(next.model, 'fixture-model'); assert.equal(next.mcp_servers.fixture.command, 'new-fixture-command'); assert.equal(next.mcp_servers.fixture.env.TOKEN, 'PRIVATE_TOKEN'); assert.deepEqual(next.mcp_servers.fixture.args, ['PRIVATE_ARG']);
  for (const name of fs.readdirSync(f.backup)) assert(!fs.readFileSync(path.join(f.backup,name)).includes(Buffer.from('PRIVATE_TOKEN')));
  f.manager.undo(f.home); assert.equal(fs.readFileSync(file,'utf8'), source);
});
test('concurrent edits and encryption unavailability reject writes, while stale/unknown fields cannot change unrelated data', t => {
  const f = fixture(t), source = '{"mcpServers":{"fixture":{"type":"stdio","command":"node"}},"unrelated":7}', file = f.write('.mcp.json', source);
  let view = f.manager.list(f.home, 'claude','project','mcp'); assert.throws(() => f.manager.prepare(view.id, { action: 'edit', row: 0, patch: { unrelated: 'injected' } }), /EDIT_INVALID/);
  let preview = f.manager.prepare(view.id, { action: 'edit', row: 0, patch: { command: 'fixture-new' } }); fs.writeFileSync(file, source + '\n'); assert.throws(() => f.manager.apply(preview.id), /CHANGED/); assert.equal(fs.readFileSync(file,'utf8'), source + '\n');
  view = f.manager.list(f.home, 'claude','project','mcp'); preview = f.manager.prepare(view.id, { action: 'toggle', row: 0, enabled: false }); f.vault.isEncryptionAvailable = () => false;
  assert.throws(() => f.manager.apply(preview.id), /BACKUP_UNAVAILABLE/); assert(!fs.existsSync(path.join(f.home,'.claude/settings.local.json')));
  assert.throws(() => f.manager.prepare('stale', { action: 'edit' }), /PREVIEW_STALE/);
});
test('Claude MCP and hook enable flags use their distinct per-file controls; undo does not overwrite newer edits', t => {
  const f = fixture(t); f.write('.mcp.json', '{"mcpServers":{"fixture":{"command":"node","type":"stdio"}}}'); const settings = f.write('.claude/settings.local.json','{"unrelated":7,"hooks":{"Stop":[{"hooks":[{"type":"command","command":"PRIVATE"}]}]}}');
  let view = f.manager.list(f.home,'claude','project','mcp'); let preview = f.manager.prepare(view.id,{ action:'toggle',row:0,enabled:false }); f.manager.apply(preview.id);
  assert.deepEqual(JSON.parse(fs.readFileSync(settings)).disabledMcpjsonServers,['fixture']); assert.equal(JSON.parse(fs.readFileSync(settings)).enabledMcpjsonServers,undefined); f.manager.undo(f.home);
  view = f.manager.list(f.home,'claude','project','hooks'); preview = f.manager.prepare(view.id,{ action:'toggle',enabled:false }); f.manager.apply(preview.id);
  const next = JSON.parse(fs.readFileSync(settings)); assert.equal(next.disableAllHooks,true); assert.equal(next.unrelated,7); assert.equal(next.hooks.Stop[0].hooks[0].command,'PRIVATE');
  fs.appendFileSync(settings,'\n'); assert.throws(() => f.manager.undo(f.home), /CHANGED/);
  assert.throws(() => f.manager.list(f.home,'claude','home','mcp'), /UNSUPPORTED/);
});
test('local configuration import merges only the chosen category, refuses collisions and retains selected-source revision', t => {
  const f = fixture(t), imported = f.write('mcp.json','{"mcpServers":{"fixture":{"type":"stdio","command":"node","env":{"TOKEN":"PRIVATE"}}},"auth":{"NEVER_COPY":true}}',f.root);
  let view = f.manager.list(f.home,'claude','project','mcp'), preview = f.manager.prepare(view.id,{ action:'import' },imported); f.manager.apply(preview.id);
  const target = path.join(f.home,'.mcp.json'), parsed = JSON.parse(fs.readFileSync(target)); assert.equal(parsed.auth,undefined); assert.equal(parsed.mcpServers.fixture.env.TOKEN,'PRIVATE');
  view = f.manager.list(f.home,'claude','project','mcp'); assert.throws(() => f.manager.prepare(view.id,{ action:'import' },imported), /COLLISION/);
  f.manager.undo(f.home); assert(!fs.existsSync(target));
  view = f.manager.list(f.home,'claude','project','mcp'); preview = f.manager.prepare(view.id,{ action:'import' },imported); fs.appendFileSync(imported,'\n'); assert.throws(() => f.manager.apply(preview.id), /CHANGED/); assert(!fs.existsSync(target));
});
test('Skill directory import, same-root disable/enable, metadata edit and undo preserve body and never execute copied scripts', t => {
  const f = fixture(t), dir = path.join(f.root,'fixture-skill'), original = '---\nname: fixture-skill\ndescription: fixture\n---\nPRIVATE_BODY\n';
  f.write('SKILL.md',original,dir); f.write('scripts/fixture.js','throw Error("MUST_NOT_EXECUTE")',dir);
  let view = f.manager.list(f.home,'codex','project','skills'), preview = f.manager.prepare(view.id,{ action:'import' },dir); f.manager.apply(preview.id);
  const destination = path.join(f.home,'.agents/skills/fixture-skill'); assert.equal(fs.readFileSync(path.join(destination,'SKILL.md'),'utf8'),original); assert(fs.existsSync(path.join(destination,'scripts/fixture.js')));
  view = f.manager.list(f.home,'codex','project','skills'); preview = f.manager.prepare(view.id,{ action:'toggle',row:0,enabled:false }); f.manager.apply(preview.id); assert(!fs.existsSync(destination));
  view = f.manager.list(f.home,'codex','project','skills'); assert.equal(view.rows[0].enabled,false); preview = f.manager.prepare(view.id,{ action:'toggle',row:0,enabled:true }); f.manager.apply(preview.id); assert(fs.existsSync(destination));
  view = f.manager.list(f.home,'codex','project','skills'); preview = f.manager.prepare(view.id,{ action:'edit',row:0,patch:{description:'updated fixture'} }); f.manager.apply(preview.id);
  assert.match(fs.readFileSync(path.join(destination,'SKILL.md'),'utf8'), /PRIVATE_BODY\n$/); f.manager.undo(f.home); assert.equal(fs.readFileSync(path.join(destination,'SKILL.md'),'utf8'), original);
});
test('links, auth-like package files, oversize imports, unsupported syntax and import collisions fail before target changes', t => {
  const f = fixture(t), dir = path.join(f.root,'fixture-skill'); f.write('SKILL.md','---\nname: fixture\ndescription: fixture\n---\nbody',dir); const auth = f.write('auth.json','PRIVATE',dir);
  let view = f.manager.list(f.home,'codex','project','skills'); assert.throws(() => f.manager.prepare(view.id,{action:'import'},dir), /IMPORT_REJECTED/); fs.unlinkSync(auth);
  const original = f.write('original','PRIVATE',f.root); fs.linkSync(original,path.join(dir,'linked.txt')); assert.throws(() => f.manager.prepare(view.id,{action:'import'},dir), /FILE_REJECTED/); fs.unlinkSync(path.join(dir,'linked.txt'));
  f.write('huge.txt','x'.repeat(1024*1024+1),dir); assert.throws(() => f.manager.prepare(view.id,{action:'import'},dir), /FILE_REJECTED/);
  f.write('.codex/config.toml','description="""unsupported\nformat"""'); assert.throws(() => f.manager.list(f.home,'codex','home','mcp'), /FORMAT_UNSUPPORTED/);
  assert(!fs.existsSync(path.join(f.home,'.agents')));
});
test('failed atomic replacement leaves original bytes and all configured code unexecuted', t => {
  const f = fixture(t), source = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"PRIVATE"}]}]}}', file = f.write('.claude/settings.json',source);
  const view = f.manager.list(f.home,'claude','home','hooks'), preview = f.manager.prepare(view.id,{action:'edit',row:0,patch:{command:'PRIVATE_NEW'}});
  for (const name of ['node:http','node:https']) for (const method of ['request','get']) t.mock.method(require(name),method,()=>{ throw Error('NETWORK_FORBIDDEN'); });
  for (const method of ['spawn','spawnSync','exec','execFile','fork']) t.mock.method(require('node:child_process'),method,()=>{ throw Error('PROCESS_FORBIDDEN'); });
  t.mock.method(fs,'renameSync',()=>{ throw Error('SYNTHETIC_REPLACE_FAILURE'); });
  assert.throws(()=>f.manager.apply(preview.id),/REPLACE_FAILURE/); assert.equal(fs.readFileSync(file,'utf8'),source); assert.equal(f.manager.undoRecord,null);
});

test('undoing a local Skill import removes only the exact unchanged selected-root copy and rejects later additions', t => {
  const f = fixture(t), dir = path.join(f.root,'fixture-skill'); f.write('SKILL.md','---\nname: fixture\ndescription: fixture\n---\nbody',dir);
  let view = f.manager.list(f.home,'codex','project','skills'), preview = f.manager.prepare(view.id,{action:'import'},dir); f.manager.apply(preview.id);
  const destination = path.join(f.home,'.agents/skills/fixture-skill'); f.manager.undo(f.home); assert(!fs.existsSync(destination)); assert(fs.existsSync(dir));
  view = f.manager.list(f.home,'codex','project','skills'); preview = f.manager.prepare(view.id,{action:'import'},dir); f.manager.apply(preview.id); fs.writeFileSync(path.join(destination,'new-owner-file.txt'),'KEEP');
  assert.throws(()=>f.manager.undo(f.home),/CHANGED/); assert.equal(fs.readFileSync(path.join(destination,'new-owner-file.txt'),'utf8'),'KEEP');
});

test('remote/relative import paths and a selected folder without SKILL.md cannot open unrelated content', t => {
  const f = fixture(t), dir = path.join(f.root,'not-a-skill'); f.write('unrelated.txt','MUST_NOT_READ',dir);
  const view = f.manager.list(f.home,'codex','project','skills'); let opened = 0;
  t.mock.method(fs,'openSync',()=>{ opened++; throw Error('UNRELATED_READ'); });
  assert.throws(()=>f.manager.prepare(view.id,{action:'import'},dir),/IMPORT_REJECTED/); assert.equal(opened,0);
  for (const file of ['relative/config.toml','\\\\remote.invalid\\share\\mcp.json']) assert.throws(()=>read(file),/PATH_REJECTED/);
  assert.equal(opened,0);
});
