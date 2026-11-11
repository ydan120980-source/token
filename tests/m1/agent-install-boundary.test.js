'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AgentInstallService}=require('../../src/quota/agent-install-service'),{request}=require('../../scripts/local/claude-governed/manage'),{remove}=require('./temp');
test('product installer dependency files contain no owner-machine network or replacement routes',()=>{
  const root=path.resolve(__dirname,'../../src/quota');
  for(const file of fs.readdirSync(root).filter(file=>/^agent-install-.*\.(js|ps1)$/.test(file))){
    const source=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(source,/17898|verge-mihomo|ClaudeNetworkPolicy|claude-replace|claude-governance|local\/claude-governed|npm\/node_modules\/@anthropic-ai\/claude-code\/bin\/claude\.exe/,file);
  }
  assert(!fs.existsSync(path.join(root,'agent-install-proxy.js')));
  for(const args of [[],['check'],['install','--root',path.resolve('unused')],['check','--root','relative','--confirm-local-governed-maintenance']])assert.throws(()=>request(args),/LOCAL_ARGUMENTS_REQUIRED/);
});
test('cached legacy governance cannot enqueue product rollback/install or bulk upgrade',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'installer-boundary-'));t.after(()=>remove(root));
  fs.writeFileSync(path.join(root,'install-status.json'),JSON.stringify({rows:{claude:{state:'installed',governed:true,version:'1.0.0',latest:'2.0.0',canRollback:true}}}));
  const service=new AgentInstallService(root,()=>({}),{fixture:true});t.after(()=>service.close());let calls=0;service.run=async()=>{calls++;throw new Error('UNEXPECTED_DISPATCH');};
  const act=action=>service.action({agent:action==='upgrade-all'?'all':'claude',action,revision:service.state().revision});
  const row=service.state().rows.find(row=>row.agent==='claude');assert.equal(row.localMaintenanceRequired,true);assert.equal(row.canRollback,false);assert.equal(row.updateAvailable,false);
  assert.equal(act('rollback').ok,false);assert.equal(act('install').ok,false);act('upgrade-all');assert.equal(calls,0);
});
