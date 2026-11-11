'use strict';
const path=require('node:path');
// Opt-in owned-window tracing. Discard raw event args and URLs on arrival;
// retain durations, numeric layout counts and code locations. No raw trace/dump.
async function start(cdp){
 const rows=[],marks=[],threads=new Set(),names=new Set(['Layout','UpdateLayoutTree','Paint','PrePaint','Layerize','Commit','FunctionCall','EventDispatch','V8.CompileCode','MajorGC','MinorGC']);let overflow=false;
 const collect=({value})=>{for(const event of value){
  if(event.ph==='M'&&event.name==='thread_name'&&event.args?.name==='CrRendererMain')threads.add(event.pid+':'+event.tid);
  if(event.name?.startsWith('local-perf:')){marks.push({name:event.name.slice(11),at:event.ts});continue;}
  if(event.ph!=='X'||!names.has(event.name)||!Number.isFinite(event.dur))continue;
  if(rows.length>=100000){overflow=true;continue;}
  const detail=event.args?.beginData??event.args?.data??{},stack=Array.isArray(detail.stackTrace)?detail.stackTrace:detail.url?[{functionName:detail.functionName??'',url:detail.url,lineNumber:detail.lineNumber,columnNumber:detail.columnNumber}]:[];
  rows.push({thread:event.pid+':'+event.tid,name:event.name,at:event.ts,ms:event.dur/1000,
   dirtyObjects:Number.isFinite(detail.dirtyObjects)?detail.dirtyObjects:null,totalObjects:Number.isFinite(detail.totalObjects)?detail.totalObjects:null,
   stack:event.dur>8000?stack.slice(0,6).map(frame=>({function:frame.functionName??'',script:path.basename((frame.url??'').split('?')[0]),line:frame.lineNumber,column:frame.columnNumber})):[]});
 }};
 cdp.on('Tracing.dataCollected',collect);await cdp.send('Tracing.start',{categories:'devtools.timeline,blink.user_timing,v8,disabled-by-default-devtools.timeline.stack',transferMode:'ReportEvents'});
 return {async stop(){
  let timer;const done=new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('LAYOUT_TRACE_TIMEOUT')),10000);cdp.once('Tracing.tracingComplete',resolve);});
  try{await cdp.send('Tracing.end');await done;}finally{clearTimeout(timer);cdp.off('Tracing.dataCollected',collect);}
  marks.sort((a,b)=>a.at-b.at);const summary=new Map();
  for(const row of rows){if(!threads.has(row.thread))continue;const phase=marks.findLast(mark=>mark.at<=row.at)?.name??'before-phases',key=phase+'|'+row.name;
   const entry=summary.get(key)??{phase,name:row.name,count:0,nestedTotalMs:0,maxMs:0};entry.count++;entry.nestedTotalMs+=row.ms;entry.maxMs=Math.max(entry.maxMs,row.ms);summary.set(key,entry);
  }
  const slow=rows.filter(row=>threads.has(row.thread)&&row.ms>8).sort((a,b)=>b.ms-a.ms).slice(0,40).map(({thread:_thread,at,...row})=>({...row,phase:marks.findLast(mark=>mark.at<=at)?.name??'before-phases'}));
  return {diagnosticOnly:true,rawTraceSaved:false,overflow,rendererThreads:threads.size,markers:marks.length,measurement:'nested durations by fixed phase; categories overlap and must not be summed as exclusive wall time',summary:[...summary.values()],slow};
 }};
}
module.exports={start};
