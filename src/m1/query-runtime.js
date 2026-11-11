'use strict';
// Defense in depth, installed only in the standalone query process. This is not
// an OS sandbox; the query implementation still owns the four-file read whitelist.
function guard() {
  const denied=()=>{throw new Error('QUERY_READ_ONLY');};
  globalThis.fetch=denied;
  for(const module of ['node:http','node:https']){const api=require(module);api.request=denied;api.get=denied;}
  const net=require('node:net');net.Server.prototype.listen=denied;net.Socket.prototype.connect=denied;net.connect=denied;net.createConnection=denied;
  require('node:tls').connect=denied;
  const child=require('node:child_process');for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])child[name]=denied;
  const fs=require('node:fs');
  for(const name of ['writeFile','appendFile','mkdir','mkdtemp','rename','rm','rmdir','unlink','copyFile','cp','truncate','chmod','chown','utimes','link','symlink']){
    if(fs[name])fs[name]=denied;if(fs[name+'Sync'])fs[name+'Sync']=denied;if(fs.promises[name])fs.promises[name]=denied;
  }
  fs.createWriteStream=denied;
  for(const [api,name] of [[fs,'open'],[fs,'openSync'],[fs.promises,'open']]){const original=api[name];api[name]=function(file,flags,...args){if(!['r','rs',0].includes(flags))return denied();return original.call(this,file,flags,...args);};}
}
module.exports={guard};
