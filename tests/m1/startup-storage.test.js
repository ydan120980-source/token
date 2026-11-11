'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store } = require('../../src/m1/store');
const { fixtures } = require('./fixtures');
const { remove } = require('./temp');
test('unchanged startup preserves ledger bytes and timestamp; corrupt storage is still isolated and recreated', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'startup-storage-'));
  try {
    const fixture=fixtures(path.join(root,'home')),dir=path.join(root,'usage'),file=path.join(dir,'statistics.json');
    new Store(dir,fixture.roots);
    const bytes=fs.readFileSync(file);fs.utimesSync(file,new Date(1000000),new Date(1000000));
    const stamp=fs.statSync(file).mtimeMs;
    new Store(dir,fixture.roots);
    assert.deepEqual(fs.readFileSync(file),bytes);assert.equal(fs.statSync(file).mtimeMs,stamp);
    fs.writeFileSync(file,'broken synthetic ledger');
    const restored=new Store(dir,fixture.roots);
    assert(restored.recovered.some(row=>row.file==='statistics.json'));
    assert.doesNotThrow(()=>JSON.parse(fs.readFileSync(file,'utf8')));
    assert(fs.readdirSync(path.join(dir,'quarantine')).some(name=>fs.readFileSync(path.join(dir,'quarantine',name),'utf8')==='broken synthetic ledger'));
  }finally{await remove(root);}
});

test('a new projection releases stale session/workbench views even if the old pages are never reopened',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'projection-retention-'));
  try{
    const store=new Store(root,{});const old=store.snapshot();store.sessionList();store.workbench({period:'total',project:'all'});
    assert.equal(store._sessions.snapshot,old);assert.equal(store._workbench.snapshot,old);
    store.reprice();assert.notEqual(store.snapshot(),old);assert.equal(store._sessions,null);assert.equal(store._workbench,null);
    store.sessionList();store.workbench({period:'total',project:'all'});
    store.state.sequence++;const next=store.snapshot();
    assert.equal(next.sequence,store.state.sequence);assert.equal(store._sessions,null);assert.equal(store._workbench,null);
  }finally{await remove(root);}
});
