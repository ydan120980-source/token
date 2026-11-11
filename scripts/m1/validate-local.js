'use strict';
// Opt-in real-source entry. Does not change product state or validation badges.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Worker}=require('node:worker_threads');
const {roots,filesUnder,disableNetwork,SOURCES}=require('../../src/m1/policy');
const {scanSources,canonical,parseObjects}=require('../../src/m1/sources');
const {verifyProjection}=require('../../src/m1/native');
const {atomic}=require('../../src/m1/store');
const {independent,compare}=require('./source-oracle');
function stamp(file,agent){const files=[file,...(agent==='antigravity'?require('../../src/m1/antigravity').companions(file):[])];return files.flatMap(f=>[f,...(/\.(?:db|sqlite)$/i.test(f)?[f+'-wal']:[])]).map(f=>{try{const st=fs.statSync(f);return [st.size,st.mtimeMs,st.ino].join(':');}catch(e){if(e.code==='ENOENT')return 'absent';throw e;}}).join('|');}
async function validate({selected=roots(),directory=path.resolve('artifacts/local-validation-'+Date.now()),maxSamples=3,native=true,onSpawn=()=>{}}={}){
  const audit={reads:0,networkAttempts:0},salt=crypto.randomBytes(32).toString('hex'),started=Date.now();
  disableNetwork(audit);
  for(const root of Object.values(selected).flat())if(require('../../src/m1/jsonl-adapter').overlaps(root,directory))throw new Error('VALIDATION_OUTPUT_OVERLAP');
  fs.mkdirSync(directory,{recursive:true});
  const report={schemaVersion:'LocalSourceValidationV2',at:new Date().toISOString(),scope:'bounded-file-samples',writesProductState:false,sourceIdentityVerified:false,modelPairingVerified:false,nativeScope:native?'statistics-projection-only':'not-run',audit,sources:{}};
  for(const agent of SOURCES){
    const files=new Set(),listingIssues=[];let detected=false;
    for(const root of selected[agent]||[])try{detected||=fs.existsSync(root);const found=filesUnder(agent,root,audit);for(const f of found)files.add(f);if(found.limited)listingIssues.push('SOURCE_LIMIT');if(found.aliased)listingIssues.push('SOURCE_ALIAS_REJECTED');if(found.unreadable)listingIssues.push('SOURCE_UNREADABLE');}catch{listingIssues.push('SOURCE_UNREADABLE');}
    const candidates=canonical(agent,[...files]).sort(),samples=[],skipped={};let attempted=0;
    for(const file of candidates.slice().reverse()){
      if(samples.length>=maxSamples||attempted>=12||Date.now()-started>120000)break;
      attempted++;
      try{
        const before=stamp(file,agent),expected=await independent(agent,file,audit);
        if(!expected.comparable){const reason=expected.reason||'NO_COMPARABLE_USAGE';skipped[reason]=(skipped[reason]||0)+1;continue;}
        const scan=(await scanSources({[agent]:[file]},salt,audit))[agent];
        if(stamp(file,agent)!==before){skipped.SOURCE_BUSY=(skipped.SOURCE_BUSY||0)+1;continue;}
        const ids=expected.projection?new Set(parseObjects(agent,expected.projection,salt,'database').map(r=>r.id)):null;
        const records=ids?scan.records.filter(r=>ids.has(r.id)):scan.records;
        const sample={...compare(expected,records),...(expected.sampling?{sampling:expected.sampling}:{}),...(agent==='antigravity'?{modelPairingVerified:expected.modelPairingVerified===true,...(expected.modelPairingReason?{modelPairingReason:expected.modelPairingReason}:{})}:{}),scanPartial:scan.partial,scanErrors:scan.errors};
        if(native)try{sample.native=await verifyProjection(records,path.join(directory,'native'),onSpawn);}finally{onSpawn(null);}
        sample.passed=sample.matches&&!scan.partial&&!scan.errors.length&&(!native||sample.native.status==='passed');samples.push(sample);
      }catch{skipped.SAMPLE_UNREADABLE_OR_SCHEMA=(skipped.SAMPLE_UNREADABLE_OR_SCHEMA||0)+1;}
    }
    report.sources[agent]={selected:Object.hasOwn(selected,agent),detected,listedFiles:candidates.length,attempted,samples,skipped,listingIssues:[...new Set(listingIssues)],sampleVerified:samples.length>0&&samples.every(s=>s.passed)&&!listingIssues.length,coverage:!Object.hasOwn(selected,agent)?'not-selected':files.size?'sample-only':'no-files',candidateLimitReached:attempted>=12&&samples.length<maxSamples};
  }
  report.custom={sampleVerified:false,reason:'NO_EXPLICIT_CUSTOM_DIRECTORY_SELECTED_FOR_THIS_RUN'};
  report.elapsedMs=Date.now()-started;atomic(path.join(directory,'report.json'),report);return report;
}
if(require.main===module){
  if(process.argv.includes('--worker')){
    const {parentPort,workerData}=require('node:worker_threads');
    validate({...workerData,onSpawn:childPid=>parentPort.postMessage({childPid})}).then(report=>parentPort.postMessage({report}),()=>parentPort.postMessage({error:'LOCAL_VALIDATION_FAILED'}));
  }else{
    const args=process.argv.slice(2),options={};let selectedNames=null;
    for(let i=0;i<args.length;i++){
      const key=args[i];if(key==='--performance'){options.performance=true;continue;}if(key==='--reader-only'){options.readerOnly=true;continue;}if(key==='--profile'){options.profile=true;continue;}if(key==='--layout-profile'){options.layoutProfile=true;continue;}if(!['--home','--output','--sources'].includes(key)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('VALIDATION_ARGUMENT_INVALID');
      const value=args[++i];if(key==='--sources'){selectedNames=value.split(',');if(selectedNames.some(name=>!SOURCES.includes(name)))throw new Error('VALIDATION_ARGUMENT_INVALID');}else if(key==='--home')options.selected=roots(path.resolve(value));else options.directory=path.resolve(value);
    }
    if(selectedNames)options.selected=Object.fromEntries(Object.entries(options.selected||roots()).filter(([name])=>selectedNames.includes(name)));
    if((options.profile||options.layoutProfile||options.readerOnly)&&!options.performance)throw Error('VALIDATION_ARGUMENT_INVALID');
    if(options.performance){
      require('./local-performance').run(options).then(report=>console.log(JSON.stringify(report,null,2)),()=>{console.error('LOCAL_PERFORMANCE_FAILED');process.exitCode=1;});
    }else{
    const worker=new Worker(__filename,{argv:['--worker'],workerData:options});
    let childPid=null,finished=false;
    const stop=()=>{if(childPid){try{process.kill(childPid);}catch{}childPid=null;}worker.terminate();};
    const timer=setTimeout(()=>{finished=true;stop();console.error('LOCAL_VALIDATION_TIMEOUT');process.exitCode=1;},180000);
    worker.on('message',message=>{if(Object.hasOwn(message,'childPid')){childPid=message.childPid;return;}finished=true;clearTimeout(timer);if(message.error){console.error(message.error);process.exitCode=1;}else{console.log(JSON.stringify(message.report,null,2));if(Object.values(message.report.sources).some(s=>s.samples.some(r=>!r.passed)))process.exitCode=1;}stop();});
    worker.on('error',()=>{finished=true;clearTimeout(timer);stop();console.error('LOCAL_VALIDATION_WORKER_FAILED');process.exitCode=1;});
    worker.on('exit',()=>{clearTimeout(timer);if(!finished){stop();console.error('LOCAL_VALIDATION_WORKER_FAILED');process.exitCode=1;}});
    }
  }
}
module.exports={validate};
