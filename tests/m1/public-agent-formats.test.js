'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const formats=require('./public-agent-formats'),{Service}=require('../../src/m1/service'),{Store}=require('../../src/m1/store'),{remove}=require('./temp');
test('pinned GitHub agent formats use mapped sources through preview, pricing, duplicate refresh, private exports and restart',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-formats-')),home=path.join(dir,'home'),usage=path.join(dir,'usage');t.after(()=>remove(dir));fs.mkdirSync(home);
  const service=new Service(usage,{},()=>{}, {home,appData:null,localAppData:null});service.store.setEnabled(false);
  try{
    service.store.setPrice({provider:'synthetic-public',model:'fixture-model',inputUncached:3,output:3,cacheRead:3,cacheWrite:3});
    for(const f of formats){
      const root=path.join(dir,f.name);fs.mkdirSync(root);const draft=service.custom.draft();service.custom.choose(draft.token,[root]);
      const invalid=structuredClone(f.record);if(f.name==='Triss')invalid.call_id=null;else delete invalid.id;
      fs.writeFileSync(path.join(root,'calls.jsonl'),[f.record,f.record,invalid].map(r=>JSON.stringify(r)).join('\n')+'\n');
      const preview=await service.custom.preview(draft.token,f.definition);assert.equal(preview.summary.records,1);assert.equal(preview.summary.totalTokens,f.expected);await service.custom.apply(preview.id);
      const r=service.store.records().find(r=>r.agent===draft.id);assert.equal(r.totalTokens,f.expected);assert(Math.abs(service.store.estimate(r).lower-f.expectedCost)<1e-12);
      const exported=JSON.stringify(service.custom.export(draft.id));for(const secret of [root,'synthetic-omp-call','synthetic-triss-call'])assert(!exported.includes(secret));
    }
    await service.refresh();const bytes=fs.readFileSync(path.join(usage,'statistics.json'));for(let i=0;i<5;i++)await service.refresh();assert.deepEqual(fs.readFileSync(path.join(usage,'statistics.json')),bytes);assert.equal(service.store.records().length,2);assert.equal(service.store.records().reduce((n,r)=>n+r.totalTokens,0),257);
    const view=service.store.workbench({period:'total'});assert(Math.abs(view.total.lower-.000771)<1e-12);assert.equal(new Store(usage,{}).records().length,2);
    assert.equal(service.get().audit.networkAttempts,0);assert.equal(service.get().audit.sourceWrites,0);
  }finally{await service.close();}
});
