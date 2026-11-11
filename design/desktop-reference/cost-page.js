'use strict';
// Cost data/preferences/actions. React owns all fee-page DOM (M8).
(() => {
  const data=window.usageData,bridge=window.usageBridge;
  if(!data||!window.costModel)return;
  const KEY = 'agentusage.cost.v1';
  // custom: a range picked on the rail's calendar; agents: the Agents the page shows (null = all);
  // gapsOnly: the table lists only entries not fully counted; cal: the month the calendar shows.
  const state = { period: 'all', month: null, custom: null, agents: null, gapsOnly: false, cal: null, by: 'model', sort: 'tokens', open: null, all: false, query: '', monthsAll:false, trend: 'daily', hidden: new Set(), compBy: 'agent', ring: 'full', bars: 'stacked', panel: 'both', panelTab: 'composition', grain: 'auto', chartView: 'area', heroSlide: 'range' };
  // The rail and its calendar fold away and stay as left (2026-10-23 owner request).
  const folds = { rail: false };
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}'); if (['model', 'agent'].includes(saved.by)) state.by = saved.by; if (['tokens', 'cost'].includes(saved.sort)) state.sort = saved.sort; if (saved.heroSlide === 'month') state.heroSlide = 'month'; } catch { /* Defaults this session. */ }
  const remember = () => { try { localStorage.setItem(KEY, JSON.stringify({ by: state.by, sort: state.sort, heroSlide: state.heroSlide })); } catch { /* Not remembered. */ } };
  let version=0,fees=null,exporting=false,cached=null;
  const model=window.costModel.create({state},window);
  const currentFees=()=>fees||data.subscriptions?.()||{};
  function notify(){version++;window.dispatchEvent(new CustomEvent('cost-change'));}
  function publish(){cached=null;notify();}
  function get(){
    if(!cached)cached={state:{...state},folds:{...folds},view:model.view(data.rows(),currentFees()),fees:{...currentFees()},exporting,available:Boolean(bridge)};
    return cached;
  }
  function set(patch){
    Object.assign(state,patch);remember();publish();
  }
  function period(value){set({period:value,month:null,custom:null,cal:null});}
  function chooseAgent(key){set({agents:key==='all'||state.agents?.has(key)?null:new Set([key]),open:null});}
  function selectRange(from,to){set({custom:{from,to},month:null,cal:to.slice(0,7)});}
  function toggleSeries(key){
    const trend=get().view.trend;if(!trend)return;
    const read=model.trendView(trend),hidden=new Set(state.hidden),priced=read.legend.filter(i=>!i.disabled);
    if(hidden.has(key))hidden.delete(key);else if(priced.filter(i=>!hidden.has(i.key)).length>1)hidden.add(key);else return;
    set({hidden});
  }
  async function saveFee(agent,raw){
    const parsed=model.validateFee(raw),saved=currentFees();
    if(!parsed.ok){data.toast('月费请填大于 0、不超过 100000 的美元金额；留空可移除。');return String(saved[agent]??'');}
    const fee=parsed.value;
    if((saved[agent]??null)===fee)return String(saved[agent]??'');
    const next={...saved};if(fee===null)delete next[agent];else next[agent]=fee;
    if(!bridge?.setSubscription){fees=next;publish();return String(next[agent]??'');}
    try{const result=await bridge.setSubscription(agent,fee);fees={...(result?.subscriptions||next)};publish();return String(fees[agent]??'');}
    catch{data.toast('月费没有保存，请重试。');return String(saved[agent]??'');}
  }
  function closeDetail(){if(state.open!==null)set({open:null});}
  function price(key,explain=false){
    closeDetail();
    if(window.uiPricingEditor)requestAnimationFrame(()=>explain?window.uiPricingEditor.explain(key):window.uiPricingEditor.open(key));
    else data.toast('计费在桌面应用中设置。');
  }
  async function copy(text){try{if(bridge?.copyText)await bridge.copyText(text);else await navigator.clipboard.writeText(text);data.toast('已复制模型标识：'+text);}catch{data.toast('复制失败。');}}
  async function exportCost(){
    if(exporting)return;
    if(!bridge?.exportCost){data.toast('界面预览不导出文件；桌面应用里会把当前表格保存为 CSV。');return;}
    const span=model.range();exporting=true;publish();
    try{const result=await bridge.exportCost({by:state.by,from:span.from,to:span.to,previousFrom:span.previous?.from??null,previousTo:span.previous?.to??null});data.toast(result.saved?'费用已导出（'+result.rows+' 行）。':'已取消导出。');}
    catch{data.toast('导出失败，请选择可写的本地目录。');}
    finally{exporting=false;publish();}
  }
  window.costHost=Object.freeze({version:()=>version,get,state:()=>({...state}),model,set,period,chooseAgent,selectRange,toggleSeries,saveFee,closeDetail,price,copy,export:exportCost,
    rail:open=>{folds.rail=open;publish();},
    month:key=>set({month:state.month===key?null:key,custom:null,cal:null}),
    group:by=>set({by,open:null,all:false,query:''}),
    showModel:model=>{closeDetail();data.showModel(model);},showAgent:agent=>{closeDetail();data.showAgent(agent);},sources:()=>{closeDetail();data.view('sources');},
    quota:agent=>window.quotaUi?.openSource(agent),invalidate:publish,
    short:data.short,displayModel:data.displayModel,today:data.today,coverageStart:data.coverageStart
  });
  document.addEventListener('click',event=>{if(event.target.closest('[data-open-cost]'))data.view('cost');});
  window.addEventListener('usage-data-change',()=>{if(bridge?.setSubscription)fees=null;publish();});
  window.addEventListener('pricing-change',publish);
  // Quota captions are read live by Subscriptions. Notify those consumers,
  // without rebuilding unchanged usage/prices/charts for an account update.
  window.addEventListener('quota-change',notify);
  window.addEventListener('ui-view-change',event=>{if(event.detail!=='cost')closeDetail();});
})();
