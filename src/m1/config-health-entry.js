'use strict';
const {scanConfigHealth}=require('./config-health');
function selection(args){
  if(!args.length||args.length%2)throw new Error('ROOT_REQUIRED');const value={};
  for(let i=0;i<args.length;i+=2){const key=args[i]==='--home'?'home':args[i]==='--project'?'project':null;if(!key||Object.hasOwn(value,key))throw new Error('ROOT_REQUIRED');value[key]=args[i+1];}return value;
}
function main(args){try{return scanConfigHealth(selection(args));}catch{return {schemaVersion:'ConfigHealthV1',errorCode:'CONFIG_HEALTH_SCOPE_REJECTED'};}}
if(require.main===module){const result=main(process.argv.slice(2));process.stdout.write(JSON.stringify(result)+'\n');if(result.errorCode)process.exitCode=1;}
module.exports={selection,main};
