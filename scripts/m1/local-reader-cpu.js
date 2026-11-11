'use strict';
// Used only by validate:local --performance --profile in its isolated worker.
// CPU locations/counts only: no raw profile, paths, IDs, arguments or bodies.
const inspector=require('node:inspector'),path=require('node:path');
async function profileReaders(store,selected){
 const reader=require('../../src/m1/transcript'),list=store.sessionList().sessions.filter(row=>reader.READERS.has(row.agent))
  .sort((a,b)=>b.days.reduce((n,d)=>n+d.records,0)-a.days.reduce((n,d)=>n+d.records,0)).slice(0,2),reports=[];
 const session=new inspector.Session();session.connect();
 const post=(method,params={})=>new Promise((resolve,reject)=>session.post(method,params,(error,result)=>error?reject(error):resolve(result)));
 try{
  await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});
  for(const row of list){
   await post('Profiler.start');const start=performance.now();
   let value;try{value=await reader.transcript(row.agent,row.id,selected[row.agent]||[]);}finally{
    const {profile}=await post('Profiler.stop'),counts=new Map();for(const id of profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
    const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map(profile.nodes.flatMap(n=>(n.children||[]).map(child=>[child,n.id])));
    const location=n=>({function:n.callFrame.functionName||'(anonymous)',script:path.basename(n.callFrame.url.split('?')[0]),line:n.callFrame.lineNumber+1,column:n.callFrame.columnNumber+1});
    reports.push({agent:row.agent,parserMs:performance.now()-start,items:value?.items.length??0,
     cpu:profile.nodes.filter(n=>counts.has(n.id)).map(n=>{const stack=[];let at=n;for(let depth=0;depth<6&&at;depth++,at=nodes.get(parents.get(at.id)))stack.push(location(at));return {...location(n),samples:counts.get(n.id),stack};}).sort((a,b)=>b.samples-a.samples).slice(0,35)});
   }
  }
  return reports;
 }finally{session.disconnect();}
}
module.exports={profileReaders};
