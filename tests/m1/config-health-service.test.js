'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { ConfigHealthService, installConfigHealth, runCheck } = require('../../src/quota/config-health-service');
const { remove } = require('./temp');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'config-center-synthetic-')); t.after(() => remove(root)); return root; }
test('native selection grants are session-only, agent/scope-specific and metadata-only until an explicit check', async t => {
  const root = fixture(t); let scans = 0, chosen = root;
  const service = new ConfigHealthService(async () => chosen, (selection, agent) => { scans++; assert.deepEqual(selection, { project: root }); assert.equal(agent, 'codex'); return { promise: Promise.resolve({ result: 'SYNTHETIC' }), cancel() {} }; });
  assert.equal(scans, 0); assert.deepEqual(service.state().selections, {});
  await service.select('codex', 'project'); assert.equal(scans, 0); assert(!JSON.stringify(service.state()).includes(root));
  await assert.rejects(service.check('claude', 'project'), /ROOT_NOT_SELECTED/);
  await service.check('codex', 'project'); assert.equal(scans, 1); assert(service.state().selections['codex:project'].checkedAt);
  chosen = null; assert((await service.select('codex', 'project')).canceled); assert(service.state().selections['codex:project'].result);
  service.forget('codex', 'project'); assert.deepEqual(service.state().selections, {}); await service.close();
  await assert.rejects(service.select('codex', 'project'), /CLOSED/);
});
test('sender validation, picker serialization, busy/cancel and failure states cannot accept renderer paths', async t => {
  const root = fixture(t); let chooseDone, rejectCheck, picks = 0;
  const service = new ConfigHealthService(() => { picks++; return new Promise(resolve => { chooseDone = resolve; }); }, () => ({ promise: new Promise((_, reject) => { rejectCheck = reject; }), cancel: () => rejectCheck(Error('CONFIG_CHECK_CANCELLED')) }));
  const handlers = new Map(); installConfigHealth({ handle: (name, fn) => handlers.set(name, fn) }, event => event.allowed, service);
  const invoke = (name, ...args) => handlers.get('usage:config:' + name)({ allowed: true }, ...args);
  assert.equal((await handlers.get('usage:config:choose')({ allowed: false }, 'codex', 'project')).error, 'IPC_SENDER_REJECTED'); assert.equal(picks, 0);
  assert.equal((await invoke('choose','cursor','project')).error, 'CONFIG_SELECTION_INVALID');
  const choosing = invoke('choose','codex','project','PRIVATE_RENDERER_PATH');
  assert.equal((await invoke('choose','claude','project')).error, 'CONFIG_CHECK_BUSY'); assert.equal(picks, 1);
  chooseDone(root); await choosing;
  const check = invoke('check','codex','project'); assert.equal(service.state().busy, true);
  assert.equal((await invoke('forget','codex','project')).error, 'CONFIG_CHECK_BUSY');
  await invoke('cancel'); await check;
  assert.equal(service.state().selections['codex:project'].error, 'CONFIG_CHECK_CANCELLED'); assert.equal(service.state().busy, false);
  await service.close();
});
test('dedicated worker checks only the selected Agent/scope and returns a redacted result', async t => {
  const root = fixture(t); fs.mkdirSync(path.join(root, '.codex')); fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.codex/config.toml'), '[mcp_servers.PRIVATE_SERVER]\ncommand="PRIVATE_COMMAND"');
  fs.writeFileSync(path.join(root, '.claude/settings.json'), 'PRIVATE_MALFORMED_CONFIGURATION');
  const task = runCheck({ project: root }, 'codex'), result = await task.promise;
  assert(result.files.every(file => file.agent === 'codex' && file.scope === 'project')); assert(!JSON.stringify(result).includes('PRIVATE')); assert(!JSON.stringify(result).includes(root)); assert.equal(result.runtimeVerified, false);
});
test('closing a matching management view releases raw snapshots and drafts but preserves encrypted undo identity',async t=>{
  const root=fixture(t),manager={context:null,draft:null,undoRecord:{id:'synthetic-encrypted-undo'}},service=new ConfigHealthService(async()=>root,undefined,manager);t.after(()=>service.close());
  await service.select('codex','project');const context={id:'current',root,agent:'codex',scope:'project',kind:'mcp'};manager.context=context;manager.draft={synthetic:'temporary'};
  await service.manage('release','codex','project','mcp',{id:'old'});assert.equal(manager.context,context);assert(manager.draft);
  await service.manage('release','codex','project','mcp',{id:'current'});assert.equal(manager.context,null);assert.equal(manager.draft,null);assert.deepEqual(manager.undoRecord,{id:'synthetic-encrypted-undo'});
});
