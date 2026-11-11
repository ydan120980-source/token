'use strict';
const crypto=require('node:crypto');
const path=require('node:path');
const {add}=require('./aggregate');
const {digest}=require('./normalize');
const {directory,projectName}=require('./sessions');
const PERIODS=['daily','weekly','monthly','total'];
const FIELDS=['inputUncached','output','cacheRead','cacheWrite','reasoning'];
const FORMATS={codex:['JSONL'],claude:['JSONL'],opencode:['SQLite','JSON'],workbuddy:['JSONL','SQLite'],mimo:['SQLite'],gemini:['JSON','JSONL'],cursor:['SDK SQLite','NDJSON','CSV'],zcode:['SQLite'],deepseek:['JSONL','Zstandard'],antigravity:['JSONL','SQLite 配对']};
const SCOPE=/^(?:all|unknown|[a-f0-9]{64})$/;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const emptySettings=()=>({version:1,budgets:{},acknowledged:{}});
function object(v){return Boolean(v)&&typeof v==='object'&&!Array.isArray(v);}
function settings(value){
  if(!object(value)||value.version!==1||Object.keys(value).some(k=>!['version','budgets','acknowledged'].includes(k))||!object(value.budgets)||!object(value.acknowledged)||Object.keys(value.budgets).length>1000||Object.keys(value.acknowledged).length>1000)throw new Error('WORKBENCH_SETTING_INVALID');
  for(const [key,limit] of Object.entries(value.budgets)){const split=key.split(':');if(split.length!==2||!SCOPE.test(split[0])||!PERIODS.includes(split[1])||!Number.isFinite(limit)||limit<=0||limit>1000000)throw new Error('WORKBENCH_SETTING_INVALID');}
  for(const [key,fingerprint] of Object.entries(value.acknowledged))if(!/^[a-f0-9]{64}$/.test(key)||!/^[a-f0-9]{64}$/.test(fingerprint))throw new Error('WORKBENCH_SETTING_INVALID');
  return value;
}
function request(value={}){
  if(!object(value)||Object.keys(value).some(k=>!['period','project'].includes(k)))throw new Error('WORKBENCH_REQUEST_INVALID');
  const period=value.period??'monthly',project=value.project??'all';
  if(!PERIODS.includes(period)||typeof project!=='string'||!SCOPE.test(project))throw new Error('WORKBENCH_REQUEST_INVALID');
  return {period,project};
}
function range(today,period){
  if(period==='total')return {from:null,to:today};
  let from=today;
  if(period==='monthly')from=today.slice(0,7)+'-01';
  if(period==='weekly'){const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);from=d.toISOString().slice(0,10);}
  return {from,to:today};
}
function summary(row){
  return {records:row?.records||0,totalTokens:row?.totalTokens||0,pricedRecords:row?.pricedRecords||0,pricedTokens:row?.pricedTokens||0,boundedTokens:row?.boundedTokens||0,partialRecords:row?.partialRecords||0,
    lower:row?.pricedRecords?row.estimatedCostUsd:null,upper:row?.pricedRecords?row.estimatedCostUpperUsd:null,
    unpricedTokens:row?row.totalTokens-row.pricedTokens:0,unpricedRecords:row?row.records-row.pricedRecords:0,
    fields:Object.fromEntries(FIELDS.map(f=>[f,row?row[f]:null])),knownRecords:{...row?.knownRecords},pricingReasons:{...row?.pricingReasons}};
}
function budget(total,limit){
  if(limit==null)return {limitUsd:null,state:'not-set',remainingUsd:null,remainingUpperUsd:null};
  const state=!total.records?'no-data':total.lower===null?'unpriced':total.lower>=limit?'exceeded':total.upper>=limit?'possibly-exceeded':total.unpricedRecords?'incomplete':'observed-below';
  return {limitUsd:limit,state,remainingUsd:total.upper===null?null:limit-total.upper,remainingUpperUsd:total.lower===null?null:limit-total.lower};
}
function maintenanceIssue(store,config,selection,code,agent,evidence,target='sources',extra=''){
  const id=digest(store.state.salt,JSON.stringify(['maintenance',selection.project,selection.period,code,agent,extra])),fingerprint=hash(evidence);
  return {id,code,agent,target,evidence,fingerprint,acknowledged:config.acknowledged[id]===fingerprint};
}
function budgetIssue(store,config,row,overview=false){
  if(!['exceeded','possibly-exceeded','incomplete','unpriced',...(overview?['no-data','scope-missing']:[])].includes(row.state))return null;
  const {scope,period,limitUsd,total}=row;
  return maintenanceIssue(store,config,{project:scope,period},'BUDGET_'+row.state.replaceAll('-','_').toUpperCase(),null,
    {scope,period,limitUsd,lower:total.lower,upper:total.upper,unpricedTokens:total.unpricedTokens},'workbench',scope+period);
}
function build(store,value={}){
  const selection=request(value),snapshot=store.snapshot(),config=store.workbenchSettings||emptySettings(),catalog=store.catalog(),records=store.records(),projects=new Map(),options=new Map(),sources=new Map(),projectSources=new Map(),totals=new Map(),sessions=new Map(),sourceSessions=new Map(),pricing=new Map();
  const span=range(snapshot.today,selection.period),formatter=new Intl.DateTimeFormat('en-CA',{timeZone:snapshot.timezone,year:'numeric',month:'2-digit',day:'2-digit'}),projectCache=new Map();
  const periods=new Map([...new Set(Object.keys(config.budgets).map(key=>key.split(':')[1]))].map(period=>[period,{span:range(snapshot.today,period),totals:new Map()}]));
  const info=record=>{
    const saved=store.state.sessions?.[record.sessionKey],cwd=saved?.agent===record.agent?directory(saved.cwd):null;
    if(!cwd)return {id:'unknown',name:'未知项目'};
    const normalized=(/^[a-z]:/i.test(cwd)?path.win32.normalize(cwd):path.posix.normalize(cwd)).replaceAll('\\','/').replace(/\/+$/,'').toLowerCase();
    if(!projectCache.has(normalized))projectCache.set(normalized,{id:digest(store.state.salt,'project:'+normalized),name:projectName(cwd)||'未知项目'});
    return projectCache.get(normalized);
  };
  // Dates are taken from timestamps in the SAME timezone as all other views.
  for(const record of records){
    const project=info(record);options.set(project.id,project);
    const date=formatter.format(new Date(record.timestamp)),selected=date<=span.to&&(!span.from||date>=span.from);
    const matching=[...periods.values()].filter(p=>date<=p.span.to&&(!p.span.from||date>=p.span.from));
    if(!selected&&!matching.length)continue;
    const estimate=store.estimate(record);
    for(const p of matching){add(p.totals,'all',{},record,estimate);add(p.totals,project.id,{},record,estimate);}
    if(!selected)continue;
    add(projects,project.id,{},record,estimate);
    if(!projectSources.has(project.id))projectSources.set(project.id,new Map());add(projectSources.get(project.id),record.agent,{},record,estimate);
    if(record.sessionKey){if(!sessions.has(project.id))sessions.set(project.id,new Set());sessions.get(project.id).add(record.sessionKey);}
    if(selection.project!=='all'&&selection.project!==project.id)continue;
    add(totals,'all',{},record,estimate);add(sources,record.agent,{},record,estimate);
    if(record.sessionKey){if(!sourceSessions.has(record.agent))sourceSessions.set(record.agent,new Set());sourceSessions.get(record.agent).add(record.sessionKey);}
    if(estimate.lower===null){const key=JSON.stringify([record.agent,record.provider,record.model,estimate.reason,estimate.cause||null]);const issue=pricing.get(key)||{agent:record.agent,provider:record.provider,model:record.model,reason:estimate.reason,cause:estimate.cause||null,records:0,tokens:0};issue.records++;issue.tokens+=record.totalTokens;pricing.set(key,issue);}
  }
  if(selection.project!=='all'&&!options.has(selection.project))throw new Error('WORKBENCH_SCOPE_INVALID');
  const projectOptions=[...options.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)),names=new Map(),occurrences=new Map();
  for(const p of projectOptions)names.set(p.name,(names.get(p.name)||0)+1);
  for(const p of projectOptions){const n=(occurrences.get(p.name)||0)+1;occurrences.set(p.name,n);p.label=p.name+(names.get(p.name)>1?'（项目 '+n+'）':'');}
  const budgets=Object.entries(config.budgets).sort(([a],[b])=>a.localeCompare(b)).map(([key,limit])=>{
    const [scope,period]=key.split(':'),p=options.get(scope),total=summary(periods.get(period).totals.get(scope));
    const row={scope,period,projectName:scope==='all'?'全部项目':p?.name??null,projectLabel:scope==='all'?'全部项目':p?.label??null,range:periods.get(period).span,...budget(total,limit),total};
    if(scope!=='all'&&!p){row.state='scope-missing';row.remainingUsd=null;row.remainingUpperUsd=null;}
    return row;
  });
  const budgetIssues=budgets.map(row=>budgetIssue(store,config,row,true)).filter(Boolean);
  const budgetOverview={budgets,issues:budgetIssues.slice(0,500),omittedIssues:Math.max(0,budgetIssues.length-500)};
  const projectRows=[...projects].filter(([id])=>selection.project==='all'||id===selection.project).map(([id,row])=>({id,name:options.get(id).name,...summary(row),sessions:sessions.get(id)?.size||0,agents:[...projectSources.get(id)].map(([agent,r])=>({agent,...summary(r)}))})).sort((a,b)=>(b.lower??-1)-(a.lower??-1)||b.totalTokens-a.totalTokens||a.id.localeCompare(b.id));
  const total=summary(totals.get('all')),limit=config.budgets[selection.project+':'+selection.period]??null;
  const budgetView=budget(total,limit),issues=[];
  function issue(code,agent,evidence,target='sources',extra=''){
    issues.push(maintenanceIssue(store,config,selection,code,agent,evidence,target,extra));
  }
  const statuses=new Map(snapshot.sources.map(s=>[s.agent,s]));
  const sourceRows=Object.entries(catalog).map(([agent,meta])=>{
    const source=store.state.customSources?.[agent],status=statuses.get(agent)||{},row=summary(sources.get(agent)),known=Object.fromEntries(FIELDS.map(f=>[f,{records:row.knownRecords[f]||0,coverage:row.records?(row.knownRecords[f]||0)/row.records:null}]));
    const input=source?(source.definition.template==='mapped'?source.definition.inputSemantics:source.definition.template==='claude'?'exclusive':'inclusive'):['claude','opencode','mimo','cursor','deepseek','antigravity'].includes(agent)?'exclusive':agent==='zcode'?'schema-dependent':'inclusive';
    const output=source?(source.definition.template==='mapped'&&!source.definition.outputIncludesReasoning?'excludes-reasoning':'includes-reasoning'):['opencode','mimo','gemini'].includes(agent)?'excludes-reasoning':agent==='zcode'?'schema-dependent':'includes-reasoning';
    const errors=[...new Set((status.errors||[]).filter(code=>/^[A-Z_]+$/.test(code)))];
    const evidence={records:status.observedRecords||row.records,codes:errors};
    for(const code of errors)issue(code,agent,evidence);
    if(row.partialRecords)issue('USAGE_QUALITY_PARTIAL',agent,{records:row.partialRecords,totalRecords:row.records},'cost');
    return {agent,name:meta.name,custom:meta.custom===true,archived:meta.archived===true,enabled:source?source.enabled&&!source.archived:!store.settings.sources.disabled.includes(agent),
      formats:source?[source.definition.template==='claude'?'Claude JSONL':source.definition.template==='mapped'?'字段映射 JSONL':'标准事件 JSONL']:FORMATS[agent]||[],
      inputSemantics:input,outputSemantics:output,quota:agent==='codex',readOnly:true,ruleVersion:source?.version??null,mixedRules:Boolean(source?.diagnostics?.mixedRules),
      parserVersion:typeof status.parserVersion==='string'?status.parserVersion:null,status:status.status||'unverified',realSampleVerified:status.realSampleVerified===true,lastSuccess:status.lastSuccess||null,
      ...row,known,sessions:sourceSessions.get(agent)?.size||0};
  });
  for(const p of pricing.values())issue('USAGE_UNPRICED',p.agent,p,'cost',JSON.stringify([p.model,p.reason,p.cause]));
  if(total.records&&projectRows.some(p=>p.id==='unknown'))issue('PROJECT_UNATTRIBUTED',null,{records:projectRows.find(p=>p.id==='unknown').records},'sessions');
  const selectedBudgetIssue=budgetIssue(store,config,{scope:selection.project,period:selection.period,...budgetView,total});
  if(selectedBudgetIssue)issues.push(selectedBudgetIssue);
  return {schemaVersion:'WorkbenchV1',sequence:snapshot.sequence,timezone:snapshot.timezone,today:snapshot.today,selection,range:span,projectOptions,projects:projectRows,total,sources:sourceRows,
    budget:budgetView,budgetOverview,issues:issues.slice(0,500),omittedIssues:Math.max(0,issues.length-500),priceBasis:{...snapshot.priceCatalog},historyStarts:snapshot.coverageStart,scope:'observed-api-equivalent',factRevision:snapshot.sequence};
}
function change(store,value){
  if(!object(value))throw new Error('WORKBENCH_SETTING_INVALID');
  const next=structuredClone(store.workbenchSettings||emptySettings());
  if(value.kind==='budget'){
    if(Object.keys(value).some(k=>!['kind','project','period','limitUsd'].includes(k)))throw new Error('WORKBENCH_SETTING_INVALID');
    const selection=request({project:value.project,period:value.period});if(value.limitUsd!==null)build(store,selection);
    const key=selection.project+':'+selection.period;
    if(value.limitUsd===null)delete next.budgets[key];else next.budgets[key]=value.limitUsd;
  }else if(value.kind==='acknowledge'){
    if(Object.keys(value).some(k=>!['kind','id','fingerprint','acknowledged','project','period'].includes(k))||typeof value.acknowledged!=='boolean')throw new Error('WORKBENCH_SETTING_INVALID');
    const selection=request({project:value.project,period:value.period});
    // Overview issues own their scope, including a saved project no longer present.
    // Resolve from the uncapped budget rows so omission never prevents acknowledgement.
    const overview=build(store).budgetOverview;
    const row=overview.budgets.find(row=>row.scope===selection.project&&row.period===selection.period);
    const candidate=row&&budgetIssue(store,next,row,true);
    const issue=candidate?.id===value.id&&candidate.fingerprint===value.fingerprint?candidate:
      build(store,selection).issues.find(issue=>issue.id===value.id&&issue.fingerprint===value.fingerprint);
    if(!issue)throw new Error('WORKBENCH_ISSUE_STALE');
    if(value.acknowledged)next.acknowledged[value.id]=value.fingerprint;else delete next.acknowledged[value.id];
  }else throw new Error('WORKBENCH_SETTING_INVALID');
  return settings(next);
}
function csv(view){
  const cell=(v,text=false)=>{if(v==null)return '';let s=String(v);if(text&&/^\s*[=+\-@]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
  const lines=[['项目','范围开始','范围结束','Token','记录','会话','估算下限 USD','估算上限 USD','未定价 Token','已计价记录']];
  const usd=value=>value===null?null:Number(value.toPrecision(12));
  const labels=new Map(view.projectOptions.map(p=>[p.id,p.label]));
  for(const p of view.projects)lines.push([labels.get(p.id)||p.name,view.range.from||'累计',view.range.to,p.totalTokens,p.records,p.sessions,usd(p.lower),usd(p.upper),p.unpricedTokens,p.pricedRecords]);
  return '\uFEFF'+lines.map((row,i)=>row.map((v,index)=>cell(v,i===0||index===0)).join(',')).join('\r\n')+'\r\n';
}
module.exports={PERIODS,emptySettings,settings,request,range,build,change,csv,budget};
