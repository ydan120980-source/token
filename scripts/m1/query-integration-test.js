'use strict';
// An external SDK client really spawns each server runtime and negotiates MCP.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {Store,atomic}=require('../../src/m1/store');
const {normalize}=require('../../src/m1/normalize');
const {remove}=require('../../tests/m1/temp');
async function run(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'聚合 query ')),dir=path.join(root,'usage'),home=path.join(root,'home');fs.mkdirSync(home);
  const store=new Store(dir,{}),r=normalize('codex',{input_tokens:100,output_tokens:20,cached_input_tokens:0,cache_creation_input_tokens:0,reasoning_output_tokens:0},{id:'private-id',model:'gpt-4.1',time:'2026-10-17T05:00:00Z',session:'raw-session'},'synthetic');
  store.state.records[r.id]=r;store.state.records.second={...r,id:'second',model:'unknown'};store.state.sessions={secret:{id:'RAW_SENTINEL',cwd:'C:/PATH_SENTINEL'}};store.state.sequence=1;atomic(path.join(dir,'statistics.json'),store.state);
  store.setPrice({provider:r.provider,model:r.model,inputUncached:1,output:1,cacheRead:0,cacheWrite:0});const priceFile=path.join(dir,'pricing.json'),priceBefore=fs.readFileSync(priceFile);
  const before=fs.readFileSync(path.join(dir,'statistics.json')),filesBefore=fs.readdirSync(dir).sort(),env={ELECTRON_RUN_AS_NODE:'1',HOME:home,USERPROFILE:home,APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'localappdata'),CODEX_HOME:path.join(home,'.codex'),PATH:''};
  for(const key of ['SYSTEMROOT','SystemRoot','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','SystemDrive'])if(process.env[key])env[key]=process.env[key];
  const executable=process.env.QUERY_PACKAGED_EXE||process.execPath,entry=process.env.QUERY_PACKAGED_EXE?path.join(path.dirname(executable),'resources/app.asar/src/m1/query-entry.js'):path.resolve('src/m1/query-entry.js');
  try{
    const cli=spawnSync(executable,[entry,'query','--data-dir',dir,'--json',JSON.stringify({groupBy:['agent']})],{env,windowsHide:true,encoding:'utf8',timeout:20000});assert.equal(cli.status,0,cli.stderr);const expected=JSON.parse(cli.stdout);assert.equal(expected.total.records,2);
    const transport=new StdioClientTransport({command:executable,args:[entry,'mcp','--data-dir',dir],env,stderr:'pipe'}),client=new Client({name:'agent-usage-integration-client',version:'1.0.0'});let stderr='',initialize,toolNames;transport.stderr?.on('data',b=>{stderr+=b;});
    const request=client.request.bind(client);client.request=async(...args)=>{const result=await request(...args);if(args[0].method==='initialize')initialize=result;return result;};
    try{
      await client.connect(transport);assert.equal(client.getServerVersion().name,'agent-usage-saved-query');
      const tools=await client.listTools();toolNames=tools.tools.map(t=>t.name);assert.deepEqual(toolNames,['usage_query']);assert.equal(tools.tools[0].annotations.readOnlyHint,true);assert(initialize.protocolVersion);
      const response=await client.callTool({name:'usage_query',arguments:{groupBy:['agent']}});assert.deepEqual(response.structuredContent,expected);
      const first=(await client.callTool({name:'usage_query',arguments:{groupBy:['model'],limit:1}})).structuredContent;
      const second=(await client.callTool({name:'usage_query',arguments:{groupBy:['model'],offset:first.nextOffset,revision:first.revision,limit:1}})).structuredContent;assert.equal(second.nextOffset,null);assert.notDeepEqual(first.rows,second.rows);assert.equal(first.revision,second.revision);
      const missing=await client.callTool({name:'usage_query',arguments:{offset:1}});assert.equal(missing.content[0].text,'QUERY_REVISION_REQUIRED');
      store.setPrice({provider:r.provider,model:r.model,inputUncached:2,output:2,cacheRead:0,cacheWrite:0});
      const changed=await client.callTool({name:'usage_query',arguments:{groupBy:['model'],offset:1,revision:first.revision}});assert.equal(changed.isError,true);assert.equal(changed.content[0].text,'QUERY_SNAPSHOT_CHANGED');fs.writeFileSync(priceFile,priceBefore);
      const error=await client.callTool({name:'usage_query',arguments:{groupBy:['cwd'],file:'auth.json'}});assert.equal(error.isError,true);assert.match(error.content[0].text,/^QUERY_ARGUMENT_INVALID$/);
      assert(!JSON.stringify(response).includes('RAW_SENTINEL'));assert(!JSON.stringify(response).includes('PATH_SENTINEL'));assert(!JSON.stringify(response).includes(r.sessionKey));assert.equal(stderr,'');
      assert.deepEqual(fs.readFileSync(path.join(dir,'statistics.json')),before,'successful and invalid queries do not change the ledger');
      fs.writeFileSync(path.join(dir,'statistics.json'),'{bad');const invalid=await client.callTool({name:'usage_query',arguments:{}});assert.equal(invalid.content[0].text,'QUERY_STORAGE_INVALID');
      assert.equal(fs.readFileSync(path.join(dir,'statistics.json'),'utf8'),'{bad','invalid saved bytes are never quarantined or rewritten');assert.deepEqual(fs.readdirSync(dir).sort(),filesBefore);
    }finally{await client.close();}
    fs.writeFileSync(path.join(dir,'statistics.json'),before);
    for(const input of ['PRIVATE_MALFORMED_SENTINEL\n',JSON.stringify({jsonrpc:'2.0',id:1,method:'PRIVATE_'+ 'x'.repeat(70000)})+'\n']){
      const malformed=spawnSync(executable,[entry,'mcp','--data-dir',dir],{env,input,windowsHide:true,encoding:'utf8',timeout:20000});
      assert(!malformed.error,malformed.error?.message);assert.equal(malformed.stdout,'');assert.match(malformed.stderr,/^QUERY_PROTOCOL_ERROR\n$/);assert(!malformed.stderr.includes('PRIVATE_'));
    }
    const output=process.env.QUERY_EVIDENCE_DIR||'artifacts/query/source';fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({runtime:process.env.QUERY_PACKAGED_EXE?'packaged-exe-electron-run-as-node':'node-source',cli:true,initialize,tools:toolNames,syntheticAggregate:expected.total,toolsList:true,toolsCall:true,revisionPagination:true,priceChangeRejected:true,invalidArguments:true,corruptStorageRedacted:true,malformedAndOversizedProtocol:true,privacy:true,protocolStdout:true,ledgerUnchanged:fs.readFileSync(path.join(dir,'statistics.json')).equals(before)},null,2));
    console.log('PASS: external SDK client CLI / initialize / tools/list / tools/call; controlled errors, privacy and saved ledger.');
  }finally{await remove(root);}
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
