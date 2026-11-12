'use strict';
(() => {
  const $=id=>document.getElementById(id),bridge=window.usageBridge;
  const state={draft:'',message:'',error:'',focusBudget:null,view:null,general:null,period:'monthly',project:'all',busy:false,dirty:false,version:0,open:new Set(),budgetOpen:new Set(),capOpen:new Set(),kind:'all',expanded:false};
  const count=value=>new Intl.NumberFormat('zh-CN').format(value);
  const money=value=>value===null?'未定价':value>0&&value<.005?'<$0.01':window.displayValues.usd(value);
  // Budget thresholds are user-entered settings; retain their finer precision.
  const budgetMoney=value=>value>0&&value<.0000005?'<$0.000001':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(value);
  const cost=row=>row.lower===null?'未定价':row.lower===row.upper?money(row.lower):money(row.lower)+' – '+money(row.upper);
  const agent=id=>state.general?.sources.find(s=>s.agent===id)?.name||window.agentCatalog.agents[id]?.name||'全部来源';
  const selection=()=>({period:state.period,project:state.project});
  const fieldNames={inputUncached:'未缓存输入',output:'输出（含推理）',cacheRead:'缓存读取',cacheWrite:'缓存写入',reasoning:'推理'};
  const issueNames={SOURCE_BUSY:'来源文件正在写入',SOURCE_UNREADABLE:'来源暂不可读',SOURCE_PARSE_FAILED:'来源格式暂不可解析',SOURCE_LIMIT:'扫描达到范围限制',SOURCE_TIMEOUT:'扫描超时',SOURCE_ROW_INVALID:'部分用量记录无效',SOURCE_USAGE_CONFLICT:'同调用的观测存在冲突',SOURCE_USAGE_REGRESSION:'观察到较旧的用量快照',CUSTOM_HISTORY_RETAINED:'部分文件沿用已保存历史',CUSTOM_COUNTER_UNSUPPORTED:'记录的计数方式暂不支持',USAGE_QUALITY_PARTIAL:'用量字段缺失或存在冲突',USAGE_UNPRICED:'部分用量未计入费用估算',PROJECT_UNATTRIBUTED:'部分用量缺少项目归属',BUDGET_EXCEEDED:'已观测估算达到预算',BUDGET_POSSIBLY_EXCEEDED:'估算区间可能达到预算',BUDGET_INCOMPLETE:'未定价用量使预算无法完整判断',BUDGET_UNPRICED:'当前用量尚无法估算费用'};
  // The settings page's reprice block moved to the React layer with the page (M3, 2026-10-25).
  const visiblePage=()=>['cost','sources','sessions'].find(id=>!$(id).hidden);
  let revision=0;
  function publish(){revision++;window.dispatchEvent(new CustomEvent('insights-change'));}
  function message(text,error=false){
    if(visiblePage()==='cost'){state[error?'error':'message']=text;publish();return;}
    const current=visiblePage(),e=current&&document.querySelector('[data-insight-status="'+current+'"]');
    if(e){e.textContent=text;e.setAttribute('role',error?'alert':'status');}
  }
  function controls(){
    publish();
  }
  // The same coverage as data for the React sources page (M4).
  function capabilityView(id){
    const s=state.general?.sources.find(row=>row.agent===id);if(!s)return null;
    return {formats:s.formats.join(' / '),
      note:'全部已保存历史 · 只读采集 · '+(s.realSampleVerified?'本机真实样本已验证':'尚无当前解析规则的真实样本验证标记')+(s.ruleVersion!==null?' · 规则版本 '+s.ruleVersion:'')+(s.mixedRules?' · 部分历史使用旧规则':''),
      semantics:'输入：'+({inclusive:'含缓存',exclusive:'不含缓存','schema-dependent':'按已验证的来源结构解释'}[s.inputSemantics])+'；原始输出：'+({'includes-reasoning':'含推理','excludes-reasoning':'不含推理，归一化时合并','schema-dependent':'按已验证的来源结构解释'}[s.outputSemantics])+'。'+(s.quota?'账户额度另由 Codex 连接提供。':'不提供账户额度。'),
      fields:Object.entries(fieldNames).map(([field,label])=>({label,value:s.known[field].records+' / '+s.records+' 条已报告'})),
      summary:count(s.totalTokens)+' Token · '+cost(s)+' · '+s.sessions+' 个已识别会话'};
  }
  // One "需要处理" list on the Sources page replaces the four per-page lists
  // (UI-SOURCES-MANAGE-20261020.md). Each item says in one sentence what is wrong and how much
  // it affects; its button goes to where it is fixed. Other pages keep a one-line notice.
  const KINDS=[['sources','来源'],['cost','费用'],['sessions','会话'],['budget','预算']];
  const PERIODS={daily:'今天',weekly:'本周',monthly:'本月',total:'全部历史'};
  const budgetOverview=()=>state.general?.budgetOverview;
  const budgetKey=row=>row.scope+':'+row.period;
  const budgetName=row=>row.projectLabel||row.projectName||(row.scope==='all'?'全部项目':row.scope==='unknown'?'未知项目':'无法关联的项目');
  const budgetStates={'not-set':'当前项目与周期尚未设置预算。','no-data':'当前周期没有已观测记录，无法判断预算使用情况。',unpriced:'当前用量未定价，无法判断预算使用情况。',exceeded:'已计价部分的估算下限已达到预算。','possibly-exceeded':'估算区间上限已达到预算，实际情况仍不确定。',incomplete:'已计价部分尚未达到预算；仍有未定价用量，不能确认总额在预算内。','observed-below':'当前已观测的估算低于预算；这不是实际账单或额度保证。','scope-missing':'项目已不在当前已保存记录中，无法判断预算使用情况。'};
  const budgetLabels={'no-data':'暂无观测记录',unpriced:'费用尚未定价',exceeded:'已观测估算达到预算','possibly-exceeded':'估算区间可能达到预算',incomplete:'仍有未定价用量','observed-below':'已观测估算低于预算','scope-missing':'无法判断预算'};
  // The last failed collection (Service.get().diagnostic, src/m1/collection-diagnostic.js) is
  // one live item at the top of the list: it cannot be acknowledged and leaves once a collection
  // completes. The diagnostic is global, so it never names a source (UI-COLLECTION-DIAGNOSTIC-20261022.md).
  const STAGES={'source-watch':'监视来源变化','source-stamp':'检查来源文件变化','source-refresh':'刷新来源','source-scan':'扫描来源文件','native-verification':'统计组件核对','custom-source':'读取自定义来源',discovery:'检查读取位置',worker:'采集进程',collection:'采集',ingest:'写入本机统计',maintenance:'维护本机数据'};
  const RETRY='可以重新检查',REINSTALL='重新安装本应用后再试';
  const REASONS={
    EACCES:['没有访问权限','检查该位置的访问权限后重新检查'],EPERM:['没有访问权限','检查该位置的访问权限后重新检查'],
    ENOENT:['文件或目录不存在','确认读取位置仍然存在'],ENOTDIR:['路径不是目录','确认读取位置仍然正确'],EISDIR:['路径是目录而不是文件','确认读取位置仍然正确'],
    ENOSPC:['磁盘空间不足','释放磁盘空间后重试'],EMFILE:['同时打开的文件过多','关闭部分程序后重试'],ENFILE:['同时打开的文件过多','关闭部分程序后重试'],
    EIO:['磁盘读写出错','检查磁盘后重试'],EBUSY:['文件被其他程序占用','稍后重试'],EROFS:['目标位置只读','确认本应用的数据目录可以写入'],EINVAL:['路径或参数无效','确认读取位置仍然正确'],ETIMEDOUT:['操作超时','稍后重试'],
    NATIVE_UNAVAILABLE:['统计组件不可用',REINSTALL],NATIVE_BINARY_MISMATCH:['统计组件校验不一致，已拒绝运行',REINSTALL],NATIVE_TIMEOUT:['统计组件运行超时','稍后重试'],NATIVE_OUTPUT_LIMIT:['统计组件输出超出上限',RETRY],
    NATIVE_FAILED:['统计组件运行失败',RETRY],NATIVE_SCHEMA_MISMATCH:['统计组件输出格式不符',REINSTALL],NATIVE_TOTAL_MISMATCH:['统计组件合计与逐条记录不一致',RETRY],
    COLLECTION_TIMEOUT:['采集超时','稍后重试'],COLLECTION_WORKER_FAILED:['采集进程意外退出',RETRY],UNKNOWN:['原因未知',RETRY]};
  const CONTROLLED={MAINTENANCE_BUSY:'本机数据正在维护',MAINTENANCE_INCOMPLETE:'本机数据维护没有完成',MAINTENANCE_STALE:'本机数据维护状态已过期',LOCAL_STORAGE_INVALID:'本机统计文件无法使用',DISCOVERY_FAILED:'读取位置检查失败',DISCOVERY_TIMEOUT:'读取位置检查超时',SOURCE_PATH_REJECTED:'读取位置不被允许',SOURCE_SYMLINK_REJECTED:'读取位置是链接，已拒绝',SOURCE_ALIAS_REJECTED:'读取位置与其他位置重复，已拒绝',SOURCE_SIZE_OR_LINK:'来源文件过大或是链接',DATABASE_SCHEMA_UNSUPPORTED:'来源数据库结构暂不支持'};
  const errorCode=value=>/^[A-Z][A-Z0-9_]+$/.test(value||'')?value:'';
  function collectionItem(){
    const c=window.usageData?.collection?.();
    return c?.error?{id:'collection',kind:'sources',scope:'collection',acknowledged:false,collection:c}:null;
  }
  function collectionSentence(c){
    const d=c.diagnostic,code=errorCode(c.error);
    // Controlled errors carry the public code in c.error; the diagnostic only says "controlled".
    const [reason,hint]=!d?[code?CONTROLLED[code]||issueNames[code]||'原因未报告':c.error,RETRY]
      :d.category==='contract'&&d.reason==='CONTROLLED_ERROR'?[CONTROLLED[code]||issueNames[code]||'采集遇到已识别的问题',RETRY]
      :REASONS[d.reason]||['原因未知',RETRY];
    const where=d?'出错环节：'+(STAGES[d.stage]||'采集'):'';
    return {what:'最近一次采集没有完成：'+reason,effect:['已有数据保留不变',where,hint].filter(Boolean).join(' · '),title:[code&&'错误代码 '+code,d&&!['UNKNOWN','CONTROLLED_ERROR',code].includes(d.reason)&&'原因代码 '+d.reason].filter(Boolean).join(' · ')};
  }
  function attentionItems(){
    const general=(state.general?.issues||[]).filter(i=>i.target!=='workbench').map(i=>({...i,kind:i.target,scope:'general'}));
    const budget=(budgetOverview()?.issues||[]).map(i=>({...i,kind:'budget',scope:'budget'}));
    const order=Object.fromEntries(KINDS.map(([kind],n)=>[kind,n])),live=collectionItem();
    return [...(live?[live]:[]),...general,...budget].sort((a,b)=>order[a.kind]-order[b.kind]);
  }
  // The same sentences as data (M4): actions are {action, label, value, disabled} for the React page.
  function item(i){
    const kind=KINDS.find(([k])=>k===i.kind)?.[1]||i.kind,base={id:i.id,kind:i.kind,kindLabel:kind,scope:i.scope,acknowledged:Boolean(i.acknowledged),agent:i.agent||null,fix:'source',tokens:i.evidence?.tokens??null,records:i.evidence?.records??null,modelKey:null};
    if(i.scope==='collection'){const s=collectionSentence(i.collection);return {...base,what:s.what,effect:s.effect,title:s.title,actions:[{action:'retry',label:i.collection.collecting?'正在采集…':'重新检查',disabled:Boolean(i.collection.collecting)}]};}
    const e=i.evidence,who=i.agent?agent(i.agent):'',records=e.records!==undefined?count(e.records)+' 条记录':'';
    const source=label=>[{action:'source',label,value:i.agent}];
    if(i.code==='USAGE_UNPRICED'){
      const labels=window.pricingLabels,fixable=labels.FIXABLE.includes(e.reason),why=e.cause?labels.CAUSES[e.cause]||labels.REASONS['usage-incomplete']:labels.REASONS[e.reason]||'无法估算';
      base.fix=fixable?'price':'accept';base.modelKey=e.provider&&e.model?e.provider+'/'+e.model:null;
      return {...base,what:(who?who+' · ':'')+(e.model==='unknown'?'未记录模型':e.model)+'：'+why,effect:'有 '+records+'、'+count(e.tokens)+' Token 未计入费用估算',actions:fixable?[{action:'pricing',label:'去定价'}]:source('查看来源')};
    }
    if(i.code==='USAGE_QUALITY_PARTIAL')return {...base,fix:'accept',what:who+'：部分记录缺少用量字段',effect:count(e.records)+' / '+count(e.totalRecords)+' 条记录的 Token 与费用不完整',actions:source('查看来源')};
    if(i.code==='PROJECT_UNATTRIBUTED')return {...base,what:'部分用量缺少项目归属',effect:records+'没有工作目录，在项目费用里归为“未归属”',actions:[{action:'view',label:'查看会话',value:'sessions'}]};
    if(i.kind==='budget'){
      const row=budgetOverview()?.budgets.find(row=>row.scope===e.scope&&row.period===e.period),scope=(PERIODS[e.period]||e.period)+' · '+(row?budgetName(row):'无法关联的项目');
      const label=i.code==='BUDGET_NO_DATA'?'暂无观测记录，无法判断预算':i.code==='BUDGET_SCOPE_MISSING'?'项目已不可关联，无法判断预算':issueNames[i.code]||i.code;
      return {...base,what:scope+'：'+label,effect:'预算 '+budgetMoney(e.limitUsd)+(e.lower!==null?'，已估算 '+cost(e):'')+(e.unpricedTokens?'，另有 '+count(e.unpricedTokens)+' Token 未定价':''),actions:[{action:'budget',label:'查看预算',value:e.scope+':'+e.period}]};
    }
    return {...base,what:(who?who+'：':'')+(issueNames[i.code]||'来源诊断 '+i.code),effect:(records?'影响 '+records:'影响范围未知')+(e.codes?.length>1?' · 依据 '+e.codes.join('、'):''),actions:i.agent?source('查看来源'):[]};
  }
  function runAction(action,value){
    if(action==='retry')void window.sourcesHost?.load(true);
    else if(action==='source')window.sourcesUi?.focus(value);
    else if(action==='pricing')pricing();
    else if(action==='view')window.usageData.view(value);
    else if(action==='budget')void openBudget(value);
  }
  // The sidebar count and other pages' notice lines follow every read, whether or not the sources page shows.
  function badge(){
    const open=attentionItems().filter(i=>!i.acknowledged),omitted=state.general?.omittedIssues||budgetOverview()?.omittedIssues;
    window.usageData?.badge?.('sources',open.length,(omitted?'已返回的事项中 ':'')+open.length+' 项需要处理');
  }
  function attention(){if(state.general)badge();}
  function openAttention(kind){
    state.kind=kind||'all';state.expanded=false;publish();window.usageData.view('sources');attention();
    // The React page draws the section; it may mount a frame after the view switch.
    const focus=(tries=0)=>{const section=$('sourcesAttentionSection');if(section){section.scrollIntoView({block:'start'});section.querySelector('h2')?.focus({preventScroll:true});}else if(tries<10)requestAnimationFrame(()=>focus(tries+1));};
    requestAnimationFrame(()=>focus());
  }
  async function openBudget(key){
    const row=budgetOverview()?.budgets.find(row=>budgetKey(row)===key);if(!row)return;
    state.period=row.period;state.project=row.state==='scope-missing'?'all':row.scope;
    state.dirty=false;state.budgetOpen.add(key);state.focusBudget=key;
    window.usageData.view('cost');window.costUi?.projects();await loadProjects();
  }
  // The sidebar and inline notices use the compact attention response. Only the
  // projects tab and source capabilities need a full workbench view.
  const pendingReads=new Map();
  function once(key,read){if(!pendingReads.has(key)){const p=read().finally(()=>pendingReads.delete(key));pendingReads.set(key,p);}return pendingReads.get(key);}
  function workbench(value){return once(JSON.stringify(value),()=>bridge.workbench(value));}
  async function load(detail,clearMessage){
    if(state.busy)return;
    if(!bridge){if(detail)message('请在桌面应用中查看本机项目与诊断。',true);return;}
    const version=++state.version;
    try{
      const [general,view]=await Promise.all([
        detail==='sources'||!bridge.attention?workbench({period:'total',project:'all'}):once('attention',()=>bridge.attention()),
        detail==='projects'?workbench(selection()):null
      ]);
      if(version!==state.version||state.busy)return;
      state.general=general;
      if(view){
        state.view=view;
        if(!state.dirty)state.draft=view.budget.limitUsd==null?'':String(view.budget.limitUsd);
      }
      if(clearMessage){
        if(visiblePage()==='cost')state.error='';
        else message('',true);
      }
      attention();controls();
    }catch(error){
      if(version!==state.version)return;
      if(detail==='projects'&&state.project!=='all'&&String(error).includes('WORKBENCH_SCOPE_INVALID')){
        state.project='all';state.dirty=false;return loadProjects(clearMessage);
      }
      if(detail)message((detail==='projects'?state.view:state.general)?'刷新失败，保留上一次结果；可重试。':'项目与诊断暂不可用，请重试。',true);
    }
  }
  function loadProjects(clearMessage=true){return load('projects',clearMessage);}
  function loadCurrent(){
    const page=visiblePage();
    return load(page==='sources'?'sources':page==='cost'&&document.querySelector('[data-cost-projects]')?'projects':null,false);
  }
  async function act(task,text,resetDraft=false){
    if(state.busy)return;const origin=document.activeElement;state.busy=true;state.version++;controls();message('',true);message('');
    try{await task();if(resetDraft)state.dirty=false;if(text)message(text);}
    catch{message('操作未完成，原有数据和设置保持不变；请重试。',true);}
    finally{state.busy=false;controls();await loadCurrent();if(origin?.isConnected&&!origin.disabled&&origin.getClientRects().length)origin.focus({preventScroll:true});}
  }
  function pricing(){window.settingsUi.openSection('pricing');}
  function changeSelection(patch){Object.assign(state,patch,{dirty:false});publish();return loadProjects();}
  function saveBudget(raw){
    const text=raw.trim(),value=/^(?:\d+\.?\d*|\.\d+)$/.test(text)?Number(text):NaN;
    if(!Number.isFinite(value)||value<=0||value>1000000){message('请输入大于 0、不超过 1,000,000 的 USD 预算；移除预算请使用移除按钮。',true);return Promise.resolve();}
    return act(()=>bridge.saveWorkbench({kind:'budget',...selection(),limitUsd:value}),'预算已保存，仅用于本机估算提醒。',true);
  }
  function acknowledge(id,acknowledged){
    const issue=attentionItems().find(i=>i.id===id);if(!issue||issue.scope==='collection')return Promise.resolve();
    const budget=issue.scope==='budget'||issue.kind==='budget';
    return act(()=>bridge.saveWorkbench({kind:'acknowledge',...(budget?{project:issue.evidence.scope,period:issue.evidence.period}:{period:'total',project:'all'}),id:issue.id,fingerprint:issue.fingerprint,acknowledged}),'已更新事项状态；诊断证据变化后会重新提醒。');
  }
  function notices(page){
    const open=attentionItems().filter(i=>!i.acknowledged),n=page==='budget'?(state.view?.issues||[]).filter(i=>i.target==='workbench'&&!i.acknowledged).length:open.filter(i=>i.kind===page).length;
    return {count:n,text:!n?'':page==='budget'?n+' 项预算提醒':page==='sessions'?'部分用量缺少项目归属'+(n>1?'等 '+n+' 项':''):n+' 项费用核对事项（未定价或用量不完整）'};
  }
  window.insightsHost=Object.freeze({
    version:()=>revision,available:Boolean(bridge),get:()=>({...state}),
    attention:kind=>attentionItems().filter(i=>!kind||i.kind===kind),
    items:()=>state.general?attentionItems().map(item):null,capabilityView,act:runAction,omitted:()=>({general:state.general?.omittedIssues||0,budget:budgetOverview()?.omittedIssues||0}),
    capability:agent=>state.general?.sources.find(s=>s.agent===agent)||null,
    notices,acknowledge:id=>acknowledge(id,true),restore:id=>acknowledge(id,false),openAttention,openBudget,
    select:changeSelection,draft:text=>{state.dirty=true;state.draft=text;publish();},
    toggle:(kind,key,open)=>{const values=kind==='budget'?state.budgetOpen:state.open;if(open)values.add(key);else values.delete(key);publish();},
    budget:{save:saveBudget,remove:()=>act(()=>bridge.saveWorkbench({kind:'budget',...selection(),limitUsd:null}),'当前项目与周期的预算已移除。',true)},
    projects:{load:loadProjects,export:()=>act(async()=>{const result=await bridge.exportProjects(selection());message(result.canceled?'已取消导出。':'项目汇总已导出，不含绝对路径和原始身份。');},'')},
    format:{count,money,budgetMoney,cost,agent,budgetKey,budgetName,budgetStates,budgetLabels,periods:PERIODS}
  });
  window.addEventListener('ui-view-change',event=>{if(event.detail==='sources')void load('sources',true);});
  // The sidebar count stays current after each collection, whichever page is open.
  window.addEventListener('usage-collection',()=>{if(!window.usageData.collection().collecting)void loadCurrent();});
  void loadCurrent();
  window.addEventListener('usage-collection',attention);
  bridge?.onUpdate(()=>void loadCurrent());
  controls();
})();
