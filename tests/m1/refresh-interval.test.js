'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Service}=require('../../src/m1/service');
const {fixtures}=require('./fixtures');
const {remove}=require('./temp');
test('refresh cadence persists, rejects arbitrary timers and keeps pause/manual semantics',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'usage-cadence-')),source=fixtures(path.join(root,'home')),dir=path.join(root,'usage'),service=new Service(dir,source.roots);
  t.mock.timers.enable({apis:['setTimeout']});
  let reads=0;t.mock.method(service,'refresh',async()=>{reads++;return service.get();});
  try {
    assert.equal(service.get().refreshIntervalMs,15000);
    service.setRefreshInterval(5000);t.mock.timers.tick(4999);assert.equal(reads,0);t.mock.timers.tick(1);assert.equal(reads,1);
    const saved=fs.readFileSync(path.join(dir,'preferences.json'),'utf8');
    assert.throws(()=>service.setRefreshInterval(1),/REFRESH_INTERVAL_INVALID/);
    assert.equal(fs.readFileSync(path.join(dir,'preferences.json'),'utf8'),saved);
    service.setRefreshInterval(0);t.mock.timers.tick(100000);assert.equal(reads,1);assert.equal(service.get().enabled,true);
    await service.refresh();assert.equal(reads,2,'manual refresh remains available with timer off');
    service.setRefreshInterval(60000);await service.setEnabled(false);t.mock.timers.tick(120000);assert.equal(reads,2,'paused collection does not restart from the cadence control');
    const restarted=new Service(dir,source.roots);assert.equal(restarted.get().refreshIntervalMs,60000);assert.equal(restarted.get().enabled,false);await restarted.close();
  } finally {await service.close(); await remove(root);}
});
