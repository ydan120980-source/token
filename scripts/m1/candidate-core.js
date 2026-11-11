'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const digest=value=>hash(JSON.stringify(value));
function files(base,skipModules=false){
 const result=[];if(!fs.existsSync(base))return result;
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('CANDIDATE_LINK_REJECTED');if(entry.isDirectory()){if(!skipModules||entry.name!=='node_modules')walk(file);}else if(entry.isFile())result.push(file);}};
 walk(base);return result.sort();
}
function tree(base){return Object.fromEntries(files(base).map(file=>[path.relative(base,file).replaceAll('\\','/'),{bytes:fs.statSync(file).size,sha256:hash(fs.readFileSync(file))}]));}
function dependencyFiles(root,pkg){
 const pending=Object.keys(pkg.dependencies||{}).map(name=>({name,from:root,optional:false})),seen=new Set(),result=[];
 while(pending.length){const {name,from,optional}=pending.pop();let base=from,folder=null;
  for(;;){const probe=path.join(base,'node_modules',name);if(fs.existsSync(path.join(probe,'package.json'))){folder=probe;break;}const next=path.dirname(base);if(next===base)break;base=next;}
  if(!folder){if(optional)continue;throw Error('CANDIDATE_DEPENDENCY_MISSING');}const real=fs.realpathSync(folder);if(seen.has(real))continue;seen.add(real);result.push(...files(real,true));
  const meta=JSON.parse(fs.readFileSync(path.join(real,'package.json'),'utf8'));
  for(const [kind,optional] of [['dependencies',false],['optionalDependencies',true],['peerDependencies',true]])for(const name of Object.keys(meta[kind]||{}))pending.push({name,from:real,optional});
 }
 return result;
}
function inputs(root,{dependencies=true}={}){
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),exclude=new Set(['src/m1/crypto.js','design/desktop-reference/serve.js','design/desktop-reference/README.md']);
 const source=['src/m1','src/quota','design/desktop-reference'].flatMap(dir=>files(path.join(root,dir))).filter(file=>!exclude.has(path.relative(root,file).replaceAll('\\','/')));
 for(const name of ['package.json','package-lock.json','LICENSE','docs/m1/UPSTREAM.md','docs/m1/CODEX-QUOTA.md','assets/icon-win.png'])source.push(path.join(root,name));
 if(dependencies){source.push(...dependencyFiles(root,pkg));source.push(path.join(root,'node_modules/electron/package.json'),...files(path.join(root,'node_modules/electron/dist')));}
 const product=Object.fromEntries([...new Set(source)].sort().map(file=>[path.relative(root,file).replaceAll('\\','/'),hash(fs.readFileSync(file))]));
 const ui=Object.fromEntries(files(path.join(root,'ui'),true).map(file=>[path.relative(root,file).replaceAll('\\','/'),hash(fs.readFileSync(file))]));
 return {key:digest(product),uiSourceHash:digest({ui,lock:product['package-lock.json']}),files:product};
}
function output(root,generation){
 if(typeof generation!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(generation)||generation==='.'||generation==='..')throw Error('CANDIDATE_GENERATION_INVALID');
 const dist=path.resolve(root,'dist');if(fs.existsSync(dist)&&fs.lstatSync(dist).isSymbolicLink())throw Error('CANDIDATE_LINK_REJECTED');
 const base=path.resolve(root,'dist',generation);if(!base.startsWith(path.resolve(root,'dist')+path.sep))throw Error('CANDIDATE_OUTPUT_INVALID');return base;
}
function contained(base,name){
 if(typeof name!=='string'||!name||path.isAbsolute(name)||name.split(/[\\/]/).some(x=>x==='..'||x==='.'||!x))throw Error('CANDIDATE_PATH_INVALID');
 const resolved=path.resolve(base,name),realBase=fs.realpathSync(base);
 let at=resolved;
 while(at!==path.resolve(base)){if(fs.existsSync(at)&&fs.lstatSync(at).isSymbolicLink())throw Error('CANDIDATE_LINK_REJECTED');const next=path.dirname(at);if(next===at)throw Error('CANDIDATE_PATH_INVALID');at=next;}
 if(fs.existsSync(resolved)&&!fs.realpathSync(resolved).startsWith(realBase+path.sep))throw Error('CANDIDATE_PATH_INVALID');
 return resolved;
}
function clone(source,target){
 if(fs.existsSync(target))throw Error('CANDIDATE_OUTPUT_EXISTS');const manifest=tree(source);fs.mkdirSync(target,{recursive:true});
 for(const name of Object.keys(manifest)){const from=path.join(source,name),to=path.join(target,name);fs.mkdirSync(path.dirname(to),{recursive:true});try{fs.linkSync(from,to);}catch(error){if(error.code!=='EXDEV'&&error.code!=='EPERM')throw error;fs.writeFileSync(to,fs.readFileSync(from),{flag:'wx'});}}
 if(digest(tree(target))!==digest(manifest))throw Error('CANDIDATE_CLONE_MISMATCH');return manifest;
}
function shareNew(target,anchors,manifest){
 let linkedBytes=0,linkedFiles=0;
 for(const [name,entry] of Object.entries(manifest)){
  const to=contained(target,name);
  for(const base of anchors){let source;try{source=contained(base,name);}catch{continue;}if(!fs.existsSync(source)||fs.statSync(source).size!==entry.bytes)continue;
   const a=fs.statSync(source,{bigint:true}),b=fs.statSync(to,{bigint:true});if(a.dev===b.dev&&a.ino===b.ino)break;
   if(hash(fs.readFileSync(source))!==entry.sha256)continue;const temp=to+'.candidate-link-'+crypto.randomUUID();
   try{fs.linkSync(source,temp);fs.renameSync(temp,to);linkedBytes+=entry.bytes;linkedFiles++;break;}catch(error){if(fs.existsSync(temp))fs.unlinkSync(temp);if(!['EXDEV','EPERM','EBUSY','EACCES'].includes(error.code))throw error;}
  }
 }
 if(digest(tree(target))!==digest(manifest))throw Error('CANDIDATE_SHARING_MISMATCH');return {linkedFiles,linkedBytes};
}
function receiptValid(receipt,key,root){
 if(receipt?.exitCode!==0||receipt.key!==key||!Array.isArray(receipt.evidence)||!receipt.evidence.length)return false;
 try{return receipt.evidence.every(row=>{const file=contained(root,row.file);return file.startsWith(path.resolve(root,'artifacts')+path.sep)&&fs.existsSync(file)&&hash(fs.readFileSync(file))===row.sha256;});}catch{return false;}
}
module.exports={hash,digest,files,tree,inputs,output,clone,shareNew,receiptValid};
