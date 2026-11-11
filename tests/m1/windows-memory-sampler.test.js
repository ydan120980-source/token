'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {python}=require('../../scripts/m1/python');

test('PDH counts an owned allocation and descendant, excludes its caller, and agrees with CIM',{skip:process.platform!=='win32'||Number(os.release().split('.')[2])<22000,timeout:30000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'usage-counter-test-'));
 const script="global.fixture=Buffer.alloc(40*1024*1024,1);const child=require('node:child_process').spawn(process.execPath,['-e',\"global.fixture=Buffer.alloc(24*1024*1024,1);process.stdout.write('ready');setTimeout(()=>{},25000)\"],{windowsHide:true,stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>process.stdout.write(JSON.stringify({pid:process.pid,child:child.pid})+'\\n'));setTimeout(()=>{},25000);";
 const child=spawn(process.execPath,['-e',script],{windowsHide:true,stdio:['ignore','pipe','ignore']});let descendant;
 try{
  const ids=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('FIXTURE_START_TIMEOUT')),10000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n')){clearTimeout(timer);resolve(JSON.parse(text.trim()));}});});
  descendant=ids.child;assert.equal(ids.pid,child.pid);assert(Number.isSafeInteger(descendant)&&descendant>0);
  const output=execFileSync(python(),[path.resolve(__dirname,'../../scripts/m1/windows-memory-sampler.py'),'--pid',String(child.pid),'--stop-file',path.join(root,'stop'),'--count','3'],{encoding:'utf8',windowsHide:true,timeout:10000});
  const samples=output.trim().split(/\r?\n/).map(JSON.parse);assert.equal(samples.length,3);
  for(const sample of samples)for(const key of ['privateWorkingMiB','privateMiB'])assert.equal(sample.processes.reduce((sum,row)=>sum+row[key],0),sample[key],'per-PID attribution uses the same counter delivery as the total');
  for(const sample of samples){assert(sample.complete,JSON.stringify(sample));assert(sample.pids.includes(child.pid)&&sample.pids.includes(descendant));assert(!sample.pids.includes(process.pid));assert(sample.privateWorkingMiB>64);assert(sample.privateMiB>=sample.privateWorkingMiB);}
  const command='Get-CimInstance Win32_PerfRawData_PerfProc_Process -Filter "IDProcess='+child.pid+' OR IDProcess='+descendant+'" | Select-Object WorkingSetPrivate,PrivateBytes | ConvertTo-Json -Compress';
  const cim=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true,timeout:15000}));assert.equal(cim.length,2);
  for(const [key,field]of [['privateWorkingMiB','WorkingSetPrivate'],['privateMiB','PrivateBytes']])assert(Math.abs(samples.at(-1)[key]-cim.reduce((sum,row)=>sum+Number(row[field])/1048576,0))<5,'same counters agree within ordinary between-sample variation');
 }finally{if(descendant)try{process.kill(descendant);}catch{}child.kill();fs.rmSync(root,{recursive:true,force:true});}
});
