'use strict';
// Local-only immutable candidates. No publishing, source reads, updater network,
// certificate discovery, ZIP creation, retention cleanup or repeated green checks.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const core=require('./candidate-core'),root=path.resolve(__dirname,'../..');
function execute(file,args=[],options={}){const result=spawnSync(process.execPath,[file,...args],{cwd:root,windowsHide:true,stdio:'inherit',...options});if(result.status!==0)throw Error('CANDIDATE_COMMAND_FAILED');return result;}
function manifests(){return fs.existsSync(path.join(root,'dist'))?fs.readdirSync(path.join(root,'dist'),{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.isSymbolicLink()).flatMap(x=>{const base=path.join(root,'dist',x.name),file=path.join(base,'candidate-inputs.json');try{if(fs.lstatSync(file).isSymbolicLink())return [];return [{...JSON.parse(fs.readFileSync(file,'utf8')),base}];}catch{return [];}}):[];}
function verify(candidate){if(core.digest(core.tree(path.join(candidate.base,'win-unpacked')))!==candidate.runtimeDigest)throw Error('CANDIDATE_BYTES_CHANGED');execute(path.join(root,'scripts/m1/audit-package.js'),[path.join(candidate.base,'win-unpacked')]);}
function environment(){
 let display=null;if(process.platform==='win32'){const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_VideoController | Select-Object CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate | ConvertTo-Json -Compress'],{encoding:'utf8',windowsHide:true,timeout:15000});if(result.status===0)try{display=JSON.parse(result.stdout);}catch{/* Unknown display prevents receipt reuse. */}}
 if(![display].flat().some(x=>x&&x.CurrentHorizontalResolution>0&&x.CurrentVerticalResolution>0&&x.CurrentRefreshRate>0))display=null;
 return {os:os.release(),platform:process.platform,arch:process.arch,node:process.version,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,day:new Date().toLocaleDateString('en-CA'),display};
}
async function main(argv){
 const mode=argv[0]||'plan',option=name=>{const at=argv.indexOf(name);return at<0?null:argv[at+1];};if(!['plan','build','check'].includes(mode)||argv.some((x,i)=>i>0&&!['--generation','--suite','--fresh'].includes(x)&&!['--generation','--suite'].includes(argv[i-1])))throw Error('CANDIDATE_ARGUMENT_INVALID');
 const generation=option('--generation'),suite=option('--suite'),state=core.inputs(root),known=manifests(),same=known.find(c=>c.inputs?.key===state.key&&c.inputs?.uiSourceHash===state.uiSourceHash);
 if(mode==='plan'){console.log(JSON.stringify({status:same?'REUSABLE_BYTES':'BUILD_REQUIRED',inputKey:state.key,uiSourceHash:state.uiSourceHash,existing:same?path.relative(root,same.base):null,createsArchives:false,publishes:false},null,2));return;}
 if(!generation)throw Error('CANDIDATE_GENERATION_REQUIRED');const base=core.output(root,generation);
 const lock=path.join(root,'.cache/local-candidate/operation.lock');fs.mkdirSync(path.dirname(lock),{recursive:true});const fd=fs.openSync(lock,'wx');
 try{
  if(mode==='build'){
   if(fs.existsSync(base)){const old=known.find(c=>c.base===base);if(old&&old.inputs.key===state.key&&old.inputs.uiSourceHash===state.uiSourceHash){verify(old);console.log('REUSED existing current candidate; no build or archive');return;}throw Error('CANDIDATE_OUTPUT_EXISTS');}
   let current=state,cached=same;
   if(!cached){execute(require.resolve('typescript/bin/tsc'),['-p','ui/tsconfig.json']);execute(path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),['build','--config','ui/vite.config.ts']);current=core.inputs(root);cached=known.find(c=>c.inputs?.key===current.key);}
   let runtime,reusedFrom=null,sharing;
   if(cached){verify(cached);runtime=core.clone(path.join(cached.base,'win-unpacked'),path.join(base,'win-unpacked'));reusedFrom=path.relative(root,cached.base);}
   else{execute(path.join(root,'scripts/m1/check-build-deps.js'));execute(require.resolve('electron-builder/out/cli/cli.js'),['--win','dir','--x64','--publish','never','--config.directories.output='+base]);execute(path.join(root,'scripts/m1/audit-package.js'),[path.join(base,'win-unpacked')]);runtime=core.tree(path.join(base,'win-unpacked'));
    const anchors=fs.readdirSync(path.join(root,'dist'),{withFileTypes:true}).filter(x=>x.isDirectory()&&!x.isSymbolicLink()&&x.name!==generation).map(x=>path.join(root,'dist',x.name,'win-unpacked')).filter(x=>fs.existsSync(x));sharing=core.shareNew(path.join(base,'win-unpacked'),anchors,runtime);
   }
   const manifest={schemaVersion:'LocalCandidateV1',createdAt:new Date().toISOString(),inputs:current,runtime,runtimeDigest:core.digest(runtime),reusedFrom,sharing:sharing||null,publish:'never',archivesCreated:false};fs.writeFileSync(path.join(base,'candidate-inputs.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({status:cached?'REUSED_VERIFIED_BUILD':'BUILT_AND_AUDITED',directory:base,inputKey:current.key,sharing,reusedFrom},null,2));return;
  }
  const candidate=known.find(c=>c.base===base);if(!candidate||candidate.inputs.key!==state.key||candidate.inputs.uiSourceHash!==state.uiSourceHash)throw Error('CANDIDATE_NOT_CURRENT');verify(candidate);
  if(!suite||!/^[a-z0-9-]+-ui-test\.js$/.test(suite)||/performance|high-refresh/.test(suite))throw Error('CANDIDATE_FUNCTIONAL_SUITE_REQUIRED');const script=path.join(root,'scripts/m1',suite);if(!fs.existsSync(script))throw Error('CANDIDATE_SUITE_MISSING');
  const envState=environment(),testFiles=[...core.files(path.join(root,'scripts/m1')),...core.files(path.join(root,'tests/m1'))],testHash=core.digest(testFiles.map(f=>[path.relative(root,f),core.hash(fs.readFileSync(f))]));
  const key=core.digest({product:candidate.runtimeDigest,testHash,suite,environment:envState}),receiptFile=path.join(root,'.cache/local-candidate/receipts',key+'.json');let old;try{old=JSON.parse(fs.readFileSync(receiptFile,'utf8'));}catch{/* No past pass. */}
  if(!argv.includes('--fresh')&&envState.display&&core.receiptValid(old,key,root)){console.log(JSON.stringify({status:'REUSED_PAST_PASS',suite,executedAt:old.executedAt,receipt:receiptFile},null,2));return;}
  const out=path.join(root,'artifacts/local-candidate',generation,suite.replace('.js','')+'-'+Date.now()),log=path.join(out,'run.log');fs.mkdirSync(out,{recursive:true});const logFd=fs.openSync(log,'wx'),env={...process.env,QUOTA_PACKAGED_EXE:path.join(base,'win-unpacked/Agent Usage Quota.exe')};
  for(const match of fs.readFileSync(script,'utf8').matchAll(/process\.env\.([A-Z_]*EVIDENCE_DIR)/g))env[match[1]]=path.join(out,match[1].toLowerCase());
  const began=new Date().toISOString();let result;try{result=spawnSync(process.execPath,[script],{cwd:root,env,windowsHide:true,stdio:['ignore',logFd,logFd],timeout:600000});}finally{fs.closeSync(logFd);}
  const evidence=core.files(out).map(file=>({file:path.relative(root,file),sha256:core.hash(fs.readFileSync(file))})),receipt={key,suite,exitCode:result.status,error:result.error?.code||null,executedAt:began,finishedAt:new Date().toISOString(),environment:envState,product:candidate.runtimeDigest,evidence};fs.mkdirSync(path.dirname(receiptFile),{recursive:true});fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:result.status===0?'PASS_NEW_RUN':'FAIL_NEW_RUN',suite,receipt:receiptFile,log},null,2));if(result.status!==0)throw Error('CANDIDATE_SUITE_FAILED');
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={main};
