'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite'),{_electron:electron}=require('playwright');
const {Store}=require('../../src/m1/store'),{roots}=require('../../src/m1/policy'),{scanSources}=require('../../src/m1/sources'),{verifyProjection}=require('../../src/m1/native'),{until,showView}=require('./ui-settle');
const output=path.resolve(process.env.RECOVERY_EVIDENCE_DIR||'artifacts/m2-agents-r4/recovery-ui');
async function run(first,scale) {
  const work=fs.mkdtempSync(path.join(os.tmpdir(),'agent-recovery-ui-'));
  try {
    const home=path.join(work,'home'),selected=roots(home),usage=path.join(work,'usage'),store=new Store(usage,selected),folder=path.join(selected.opencode[0],'storage/message'),mimoFile=path.join(selected.mimo[0],'mimocode.db');
    const time=Date.parse('2026-10-06T00:00:00Z'),obj=(input,out)=>({role:'assistant',id:'same-call',modelID:'gpt-4.1',time:{created:time},tokens:{input,output:out,reasoning:0,cache:{read:0,write:0}}});
    const putOpen=(name,row)=>{fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,name+'.json'),JSON.stringify(row));};
    const putMimo=row=>{fs.mkdirSync(path.dirname(mimoFile),{recursive:true});const db=new DatabaseSync(mimoFile);db.exec('CREATE TABLE IF NOT EXISTS message(id TEXT,session_id TEXT,data TEXT)');db.exec('DELETE FROM message');db.prepare('INSERT INTO message VALUES(?,?,?)').run('same-call','s',JSON.stringify(row));db.close();};
    // Deliberately scaled synthetic manual rates make the recovered UI price
    // legible; unit tests separately check the ordinary 1/2 USD-per-million rates.
    store.setPrice({provider:'openai',model:'gpt-4.1',inputUncached:10000,output:20000,cacheRead:0,cacheWrite:0});store.setBilling({autoSync:false,defaults:{},mappings:{}});
    if(first==='opencode')putOpen('a',obj(100,20));else putMimo(obj(100,20));
    store.ingest(await scanSources(selected,store.state.salt,{reads:0}),{status:'passed'});
    putOpen('a',obj(100,20));putOpen('b',obj(90,30));putMimo(obj(100,40));store.setEnabled(true);
    const files=[path.join(folder,'a.json'),path.join(folder,'b.json'),mimoFile],hashes=()=>files.map(file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')),before=hashes();
    const native=await verifyProjection((await scanSources(selected,store.state.salt,{reads:0})).opencode.records,path.join(work,'native'));assert.equal(native.status,'passed');assert.equal(native.tokens,140);
    const app=await electron.launch({executablePath:process.env.QUOTA_PACKAGED_EXE||require('electron'),args:[...(process.env.QUOTA_PACKAGED_EXE?[]:['src/quota/main.js']),'--usage-data-dir',usage,'--quota-data-dir',path.join(work,'quota'),'--m1-fixture-root',home,'--force-device-scale-factor='+scale],timeout:60000});
    try {
      const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      await until(page,async()=>{const s=await window.usageBridge.get();return !s.collecting&&s.snapshot.daily.some(r=>r.totalTokens===140);},60000);
      await showView(page,'usage');
      const state=await page.evaluate(()=>window.usageBridge.get()),row=state.snapshot.daily[0];assert.equal(row.agent,first);assert.equal(row.totalTokens,140);assert.equal(row.inputUncached,100);assert.equal(row.output,40);assert(Math.abs(row.estimatedCostUsd-1.8)<1e-12);assert.equal(Number(await page.locator('#totalCost .cost-value').getAttribute('data-cost-lower')),1.8);
      const label=await page.locator('#totalCost .cost-value').getAttribute('aria-label');assert(!label.includes('未定价'));assert(label.includes('1.80'));assert.deepEqual(hashes(),before);
      await page.locator('#totalCost').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,first+'-'+scale+'.png')});assert.deepEqual(errors,[]);
      return {first,scale,packaged:Boolean(process.env.QUOTA_PACKAGED_EXE),nativeTokens:native.tokens,actualCollector:true,knownBuckets:true,recoveredCostUsd:row.estimatedCostUsd,firstAttribution:true,sourceHashesUnchanged:true,label,errors};
    }finally{await app.close();}
  }finally{fs.rmSync(work,{recursive:true,force:true});}
}
(async()=>{fs.mkdirSync(output,{recursive:true});const results=[];for(const first of ['opencode','mimo'])for(const scale of [1,1.5])results.push(await run(first,scale));fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));})().catch(e=>{console.error(e.stack);process.exitCode=1;});
