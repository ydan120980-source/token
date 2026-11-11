'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {remove}=require('./temp');
test('standalone runtime denies listeners, connections, child processes and filesystem mutations',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'query-guard-'));t.after(()=>remove(root));
 const script="require('./src/m1/query-runtime').guard();const assert=require('node:assert/strict'),file=process.argv[1];for(const action of [()=>require('node:net').createServer().listen(0),()=>fetch('https://invalid.test'),()=>require('node:child_process').spawn(process.execPath,['--version']),()=>require('node:fs').writeFileSync(file,'private'),()=>require('node:fs').openSync(file,'w')])assert.throws(action,/QUERY_READ_ONLY/);assert(!require('node:fs').existsSync(file));console.log('guard passed');";
 const result=spawnSync(process.execPath,['-e',script,path.join(root,'must-not-exist')],{cwd:path.resolve(__dirname,'../..'),windowsHide:true,encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'guard passed');
});
