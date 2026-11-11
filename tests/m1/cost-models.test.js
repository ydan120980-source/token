'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../../design/desktop-reference/cost-model');
const costTable=require('../../src/m1/cost-table'),costInsights=require('../../src/m1/cost-insights');
const usageMath=require('../../src/m1/usage-math'),insightsMath=require('../../src/m1/insights-math');
const agentCatalog=require('../../src/m1/agent-catalog'),displayValues=require('../../design/desktop-reference/display-values');
const row=(date,agent,lower,upper=lower)=>({date,agent,model:'synthetic',provider:'p',totalTokens:1000,inputUncached:400,output:100,cacheRead:500,cacheWrite:0,reasoning:0,records:1,pricedTokens:lower===null?0:1000,boundedTokens:0,estimatedCostUsd:lower,estimatedCostUpperUsd:upper,costParts:lower===null?null:{inputUncached:lower*.5,output:lower*.4,cacheRead:lower*.1,cacheWrite:0},cacheSavingsUsd:lower===null?null:1,pricingReasons:upper>lower?{'context-unreported':1}:{},unpricedTokens:lower===null?{'model-unpriced':1000}:{},incompleteTokens:{},unpricedRecords:lower===null?1:0});
function setup(patch={}){
  const state={period:'all',month:null,custom:null,agents:null,by:'model',sort:'tokens',gapsOnly:false,all:false,query:'',monthsAll:false,grain:'day',trend:'daily',chartView:'area',hidden:new Set(),compBy:'agent',ring:'full',heroSlide:'range',...patch};
  const globals={costTable,costInsights,usageMath,insightsMath,agentCatalog,displayValues,usageData:{today:()=> '2026-10-26',coverageStart:()=> '2026-08-01',short:String,displayModel:String,recorded:()=>()=>true},quotaHost:{codex:()=>[],providers:()=>({accounts:[]}),state:()=>({accounts:[]})}};
  return {state,globals,m:create({state},globals)};
}
test('cost ranges clamp custom dates, compare only covered history, and remain independent from usage',()=>{
  const {state,m}=setup({custom:{from:'2026-07-01',to:'2027-01-01'}});
  assert.deepEqual(m.range(),{from:'2026-08-01',to:'2026-10-26',previous:null,compare:'较前 87 天',label:'8/1 – 10/26',custom:true});
  state.custom=null;state.period='7';assert.equal(m.range().from,'2026-10-20');assert.deepEqual(m.range().previous,{from:'2026-10-13',to:'2026-10-19'});
  state.month='2026-10';assert.equal(m.range().compare,'较上月同期');assert.equal(m.range().previous.to,'2026-09-26');
});
test('S8 month unknown bounds stay null at gauge input; a measured zero stays zero',()=>{
  const {m}=setup(),unknown=m.view([row('2026-10-26','codex',null)]).hero.month;
  assert.equal(unknown.lower,null);assert.equal(unknown.upper,null);assert.equal(unknown.number,null);assert.equal(unknown.projection,null);
  const zero=m.view([row('2026-10-26','codex',0)]).hero.month;
  assert.equal(zero.lower,0);assert.equal(zero.number,'$0.00');assert.equal(zero.days.find(d=>d.today).state,'zero');
});
test('trend preserves absent, unpriced and measured-zero buckets; cumulative values use only known observations',()=>{
  const {m,state}=setup({custom:{from:'2026-10-20',to:'2026-10-23'}}),rows=[row('2026-10-20','codex',.01),row('2026-10-22','codex',null),row('2026-10-23','codex',0)];
  const trend=m.view(rows).trend,read=m.trendView(trend);
  assert.deepEqual(read.series[0].values,[.01,null,null,0]);assert.equal(m.trendView(trend,1).legend[0].value,'没有记录');assert.equal(m.trendView(trend,2).legend[0].value,'未计入');assert.equal(m.trendView(trend,3).total,'$0.00');
  state.trend='cumulative';assert.deepEqual(m.trendView(trend).series[0].values,[.01,.01,.01,.01]);
});
test('view keeps current month independent of range and unknown composition separate from zero',()=>{
  const {m}=setup({custom:{from:'2026-09-01',to:'2026-09-30'}}),rows=[row('2026-09-02','codex',2),row('2026-09-03','claude',null),row('2026-10-01','codex',7,9)];
  const view=m.view(rows);assert.equal(view.hero.month.number,'$7.00');assert.equal(view.hero.month.upperText,'– $9.00');assert.equal(view.comp.lower,2);
  const unknown=m.view([row('2026-09-02','codex',null)]);assert.equal(unknown.comp.lower,null);assert.equal(unknown.coverage.unpricedTokens,1000);
});
test('month projection, tiny amounts, G2 readouts and filtering keep precision and scope',()=>{
  const {m,state}=setup(),rows=[row('2026-09-02','codex',.0001),row('2026-10-26','claude',null)];
  const v=m.view(rows),month=m.monthView(v.list,v.all,[],'2026-09');assert.equal(month.groups.find(g=>g.key==='2026-09').series[0].lower,.0001);assert.equal(month.total,'<$0.01');assert.ok(month.ticks.at(-1).value<1);
  assert.equal(m.rate(.000123456789),'$0.00012');assert.equal(m.covered(.9999),'>99.9%');assert.equal(m.money(null),'未知');
  state.agents=new Set(['claude']);assert.equal(m.view(rows).rows.length,1);assert.equal(m.view(rows).comp.lower,null);
});
test('fee parsing retains dollar prefix, rounding, empty removal and old bounded validation',()=>{
  const {m}=setup();assert.deepEqual(m.validateFee(' $20.005 '),{ok:true,value:20.01});assert.deepEqual(m.validateFee(''),{ok:true,value:null});
  for(const value of ['0','-1','NaN','100001','USD 20'])assert.equal(m.validateFee(value).ok,false);
  assert.equal(m.budgetMoney(.000123),'$0.000123');assert.equal(m.budgetMoney(.0000001),'<$0.000001');
});
test('quota summary reads quotaHost only and uses one account plus count, never combines balances',()=>{
  const {m,globals}=setup();globals.providerQuotaUi={codex:()=>{throw Error('legacy getter used');}};
  globals.quotaHost.providers=()=>({accounts:[{provider:'workbuddy',quota:{pools:[{balances:[{id:'total',remaining:'9007199254740993.01',currency:'USD'}]}]}},{provider:'workbuddy',quota:{pools:[{balances:[{remaining:'999',currency:'USD'}]}]}}]});
  assert.equal(m.quotaSummary('workbuddy'),'余额 9007199254740993.01 USD · 共 2 个账号');
});
