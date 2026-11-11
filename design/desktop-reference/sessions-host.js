'use strict';
// M5: metadata/usage only. The small summary service is independent of the page.
(()=>{
 const bridge=window.usageBridge,demo=new URLSearchParams(location.search).has('demo'),snapshotOnly=!bridge&&!demo&&window.previewUsage?.schemaVersion==='LocalUsagePreviewV1';
 const state={list:null,error:false,loading:false,stale:true,drill:null,range:'today',labels:{},reading:null,also:[],compare:null,all:null},summaries=new Map();let labelsRead=null;let drills=0;let epoch=0,reading=null,recentList=null,recentReading=null,recentEpoch=0,recentStale=false,recentFailed=false,holds=0,allReading=null,allEpoch=0;
 const visible=()=>document.getElementById('main')?.dataset.currentView==='sessions',publish=()=>window.dispatchEvent(new Event('sessions-change'));
 const model=()=>window.sessionsModel.create({list:state.list,agent:'all',range:'today',sort:'cost',query:''},window),toast=text=>window.usageData?.toast(text);
 async function load(range=state.range){
  if(!['today','7','30','all'].includes(range))throw Error('SESSION_SELECTION_INVALID');
  if(range!==state.range){state.range=range;state.stale=true;epoch++;}
  if(snapshotOnly){state.list=null;publish();return;}
  void loadLabels();
  if(!bridge){const list=model().demoList();state.list=window.settingsHost?.demo.get()==='empty'?{...list,sessions:[],unattributed:{}}:list;state.stale=false;publish();return;}
  if(reading)return reading;
  const version=epoch;state.loading=true;publish();
  reading=(async()=>{try{const list=await bridge.sessions({range:state.range});if(version===epoch){state.list=list;state.error=false;state.stale=false;}}catch{state.error=true;if(state.list&&visible())toast('会话列表刷新失败，显示的是上一次的结果。');}finally{reading=null;state.loading=false;if(version!==epoch&&visible())void load();else publish();}})();return reading;
 }
 // Names and pins the person gives sessions (SESSIONS-NEXT-20261101.md): the app's own file, read once.
 function loadLabels(){if(labelsRead)return labelsRead;labelsRead=(async()=>{try{if(bridge?.sessionLabels){state.labels=await bridge.sessionLabels()||{};publish();}}catch{labelsRead=null;}})();return labelsRead;}
 // How far a conversation was read: only the turn number, saved quietly; a failed save costs nothing.
 async function position(key,turn){try{if(bridge?.setSessionLabel)state.labels=await bridge.setSessionLabel(key,{turn:turn>0?turn:null})||{};}catch{/* Not remembered this time. */}}
 async function label(key,patch){
  if(!/^[a-f0-9]{64}$/.test(key)&&!/^d\d+0+$/.test(key))return false;
  if(!bridge){const next={...state.labels[key],...patch};for(const name of ['alias','pinned','group'])if(!next[name])delete next[name];state.labels={...state.labels};if(Object.keys(next).length)state.labels[key]=next;else delete state.labels[key];publish();return true;}
  try{state.labels=await bridge.setSessionLabel(key,patch)||{};publish();return true;}catch{toast(patch.alias!==undefined?'保存会话名称失败':patch.group!==undefined?'保存分组失败':'置顶失败');return false;}
 }
 // The reading view (SESSIONS-READER-20261101.md): one session at a time, read from its file on request, never kept here.
 // Agents with a conversation reader (src/m1/transcript.js READERS).
 const READABLE=new Set(['codex','claude','opencode','mimo','zcode','gemini','deepseek','antigravity','copilot','cline','pi','continue','kilo','qwen','kimi','cursor','workbuddy']);
 // Several conversations may be open side by side (UI-SESSIONS-MULTI-20261102.md); each keeps its place when another closes.
 const MAX_ALSO=2,target=(session,slot)=>({key:session.key,slot,agent:session.agent,name:session.name||session.title||null,project:session.project||null,start:session.start,end:session.end,find:typeof session.find==='string'?session.find.slice(0,120):null,file:typeof session.file==='string'?session.file:null});let slots=0;
 function read(session){if(!session||!READABLE.has(session.agent)){state.reading=null;state.also=[];publish();return;}state.also=state.also.filter(pane=>pane.key!==session.key);state.reading=target(session,state.reading?.slot??0);publish();}
 function readAlso(session){if(!state.reading||!READABLE.has(session?.agent)||state.reading.key===session.key||state.also.some(pane=>pane.key===session.key)||state.also.length>=MAX_ALSO)return;state.also=[...state.also,target(session,++slots)];publish();}
 function readInSlot(slot,session){if(!READABLE.has(session?.agent)||state.reading?.key===session.key||state.also.some(pane=>pane.key===session.key))return;if(state.reading?.slot===slot)state.reading=target(session,slot);else state.also=state.also.map(pane=>pane.slot===slot?target(session,slot):pane);publish();}
 function closePane(key){if(state.reading?.key===key){const [next,...rest]=state.also;state.reading=next??null;state.also=next?rest:[];}else state.also=state.also.filter(pane=>pane.key!==key);publish();}
 function compare(keys){state.compare=Array.isArray(keys)&&keys.length?keys.slice(0,2):null;publish();}
 // Figures of a conversation for a comparison: read when asked, no text of the conversation, not kept here.
 // Every session, whatever range the page shows, while something needs them: the reading page and the quick switch. It is let go with the last of them.
 async function loadAll(){if(allReading)return allReading;
  // The page already owns these exact saved facts. Share its reference while a reader
  // holds all; do not request and retain a second IPC copy of the same full list.
  if(holds&&state.range==='all'&&state.list&&!state.stale&&!state.loading){state.all=state.list;publish();return;}
  const version=allEpoch;allReading=(async()=>{try{const list=bridge?await bridge.sessions({range:'all'}):model().demoList();if(version===allEpoch&&holds)state.all=list;}catch{/* The page's own list stands in. */}finally{allReading=null;publish();}})();return allReading;}
 function holdAll(){holds++;if(!state.all)void loadAll();return ()=>{holds--;if(!holds){state.all=null;allEpoch++;}};}
 // Which other sessions changed a file: one batch per call, continued from its next offset; nothing is kept here.
 async function fileHistory(request){if(!bridge?.transcriptFileHistory)throw Error('TRANSCRIPT_PREVIEW');return bridge.transcriptFileHistory(request);}
 async function facts(key){if(!bridge?.transcriptFacts)throw Error('TRANSCRIPT_PREVIEW');return bridge.transcriptFacts(key);}
 async function renameGroup(from,to){for(const [key,value] of Object.entries(state.labels))if(value.group===from)await label(key,{group:to});}
 async function transcript(key,previous){if(!bridge?.transcript)throw Error('TRANSCRIPT_PREVIEW');const protocol=window.transcriptContinuation;if(!protocol)return bridge.transcript(key);return protocol.merge(previous,await bridge.transcript(key,protocol.request(previous)));}
 // Search across conversations: one batch per call, continued from its next offset; results are not kept here.
 // One item in full and find over the full text of the open conversation; nothing is kept here.
 async function part(key,request){if(!bridge?.transcriptPart)throw Error('TRANSCRIPT_PREVIEW');return bridge.transcriptPart(key,request);}
 async function stamp(key){if(!bridge?.transcriptStamp)throw Error('TRANSCRIPT_PREVIEW');return bridge.transcriptStamp(key);}
 async function find(key,request){if(!bridge?.transcriptFind)throw Error('TRANSCRIPT_PREVIEW');return bridge.transcriptFind(key,request);}
 // Copy a turn or save the conversation as Markdown (full text), and open a link the person clicked.
 async function copyTurns(key,request){try{if(!bridge?.transcriptCopy)throw Error('TRANSCRIPT_PREVIEW');await bridge.transcriptCopy(key,request);toast(request?.plain?'已复制这条消息':'已复制这一轮');return true;}catch(error){if(/TRANSCRIPT_CHANGED/.test(String(error?.message)))throw error;toast('复制失败');return false;}}
 async function exportMarkdown(key,request){try{if(!bridge?.transcriptExport)throw Error('TRANSCRIPT_PREVIEW');const result=await bridge.transcriptExport(key,request);if(result?.saved)toast('已导出对话');return Boolean(result?.saved);}catch(error){if(/TRANSCRIPT_CHANGED/.test(String(error?.message)))throw error;toast('导出失败');return false;}}
 async function openLink(url){try{if(!bridge?.openLink)throw Error('LINK_PREVIEW');await bridge.openLink(url);return true;}catch{toast('无法打开这个链接');return false;}}
 async function search(request){if(!bridge?.searchTranscripts)throw Error('TRANSCRIPT_PREVIEW');return bridge.searchTranscripts(request);}
 // The recent list behind the summary card and the widgets. It has its own version, so a change of the page's range cannot
 // void it; what is on screen stays while newer data is read; a failed read says so and tries again with the next data.
 async function loadRecent(){if(recentReading)return recentReading;const version=recentEpoch;recentReading=(async()=>{try{const list=bridge?await bridge.sessions({recent:true}):model().demoList();if(version===recentEpoch){recentList=list;recentStale=false;}recentFailed=false;}catch{recentFailed=true;}finally{recentReading=null;publish();}})();return recentReading;}
 function wantRecent(){if(recentReading||recentFailed)return;if(!recentList||recentStale)void loadRecent();}
 function summary(date=model().today(),modelName='all'){
  if(!bridge?.sessionSummary)return null;
  const key=JSON.stringify([date,modelName]);let entry=summaries.get(key);
  if(!entry){if(summaries.size>=8)summaries.delete(summaries.keys().next().value);const version=epoch;entry={value:null};summaries.set(key,entry);void bridge.sessionSummary({date,model:modelName}).then(value=>{if(version===epoch&&summaries.get(key)===entry){entry.value=value;publish();}}).catch(()=>{});}
  return entry.value;
 }
 function count({agent='all',date=model().today(),model:modelName='all'}={}){if(bridge?.sessionSummary){const value=summary(date,modelName);return value?agent==='all'?value.count:value.agents[agent]||0:null;}if(!state.list)return null;return state.list.sessions.filter(s=>(agent==='all'||s.agent===agent)&&(modelName==='all'||s.models.includes(modelName))&&s.days.some(row=>row.date===date)).length;}
 async function copyText(text,kind='inspector'){
  const success=kind==='project'?'已复制项目工作目录路径':kind==='id'?'已复制完整会话 ID':'已复制到剪贴板',failure=kind==='project'?'复制项目路径失败':kind==='id'?'复制会话 ID失败':'复制失败';
  try{if(bridge?.copyText)await bridge.copyText(text);else if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);else throw Error('COPY_UNAVAILABLE');toast(success);return true;}catch{toast(failure);return false;}
 }
 async function openFolder(key,kind='row'){
  if(kind==='project'&&!key){toast('该项目未记录有效的工作目录');return false;}
  if(!bridge){toast('界面预览不调用系统资源管理器；桌面应用里会在资源管理器中打开对应工作目录。');return false;}
  try{const result=await bridge.openFolder(key);if(result?.opened)toast(kind==='project'?'已在文件资源管理器中打开项目目录':'已在文件资源管理器中打开工作目录');return Boolean(result?.opened);}catch(error){toast(error?.message?.includes('DIRECTORY_MISSING')?'工作目录在磁盘上不存在':kind==='row'&&error?.message?.includes('DIRECTORY_NOT_FOUND')?'该会话未记录有效的工作目录':kind==='project'?'打开项目目录失败':'打开工作目录失败');return false;}
 }
 async function copyResume(key){if(!bridge){toast('界面预览不复制命令；桌面应用里会把恢复命令复制到剪贴板。');return false;}try{await bridge.copyResume(key);toast('已复制恢复命令，粘贴到 PowerShell 里执行即可回到该会话。');return true;}catch{toast('无法生成这个会话的恢复命令。');return false;}}
 // Other pages open the sessions page on an Agent and range; the page may mount after the request.
 function drillDown(agent='all',range='today',query=null){state.drill={agent,range,query:typeof query==='string'?query.slice(0,120):null,seq:++drills};publish();}
 window.sessionsHost=Object.freeze({get:()=>state,list:()=>state.list,load,labels:()=>state.labels,label,position,read,readAlso,readInSlot,closePane,compare,facts,renameGroup,holdAll,fileHistory,readable:agent=>READABLE.has(agent),transcript,stamp,part,find,copyTurns,exportMarkdown,openLink,search,recent:()=>recentList,recentFailed:()=>recentFailed,loadRecent,wantRecent,summary,count,openFolder,copyResume,copyText,drillDown,snapshotOnly});
 // The pre-migration reader kept for the widgets, the usage page and the home page (list/loaded/reload/count).
 window.sessionsUi=Object.freeze({count,reload:load,drillDown,list:()=>state.list,get loaded(){return Boolean(state.list);}});
 window.addEventListener('ui-view-change',event=>{if(event.detail==='sessions'&&(state.stale||!state.list))void load();});
 // Collection busy/checkedAt notifications do not change the session facts.
 // The snapshot owner emits this only for changed facts (including repricing).
 window.addEventListener('usage-data-change',()=>{epoch++;state.stale=true;summaries.clear();recentEpoch++;recentStale=true;recentFailed=false;allEpoch++;if(holds)void loadAll();if(visible())void load();else publish();});
 window.addEventListener('demo-state-change',()=>{void load();});
 if(!bridge)void load();
})();
