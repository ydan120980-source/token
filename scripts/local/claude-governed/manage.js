'use strict';
// Manual owner-machine tool. Nothing in the application imports this entry.
const path=require('node:path'),os=require('node:os');
function request(args){
  if(args.length!==4||!['check','install','rollback'].includes(args[0])||args[1]!=='--root'||!path.isAbsolute(args[2])||args[3]!=='--confirm-local-governed-maintenance')throw new Error('LOCAL_ARGUMENTS_REQUIRED');
  return {action:args[0],root:path.resolve(args[2])};
}
async function main(args){
  const input=request(args),home=os.homedir(),abort=new AbortController();process.once('SIGINT',()=>abort.abort());
  const environment={home,appData:process.env.APPDATA||path.join(home,'AppData/Roaming'),localAppData:process.env.LOCALAPPDATA||path.join(home,'AppData/Local'),systemRoot:process.env.SystemRoot,temp:os.tmpdir(),arch:process.arch};
  const engine=require('./engine').makeEngine({root:input.root,environment,signal:abort.signal,allowGoverned:true,report:row=>process.stdout.write(JSON.stringify({stage:row.stage})+'\n')});
  const result=input.action==='check'?await engine.inspect('claude',false):await engine[input.action]('claude');
  process.stdout.write(JSON.stringify({state:result.state||null,version:result.version||null,installed:result.installed===true,rolledBack:result.rolledBack===true,runnable:result.runnable===true})+'\n');
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{process.stderr.write((/^(INSTALL|LOCAL)_[A-Z_]+$/.test(error.message)?error.message:'LOCAL_FAILED')+'\n');process.exitCode=1;});
module.exports={request};
