'use strict';
// Pure cost projections extracted from cost-page.js (main 0ac94cf).
// The caller owns preferences and actions; deriving a view never reads a source or performs IPC.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.costModel=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 function create(context, globals){
  const window=globals,state=context.state,data=globals.usageData,table=globals.costTable,insights=globals.costInsights,math=globals.insightsMath;
  const agents=globals.agentCatalog.agents,usd=globals.displayValues.usd,{short,displayModel}=data;
  const MONTHS=12,set=context.set||(()=>{});
  const money = value => value === null || value === undefined ? '未知' : value > 0 && value < 0.005 ? '<$0.01' : usd(value);
  const rate = value => value === null || value === undefined ? '未知' : value >= 1 || value === 0 ? usd(value) : '$' + (value >= 0.01 ? value.toFixed(3) : value.toPrecision(2));
  const pct = (value, digits = 1) => value === null || value === undefined ? '未知' : value > 0 && value * 100 < .5 / 10 ** digits ? '<' + (1 / 10 ** digits) + '%' : (value * 100).toFixed(digits) + '%';
  const covered = value => value !== null && value < 1 && value * 100 >= 99.95 ? '>99.9%' : pct(value);
  const signed = value => (value >= 0 ? '+' : '−') + Math.abs(value * 100).toFixed(1) + '%';
  const agentName = id => agents[id]?.name || id;
  const shift = (date, days) => insights.shift(date, days);
  const monthBefore = start => { const [y, m] = start.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); };
  const monthLabel = (month, year = data.today().slice(0, 4)) => { const [y, m] = month.split('-'); return (y === year ? '' : y + ' 年 ') + Number(m) + ' 月'; };
  const KINDS = ['input', 'output', 'read', 'write'];
  const PART_NAMES = { inputUncached: ['输入', '未缓存'], output: ['输出', '含推理'], cacheRead: ['缓存读取', ''], cacheWrite: ['缓存写入', ''] };

  // The range and its comparable earlier window: a preset (same rule as the usage page's) or one month.
  const md = date => Number(date.slice(5, 7)) + '/' + Number(date.slice(8));
  const dayCount = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  function range() {
    const today = data.today(), coverage = data.coverageStart();
    if (state.custom) {
      const from = coverage && coverage > state.custom.from ? coverage : state.custom.from, to = state.custom.to > today ? today : state.custom.to, length = dayCount(from, to) + 1;
      const previous = { from: shift(from, -length), to: shift(from, -1) };
      return { from, to, previous: coverage && previous.from >= coverage ? previous : null, compare: '较前 ' + length + ' 天', label: from === to ? md(from) : md(from) + ' – ' + md(to), custom: true };
    }
    if (state.month) {
      const start = state.month + '-01', end = insights.monthEnd(start), from = coverage && coverage > start ? coverage : start, to = end > today ? today : end;
      const before = monthBefore(start), partial = to < end, length = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
      const previous = from === start && coverage && before >= coverage ? { from: before, to: partial ? shift(before, length - 1) : insights.monthEnd(before) } : null;
      return { from, to, previous, compare: partial ? '较上月同期' : '较上月', label: monthLabel(state.month) + (partial ? ' · 至今' : '') };
    }
    if (state.period === 'all') return { from: null, to: null, previous: null, compare: null, label: '累计' };
    const from = window.usageMath.startFor(today, state.period, coverage), length = Math.round((Date.parse(today) - Date.parse(from)) / 86400000) + 1;
    const previous = { from: shift(from, -length), to: shift(from, -1) };
    return { from, to: today, previous: coverage && previous.from >= coverage ? previous : null, compare: state.period === 'today' ? '较昨天' : '较前 ' + state.period + ' 天', label: state.period === 'today' ? '今天' : '最近 ' + state.period + ' 天' };
  }
  const within = (rows, span) => span && span.from ? rows.filter(row => row.date >= span.from && row.date <= span.to) : rows;
  const chosen = rows => state.agents ? rows.filter(row => state.agents.has(row.agent)) : rows;
  // Whether part of a set of rows has no estimate: the total then carries a "+".
  const partialOf = rows => rows.some(row => row.unpricedRecords > 0 || row.pricedTokens < row.totalTokens);

  // Why an entry is not counted, in a few words for the table cell.
  function why(item) {
    const gap = item.gaps?.[0];
    if (!gap) return '';
    return gap.kind === 'cause' || gap.code === 'usage-incomplete' ? '来源未报告完整' : gap.code === 'price-unverified' ? '价格待核实' : gap.code === 'rate-missing' ? '缺少部分费率' : '没有价格';
  }
  // Why an estimate is a range, in a few words; the range is never pinned on one field.
  const RANGE_WORDS = { 'cache-write-unreported': '缓存写入未报告', 'context-unreported': '上下文长度未报告', 'reasoning-unreported': '推理数量未报告', 'time-tariff-unreported': '按时段计价' };
  const rangeWords = reasons => (reasons || []).map(reason => RANGE_WORDS[reason.code] || reason.text).join('、');
  const amount = (lower,upper) => lower===null?'未计入':upper>lower+.000001?money(lower)+' – '+money(upper):money(lower);
  const nameOf = item => item.other ? '其他 ' + item.count + ' 个' + (state.by === 'agent' ? ' Agent' : '模型') : state.by === 'agent' ? agentName(item.agent) : displayModel(item.model);

  const daysOfWeek = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const WEEKDAY=daysOfWeek;
  const dayTitle = date => Number(date.slice(5, 7)) + ' 月 ' + Number(date.slice(8)) + ' 日 ' + daysOfWeek[new Date(date + 'T12:00:00Z').getUTCDay()];
  function heroModel(rows, span, comp, previousRows, all, list, models) {
    const eff=math.efficiency(rows,data.recorded()),dest=math.costDestination(rows,data.recorded());
    const dates=[...new Set(rows.map(row=>row.date))].sort(),from=span.from||dates[0],to=span.to||data.today();
    const ranged=comp.upper>comp.lower+.000001,partial=comp.lower!==null&&partialOf(rows)&&!ranged;
    const unpriced=rows.reduce((n,row)=>n+Math.max(0,row.totalTokens-(row.pricedTokens??0)),0);
    const before=previousRows?insights.composition(previousRows,{bucket:'week',from:span.previous.from}).lower:null;
    const byAgent=new Map(),seen=new Set();
    for(const row of rows){seen.add(row.agent);if(Number.isFinite(row.estimatedCostUsd))byAgent.set(row.agent,(byAgent.get(row.agent)||0)+row.estimatedCostUsd);}
    const agentsShare=[...byAgent].filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]).map(([key,value])=>({key,name:agentName(key),value,tone:'series:'+key}));
    const total=agentsShare.reduce((n,a)=>n+a.value,0);
    const range={number:comp.lower===null?null:money(comp.lower)+(partial?'+':''),upperText:ranged?'– '+money(comp.upper):'',total,agents:agentsShare,unpriced:[...seen].filter(a=>!byAgent.has(a)).map(agentName),coverage:comp.coverage,unpricedTokens:unpriced,hasRows:rows.length>0,
      sub:span.label+(from?' · '+(from===to?md(from):md(from)+' – '+md(to)):'')+(comp.lower!==null&&before>0?' · '+span.compare+' '+signed((comp.lower-before)/before):'')};
    const perDay=new Map();for(const row of rows)if(Number.isFinite(row.estimatedCostUsd))perDay.set(row.date,(perDay.get(row.date)||0)+row.estimatedCostUsd);
    const last=to||data.today(),daily=Array.from({length:14},(_,i)=>({date:shift(last,i-13),value:perDay.get(shift(last,i-13))??null}));
    const prior=previousRows?math.efficiency(previousRows,data.recorded()).costPerMillion:null,now=eff.costPerMillion,hit=insights.cache(models).hitRate;
    const facts={perDay:eff.costPerDay===null?null:money(eff.costPerDay),daily,dailyNote:'近 14 天',perMillion:now===null?null:rate(now),perMillionNow:Number.isFinite(now)?now:null,perMillionBefore:Number.isFinite(prior)&&Number.isFinite(now)?prior:null,
      perMillionNote:Number.isFinite(prior)&&prior>0&&Number.isFinite(now)?span.compare+' '+signed((now-prior)/prior):'',saved:dest.savings===null?null:money(dest.savings),hit:Number.isFinite(hit)?hit:null,hitNote:Number.isFinite(hit)?'缓存命中 '+pct(hit):'命中率未报告'};
    const today=data.today(),current=list.find(m=>m.current&&m.month===today.slice(0,7));let month=null;
    if(current){
      const first=current.month+'-01',end=insights.monthEnd(first),inMonth=all.filter(r=>r.date.slice(0,7)===current.month),days=[];
      for(let day=first;day<=end;day=shift(day,1)){
        const on=inMonth.filter(r=>r.date===day),priced=on.filter(r=>Number.isFinite(r.estimatedCostUsd)),value=priced.length?priced.reduce((n,r)=>n+r.estimatedCostUsd,0):null;
        const future=day>today,used=on.length>0;
        days.push({key:day,date:day,title:dayTitle(day),short:md(day),future,today:day===today,used,value,partial:partialOf(on),label:dayTitle(day)+'，'+(future?'还没到':value!==null?money(value):used?'有用量，未计入':'没有记录'),state:future?'future':value===0?'zero':value!==null?'value':used?'unpriced':'unobserved'});
      }
      const monthRanged=current.upper>current.lower+.000001,tokens=inMonth.reduce((n,r)=>n+r.totalTokens,0),priced=inMonth.reduce((n,r)=>n+(r.pricedTokens??0),0);
      month={title:monthLabel(current.month)+' '+Number(current.from.slice(8))+' – '+Number(current.to.slice(8))+' 日',lower:current.lower,upper:current.upper,projection:current.projection,days,today:days.findIndex(d=>d.today),coverage:tokens?priced/tokens:null,
        number:current.lower===null?null:money(current.lower)+(partialOf(inMonth)&&!monthRanged?'+':''),upperText:monthRanged?'– '+money(current.upper):'',
        sub:'第 '+(dayCount(first,today)+1)+' 天，共 '+(dayCount(first,end)+1)+' 天'+(current.delta!==null?' · 较上月同期 '+signed(current.delta):'')};
      if(month.today<0)month=null;
    }
    return {range,month,facts,customLabel:state.month||state.custom?span.label:null,slide:state.heroSlide};
  }

  function trendModel(rows, span) {
    const dates = [...new Set(rows.map(row => row.date))].sort(); if (!dates.length) return null;
    const from = span.from || dates[0], to = span.to || data.today(), weekly = state.grain === 'week' || state.grain === 'auto' && dayCount(from, to) + 1 > 120, monthly = state.grain === 'month';
    const key = date => monthly ? (date.slice(0, 7) === from.slice(0, 7) ? from : date.slice(0, 7) + '-01') : weekly ? shift(from, Math.floor(dayCount(from, date) / 7) * 7) : date, buckets = new Map(), totals = new Map();
    for (let day = from; day <= to; day = monthly ? shift(insights.monthEnd(day.slice(0, 7) + '-01'), 1) : shift(day, weekly ? 7 : 1)) { const end = monthly ? (insights.monthEnd(day.slice(0, 7) + '-01') > to ? to : insights.monthEnd(day.slice(0, 7) + '-01')) : weekly ? (shift(day, 6) > to ? to : shift(day, 6)) : day; buckets.set(day, { date: day, end, title: monthly ? monthLabel(day.slice(0, 7)) : weekly ? md(day) + ' – ' + md(end) : Number(day.slice(5, 7)) + ' 月 ' + Number(day.slice(8)) + ' 日 ' + WEEKDAY[new Date(day + 'T12:00:00Z').getUTCDay()], values: {}, used: new Set(), partial: false, unpriced: new Set() }); }
    for (const row of rows) {
      const bucket = buckets.get(key(row.date)); if (!bucket) continue;
      bucket.used.add(row.agent);
      if (Number.isFinite(row.estimatedCostUsd)) { bucket.values[row.agent] = (bucket.values[row.agent] || 0) + row.estimatedCostUsd; totals.set(row.agent, (totals.get(row.agent) || 0) + row.estimatedCostUsd); }
      if (row.unpricedRecords > 0 || row.pricedTokens < row.totalTokens) { bucket.partial = true; bucket.unpriced.add(agentName(row.agent)); }
    }
    // The largest Agent sits at the bottom of the stack.
    const series = [...new Set(rows.map(row => row.agent))].sort((a, b) => (totals.get(b) ?? -1) - (totals.get(a) ?? -1)).map(agent => ({ key: agent, name: agentName(agent) }));
    const left = [...new Set(rows.map(row => row.agent))].filter(agent => !totals.has(agent));
    return { buckets: [...buckets.values()].map(bucket => ({ ...bucket, unpriced: [...bucket.unpriced] })), series, left, weekly, monthly, view: state.chartView, mode: state.trend, hidden: new Set([...state.hidden].filter(agent => totals.has(agent))),
      select: (a, b) => set({custom: {from: a.date < b.date ? a.date : b.date, to: a.end > b.end ? a.end : b.end}, month: null, cal: b.end.slice(0, 7)}),
      drill: bucket => { if (bucket) set({ custom: { from: bucket.date, to: bucket.end }, month: null, cal: bucket.end.slice(0, 7) }); } };
  }
  function compositionModel(comp, rows) {
    let items;
    if (state.compBy === 'kind') items = comp.parts.map((part, i) => ({ key: KINDS[i], name: PART_NAMES[part.key][0], value: part.cost, color: 'var(--' + KINDS[i] + ')', detail: comp.fullTokens ? '占 Token ' + pct(part.tokenShare, 0) : PART_NAMES[part.key][1] }));
    else {
      const by = new Map();
      for (const row of rows) { const entry = by.get(row.agent) || { lower: 0, priced: false, tokens: 0, partial: false }; entry.tokens += row.totalTokens; if (Number.isFinite(row.estimatedCostUsd)) { entry.lower += row.estimatedCostUsd; entry.priced = true; } if (row.unpricedRecords > 0 || row.pricedTokens < row.totalTokens) entry.partial = true; by.set(row.agent, entry); }
      items = [...by].map(([agent, entry]) => ({ key: agent, name: agentName(agent), value: entry.priced ? entry.lower : null, color: 'var(--series-' + agent + ', var(--series-other))', detail: short(entry.tokens) + ' Token' + (entry.priced && entry.partial ? ' · 部分未计入' : '') })).sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    }
    const ranged = comp.upper > comp.lower + 0.000001;
    return { items, semi: state.ring === 'semi', label: '已计价 ' + money(comp.lower), centerLabel: '已计价', centerFoot: ranged ? '至多 ' + money(comp.upper) : partialOf(rows) ? '另有未计入' : '全部已计价',
      note: state.compBy === 'kind' && comp.spread > 0.000001 ? '估算区间：至多 +' + money(comp.spread) + '（' + rangeWords(comp.reasons) + '）' : '', format: money, pct: value => pct(value) };
  }
  function monthsModel(list, rows) {
    const shown = (state.monthsAll ? list : list.slice(0, MONTHS)).slice().reverse(), totals = new Map();
    for (const row of rows) if (Number.isFinite(row.estimatedCostUsd)) totals.set(row.agent, (totals.get(row.agent) || 0) + row.estimatedCostUsd);
    // Agents with no priced use in these months have no bar to draw; the readout names them instead.
    const seen = [...new Set(rows.filter(r => shown.some(m => m.month === r.date.slice(0, 7))).map(r => r.agent))];
    const series = seen.filter(agent => totals.has(agent)).sort((a, b) => totals.get(b) - totals.get(a)).map(agent => ({ key: agent, name: agentName(agent), color: 'var(--series-' + agent + ', var(--series-other))' }));
    const left = seen.filter(agent => !totals.has(agent)).map(agentName);
    const year = data.today().slice(0, 4);
    const months = shown.map(m => {
      const inMonth = rows.filter(r => r.date.slice(0, 7) === m.month), used = new Set(inMonth.map(r => r.agent));
      const values = series.map(s => { const priced = inMonth.filter(r => r.agent === s.key && Number.isFinite(r.estimatedCostUsd)); return priced.length ? priced.reduce((n, r) => n + r.estimatedCostUsd, 0) : null; });
      const title = monthLabel(m.month) + (m.current ? ' · 至今' : ''), total = m.lower === null ? '未计入' : amount(m.lower, m.upper) + (partialOf(inMonth) && !(m.upper > m.lower) ? '+' : '');
      return { key: m.month, label: (m.month.slice(0, 4) === year ? '' : m.month.slice(2, 4) + '/') + Number(m.month.slice(5)) + ' 月', title, values, lower: m.lower, upper: m.upper, projection: m.projection || null, used, totalText: total,
        note: m.projection ? '推算整月 ' + money(m.projection.lower) + ' – ' + money(m.projection.upper) : '', aria: title + '，' + (m.lower === null ? '未计入' : money(m.lower)) + (m.projection ? '，推算整月 ' + money(m.projection.lower) : '') + '，点选筛选这个月' };
    });
    const tick = v => v === 0 ? '$0' : v >= 1000 ? '$' + Number((v / 1000).toFixed(v >= 10000 ? 0 : 1)) + 'K' : '$' + (v >= 10 ? Math.round(v) : Number(v.toFixed(1)));
    return { months, series, stacked: state.bars === 'stacked', selected: state.month, format: money, tick, left: left.length ? left.join('、') + ' 未计入' : '' };
  }
  function subsMonth(list) {
    if (state.month) return list.find(m => m.month === state.month) || null;
    return list.find(m => !m.current && m.started) || list[0] || null;
  }
  function quotaSummary(agent) {
    const v2 = window.quotaHost?.codex?.() || [], others = window.quotaHost?.providers?.()?.accounts || [], v1 = window.quotaHost?.state?.().accounts || [];
    const accounts = agent === 'codex' ? (v2.length ? v2 : v1.map(row => ({ ...row, quota: row.quota && { pools: [{ windows: (row.quota.windows || []).map(w => ({ ...w, unit: 'percent' })) }] } }))) : others.filter(row => row.provider === agent);
    if (!accounts.length) return null;
    const pools = accounts[0].quota?.pools || [], windows = pools.flatMap(pool => (pool.windows || []).filter(w => w.unit === 'percent')).sort((a, b) => (a.role === 'primary' ? 0 : a.role === 'secondary' ? 1 : 2) - (b.role === 'primary' ? 0 : b.role === 'secondary' ? 1 : 2));
    const span = mins => mins === 10080 ? '每周' : mins === 1440 ? '每天' : Number.isFinite(mins) && mins % 60 === 0 ? mins / 60 + ' 小时' : Number.isFinite(mins) ? mins + ' 分钟' : null;
    const parts = windows.slice(0, 2).map(w => { const name = span(w.durationMins) || String(w.label || '额度').split(/ · |（/)[0]; return Number.isFinite(w.remainingPercent) ? name + ' 剩 ' + Math.round(w.remainingPercent) + '%' : name + ' 未知'; });
    const balance = !parts.length ? pools.flatMap(pool => pool.balances || []).find(b => b.id === 'total') || pools.flatMap(pool => pool.balances || [])[0] : null;
    const text = parts.length ? parts.join(' · ') : balance ? '余额 ' + (balance.remaining ?? '未知') + (balance.currency ? ' ' + balance.currency : '') : '尚无额度观测';
    return text + (accounts.length > 1 ? ' · 共 ' + accounts.length + ' 个账号' : '');
  }
  const niceStep=raw=>{if(!(raw>0)||!Number.isFinite(raw))return 1;const exp=Math.floor(Math.log10(raw)),base=raw/10**exp;return(base<=1?1:base<=2?2:base<=2.5?2.5:base<=5?5:10)*10**exp;};
  // cost-chart.js niceMax: the original detail plot has two grid rows, excluding
  // the upper label. This is deliberately different from the stacked scale.
  const niceMax=value=>{if(!Number.isFinite(value)||value<=0)return 1;const power=10**Math.floor(Math.log10(value)),scaled=value/power;return(scaled<=1?1:scaled<=2?2:scaled<=4?4:scaled<=5?5:10)*power;};
  const tick=value=>value===0?'$0':'$'+(value>=100?Math.round(value):value>=1?Number(value.toFixed(1)):Number(value.toPrecision(2)));
  const budgetMoney=value=>value>0&&value<.0000005?'<$0.000001':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:6}).format(value);
  function validateFee(raw){const text=raw.trim().replace(/^\$/,''),fee=text===''?null:Number(text);return fee!==null&&(!Number.isFinite(fee)||fee<=0||fee>100000)?{ok:false,value:null}:{ok:true,value:fee===null?null:Math.round(fee*100)/100};}
  function mix(item){
    if(!item.costParts||!item.upper)return [];
    return [['inputUncached','输入','cost:input'],['output','输出','cost:output'],['cacheRead','缓存读取','cost:read'],['cacheWrite','缓存写入','cost:write']]
      .flatMap(([key,label,tone])=>item.costParts[key]>0?[{key,value:item.costParts[key]/item.upper,tone,label:label+' '+money(item.costParts[key])+' · '+pct(item.costParts[key]/item.upper)}]:[])
      .concat(item.spread>0?[{key:'range',value:item.spread/item.upper,tone:'muted',pattern:'hatched',label:'估算区间（至多） '+money(item.spread)+' · '+pct(item.spread/item.upper)}]:[]);
  }
  function rowView(item){
    const name=nameOf(item),other=Boolean(item.other),partial=item.coverage!==null&&item.coverage<.999999;
    const ranged=item.upper>item.lower+.000001;
    const sub=other?'':state.by==='agent'?item.users.length+' 个模型':item.users.map(u=>agentName(u.agent)).join(' · ');
    const change=other||item.previousTokens===null?null:item.isNew?'新增':item.delta===null?null:(item.delta>=0?'+':'−')+Math.abs(item.delta*100).toFixed(0)+'%';
    const points=other?[]:table.points(item.series,30).map(p=>({key:p.date,label:md(p.date),value:p.tokens,readout:p.date+' · '+short(p.tokens)}));
    return {key:other?'__other':item.key,name,sub,agent:other?null:state.by==='agent'?item.agent:item.users[0]?.agent,title:other?item.members.join('、'):name,tokens:short(item.tokens),share:pct(item.share),amount:amount(item.lower,item.upper)+(item.lower!==null&&partial&&!ranged?'+':''),unknown:item.lower===null,
      note:item.lower===null?other?'没有价格或来源未报告完整':why(item):partial?'已计入 '+pct(item.coverage):ranged?other?'估算区间':RANGE_WORDS[item.spreadReasons?.[0]?.code]||'估算区间':'',rate:other||item.perMillion===null?null:rate(item.perMillion),change,mix:other?[]:mix(item),points,other};
  }
  // One day's cost as the page says it elsewhere: a range when the sources allow one, + when part of it is unpriced.
  const dayCost=p=>p.cost===null||p.cost===undefined?'未计入':p.costUpper>p.cost?money(p.cost)+' – '+money(p.costUpper):money(p.cost)+(p.partial?'+':'');
  function detailView(item,span){
    if(!item||item.other)return null;
    const dates=item.series.map(p=>p.date).sort(),from=span.from||dates[0],to=span.to||dates.at(-1),days=from&&to?dayCount(from,to)+1:0;
    const metric=(label,value)=>({label,value});
    const fields=[['inputUncached','输入','未缓存'],['output','输出',item.fields.reasoning?.value?'含推理 '+short(item.fields.reasoning.value):'含推理'],['cacheRead','缓存读取',''],['cacheWrite','缓存写入','']].map(([key,label,note],i)=>({key,label,note,tone:'cost:'+KINDS[i],tokens:item.fields[key].value===null?null:item.fields[key].value.toLocaleString('zh-CN')+(item.fields[key].partial?'（部分未报告）':''),cost:item.lower===null?null:money(item.costParts?.[key])}));
    const series=(item.series.length<=90?item.series:Array.from({length:90},(_,i)=>item.series[Math.round(i*(item.series.length-1)/89)])).map(p=>({key:p.date,label:md(p.date),value:p.tokens,readout:p.date+' · '+short(p.tokens),cost:p.cost??null,costText:dayCost(p),costReadout:p.date+' · '+dayCost(p)+' · '+short(p.tokens)+' Token'}));
    const costCeiling=niceMax(Math.max(0,...series.map(p=>p.cost??0))),costTicks=Array.from({length:2},(_,i)=>({value:costCeiling*i/2,label:money(costCeiling*i/2)}));
    const ceiling=niceMax(Math.max(0,...series.map(p=>p.value))),tokenTick=v=>v>0&&v<.000001?Number(v.toPrecision(3)).toExponential():new Intl.NumberFormat('en-US',{notation:v>=10000?'compact':'standard',maximumFractionDigits:8}).format(v);
    const ticks=Array.from({length:2},(_,i)=>({value:ceiling*i/2,label:tokenTick(ceiling*i/2)}));
    return {...rowView(item),amount:amount(item.lower,item.upper),item,fields,series,ticks,costTicks,endLabel:series.length?short(series.at(-1).value):null,costEndLabel:series.length&&series.at(-1).cost!==null?series.at(-1).costText:null,range:span.label,rangeReason:rangeWords(item.spreadReasons),coverage:covered(item.coverage),metrics:[metric('Token',short(item.tokens)),metric('用量占比',pct(item.share)),metric('每百万 Token',item.perMillion===null?null:rate(item.perMillion)),metric('日均',days&&item.lower!==null?money(item.lower/days):null),metric('缓存命中',item.hitRate===null?null:pct(item.hitRate)),metric('缓存约省下',item.savings===null?null:money(item.savings))]};
  }
  function trendView(trend,index=null){
    if(!trend)return null;
    const totals=new Map();for(const bucket of trend.buckets)for(const [key,value]of Object.entries(bucket.values))totals.set(key,(totals.get(key)||0)+value);
    // drawn keeps hidden series too, so the chart can move them away instead of cutting to a new drawing.
    const drawn=trend.series.filter(s=>totals.has(s.key)).map(s=>{let sum=null;return{key:s.key,label:s.name,tone:'series:'+s.key,style:state.chartView==='line'?'line':'area',values:trend.buckets.map(b=>{const v=b.values[s.key]??null;if(state.trend!=='cumulative')return v;if(Number.isFinite(v))sum=(sum||0)+v;return sum;})};});
    const series=drawn.filter(s=>!state.hidden.has(s.key));
    const peak=state.chartView==='line'?Math.max(0,...series.flatMap(s=>s.values.filter(Number.isFinite))):Math.max(0,...trend.buckets.map((_,i)=>series.reduce((n,s)=>n+(s.values[i]??0),0)));
    const step=niceStep(peak/4),ticks=Array.from({length:5},(_,i)=>({value:step*i,label:tick(step*i)}));
    const bucket=index===null?null:trend.buckets[index],partial=bucket?bucket.partial:trend.buckets.some(b=>b.partial);
    const read=trend.series.map(s=>{const value=bucket?(state.trend==='cumulative'?series.find(v=>v.key===s.key)?.values[index]??null:bucket.values[s.key]??null):totals.get(s.key)??null;return{key:s.key,label:s.name,tone:'series:'+s.key,hidden:state.hidden.has(s.key),disabled:!totals.has(s.key),value:value===null?bucket&&!bucket.used.has(s.key)?'没有记录':'未计入':money(value)};});
    const sum=bucket?series.some(s=>s.values[index]!==null)?series.reduce((n,s)=>n+(s.values[index]??0),0):null:[...totals].filter(([k])=>!state.hidden.has(k)).reduce((n,[,v])=>n+v,0);
    return {series,drawn,ticks,legend:read,known:totals.size>0,when:bucket?bucket.title:md(trend.buckets[0].date)+' – '+md(trend.buckets.at(-1).end)+' · 已计价合计',total:sum===null?null:money(sum)+(partial?'+':''),note:bucket?bucket.unpriced.length?bucket.unpriced.join('、')+' 未计入':'':partial?'另有未计入的用量':''};
  }
  let monthProjection=null;
  function monthView(list,rows,hidden=[],active=null){
    const key=JSON.stringify([state.monthsAll,state.bars]);
    if(!monthProjection||monthProjection.list!==list||monthProjection.rows!==rows||monthProjection.key!==key)monthProjection={list,rows,key,base:monthsModel(list,rows),groups:null};
    const base=monthProjection.base,hide=new Set(hidden),groups=monthProjection.groups||(monthProjection.groups=base.months.map(m=>({key:m.key,label:m.label,ariaLabel:m.aria,projection:m.projection,series:base.series.map((s,i)=>{const priced=rows.filter(r=>r.agent===s.key&&r.date.slice(0,7)===m.key&&Number.isFinite(r.estimatedCostUsd));return{key:s.key,lower:m.values[i],upper:priced.length?priced.reduce((n,r)=>n+(r.estimatedCostUpperUsd??r.estimatedCostUsd),0):null,tone:'series:'+s.key};})})));
    const peak=Math.max(0,...groups.map(g=>state.bars==='stacked'?Math.max(g.series.filter(s=>!hide.has(s.key)).reduce((n,s)=>n+(s.lower??0),0),hidden.length?0:g.projection?.upper??0,hidden.length?0:g.series.reduce((n,s)=>n+(s.upper??0),0)):Math.max(0,...g.series.filter(s=>!hide.has(s.key)).map(s=>s.lower??0))));
    const step=niceStep(peak/4),ticks=Array.from({length:5},(_,i)=>({value:step*i,label:base.tick(step*i)})),m=base.months.find(m=>m.key===(active||state.month))||base.months.at(-1);
    return {groups,ticks,left:base.left,when:m?m.title:'',total:m?m.totalText:null,note:m?.note||'',legend:base.series.map((s,i)=>({key:s.key,label:s.name,tone:'series:'+s.key,hidden:hide.has(s.key),value:m?m.values[i]===null?m.used.has(s.key)?'未计入':'没有记录':money(m.values[i]):null}))};
  }
  function donutReadout(model,hidden=[],active=null){
    const shown=model.items.filter(i=>!hidden.includes(i.key)&&i.value>0),sum=shown.reduce((n,i)=>n+i.value,0),item=model.items.find(i=>i.key===active),share=item&&sum>0&&item.value!==null?item.value/sum:null;
    return {label:item?.name||model.centerLabel,amount:item?item.value:shown.length?sum:null,
      value:item?item.value===null?null:money(item.value):shown.length?money(sum):null,
      detail:item?item.value===null?item.detail||'没有价格':(hidden.includes(item.key)?'已隐藏':share===null?'—':pct(share))+(item.detail?' · '+item.detail:''):
        hidden.length?'已隐藏 '+hidden.length+' 项':model.centerFoot,share:share===null?null:pct(share),note:model.note};
  }
  function subscriptionView(entry){
    const ratio=value=>value>=10?value.toFixed(0):value>=1?value.toFixed(1):value.toFixed(2);
    const scale=Math.max(entry.upper??0,entry.fee??0,.01);
    const multiple=entry.lower===null?null:entry.fee?ratio(entry.ratioLower)+(entry.ratioUpper>entry.ratioLower+.005?'–'+ratio(entry.ratioUpper):'')+'×':null;
    const note=entry.lower===null?entry.tokens?'没有可计价的用量':'这个月没有用量':entry.fee?entry.ratioLower>=1?'已回本':'还没回本':'填写月费后显示';
    const segments=entry.lower===null?[]:[{key:'lower',value:entry.lower/scale,tone:'series:'+entry.agent,label:'API 等价 '+money(entry.lower)}];
    if(entry.upper>entry.lower)segments.push({key:'upper',value:(entry.upper-entry.lower)/scale,tone:'series:'+entry.agent,pattern:'light',label:'至多 '+money(entry.upper)});
    const markers=entry.fee?[{key:'fee',at:entry.fee/scale,kind:'fee',label:'月费 '+money(entry.fee)}]:[];
    return {ratio:multiple,note,segments,markers};
  }
  let derived=null;
  function view(everything,fees={}){
    const span=range(),key=JSON.stringify([span,state.agents&&[...state.agents],state.by,data.today(),data.coverageStart()]);
    if(!derived||derived.source!==everything||derived.key!==key){
      const all=chosen(everything),rows=within(all,span),previousRows=span.previous?within(all,span.previous):null,bucketDays=span.from?dayCount(span.from,span.to):Infinity;
      const comp=insights.composition(rows,{bucket:bucketDays<31?'day':'week',from:span.from}),list=insights.months(all,{today:data.today(),coverageStart:data.coverageStart()}),models=table.table(rows,{by:'model'}),items=state.by==='model'&&!previousRows?models:table.table(rows,{by:state.by,previousRows});
      derived={source:everything,key,all,rows,previousRows,comp,list,models,items,hero:heroModel(rows,span,comp,previousRows,all,list,models),coverage:insights.coverage(models),cache:insights.cache(models),trend:null,trendKey:null};
    }
    const {all,rows,comp,list,models,items,coverage,cache}=derived;
    if(derived.trendKey!==state.grain){derived.trend=trendModel(rows,span);derived.trendKey=state.grain;}
    const sorted=table.sort(items,state.sort),filtered=state.gapsOnly?sorted.filter(i=>i.lower===null||i.coverage!==null&&i.coverage<.999999||i.gaps?.length):sorted;
    const query=state.query.trim().toLowerCase(),search=filtered.length>12,matched=search&&query?filtered.filter(i=>[nameOf(i),i.key,...i.users.map(u=>u.agent?agentName(u.agent):u.model)].some(t=>String(t).toLowerCase().includes(query))):filtered;
    const shown=state.all||search&&query?matched:table.fold(matched,6),dates=[...new Set(rows.map(r=>r.date))].sort(),from=span.from||dates[0],to=span.to||data.today();
    const month=subsMonth(list),subscriptions=month?insights.subscriptions(all,{from:month.from,to:month.to,fees,agents:Object.keys(fees)}).filter(e=>!state.agents||state.agents.has(e.agent)).sort((a,b)=>(a.lower===null)-(b.lower===null)||(b.lower??0)-(a.lower??0)||b.tokens-a.tokens||a.agent.localeCompare(b.agent)):[];
    const eligible=cache.models.filter(m=>m.reported||m.savings!==null),unreported=cache.models.filter(m=>!m.reported&&m.savings===null),cacheRows=[...eligible,...unreported];
    const result={span,all,rows,models,items,comp,list,hero:derived.hero,trend:derived.trend,composition:compositionModel(comp,rows),coverage,cache,cacheRows,subscriptions,subsMonth:month,shown,matched,table:shown.map(rowView),detail:detailView(matched.find(i=>i.key===state.open),span),search,canFold:matched.length>7,counts:{model:state.by==='model'?filtered.length:models.length,agent:state.by==='agent'?filtered.length:new Set(rows.map(r=>r.agent)).size},monthsTotal:list.some(m=>m.lower!==null)?amount(list.reduce((n,m)=>n+(m.lower??0),0),list.reduce((n,m)=>n+(m.upper??0),0)):'未计入',rangeLabel:from?from===to?md(from):md(from)+' – '+md(to):span.label,agents:[...new Set(within(everything,span).map(r=>r.agent))].sort((a,b)=>(Object.keys(agents).indexOf(a)+1||999)-(Object.keys(agents).indexOf(b)+1||999)).map(id=>({id,name:agentName(id),recorded:true}))};
    return result;
  }
  return Object.freeze({subscriptionView,view,trendView,monthView,donutReadout,mix,rowView,detailView,validateFee,budgetMoney,money,rate,pct,covered,signed,agentName,shift,monthBefore,monthLabel,md,dayCount,range,within,chosen,partialOf,why,rangeWords,amount,nameOf,heroModel,trendModel,compositionModel,monthsModel,subsMonth,quotaSummary});
 }
 return Object.freeze({create});
});
