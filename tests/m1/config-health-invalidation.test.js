'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ConfigHealthService } = require('../../src/quota/config-health-service'), { remove } = require('./temp');

test('apply and undo return redacted fresh state and invalidate every same-root grant without rescanning', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'config-invalidation-synthetic-')), first = path.join(root,'first'), other = path.join(root,'other');
  fs.mkdirSync(first); fs.mkdirSync(other); let chosen = first, scans = 0, fail = false;
  const manager = { context:null, apply() { if (fail) throw Error('CONFIG_CHANGED'); return {applied:true,undo:true}; }, undo() { if (fail) throw Error('CONFIG_CHANGED'); return {restored:true}; } };
  const service = new ConfigHealthService(async () => chosen, () => { scans++; return {promise:Promise.resolve({schemaVersion:'ConfigHealthV1',synthetic:true}),cancel(){}}; }, manager);
  t.after(async () => {await service.close();remove(root);});
  for (const [agent,scope] of [['codex','home'],['codex','project'],['claude','home'],['claude','project']]) {
    chosen = agent === 'claude' && scope === 'project' ? other : process.platform === 'win32' && scope === 'project' ? first.toUpperCase() : first;
    await service.select(agent,scope); await service.check(agent,scope);
  }
  const originalOther = service.state().selections['claude:project'];
  manager.context = {root:first,agent:'codex',scope:'home',kind:'mcp'};
  const before = service.state(); fail = true;
  await assert.rejects(service.manage('apply','codex','home','mcp',{id:'synthetic'}),/CONFIG_CHANGED/); assert.deepEqual(service.state(),before);
  fail = false;
  const applied = await service.manage('apply','codex','home','mcp',{id:'synthetic'}); assert.equal(applied.applied,true); assert.equal(applied.undo,true);
  for (const id of ['codex:home','codex:project','claude:home']) assert.deepEqual(applied.state.selections[id],{selected:true,result:null,checkedAt:null,error:null});
  assert.deepEqual(applied.state.selections['claude:project'],originalOther); assert.equal(scans,4); assert(!JSON.stringify(applied).includes(root));
  await service.check('codex','project'); const checked = service.state(); fail = true;
  await assert.rejects(service.manage('undo','codex','home','mcp'),/CONFIG_CHANGED/); assert.deepEqual(service.state(),checked);
  fail = false; const undone = await service.manage('undo','codex','home','mcp');
  assert.equal(undone.restored,true); assert.equal(undone.state.selections['codex:project'].result,null); assert.equal(undone.state.selections['codex:project'].checkedAt,null);
  assert.deepEqual(undone.state.selections['claude:project'],originalOther); assert.equal(scans,5); assert(!JSON.stringify(undone).includes(root));
});
