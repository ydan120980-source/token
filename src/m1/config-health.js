'use strict';
const fs=require('node:fs'),path=require('node:path'),{TextDecoder}=require('node:util');
const {project}=require('./config-health-project');
const LIMITS=Object.freeze({fileBytes:262144,frontmatterBytes:16384,skills:64,totalBytes:2*1024*1024});
const FILES=Object.freeze({codex:[['.codex/config.toml','codex-config'],['.codex/hooks.json','codex-hooks'],['AGENTS.md','instruction']],claude:[['.claude/settings.json','claude-settings'],['CLAUDE.md','instruction']]});
const fail=code=>{throw new Error(code);};
const comparable=file=>process.platform==='win32'?file.toLowerCase():file;
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.nlink===1&&b.nlink===1;
function guard(file){
  for(let current=path.resolve(file);;current=path.dirname(current)){
    const stat=fs.lstatSync(current);if(stat.isSymbolicLink()||comparable(fs.realpathSync.native(current))!==comparable(current))fail('PATH_REJECTED');
    if(current===path.dirname(current))return;
  }
}
function selected(root){
  if(typeof root!=='string'||!path.isAbsolute(root)||/^[\\/]{2}/.test(root)||path.resolve(root)===path.dirname(path.resolve(root)))fail('ROOT_REQUIRED');
  const absolute=path.resolve(root);guard(absolute);if(!fs.lstatSync(absolute).isDirectory())fail('ROOT_REQUIRED');return absolute;
}
function safeReason(error){return ['ENOENT','EACCES','EPERM'].includes(error.code)?error.code: ['PATH_REJECTED','FILE_LIMIT','TOTAL_LIMIT','FRONTMATTER_LIMIT','FRONTMATTER_MISSING','FILE_CHANGED','FILE_TYPE'].includes(error.message)?error.message:'READ_UNAVAILABLE';}
function read(file,kind,audit){
  guard(file);const before=fs.lstatSync(file);if(!before.isFile()||before.nlink>1)fail('FILE_TYPE');
  if(kind==='instruction')return {bytes:before.size};
  if(kind!=='skill'&&before.size>LIMITS.fileBytes)fail('FILE_LIMIT');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{
    const opened=fs.fstatSync(fd);guard(file);if(!sameFile(opened,before))fail('FILE_CHANGED');
    let bytes;
    if(kind==='skill'){
      const prefix=[],byte=Buffer.alloc(1);let line='',lines=0,closed=false;
      // Stop at the delimiter's final byte. Never fetch a block containing body.
      while(prefix.length<LIMITS.frontmatterBytes){
        if(audit.bytesRead>=LIMITS.totalBytes)fail('TOTAL_LIMIT');if(!fs.readSync(fd,byte,0,1,null))break;prefix.push(byte[0]);audit.bytesRead++;line+=String.fromCharCode(byte[0]);
        if(byte[0]===10){const value=line.replace(/\r?\n$/,'');if(!lines++&&value!=='---')fail('FRONTMATTER_MISSING');if(lines>1&&value==='---'){closed=true;break;}line='';}
      }
      if(!closed&&line==='---'&&lines>0&&prefix.length===opened.size)closed=true;
      if(!closed)fail(prefix.length>=LIMITS.frontmatterBytes?'FRONTMATTER_LIMIT':'FRONTMATTER_MISSING');bytes=Buffer.from(prefix);
    }else{
      if(audit.bytesRead+opened.size>LIMITS.totalBytes)fail('TOTAL_LIMIT');bytes=Buffer.alloc(opened.size);let offset=0;
      while(offset<bytes.length){const count=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!count)fail('FILE_CHANGED');offset+=count;audit.bytesRead+=count;}
    }
    const after=fs.fstatSync(fd);guard(file);const current=fs.lstatSync(file);
    if(!sameFile(after,opened)||!sameFile(current,opened))fail('FILE_CHANGED');
    audit.filesRead++;return {text:new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes).replace(/\r?\n$/,'')};
  }finally{fs.closeSync(fd);}
}
function scanConfigHealth(selection,agents=['codex','claude']){
  if(!Array.isArray(agents)||!agents.length||agents.length>2||new Set(agents).size!==agents.length||agents.some(agent=>!['codex','claude'].includes(agent)))fail('AGENT_REQUIRED');
  if(!selection||typeof selection!=='object'||Array.isArray(selection)||Object.keys(selection).some(key=>!['home','project'].includes(key))||!Object.values(selection).some(value=>value!==undefined))fail('ROOT_REQUIRED');
  // Validate every selected root before opening any content.
  const scopes=Object.entries(selection).filter(([,value])=>value!==undefined).map(([scope,root])=>[scope,selected(root)]);
  const audit={filesRead:0,bytesRead:0},files=[],names=new Map();
  function inspect(agent,scope,root,relative,kind,index=null){
    const file={agent,scope,kind,...(index===null?{}:{index})};
    try{const input=read(path.join(root,relative),kind,audit);file.checks=kind==='instruction'?[{kind:'instruction',state:'static-ok',reason:'METADATA_ONLY',bytes:input.bytes}]:project(agent,kind,input.text,(name,check)=>{
      const key=agent+':'+scope;if(!names.has(key))names.set(key,new Map());const seen=names.get(key),previous=seen.get(name);
      if(previous){Object.assign(previous,{state:'issue',reason:'DUPLICATE_SKILL_NAME'});Object.assign(check,{state:'issue',reason:'DUPLICATE_SKILL_NAME'});}else seen.set(name,check);
    });}
    catch(error){file.checks=[{kind:'file',state:'unchecked',reason:safeReason(error)}];}files.push(file);
  }
  for(const [scope,root]of scopes)for(const agent of agents){
    files.push({agent,scope,kind:'client-compatibility',checks:[{kind:'compatibility',state:'unchecked',reason:'CLIENT_VERSION_UNVERIFIED'}]});
    const candidates=[...FILES[agent]];if(agent==='claude'&&scope==='project')candidates.push(['.claude/settings.local.json','claude-settings-local'],['.mcp.json','claude-mcp']);
    for(const [relative,kind]of candidates)inspect(agent,scope,root,relative,kind);
    if(agent==='claude')files.push({agent,scope,kind:'mixed-account-mcp',checks:[{kind:'mcp',state:'unchecked',reason:'MIXED_ACCOUNT_FILE_EXCLUDED'}]});
    const directory=path.join(root,agent==='codex'?'.agents/skills':'.claude/skills');
    try{
      guard(directory);if(!fs.lstatSync(directory).isDirectory())fail('FILE_TYPE');const iterator=fs.opendirSync(directory);let count=0,visited=0;
      try{let entry;while((entry=iterator.readSync())){
        if(++visited>LIMITS.skills){files.push({agent,scope,kind:'skill-directory',checks:[{kind:'skills',state:'unchecked',reason:'ENTRY_LIMIT',omittedAtLeast:1}]});break;}
        if(!entry.isDirectory()&&!entry.isSymbolicLink())continue;
        inspect(agent,scope,root,path.relative(root,path.join(directory,entry.name,'SKILL.md')),'skill',++count);
      }}finally{iterator.closeSync();}
      if(!count)files.push({agent,scope,kind:'skill-directory',checks:[{kind:'skills',state:'static-ok',reason:'NO_ENTRIES'}]});
    }catch(error){files.push({agent,scope,kind:'skill-directory',checks:[{kind:'skills',state:'unchecked',reason:safeReason(error)}]});}
  }
  const counts={'static-ok':0,issue:0,unchecked:0,'not-applicable':0};for(const file of files)for(const check of file.checks)counts[check.state]++;
  return {schemaVersion:'ConfigHealthV1',contract:'codex-claude-static/20261022-events',state:'unchecked',reason:'PARTIAL_STATIC_SCOPE',clientVersionVerified:false,runtimeVerified:false,scopes:scopes.map(([scope])=>scope),files,counts,summary:summary(files),audit};
}
function summary(files){
  const kinds={mcp:new Set(['mcp']),hooks:new Set(['hooks']),skills:new Set(['skills','skill-overrides'])};
  const candidates={'codex-config':['mcp','hooks','skills'],'codex-hooks':['hooks'],'claude-settings':['hooks'],'claude-settings-local':['hooks'],'claude-mcp':['mcp'],skill:['skills'],'skill-directory':['skills'],'mixed-account-mcp':['mcp']};
  return Object.fromEntries(Object.entries(kinds).map(([kind,checks])=>{
    const counts={'static-ok':0,issue:0,unchecked:0,'not-applicable':0};let fileCount=0;
    for(const file of files){const rows=file.checks.filter(check=>checks.has(check.kind)||check.kind==='file'&&candidates[file.kind]?.includes(kind));if(rows.length){fileCount++;for(const row of rows)counts[row.state]++;}}
    const state=counts.issue?'issue':counts.unchecked||!fileCount?'unchecked':'static-ok';
    return [kind,{state,files:fileCount,counts,runtimeVerified:false}];
  }));
}
module.exports={scanConfigHealth,LIMITS,summary,selected,guard,sameFile};
