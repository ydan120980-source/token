'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {scanConfigHealth,LIMITS}=require('../../src/m1/config-health'),{project}=require('../../src/m1/config-health-project'),syntax=require('../../src/m1/config-health-syntax');
const {remove}=require('./temp');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'配置 health with spaces-'));t.after(()=>remove(root));const home=path.join(root,'home'),project=path.join(root,'project');fs.mkdirSync(home);fs.mkdirSync(project);const saved=new Map();
  function write(scope,file,value){const absolute=path.join(scope,file);fs.mkdirSync(path.dirname(absolute),{recursive:true});fs.writeFileSync(absolute,value);saved.set(absolute,crypto.createHash('sha256').update(value).digest('hex'));return absolute;}
  return {root,home,project,write,saved};
}
const checks=result=>result.files.flatMap(file=>file.checks);
test('strict bounded grammars reject duplicate keys, syntax tricks and executable YAML without returning error source',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(syntax.json('{"__proto__":{"polluted":true}}'))),{['__proto__']:{polluted:true}});assert.equal({}.polluted,undefined);
  for(const input of ['{"hooks":{},"hooks":{}}','{"a":1,}','{"a":1}\u00a0','[true,]','{"a":NaN}'])assert.throws(()=>syntax.json(input));
  const supported=syntax.toml('model="ignored"\n[mcp_servers."private.name"]\ncommand="node"\nargs=[\n"a",\n]\n[[skills.config]]\npath=\'C:\\secret\'\nenabled=false\n');assert.equal(supported.mcp_servers['private.name'].command,'node');assert.equal(supported.skills.config[0].enabled,false);
  for(const input of ['[mcp_servers.a]\ncommand="a"\ncommand="b"','[mcp_servers.a]\n[mcp_servers.a]','mcp_servers={a={command="node"}}\n[mcp_servers.a]\nurl="https://x.invalid"','a=[]\n[[a]]\nx=1','[mcp_servers\n.a]\ncommand="node"','description="""multi\nline"""','[mcp_servers.a]\ncommand=\n"node"',String.raw`[mcp_servers.a]
command="node\/server"`])assert.throws(()=>syntax.toml(input));
  for(const input of ['---\nname: !!js/function secret\n---','---\nname: &secret x\ndescription: *secret\n---','---\nname: x\nname: y\n---','---\nname: foo: bar\n---','---\nname: #comment\n---'])assert.equal(project('codex','skill',input)[0].state,'unchecked');
});
test('static projection differentiates deterministic issues, unknown transports/handlers and optional Claude frontmatter',()=>{
  const source=JSON.stringify({mcpServers:{remote:{type:'http',url:'https://private:secret@site.invalid/path?token=secret'},bad:{command:45},unknown:{type:'future',url:'https://site.invalid'}}});
  const rows=project('claude','claude-mcp',source);assert.equal(rows[0].state,'static-ok');assert.equal(rows[0].executableCheck,'not-applicable');assert.equal(rows[1].state,'issue');assert.equal(rows[2].state,'unchecked');
  assert.equal(project('claude','skill','---\n---')[0].state,'static-ok');assert.equal(project('codex','skill','---\n---')[0].state,'issue');
  const hooks=JSON.stringify({hooks:{Stop:[{hooks:[{type:'command',command:'private command'},{type:'http',url:'private url'},{type:'mcp_tool',server:'private'}]}],FutureEvent:[]}});
  assert.deepEqual(project('codex','codex-hooks',hooks).map(row=>row.state),['static-ok','unchecked','issue','unchecked']);
  assert.deepEqual(project('claude','claude-settings',hooks).map(row=>row.state),['static-ok','issue','issue','unchecked']);
  assert.equal(project('claude','claude-settings','{"hooks":{"Stop":[{"hooks":[{"type":"command"}]}]}}')[0].state,'issue');
});
test('explicit root scan uses separate whitelist and redacts every original value, key, path and skill body',t=>{
  const f=fixture(t),secret='SENTINEL_abcdefghijklmnopqrstuvwxyz_0123456789';
  f.write(f.home,'.codex/config.toml','[mcp_servers."'+secret+'"]\ncommand="node"\nargs=["'+secret+'"]\nenv={"'+secret+'"="'+secret+'"}\nhttp_headers={"'+secret+'"="'+secret+'"}\n[[skills.config]]\npath="'+secret+'"\nenabled=false\n');
  f.write(f.project,'.mcp.json',JSON.stringify({mcpServers:{[secret]:{type:'http',url:'https://'+secret+':'+secret+'@site.invalid/'+secret+'?token='+secret+'#'+secret,headers:{[secret]:secret}}}}));
  f.write(f.home,'.claude/settings.json',JSON.stringify({hooks:{Stop:[{matcher:secret,hooks:[{type:'command',command:secret}]}]},env:{[secret]:secret},oauth:{token:secret}}));
  const header='---\nname: '+secret+'\ndescription: >\n  '+secret+'\n---\n';f.write(f.home,'.agents/skills/'+secret+'/SKILL.md',header+'NEVER_READ_BODY_'+secret);
  const instruction=f.write(f.project,'AGENTS.md','NEVER_READ_INSTRUCTIONS_'+secret),auth=f.write(f.home,'.codex/auth.json','NEVER_READ_AUTH_'+secret),mixed=f.write(f.home,'.claude.json','NEVER_READ_MIXED_'+secret);
  const open=fs.openSync,reads=[];t.mock.method(fs,'openSync',(file,...args)=>{reads.push(String(file));return open(file,...args);});
  for(const name of ['node:http','node:https'])for(const method of ['request','get'])t.mock.method(require(name),method,()=>{throw new Error('NETWORK_FORBIDDEN');});
  for(const method of ['spawn','spawnSync','exec','execFile','fork'])t.mock.method(require('node:child_process'),method,()=>{throw new Error('PROCESS_FORBIDDEN');});
  for(const method of ['writeFileSync','appendFileSync','renameSync','unlinkSync','mkdirSync','rmSync'])t.mock.method(fs,method,()=>{throw new Error('WRITE_FORBIDDEN');});
  const result=scanConfigHealth({home:f.home,project:f.project}),serialized=JSON.stringify(result);
  assert(!serialized.includes(secret));assert(!serialized.includes(f.root));assert(!serialized.includes('NEVER_READ'));assert(!reads.includes(auth));assert(!reads.includes(mixed));assert(!reads.includes(instruction));
  assert.equal(result.state,'unchecked');assert.equal(result.runtimeVerified,false);assert.equal(result.clientVersionVerified,false);assert(checks(result).some(row=>row.reason==='CLIENT_VERSION_UNVERIFIED'));assert(checks(result).some(row=>row.reason==='REFERENCES_NOT_FOLLOWED'));assert(checks(result).some(row=>row.reason==='MIXED_ACCOUNT_FILE_EXCLUDED'));
  const expected=Buffer.byteLength(header)+[...f.saved.keys()].filter(file=>reads.includes(file)&&!file.endsWith('SKILL.md')).reduce((sum,file)=>sum+fs.statSync(file).size,0);assert.equal(result.audit.bytesRead,expected,'reads stop at skill closing delimiter');
  t.mock.restoreAll();for(const [file,hash]of f.saved)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash);
});
test('missing roots/parameters fail before content reads; absent files remain unchecked, not healthy',t=>{
  const f=fixture(t);let opens=0;t.mock.method(fs,'openSync',()=>{opens++;throw new Error('UNEXPECTED_READ');});
  for(const input of [null,{},[],{home:'relative'},{home:f.home,project:'relative'},{home:f.home,extra:'x'},{home:path.parse(f.root).root}])assert.throws(()=>scanConfigHealth(input));
  const result=scanConfigHealth({project:f.project});assert.equal(opens,0);assert.equal(result.counts['static-ok'],0);assert.equal(result.audit.bytesRead,0);assert(result.counts.unchecked>0);
});
test('junctions, linked files and oversized candidates are rejected before any content read',t=>{
  const f=fixture(t),outside=path.join(f.root,'outside');fs.mkdirSync(outside);f.write(outside,'config.toml','[mcp_servers.secret]\ncommand="NEVER"');
  fs.symlinkSync(outside,path.join(f.home,'.codex'),process.platform==='win32'?'junction':'dir');
  const auth=f.write(f.project,'private-auth','NEVER_READ');fs.mkdirSync(path.join(f.project,'.claude'));fs.linkSync(auth,path.join(f.project,'.claude/settings.json'));
  f.write(f.project,'.mcp.json',' '.repeat(LIMITS.fileBytes+1));let opens=0;const open=fs.openSync;t.mock.method(fs,'openSync',(...args)=>{opens++;return open(...args);});
  const result=scanConfigHealth({home:f.home,project:f.project});assert.equal(opens,0);assert.equal(result.audit.bytesRead,0);assert(checks(result).some(row=>row.reason==='PATH_REJECTED'));assert(checks(result).some(row=>row.reason==='FILE_TYPE'));assert(checks(result).some(row=>row.reason==='FILE_LIMIT'));
});
test('duplicate skills are detected within one agent/scope; directory and frontmatter limits are explicit',t=>{
  const f=fixture(t);for(const name of ['a','b'])f.write(f.project,'.agents/skills/'+name+'/SKILL.md','---\nname: duplicate-secret\ndescription: private\n---\nBODY');
  const result=scanConfigHealth({project:f.project});assert.equal(checks(result).filter(row=>row.reason==='DUPLICATE_SKILL_NAME').length,2);assert(!JSON.stringify(result).includes('duplicate-secret'));
  f.write(f.home,'.claude/skills/big/SKILL.md','---\ndescription: '+ 'x'.repeat(LIMITS.frontmatterBytes));for(let i=0;i<LIMITS.skills+1;i++)f.write(f.home,'.agents/skills/'+i+'/SKILL.md','---\nname: fixture-'+i+'\ndescription: text\n---\nBODY');
  const bounded=scanConfigHealth({home:f.home});assert(checks(bounded).some(row=>row.reason==='FRONTMATTER_LIMIT'));assert(checks(bounded).some(row=>row.reason==='ENTRY_LIMIT'));assert.equal(bounded.files.filter(row=>row.agent==='codex'&&row.kind==='skill').length,LIMITS.skills);
});
test('read denial, content replacement and malformed secret-bearing documents return controlled unchecked codes',t=>{
  const f=fixture(t),file=f.write(f.project,'.mcp.json','{"mcpServers":{"SECRET_BAD_JSON":');let mode='deny';const open=fs.openSync,read=fs.readSync;
  t.mock.method(fs,'openSync',(target,...args)=>{if(target===file&&mode==='deny')throw Object.assign(new Error('SECRET_ERROR_AND_PATH'),{code:'EACCES'});return open(target,...args);});
  assert(checks(scanConfigHealth({project:f.project})).some(row=>row.reason==='EACCES'));
  mode='invalid';const bad=scanConfigHealth({project:f.project});assert(checks(bad).some(row=>row.reason==='PARSE_UNSUPPORTED'));assert(!JSON.stringify(bad).includes('SECRET'));
  mode='race';t.mock.method(fs,'readSync',(fd,...args)=>{const count=read(fd,...args);if(mode==='race'){mode='done';fs.appendFileSync(file,'SECRET_RACE');}return count;});
  const race=scanConfigHealth({project:f.project});assert(checks(race).some(row=>row.reason==='FILE_CHANGED'));assert(!JSON.stringify(race).includes('SECRET'));
});
test('total content budget stops further reads even across many bounded skill headers',t=>{
  const f=fixture(t),header='---\nname: unique\ndescription: '+ 'x'.repeat(16320)+'\n---\nBODY';
  for(const scope of [f.home,f.project])for(const folder of ['.agents/skills','.claude/skills'])for(let i=0;i<40;i++)f.write(scope,folder+'/'+i+'/SKILL.md',header);
  const result=scanConfigHealth({home:f.home,project:f.project});assert(result.audit.bytesRead<=LIMITS.totalBytes);assert(checks(result).some(row=>row.reason==='TOTAL_LIMIT'));
});
test('CLI requires explicit roots and emits only redacted JSON for a synthetic home',t=>{
  const f=fixture(t);f.write(f.home,'.codex/config.toml','[mcp_servers.private]\ncommand="node"\nargs=["PRIVATE_CLI_SECRET"]');const entry=path.resolve('src/m1/config-health-entry.js');
  const rejected=spawnSync(process.execPath,[entry],{encoding:'utf8',cwd:f.project});assert.equal(rejected.status,1);assert.equal(JSON.parse(rejected.stdout).errorCode,'CONFIG_HEALTH_SCOPE_REJECTED');assert.equal(rejected.stderr,'');
  const accepted=spawnSync(process.execPath,[entry,'--home',f.home],{encoding:'utf8'});assert.equal(accepted.status,0);assert.equal(accepted.stderr,'');assert(!accepted.stdout.includes('PRIVATE_CLI_SECRET'));assert(!accepted.stdout.includes(f.home));assert.equal(JSON.parse(accepted.stdout).schemaVersion,'ConfigHealthV1');
});
