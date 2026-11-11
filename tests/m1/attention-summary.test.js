'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store,atomic}=require('../../src/m1/store'),{StatisticsService}=require('../../src/m1/statistics-service');
const {normalize}=require('../../src/m1/normalize'),{fixtures}=require('./fixtures'),{remove}=require('./temp');
test('lightweight attention retains general omission counts independently of budget omissions',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'attention-summary-synthetic-'));let service;
  try{
    const home=path.join(root,'home'),fixture=fixtures(home),dir=path.join(root,'usage'),store=new Store(dir,fixture.roots);
    for(let i=0;i<510;i++){
      const record=normalize('codex',{input_tokens:100,output_tokens:20,total_tokens:120},{id:'omission-'+i,time:Date.now(),provider:'synthetic',model:'unknown-price-'+i,entry:'cli'},store.state.salt);
      store.state.records[record.id]=record;
    }
    store.state.sequence=1;atomic(path.join(dir,'statistics.json'),store.state);store.setEnabled(false);
    const expected=store.workbench({period:'total',project:'all'}),before=fs.readFileSync(path.join(dir,'statistics.json'));
    assert(expected.omittedIssues>0);assert.equal(expected.budgetOverview.omittedIssues,0);
    service=new StatisticsService(dir,fixture.roots,()=>{},{home,appData:path.join(home,'AppData/Roaming'),localAppData:path.join(home,'AppData/Local')},{offline:true});
    const actual=await service.attention();
    assert.equal(actual.omittedIssues,expected.omittedIssues);assert.equal(actual.budgetOverview.omittedIssues,0);
    assert.deepEqual(actual.issues,expected.issues);assert.deepEqual(Object.keys(actual).sort(),['budgetOverview','issues','omittedIssues','sources']);
    assert.deepEqual(fs.readFileSync(path.join(dir,'statistics.json')),before);
  }finally{await service?.close();await remove(root);}
});
