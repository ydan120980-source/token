'use strict';
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.sessionsModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
function create(state,window,options={}){const agents=window.agentCatalog.agents,escapeHtml=options.escape||String,clock=new Map(),now=options.now||Date.now;
const short = value => value === null || value === undefined ? '未知' : value >= 1e9 ? (value / 1e9).toFixed(1) + 'B' : value >= 1e6 ? (value / 1e6).toFixed(1) + 'M' : value >= 1e3 ? (value / 1e3).toFixed(1) + 'K' : String(value);
const timezone = () => state.list?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = () => state.list?.today || window.usageMath.localDay(timezone());
const rangeStart = () => state.range === 'all' ? '0000-01-01' : window.usageMath.startFor(today(), state.range, null);
const fieldText = (part, format = short) => part.value === null ? '未报告' : format(part.value) + (part.partial ? '（部分未报告）' : '');
const shortId = id => !id ? '未记录' : id.length > 14 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
const displayModel = model => model === 'unknown' ? '模型未记录' : model;
function demoList() {
    const day = window.usageMath.localDay(Intl.DateTimeFormat().resolvedOptions().timeZone), shift = (date, n) => { const v = new Date(date + 'T12:00:00Z'); v.setUTCDate(v.getUTCDate() + n); return v.toISOString().slice(0, 10); };
    const projects = [['C:\\Users\\demo\\work\\agent-usage', 'agent-usage'], ['D:\\repos\\obsidian-vault', 'obsidian-vault'], ['C:\\Users\\demo\\work\\site', 'site'], ['E:\\labs\\qq-speed-3d', 'qq-speed-3d'], ['C:\\Users\\demo\\notes', 'notes']];
    // Today matches the usage page's demo (Codex only, 1,128,200 tokens, $0.76).
    const plan = [['codex', 0, 0, 698200, .47], ['codex', 0, 1, 430000, .29], ['claude', 1, 0, 980e3, 1.46], ['claude', 1, 0, 420e3, .61], ['claude', 2, 3, 300e3, .31], ['cursor', 2, null, 160e3, null], ['opencode', 1, 2, 520e3, .44], ['gemini', 2, 1, 260e3, .12],
      ['claude', 3, 0, 1.4e6, 2.1], ['codex', 3, 0, 380e3, .51], ['claude', 5, 0, 610e3, .92], ['claude', 6, 0, 240e3, .33], ['codex', 8, 0, 700e3, .97], ['claude', 9, 0, 150e3, .2], ['workbuddy', 2, null, 90e3, null], ['deepseek', 12, 4, 330e3, .08], ['claude', 20, 2, 410e3, .55], ['codex', 25, 3, 220e3, .3]];
    const models = { claude: 'claude-opus-5-5', codex: 'gpt-6.1-sol', cursor: 'composer-2', opencode: 'gpt-6-luna', gemini: 'gemini-3-pro', workbuddy: 'unknown', deepseek: 'deepseek-v4-flash' };
    const sessions = plan.map(([agent, ago, project, tokens, cost], index) => {
      const date = shift(day, -ago), hour = 9 + index % 12, start = new Date(date + 'T' + String(hour).padStart(2, '0') + ':0' + index % 6 + ':00').toISOString(), end = new Date(Date.parse(start) + (20 + index * 7) * 60000).toISOString();
      const cwd = project === null ? null : projects[project][0], resumable = cwd !== null && ['codex', 'claude', 'opencode', 'gemini'].includes(agent);
      const output = Math.round(tokens * .04), cacheRead = Math.round(tokens * .8), inputUncached = tokens - output - cacheRead;
      return { key: ('d' + index).padEnd(64, '0'), agent, entries: [agent === 'codex' ? 'desktop' : 'cli'], models: [models[agent]], start, end, id: cwd ? 'demo' + String(index).padStart(4, '0') + '-7c2e-4000-8000-00000000' + String(index).padStart(4, '0') : null, cwd, project: cwd && projects[project][1], resumable,
        days: [{ date, totalTokens: tokens, inputUncached, output, cacheRead, cacheWrite: 0, reasoning: Math.round(output * .2), records: Math.max(1, Math.round(tokens / 20e3)), partialRecords: 0, pricedTokens: cost === null ? 0 : tokens, boundedTokens: 0, estimatedCostUsd: cost, estimatedCostUpperUsd: cost, knownUsage: {} }] };
    });
    return { schemaVersion: 'SessionListV1', sequence: 1, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, today: day, sessions, unattributed: { workbuddy: { [shift(day, -2)]: 3 } } };
  }
function within(session, start, end) {
    let found = false, total = 0, records = 0, priced = 0, costs = 0, cost = 0, upper = 0, saved = false, savings = 0;
    // Preserve each sum's input order and unknown-versus-zero semantics while
    // avoiding three filtered arrays and repeated reductions per session.
    for (const row of session.days) {
      if (!(row.date >= start && row.date <= end)) continue;
      found = true; total += row.totalTokens; records += row.records; priced += row.pricedTokens;
      if (row.estimatedCostUsd !== null) { costs++; cost += row.estimatedCostUsd; upper += row.estimatedCostUpperUsd ?? row.estimatedCostUsd; }
      if (row.cacheSavingsUsd !== null && row.cacheSavingsUsd !== undefined && row.cacheSavingsUsd > 0) { saved = true; savings += row.cacheSavingsUsd; }
    }
    return found ? { total, records, cost: costs ? cost : null, upper: costs ? upper : null, savings: saved ? savings : null, priced } : null;
  }
function format(time, withDate) {
    const key = timezone() + withDate;
    if (!clock.has(key)) clock.set(key, new Intl.DateTimeFormat('zh-CN', { timeZone: timezone(), ...(withDate ? { month: '2-digit', day: '2-digit' } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    return clock.get(key).format(new Date(time));
  }
// When a session last moved, as short as the page can say it: the time today, the date before that.
function ended(session) {
  return format(session.end, window.usageMath.localDay(timezone(), Date.parse(session.end)) !== today());
}
function span(session) {
    const sameDay = window.usageMath.localDay(timezone(), Date.parse(session.start)) === window.usageMath.localDay(timezone(), Date.parse(session.end));
    const startDay = window.usageMath.localDay(timezone(), Date.parse(session.start));
    return sameDay ? (startDay === today() ? '' : startDay.slice(5) + ' ') + format(session.start, false) + '–' + format(session.end, false) : format(session.start, true) + ' – ' + format(session.end, true);
  }
function durationParts(ms) {
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) return { unit: 's', value: Math.max(1, seconds) };
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return { unit: 'm', value: minutes };
    if (minutes < 1440) return { unit: 'h', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
    const hours = Math.round(ms / 3600000);
    return { unit: 'd', days: Math.floor(hours / 24), hours: hours % 24 };
  }
function durationText(startIso, endIso) {
    const p = durationParts(Math.max(0, Date.parse(endIso) - Date.parse(startIso)));
    if (p.unit === 's') return '持续约 ' + p.value + ' 秒';
    if (p.unit === 'm') return '持续约 ' + p.value + ' 分钟';
    if (p.unit === 'h') return '持续约 ' + p.hours + ' 小时' + (p.minutes ? ' ' + p.minutes + ' 分' : '');
    return '持续约 ' + p.days + ' 天' + (p.hours ? ' ' + p.hours + ' 小时' : '');
  }
function durationBadge(startIso, endIso) {
    if (!startIso || !endIso) return '';
    const start = Date.parse(startIso), end = Date.parse(endIso);
    if (isNaN(start) || isNaN(end)) return '';
    const p = durationParts(Math.max(0, end - start));
    if (p.unit === 's') return p.value + '秒';
    if (p.unit === 'm') return p.value + '分';
    if (p.unit === 'h') return p.hours + '时' + (p.minutes ? p.minutes + '分' : '');
    return p.days + '天' + (p.hours ? p.hours + '时' : '');
  }
function breakdown(session) {
    const start = rangeStart(), end = today(), days = (session.days || []).filter(row => row.date >= start && row.date <= end);
    const field = key => { const known = days.filter(row => row[key] !== null && row[key] !== undefined); return { value: known.length ? known.reduce((n, row) => n + row[key], 0) : null, partial: known.length > 0 && known.length < days.length }; };
    return { days, inputUncached: field('inputUncached'), output: field('output'), cacheRead: field('cacheRead'), cacheWrite: field('cacheWrite'), reasoning: field('reasoning') };
  }
function cacheRate(parts) {
    const read = parts.cacheRead, input = parts.inputUncached;
    if (read.value === null || input.value === null || read.partial || input.partial || read.value + input.value === 0) return null;
    return read.value / (read.value + input.value);
  }
function tokenTip(session) {
    const parts = breakdown(session), rate = cacheRate(parts);
    const lines = ['总用量 ' + short(session.totals.total) + ' Token', '输入（未缓存） ' + fieldText(parts.inputUncached), '输出 ' + fieldText(parts.output), '缓存读取 ' + fieldText(parts.cacheRead) + (rate === null ? '' : '，命中率 ' + (rate * 100).toFixed(1) + '%')];
    if (parts.reasoning.value) lines.push('其中推理 ' + fieldText(parts.reasoning));
    return lines.join('\n');
  }
// Time groups by the local day of the session's last activity (SESSIONS-NEXT-20261101.md).
const PERIODS = [['today', '今天'], ['yesterday', '昨天'], ['week', '近 7 天'], ['month', '近 30 天'], ['older', '更早']];
function period(session) {
    const day = window.usageMath.localDay(timezone(), Date.parse(session.end)), now = today();
    if (day >= now) return 'today';
    if (day === shiftDay(now, -1)) return 'yesterday';
    if (day >= window.usageMath.startFor(now, '7', null)) return 'week';
    return day >= window.usageMath.startFor(now, '30', null) ? 'month' : 'older';
  }
function shiftDay(date, n) { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + n); return value.toISOString().slice(0, 10); }
// A session's name: the person's own name for it, else the title the Agent stores; never message text.
function sessionName(session) { const label = state.labels?.[session.key]; return label?.alias || session.title || null; }
function pinned(session) { return state.labels?.[session.key]?.pinned === true; }
// The groups the person made (UI-SESSIONS-MULTI-20261102.md): every session they hold, whatever the page's range.
function collections() {
    const counts = new Map();
    for (const session of state.list?.sessions || []) { const name = state.labels?.[session.key]?.group; if (name) counts.set(name, (counts.get(name) || 0) + 1); }
    return [...counts].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN')).map(([name, count]) => ({ name, count }));
  }
// A detail needs its one group, not sorted/copy-expanded rows for every project.
// Keep the full grouping/filtering rules, including pins and unknown directories.
function groupFor(key) {
    const source = state.list?.sessions || [], target = source.find(session => session.key === key);
    if (!target) return null;
    const identity = session => pinned(session) ? ':pinned' : state.group === 'collection' ? ':group:' + (state.labels?.[session.key]?.group || '') : state.group === 'time' ? ':time:' + period(session) : session.cwd ? session.cwd.toLowerCase() : ':unknown';
    const wanted = identity(target), sessions = source.filter(session => identity(session) === wanted);
    return create({ ...state, list: { ...state.list, sessions } }, window, options).groups().find(group => group.sessions.some(session => session.key === key)) || null;
  }
function groups() {
    const start = rangeStart(), end = today(), query = state.query.trim().toLowerCase(), map = new Map(), byTime = state.group === 'time', byCollection = state.group === 'collection';
    for (const session of state.list?.sessions || []) {
      if (state.agent !== 'all' && session.agent !== state.agent) continue;
      const totals = within(session, start, end);
      if (!totals) continue;
      const alias = state.labels?.[session.key]?.alias || null;
      if (query && ![session.project, session.cwd, session.id, agents[session.agent]?.name, session.title, alias, ...session.models].some(value => value && value.toLowerCase().includes(query))) continue;
      // The key round-trips through a data attribute, so it must survive HTML parsing
      // (a NUL becomes U+FFFD there); no Windows path starts with ':'.
      const kind = pinned(session) ? 'pinned' : byCollection ? 'collection' : byTime ? 'time' : 'project', collection = state.labels?.[session.key]?.group || null;
      const id = kind === 'pinned' ? ':pinned' : kind === 'collection' ? ':group:' + (collection ?? '') : kind === 'time' ? ':time:' + period(session) : session.cwd ? session.cwd.toLowerCase() : ':unknown';
      if (!map.has(id)) map.set(id, kind === 'pinned' ? { id, kind, cwd: null, name: '置顶', unknown: false, sessions: [] } :
        kind === 'collection' ? { id, kind, cwd: null, name: collection ?? '未分组', unknown: !collection, sessions: [] } :
        kind === 'time' ? { id, kind, cwd: null, name: PERIODS.find(([key]) => ':time:' + key === id)[1], unknown: false, sessions: [] } :
        { id, kind, cwd: session.cwd, name: session.project || '未知项目', unknown: !session.cwd, sessions: [] });
      map.get(id).sessions.push({ ...session, totals, name: sessionName(session), pinned: kind === 'pinned', group: collection });
    }
    const byCost = (a, b) => (b.cost ?? -1) - (a.cost ?? -1) || b.total - a.total;
    const byTokens = (a, b) => b.total - a.total || (b.cost ?? -1) - (a.cost ?? -1);
    const sessionSort = state.sort === 'recent' ? (a, b) => b.end.localeCompare(a.end) : state.sort === 'tokens' ? (a, b) => byTokens(a.totals, b.totals) || b.end.localeCompare(a.end) : (a, b) => byCost(a.totals, b.totals) || b.end.localeCompare(a.end);
    const list = [...map.values()].map(group => {
      const priced = group.sessions.filter(s => s.totals.cost !== null), total = group.sessions.reduce((n, s) => n + s.totals.total, 0);
      group.total = total; group.cost = priced.length ? priced.reduce((n, s) => n + s.totals.cost, 0) : null; group.upper = priced.length ? priced.reduce((n, s) => n + s.totals.upper, 0) : null;
      group.coverage = total ? group.sessions.reduce((n, s) => n + s.totals.priced, 0) / total : null; group.latest = group.sessions.reduce((t, s) => s.end > t ? s.end : t, '');
      group.sessions.sort(sessionSort);
      return group;
    });
    const groupSort = state.sort === 'recent' ? (a, b) => b.latest.localeCompare(a.latest) : state.sort === 'tokens' ? (a, b) => byTokens(a, b) || b.latest.localeCompare(a.latest) : (a, b) => byCost(a, b) || b.latest.localeCompare(a.latest);
    // Pinned first; time groups keep their calendar order, projects follow the chosen sort.
    const order = group => group.kind === 'pinned' ? -1 : group.kind === 'time' ? PERIODS.findIndex(([key]) => ':time:' + key === group.id) : 0;
    list.sort((a, b) => order(a) - order(b) || (a.unknown - b.unknown) || ((a.kind === 'project' && b.kind === 'project') || (a.kind === 'collection' && b.kind === 'collection') ? groupSort(a, b) : 0));
    return list;
  }
function agentSummary(sessions) {
    const counts = new Map(); for (const s of sessions) counts.set(s.agent, (counts.get(s.agent) || 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([agent, n]) => escapeHtml(agents[agent]?.name || agent) + ' ' + n).join(' · ');
  }
function groupModelsSummary(sessions) {
    const models = [...new Set(sessions.flatMap(s => s.models).filter(Boolean).map(displayModel))];
    const agentNames = [...new Set(sessions.map(s => agents[s.agent]?.name || s.agent))];
    if (!models.length) return agentNames.join(' · ');
    if (models.length === 1) return agentNames.join(' · ') + ' · ' + models[0];
    return agentNames.join(' · ') + ' · ' + models[0] + ' +' + (models.length - 1);
  }

function recent(session){return Boolean(session.end&&(now()-Date.parse(session.end)<3600000)&&(window.usageMath.localDay(timezone(),Date.parse(session.end))===today()));}
function dateTime(value){
 const key='local-full';
 if(!clock.has(key))clock.set(key,new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',second:'numeric',hour12:false}));
 return clock.get(key).format(new Date(value));
}
function costValue(lower,upper,coverage){return window.displayValues.cost(lower,upper,coverage);}
function sessionView(session,group){
 const unknown=session.totals.records===0,meta=agents[session.agent]||{name:session.agent,icon:'ui/layout-grid'},models=(session.models||[]).map(displayModel),coverage=session.totals.total?session.totals.priced/session.totals.total:null;
 const reason=!session.cwd&&!session.id?'该来源的会话标识与工作目录尚未确认，无法恢复':'该来源的恢复方式尚未确认',isRecent=recent(session),ratio=(group?.total>0&&session.totals?.total)?Math.min(100,Math.max(0,session.totals.total/group.total*100)):0,badge=durationBadge(session.start,session.end);
 const timeTip='开始: '+dateTime(session.start)+'\n结束: '+dateTime(session.end)+'\n'+durationText(session.start,session.end)+(isRecent?'\n• 活跃中（最近 1 小时内活动）':'');
 const costTip=session.totals.cost!==null?'API 等价估算: $'+session.totals.cost.toFixed(4)+(session.totals.savings?'\n缓存节省: $'+session.totals.savings.toFixed(4):'')+(coverage!==null?'\n定价覆盖: '+(coverage*100).toFixed(1)+'%':''):'未计入估算：模型没有价格，或来源没有报告完整用量';
 return {meta,models,coverage,reason,isRecent,ratio,fraction:Number(ratio.toFixed(0))/100,badge,timeTip,costTip,time:span(session),ended:ended(session),timeLabel:meta.name+' 会话 '+span(session),duration:durationText(session.start,session.end),tokens:unknown?null:short(session.totals.total),tokenTitle:unknown?'这个 Agent 的用量没有记到会话上':tokenTip(session),proportionTitle:'占项目消耗 '+ratio.toFixed(1)+'%',estimate:costValue(session.totals.cost,session.totals.upper,coverage)};
}
function groupView(group){const modelsSummary=groupModelsSummary(group.sessions),agentsText=agentSummary(group.sessions),firstKey=group.sessions.find(s=>s.cwd)?.key,activeCount=group.sessions.filter(recent).length,projects=[...new Set(group.sessions.map(s=>s.project||'未知项目'))],pathText=group.kind==='project'?group.cwd||'工作目录未记录或来源未确认':projects.slice(0,3).join('、')+(projects.length>3?' 等 '+projects.length+' 个项目':''),whoTip=agentsText+(group.sessions.some(s=>s.models?.length)?'\n模型: '+[...new Set(group.sessions.flatMap(s=>s.models).filter(Boolean).map(displayModel))].join('、'):'');return {modelsSummary,agentsText,firstKey,activeCount,pathText,whoTip,agentIds:[...new Set(group.sessions.map(s=>s.agent))],tokens:group.sessions.every(session=>session.totals.records===0)?null:short(group.total),estimate:costValue(group.cost,group.upper,group.coverage)};}
function inspectorView(session,group){const row=sessionView(session,group),parts=breakdown(session),rate=cacheRate(parts),totals=session.totals,rangeLabel={today:'今天',7:'近 7 天',30:'近 30 天',all:'全部时间'}[state.range]||'',reason=!session.cwd&&!session.id?'这个来源的会话标识与工作目录尚未确认，不能生成恢复命令。':'这个来源的恢复方式尚未确认，不能生成恢复命令。';return {...row,parts,rate,totals,rangeLabel,reason,project:group?.name||'未知项目',metadata:span(session)+' · '+durationText(session.start,session.end),coverageText:row.coverage===null?'':row.coverage<1?'已计入 '+(row.coverage*100).toFixed(1)+'%':'全部计入',rateText:rate===null?null:(rate*100).toFixed(1)+'%',partsRows:[['inputUncached','输入','未缓存'],['output','输出',parts.reasoning.value?'含推理 '+parts.reasoning.value.toLocaleString('zh-CN'):''],['cacheRead','缓存读取',''],['cacheWrite','缓存写入','']].map(([key,label,note])=>({key,label,note,part:parts[key],text:fieldText(parts[key],value=>value.toLocaleString('zh-CN'))})),days:parts.days.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(day=>({...day,tokens:short(day.totalTokens),estimate:costValue(day.estimatedCostUsd,day.estimatedCostUpperUsd,day.totalTokens?day.pricedTokens/day.totalTokens:null)}))};}
function pageSummary(){const list=groups(),sessions=list.reduce((n,g)=>n+g.sessions.length,0),priced=list.filter(g=>g.cost!==null),cost=priced.length?priced.reduce((n,g)=>n+g.cost,0):null,upper=priced.length?priced.reduce((n,g)=>n+g.upper,0):null,total=list.reduce((n,g)=>n+g.total,0),label={today:'今天',7:'最近 7 天',30:'最近 30 天',all:'全部时间'}[state.range],start=rangeStart(),end=today(),missing=Object.entries(state.list?.unattributed||{}).filter(([agent])=>state.agent==='all'||agent===state.agent).reduce((n,[,days])=>n+Object.entries(days).reduce((m,[date,v])=>date>=start&&date<=end?m+v:m,0),0),coverage=total?list.reduce((n,g)=>n+(g.coverage??0)*g.total,0)/total:null;return {list,sessions,cost,upper,total,label,start,end,missing,coverage,tokens:short(total),agent:state.agent==='all'?'全部 Agent':agents[state.agent].name,estimate:costValue(cost,upper,coverage)};}

return Object.freeze({sessionName,pinned,collections,demoList,within,format,span,durationParts,durationText,durationBadge,breakdown,cacheRate,tokenTip,groups,groupFor,agentSummary,groupModelsSummary,short,timezone,today,rangeStart,fieldText,shortId,displayModel,recent,costValue,sessionView,groupView,inspectorView,pageSummary});}
return Object.freeze({create});
});
