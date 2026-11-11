'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('quota-only updates keep cost facts while notifying live quota consumers; fact changes still rebuild',()=>{
 const handlers=new Map(),events=[],counts={views:0},values={rows:[],quota:'5 小时 剩 80%'};
 const window={usageData:{rows:()=>values.rows,subscriptions:()=>({}),short:String,displayModel:String,today:()=> '2026-11-05',coverageStart:()=>null},
  costModel:{create:()=>({view:rows=>{counts.views++;return {rows};},quotaSummary:()=>values.quota})},
  addEventListener:(name,fn)=>handlers.set(name,fn),dispatchEvent:event=>events.push(event.type)};
 const context=vm.createContext({window,document:{addEventListener:()=>{}},localStorage:{getItem:()=>null,setItem:()=>{}},CustomEvent:class{constructor(type){this.type=type;}}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../design/desktop-reference/cost-page.js'),'utf8'),context);
 const host=window.costHost,first=host.get(),version=host.version();
 values.quota='5 小时 剩 60%';handlers.get('quota-change')();
 assert.equal(host.version(),version+1);assert.equal(events.at(-1),'cost-change');
 assert.equal(host.model.quotaSummary('codex'),'5 小时 剩 60%');assert.equal(host.get(),first);assert.equal(counts.views,1);
 for(const event of ['usage-data-change','pricing-change']){const before=host.get();values.rows=[];handlers.get(event)();assert.notEqual(host.get(),before);}
 const before=host.get();host.set({period:'7'});assert.notEqual(host.get(),before);assert.equal(host.get().state.period,'7');
});
